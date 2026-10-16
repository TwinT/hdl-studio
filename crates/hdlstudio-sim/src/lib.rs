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
    monitored: bool,
}

/// What a step tells the engine's client (digitaljs's worker messages).
#[derive(Clone, Debug, PartialEq)]
pub enum Event {
    /// A monitored output changed (to one of its trigger values, if given).
    Monitor { id: u64, tick: u64, value: LogicVec, stop: bool, once: bool },
    Alarm { id: u64, tick: u64, stop: bool },
    /// The circuit wrote a memory word.
    Memory { path: String, addr: usize, value: LogicVec },
    /// An FSM moved to another state.
    FsmState { path: String, state: i64 },
}

struct Monitor {
    net: NetId,
    triggers: Option<Vec<LogicVec>>,
    stop: bool,
    once: bool,
}

/// Names in one (sub)circuit instance, for scripts: digitaljs's label index.
#[derive(Default)]
struct Labels {
    /// Connector name to the net it carries.
    wires: HashMap<String, NetId>,
    /// Subcircuit label to its instance.
    subcircuits: HashMap<String, usize>,
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
    /// Every cell by path, and each cell's path.
    cell_ids: HashMap<String, CellId>,
    cell_paths: Vec<String>,
    labels: Vec<Labels>,
    /// Top-level inputs and outputs by `net`: the cell, and the net an
    /// output shows.
    inputs: HashMap<String, CellId>,
    outputs: HashMap<String, NetId>,
    monitors: HashMap<u64, Monitor>,
    /// Monitored values that changed this tick, by monitor id.
    checks: BTreeMap<u64, LogicVec>,
    alarms: HashMap<u64, u64>,
    alarm_queue: BTreeMap<u64, Vec<(u64, bool)>>,
    events: Vec<Event>,
    stop: bool,
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

    /// Moves time forward to `tick` (no earlier than now) when nothing is
    /// queued before it: a rate-limited run's empty ticks.
    pub fn skip_to(&mut self, tick: u64) {
        debug_assert!(self.next_event_tick().is_none_or(|k| k >= tick));
        self.tick = self.tick.max(tick);
    }

    /// The next tick with events, if any.
    pub fn next_event_tick(&self) -> Option<u64> {
        self.queue.first_key_value().map(|(&k, _)| k)
    }

    pub fn value(&self, probe: &Probe) -> &LogicVec {
        &self.nets[probe.net as usize].value
    }

    /// The probe of a cell output, by digitaljs path and port.
    pub fn find_probe(&self, path: &str, port: &str) -> Option<usize> {
        self.probes.binary_search_by(|p| (p.path.as_str(), p.port.as_str()).cmp(&(path, port))).ok()
    }

    /// The probes reading `net`'s value.
    pub fn net_of(&self, probe: usize) -> NetId {
        self.probes[probe].net
    }

    pub fn net_value(&self, net: NetId) -> &LogicVec {
        &self.nets[net as usize].value
    }

    /// A named wire (connector name) in the subcircuit reached through the
    /// subcircuit labels `path`.
    pub fn find_wire(&self, path: &[&str], name: &str) -> Option<NetId> {
        let mut inst = 0;
        for label in path {
            inst = *self.labels[inst].subcircuits.get(*label)?;
        }
        self.labels[inst].wires.get(name).copied()
    }

    /// A top-level input or output cell by its `net` (the Verilog port name):
    /// the input's device id, or the net the output shows.
    pub fn find_input(&self, net: &str) -> Option<&str> {
        self.inputs.get(net).map(|&c| self.cell_paths[c as usize].as_str())
    }

    pub fn find_output(&self, net: &str) -> Option<NetId> {
        self.outputs.get(net).copied()
    }

    /// The net a top-level output cell (by device id) shows.
    pub fn find_output_id(&self, device: &str) -> Option<NetId> {
        let c = &self.cells[*self.top_cells.get(device)? as usize];
        if c.outputs.is_empty() { c.inputs.first().copied() } else { None }
    }

    /// The width of a top-level input.
    pub fn input_bits(&self, device: &str) -> Option<usize> {
        let &c = self.top_cells.get(device)?;
        let &net = self.cells[c as usize].outputs.first()?;
        Some(self.nets[net as usize].value.bits())
    }

    /// Events since the last call, and whether one of them asked to stop.
    pub fn take_events(&mut self) -> (Vec<Event>, bool) {
        (std::mem::take(&mut self.events), std::mem::take(&mut self.stop))
    }

    /// Reports `net` changes as `id`: after each tick it changed in, if its
    /// value is one of `triggers` (any, if `None`); `once` drops the monitor
    /// when it fires, `stop` asks the client to stop running. Without
    /// triggers the current value is reported right away (digitaljs's
    /// worker `monitor`).
    pub fn monitor(&mut self, id: u64, net: NetId, triggers: Option<Vec<LogicVec>>, stop: bool, once: bool) {
        if triggers.is_none() {
            let value = self.nets[net as usize].value.clone();
            self.events.push(Event::Monitor { id, tick: self.tick, value, stop: false, once: false });
        }
        self.nets[net as usize].monitored = true;
        self.monitors.insert(id, Monitor { net, triggers, stop, once });
    }

    pub fn unmonitor(&mut self, id: u64) {
        self.monitors.remove(&id);
        self.checks.remove(&id);
    }

    /// Reports `id` once ticks reach `tick` (the next tick if that already
    /// happened: the client's view of the tick can be stale).
    pub fn alarm(&mut self, id: u64, tick: u64, stop: bool) {
        let tick = tick.max(self.tick + 1);
        self.alarms.insert(id, tick);
        self.alarm_queue.entry(tick).or_default().push((id, stop));
        // runs stop at the tick before, as they do at a tick with events
        let spare = &mut self.spare;
        self.queue.entry(tick - 1).or_insert_with(|| spare.pop().unwrap_or_default());
    }

    pub fn unalarm(&mut self, id: u64) {
        if let Some(tick) = self.alarms.remove(&id)
            && let Some(ids) = self.alarm_queue.get_mut(&tick)
        {
            ids.retain(|&(i, _)| i != id);
        }
    }

    /// Changes a cell parameter while running; only a cell's propagation
    /// delay (a Clock's half period) affects the simulation.
    pub fn set_propagation(&mut self, path: &str, propagation: u64) -> Result<(), String> {
        let &c = self.cell_ids.get(path).ok_or_else(|| format!("no cell {path}"))?;
        self.sched[c as usize].propagation = propagation;
        Ok(())
    }

    /// A memory word written by hand (the memory editor); the memory then
    /// runs again.
    pub fn write_memory(&mut self, path: &str, addr: usize, value: LogicVec) -> Result<(), String> {
        let &c = self.cell_ids.get(path).ok_or_else(|| format!("no cell {path}"))?;
        let Op::Memory(m) = &mut self.cells[c as usize].op else { return Err(format!("{path} isn't a memory")) };
        if addr >= m.mem.len() || value.bits() != m.mem.bits() {
            return Err(format!("bad memory write to {path}"));
        }
        m.mem.set(addr, value);
        self.enqueue(c);
        Ok(())
    }

    /// After a step: monitored values and alarms (digitaljs's
    /// `_postMonitors`).
    fn post_monitors(&mut self) {
        for (id, value) in std::mem::take(&mut self.checks) {
            let Some(m) = self.monitors.get(&id) else { continue };
            if m.triggers.as_ref().is_none_or(|t| t.contains(&value)) {
                let (stop, once) = (m.stop, m.once);
                if once {
                    self.unmonitor(id);
                }
                self.events.push(Event::Monitor { id, tick: self.tick, value, stop, once });
                self.stop |= stop;
            }
        }
        if let Some(ids) = self.alarm_queue.remove(&self.tick) {
            for (id, stop) in ids {
                self.alarms.remove(&id);
                self.events.push(Event::Alarm { id, tick: self.tick, stop });
                self.stop |= stop;
            }
        }
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
    pub fn update_gates(&mut self) -> Result<usize, String> {
        if self.queue.first_key_value().is_some_and(|(&k, _)| k == self.tick) {
            self.update_gates_next()
        } else {
            self.tick += 1;
            self.post_monitors();
            Ok(0)
        }
    }

    /// Jumps to the next tick with events and runs it; returns how many
    /// cells ran. A zero-delay loop that never settles (each cell running
    /// over and over in the same tick) is an error, where digitaljs hangs.
    pub fn update_gates_next(&mut self) -> Result<usize, String> {
        let Some((k, entries)) = self.queue.pop_first() else {
            self.post_monitors();
            return Ok(0);
        };
        // ponytail: a fixed budget per cell; no real circuit gets near it
        let limit = 100 * self.cells.len() + 10_000;
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
            match &mut self.cells[e.cell as usize].op {
                Op::Memory(m) if !m.writes.is_empty() => {
                    for (addr, value) in m.writes.drain(..) {
                        let path = self.cell_paths[e.cell as usize].clone();
                        self.events.push(Event::Memory { path, addr, value });
                    }
                }
                Op::Fsm(f) if f.moved => {
                    f.moved = false;
                    let path = self.cell_paths[e.cell as usize].clone();
                    self.events.push(Event::FsmState { path, state: f.state() });
                }
                _ => {}
            }
            count += 1;
            if count > limit {
                self.running = false;
                self.current = TickQueue::default();
                self.tick = k + 1;
                return Err(format!("combinational loop did not settle in tick {k}"));
            }
        }
        self.running = false;
        let mut done = std::mem::take(&mut self.current);
        done.entries.clear();
        done.copies.clear();
        self.spare.push(done);
        self.tick = k + 1;
        self.post_monitors();
        Ok(count)
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
        if n.monitored {
            let value = &self.nets[net as usize].value;
            for (&id, m) in &self.monitors {
                if m.net == net {
                    self.checks.insert(id, value.clone());
                }
            }
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
        cell_paths: Vec<String>,
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
                                self.nets.push(Net { value: v.clone(), fanout: vec![], changed: false, monitored: false });
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
                        self.cell_paths.push(prefix);
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
            self.nets.push(Net { value: LogicVec::xes(bits), fanout: vec![], changed: false, monitored: false });
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
            cell_paths: vec![],
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
        // names for scripts (digitaljs's makeLabelIndex)
        let mut labels = vec![];
        for inst in 0..b.insts.len() {
            let mut l = Labels::default();
            for c in &b.insts[inst].circuit.connectors {
                if let (Some(name), Some(net)) = (&c.name, b.net_from(inst, &c.from.id, &c.from.port)) {
                    l.wires.insert(name.clone(), net);
                }
            }
            for (id, dev) in &b.insts[inst].circuit.devices {
                if let (Some(label), Some(&child)) = (&dev.label, b.insts[inst].subs.get(id)) {
                    l.subcircuits.insert(label.clone(), child);
                }
            }
            labels.push(l);
        }
        let (mut inputs, mut outputs) = (HashMap::new(), HashMap::new());
        for (id, dev) in &circuit.devices {
            match &dev.cell {
                Cell::Input(io) | Cell::Button(io) | Cell::NumEntry(io) | Cell::PushButton(io) => {
                    inputs.insert(io.net.clone(), b.insts[0].cells[id]);
                }
                Cell::Output(io) | Cell::Lamp(io) | Cell::NumDisplay(io) | Cell::Display7(io) | Cell::LedMatrix(io) => {
                    let net = match b.net_into(0, id, "in") {
                        Some(n) => n,
                        None => b.undriven(io.bits as usize),
                    };
                    outputs.insert(io.net.clone(), net);
                }
                _ => {}
            }
        }
        let top_cells = b.insts[0].cells.clone();
        let cell_ids = b.cell_paths.iter().enumerate().map(|(i, p)| (p.clone(), i as CellId)).collect();
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
            cell_ids,
            cell_paths: b.cell_paths,
            labels,
            inputs,
            outputs,
            monitors: HashMap::new(),
            checks: BTreeMap::new(),
            alarms: HashMap::new(),
            alarm_queue: BTreeMap::new(),
            events: vec![],
            stop: false,
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
        sim.update_gates()?;
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
