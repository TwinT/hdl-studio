//! Event-driven simulator of HDL Studio circuits, with the semantics of
//! digitaljs's WorkerEngine (what the extension used to run):
//! - each cell runs `propagation` ticks after an input changes, on a copy
//!   of its inputs taken when it was queued (transport delay); queued again
//!   for the same tick, its copy is refreshed and it keeps its place. The
//!   copy is taken lazily: only when an input changes after the tick the
//!   cell was queued in, else it runs on its current inputs;
//! - a tick's queue runs in order, zero-delay cells joining at the end;
//! - subcircuits add neither delay nor events, so the hierarchy is
//!   flattened: a net goes from its real driver straight to every cell that
//!   reads it, in digitaljs's propagation order.
// Copyright (c) Marek Materzok (digitaljs), BSD-2-Clause.

mod cells;
mod int;

use cells::{Op, Spec};
use hdlstudio_logic::LogicVec;
use hdlstudio_netlist::{Cell, Circuit};
use std::collections::{BTreeMap, HashMap};

type CellId = u32;
type NetId = u32;
/// A queue entry that does nothing (a skipped special cell, or one that
/// already ran this tick): it only keeps its tick in the queue.
const PHANTOM: CellId = CellId::MAX;

struct SimCell {
    op: Op,
    inputs: Vec<NetId>,
    outputs: Vec<NetId>,
}

/// What the scheduler reads for every queued cell, kept apart and small.
#[derive(Clone, Copy)]
struct Sched {
    propagation: u64,
    special: bool,
    /// Where the cell was last queued (tick, index), to refresh that entry.
    last: (u64, u32),
    /// The tick that entry was queued in, while it has no copy of the
    /// inputs (`NONE`): only the latest entry can lack one.
    lazy_since: u64,
}

const NONE: u64 = u64::MAX;

struct Net {
    value: LogicVec,
    /// Cells to queue when the value changes, in digitaljs's order.
    fanout: Vec<CellId>,
    changed: bool,
}

/// A cell's inputs (or outputs) when it runs: its queued copy, or the
/// current values of its nets.
pub(crate) struct Args<'a> {
    nets: &'a [Net],
    ids: &'a [NetId],
    copy: Option<&'a [LogicVec]>,
}

impl Args<'_> {
    pub(crate) fn len(&self) -> usize {
        self.ids.len()
    }
}

impl std::ops::Index<usize> for Args<'_> {
    type Output = LogicVec;
    fn index(&self, i: usize) -> &LogicVec {
        match self.copy {
            Some(c) => &c[i],
            None => &self.nets[self.ids[i] as usize].value,
        }
    }
}

struct Entry {
    cell: CellId,
    /// Where the inputs to run on start in the tick's `copies`; `NONE`:
    /// the current ones.
    copy: u32,
}

/// The cells queued for one tick, and the input copies some of them run on.
#[derive(Default)]
struct TickQueue {
    entries: Vec<Entry>,
    copies: Vec<LogicVec>,
}

const NO_COPY: u32 = u32::MAX;

/// A digitaljs cell output, by hierarchical path ("dev3/dev12") and port.
pub struct Probe {
    pub path: String,
    pub port: String,
    net: NetId,
}

pub struct Sim {
    cells: Vec<SimCell>,
    sched: Vec<Sched>,
    nets: Vec<Net>,
    tick: u64,
    queue: BTreeMap<u64, TickQueue>,
    /// The queue of the tick being run, while it runs.
    current: TickQueue,
    /// Emptied queues, reused for later ticks.
    spare: Vec<TickQueue>,
    running: bool,
    changed: Vec<NetId>,
    /// Sorted by path, then port.
    pub probes: Vec<Probe>,
    top_cells: HashMap<String, CellId>,
}

impl Sim {
    /// `defaultcomb`: combinational cells without their own propagation
    /// settle in zero ticks (digitaljs's `defaultCombinationalPropagation: 0`).
    pub fn new(circuit: &Circuit, defaultcomb: bool) -> Result<Sim, String> {
        build::build(circuit, defaultcomb)
    }

    pub fn tick(&self) -> u64 {
        self.tick
    }

    pub fn has_pending_events(&self) -> bool {
        !self.queue.is_empty()
    }

    /// The next tick with events, if any.
    pub fn next_event_tick(&self) -> Option<u64> {
        self.queue.first_key_value().map(|(&k, _)| k)
    }

    pub fn value(&self, probe: &Probe) -> &LogicVec {
        &self.nets[probe.net as usize].value
    }

    /// Sets a top-level input cell (by device id) to `v`.
    pub fn set_input(&mut self, device: &str, v: LogicVec) -> Result<(), String> {
        let &c = self.top_cells.get(device).ok_or_else(|| format!("no input {device}"))?;
        let &net = self.cells[c as usize].outputs.first().ok_or_else(|| format!("{device} isn't an input"))?;
        if self.nets[net as usize].value.bits() != v.bits() {
            return Err("setInput: wrong number of bits".into());
        }
        self.set_net(net, v);
        Ok(())
    }

    /// Runs the current tick if it has events, else just moves past it.
    pub fn update_gates(&mut self) -> usize {
        if self.queue.first_key_value().is_some_and(|(&k, _)| k == self.tick) {
            self.update_gates_next()
        } else {
            self.tick += 1;
            0
        }
    }

    /// Jumps to the next tick with events and runs it; returns how many
    /// cells ran.
    pub fn update_gates_next(&mut self) -> usize {
        let Some((k, entries)) = self.queue.pop_first() else { return 0 };
        self.tick = k;
        self.current = entries;
        self.running = true;
        let mut count = 0;
        let mut multi = Vec::new();
        let mut i = 0;
        while i < self.current.entries.len() {
            let e = std::mem::replace(&mut self.current.entries[i], Entry { cell: PHANTOM, copy: NO_COPY });
            i += 1;
            if e.cell == PHANTOM {
                continue;
            }
            let s = &mut self.sched[e.cell as usize];
            if s.last == (k, i as u32 - 1) {
                s.lazy_since = NONE;
            }
            if s.special {
                continue;
            }
            let c = &mut self.cells[e.cell as usize];
            let copy = (e.copy != NO_COPY).then(|| &self.current.copies[e.copy as usize..][..c.inputs.len()]);
            let args = Args { nets: &self.nets, ids: &c.inputs, copy };
            let cur = Args { nets: &self.nets, ids: &c.outputs, copy: None };
            let (v, again) = c.op.eval(&args, &cur, &mut multi);
            if again {
                self.enqueue(e.cell);
            }
            if let Some(v) = v {
                let net = self.cells[e.cell as usize].outputs[0];
                self.set_net(net, v);
            }
            for (port, v) in multi.drain(..) {
                let net = self.cells[e.cell as usize].outputs[port];
                self.set_net(net, v);
            }
            count += 1;
        }
        self.running = false;
        let mut done = std::mem::take(&mut self.current);
        done.entries.clear();
        done.copies.clear();
        self.spare.push(done);
        self.tick = k + 1;
        count
    }

    /// Nets whose value changed since the last call.
    pub fn take_changed(&mut self) -> Vec<NetId> {
        for &n in &self.changed {
            self.nets[n as usize].changed = false;
        }
        std::mem::take(&mut self.changed)
    }

    fn set_net(&mut self, net: NetId, v: LogicVec) {
        if self.nets[net as usize].value == v {
            return;
        }
        let fanout = std::mem::take(&mut self.nets[net as usize].fanout);
        let n = &mut self.nets[net as usize];
        let old = std::mem::replace(&mut n.value, v);
        if !n.changed {
            n.changed = true;
            self.changed.push(net);
        }
        for &c in &fanout {
            // a reader queued in an earlier tick keeps the inputs it was
            // queued with: none changed since but this net, still lazy
            let since = self.sched[c as usize].lazy_since;
            if since != NONE && since < self.tick {
                self.snapshot(c, net, &old);
            }
            self.enqueue(c);
        }
        self.nets[net as usize].fanout = fanout;
    }

    /// Gives the cell's latest entry a copy of its inputs, `net` at `old`.
    fn snapshot(&mut self, c: CellId, net: NetId, old: &LogicVec) {
        let s = &mut self.sched[c as usize];
        let (target, slot) = s.last;
        s.lazy_since = NONE;
        let q = if self.running && target == self.tick { &mut self.current } else { self.queue.get_mut(&target).unwrap() };
        q.entries[slot as usize].copy = q.copies.len() as u32;
        for &n in &self.cells[c as usize].inputs {
            q.copies.push(if n == net { old.clone() } else { self.nets[n as usize].value.clone() });
        }
    }

    fn enqueue(&mut self, c: CellId) {
        let s = &mut self.sched[c as usize];
        let target = self.tick + s.propagation;
        let (last_tick, slot) = s.last;
        s.lazy_since = self.tick;
        let q = if self.running && target == self.tick {
            &mut self.current
        } else {
            let spare = &mut self.spare;
            self.queue.entry(target).or_insert_with(|| spare.pop().unwrap_or_default())
        };
        if last_tick == target && q.entries.get(slot as usize).is_some_and(|e| e.cell == c) {
            q.entries[slot as usize].copy = NO_COPY;
        } else {
            self.sched[c as usize].last = (target, q.entries.len() as u32);
            q.entries.push(Entry { cell: c, copy: NO_COPY });
        }
    }
}

mod build {
    //! Flattening a circuit into cells and nets.

    use super::*;

    /// One instance of a (sub)circuit.
    struct Inst<'a> {
        circuit: &'a Circuit,
        path: String,
        /// The subcircuit device this instance is, in its parent instance.
        parent: Option<(usize, String)>,
        cells: HashMap<String, CellId>,
        subs: HashMap<String, usize>,
        /// Connector into each (device, port), and out of each, in order.
        into: HashMap<(String, String), (String, String)>,
        from: HashMap<(String, String), Vec<(String, String)>>,
    }

    struct Builder<'a> {
        subcircuits: &'a indexmap::IndexMap<String, Circuit>,
        insts: Vec<Inst<'a>>,
        cells: Vec<SimCell>,
        sched: Vec<Sched>,
        specs: Vec<Spec>,
        nets: Vec<Net>,
        passthrough: bool,
        defaultcomb: bool,
    }

    fn key(id: &str, port: &str) -> (String, String) {
        (id.to_string(), port.to_string())
    }

    fn io_net(cell: &Cell) -> Option<&str> {
        match cell {
            Cell::Input(io) | Cell::Output(io) => Some(&io.net),
            _ => None,
        }
    }

    impl<'a> Builder<'a> {
        fn add_inst(&mut self, circuit: &'a Circuit, path: String, parent: Option<(usize, String)>) -> Result<usize, String> {
            let idx = self.insts.len();
            let mut into = HashMap::new();
            let mut from: HashMap<_, Vec<_>> = HashMap::new();
            for c in &circuit.connectors {
                into.insert(key(&c.to.id, &c.to.port), key(&c.from.id, &c.from.port));
                from.entry(key(&c.from.id, &c.from.port)).or_default().push(key(&c.to.id, &c.to.port));
            }
            let nested = parent.is_some();
            self.insts.push(Inst { circuit, path, parent, cells: HashMap::new(), subs: HashMap::new(), into, from });
            // preorder, the order digitaljs's worker gets its cells in
            for (id, dev) in &circuit.devices {
                let prefix = format!("{}{id}", self.insts[idx].path);
                match &dev.cell {
                    Cell::Subcircuit { celltype } => {
                        let sub = self.subcircuits.get(celltype).ok_or_else(|| format!("no subcircuit {celltype}"))?;
                        self.passthrough = true;
                        let child = self.add_inst(sub, prefix + "/", Some((idx, id.clone())))?;
                        self.insts[idx].subs.insert(id.clone(), child);
                    }
                    Cell::Input(_) | Cell::Output(_) if nested => self.passthrough = true,
                    cell => {
                        let mut spec = cells::spec(cell)?;
                        if let Some(p) = dev.propagation {
                            spec.propagation = p;
                        } else if self.defaultcomb && spec.op.combinational() {
                            spec.propagation = 0;
                        }
                        let outputs = spec
                            .initial
                            .iter()
                            .map(|v| {
                                self.nets.push(Net { value: v.clone(), fanout: vec![], changed: false });
                                (self.nets.len() - 1) as NetId
                            })
                            .collect();
                        let id_ = self.cells.len() as CellId;
                        self.cells.push(SimCell { op: spec.op.clone(), inputs: vec![], outputs });
                        self.sched.push(Sched {
                            propagation: spec.propagation as u64,
                            special: spec.special,
                            last: (u64::MAX, 0),
                            lazy_since: NONE,
                        });
                        self.specs.push(spec);
                        self.insts[idx].cells.insert(id.clone(), id_);
                    }
                }
            }
            Ok(idx)
        }

        fn device(&self, inst: usize, id: &str) -> &'a Cell {
            &self.insts[inst].circuit.devices[id].cell
        }

        /// The device (in a subcircuit instance) that is its port `net`.
        fn io_device(&self, inst: usize, net: &str, output: bool) -> Option<String> {
            self.insts[inst].circuit.devices.iter().find_map(|(id, d)| match (&d.cell, output) {
                (Cell::Output(io), true) | (Cell::Input(io), false) if io.net == net => Some(id.clone()),
                _ => None,
            })
        }

        /// The net driving input `port` of device `id`, if any.
        fn net_into(&self, inst: usize, id: &str, port: &str) -> Option<NetId> {
            let (sid, sport) = self.insts[inst].into.get(&key(id, port))?;
            self.net_from(inst, sid, sport)
        }

        /// The net of output `port` of device `id`, through subcircuits.
        fn net_from(&self, inst: usize, id: &str, port: &str) -> Option<NetId> {
            let i = &self.insts[inst];
            if let Some(&c) = i.cells.get(id) {
                let spec = &self.specs[c as usize];
                let n = spec.outputs.iter().position(|(p, _)| p == port)?;
                return Some(self.cells[c as usize].outputs[n]);
            }
            if let Some(&child) = i.subs.get(id) {
                let out = self.io_device(child, port, true)?;
                return self.net_into(child, &out, "in");
            }
            // an Input inside a subcircuit: whatever drives the subcircuit's port
            let (parent, sub) = i.parent.as_ref()?;
            self.net_into(*parent, sub, io_net(self.device(inst, id))?)
        }

        /// The cells to queue when output `port` of device `id` changes, in
        /// digitaljs's order (connectors in order, through subcircuits).
        fn fanout(&self, inst: usize, id: &str, port: &str, out: &mut Vec<CellId>) {
            let i = &self.insts[inst];
            for (tid, tport) in i.from.get(&key(id, port)).into_iter().flatten() {
                if let Some(&c) = i.cells.get(tid) {
                    // a top-level Output is never queued (no subcircuit to forward to)
                    if !matches!(self.device(inst, tid), Cell::Output(_)) {
                        out.push(c);
                    }
                } else if let Some(&child) = i.subs.get(tid) {
                    if let Some(input) = self.io_device(child, tport, false) {
                        self.fanout(child, &input, "out", out);
                    }
                } else if let (Some((parent, sub)), Some(net)) = (&i.parent, io_net(self.device(inst, tid))) {
                    self.fanout(*parent, sub, net, out);
                }
            }
        }

        fn undriven(&mut self, bits: usize) -> NetId {
            self.nets.push(Net { value: LogicVec::xes(bits), fanout: vec![], changed: false });
            (self.nets.len() - 1) as NetId
        }
    }

    pub fn build(circuit: &Circuit, defaultcomb: bool) -> Result<Sim, String> {
        let empty = indexmap::IndexMap::new();
        let mut b = Builder {
            subcircuits: circuit.subcircuits.as_ref().unwrap_or(&empty),
            insts: vec![],
            cells: vec![],
            sched: vec![],
            specs: vec![],
            nets: vec![],
            passthrough: false,
            defaultcomb,
        };
        b.add_inst(circuit, String::new(), None)?;
        let mut probes = vec![];
        for inst in 0..b.insts.len() {
            let path = b.insts[inst].path.clone();
            for (id, dev) in &b.insts[inst].circuit.devices {
                let devpath = format!("{path}{id}");
                if let Some(&c) = b.insts[inst].cells.get(id) {
                    // inputs, and the fanout of each output
                    let ins = b.specs[c as usize].inputs.clone();
                    let mut nets = vec![];
                    for (port, bits) in &ins {
                        let n = match b.net_into(inst, id, port) {
                            Some(n) => n,
                            None => b.undriven(*bits),
                        };
                        nets.push(n);
                    }
                    b.cells[c as usize].inputs = nets;
                    let outs = b.specs[c as usize].outputs.clone();
                    for (n, (port, _)) in outs.iter().enumerate() {
                        let mut fanout = vec![];
                        b.fanout(inst, id, port, &mut fanout);
                        let net = b.cells[c as usize].outputs[n];
                        b.nets[net as usize].fanout = fanout;
                        probes.push(Probe { path: devpath.clone(), port: port.clone(), net });
                    }
                } else if let Some(&child) = b.insts[inst].subs.get(id) {
                    // a subcircuit's outputs are its Output devices' inputs
                    for d in b.insts[child].circuit.devices.values() {
                        if let Cell::Output(io) = &d.cell {
                            let out = b.io_device(child, &io.net, true).unwrap();
                            let net = match b.net_into(child, &out, "in") {
                                Some(n) => n,
                                None => b.undriven(io.bits as usize),
                            };
                            probes.push(Probe { path: devpath.clone(), port: io.net.clone(), net });
                        }
                    }
                } else if let Cell::Input(io) = &dev.cell {
                    let (parent, sub) = b.insts[inst].parent.clone().unwrap();
                    let net = match b.net_into(parent, &sub, &io.net) {
                        Some(n) => n,
                        None => b.undriven(io.bits as usize),
                    };
                    probes.push(Probe { path: devpath, port: "out".into(), net });
                }
            }
        }
        probes.sort_by(|a, b| (&a.path, &a.port).cmp(&(&b.path, &b.port)));
        let top_cells = b.insts[0].cells.clone();
        let mut sim = Sim {
            cells: b.cells,
            sched: b.sched,
            nets: b.nets,
            tick: 0,
            queue: BTreeMap::new(),
            current: TickQueue::default(),
            spare: vec![],
            running: false,
            changed: vec![],
            probes,
            top_cells,
        };
        // the worker queues every cell as it gets it
        for c in 0..sim.cells.len() {
            sim.enqueue(c as CellId);
        }
        if b.passthrough {
            sim.queue.entry(0).or_default().entries.push(Entry { cell: PHANTOM, copy: NO_COPY });
        }
        Ok(sim)
    }
}

/// The differential harness's trace (see test/simdiff/trace.mjs): every
/// cell output's initial value, then each tick's end values that changed.
/// `stimulus` is `(tick, top-level device id, binary value)`, by tick.
pub fn trace(circuit: &Circuit, ticks: u64, stimulus: &[(u64, String, String)], defaultcomb: bool) -> Result<Vec<String>, String> {
    let mut sim = Sim::new(circuit, defaultcomb)?;
    let mut by_net: HashMap<NetId, Vec<usize>> = HashMap::new();
    let mut last = Vec::with_capacity(sim.probes.len());
    let mut lines = vec![];
    for (i, p) in sim.probes.iter().enumerate() {
        by_net.entry(p.net).or_default().push(i);
        let v = sim.value(p).to_bin();
        lines.push(format!("init {}.{} {v}", p.path, p.port));
        last.push(v);
    }
    sim.take_changed();
    let mut next = stimulus.iter().peekable();
    for t in 0..ticks {
        while let Some((_, id, v)) = next.next_if(|s| s.0 == t) {
            let v = LogicVec::from_bin(v, Some(v.len())).ok_or("bad stimulus value")?;
            sim.set_input(id, v)?;
        }
        sim.update_gates();
        let mut idx: Vec<usize> = sim.take_changed().iter().flat_map(|n| by_net.get(n).into_iter().flatten().copied()).collect();
        idx.sort_unstable();
        idx.dedup();
        for i in idx {
            let p = &sim.probes[i];
            let v = sim.value(p).to_bin();
            if v != last[i] {
                lines.push(format!("{t} {}.{} {v}", p.path, p.port));
                last[i] = v;
            }
        }
    }
    Ok(lines)
}
