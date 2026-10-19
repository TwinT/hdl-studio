//! Rewrites that make the schematic
//! smaller (repeaters out, negations folded into gates, small constants
//! folded into arithmetic, n-ary gates, binary muxes from one-hot ones,
//! flip-flops with enable). Each runs to a fixpoint, always rewriting the
//! first device (in device order) it applies to, like the JS.

use hdlstudio_logic::LogicVec;
use hdlstudio_netlist::*;
use indexmap::IndexMap;
use std::collections::{BTreeMap, BTreeSet, HashMap};

type Id = u32;

struct Model {
    devices: IndexMap<String, Device>,
    // Connector ids only grow, so id order is creation order: the order JS
    // returns them in (integer-keyed objects iterate ascending).
    connectors: BTreeMap<Id, Connector>,
    forward: HashMap<String, BTreeSet<Id>>,
    backward: HashMap<String, BTreeSet<Id>>,
    count: Id,
}

impl Model {
    fn new(c: Circuit) -> Model {
        let mut m = Model {
            devices: IndexMap::new(),
            connectors: BTreeMap::new(),
            forward: HashMap::new(),
            backward: HashMap::new(),
            count: 0,
        };
        for (id, dev) in c.devices {
            m.add_device(dev, id);
        }
        for conn in c.connectors {
            m.add_connector(conn, &[]);
        }
        m
    }

    fn add_device(&mut self, dev: Device, id: String) {
        self.forward.insert(id.clone(), BTreeSet::new());
        self.backward.insert(id.clone(), BTreeSet::new());
        self.devices.insert(id, dev);
    }

    fn dev(&self, id: &str) -> Option<&Cell> {
        self.devices.get(id).map(|d| &d.cell)
    }

    fn remove_device(&mut self, id: &str) {
        self.devices.shift_remove(id);
        let conns: Vec<Id> = self.forward[id].iter().chain(&self.backward[id]).copied().collect();
        for c in conns {
            self.remove_connector(c);
        }
    }

    /// A connector without a name or source positions takes them from the
    /// ones it replaces.
    fn add_connector(&mut self, mut conn: Connector, from: &[&Connector]) {
        if conn.name.is_none() {
            conn.name = from.iter().find_map(|c| c.name.clone());
        }
        if conn.source_positions.is_none() {
            conn.source_positions =
                Some(from.iter().flat_map(|c| c.source_positions.iter().flatten().cloned()).collect());
        }
        self.count += 1;
        self.forward.entry(conn.from.id.clone()).or_default().insert(self.count);
        self.backward.entry(conn.to.id.clone()).or_default().insert(self.count);
        self.connectors.insert(self.count, conn);
    }

    fn remove_connector(&mut self, id: Id) {
        let c = self.connectors.remove(&id).unwrap();
        self.forward.get_mut(&c.from.id).unwrap().remove(&id);
        self.backward.get_mut(&c.to.id).unwrap().remove(&id);
    }

    fn conns(&self, ids: Option<&BTreeSet<Id>>, keep: impl Fn(&Connector) -> bool) -> Vec<Connector> {
        ids.into_iter().flatten().map(|i| &self.connectors[i]).filter(|c| keep(c)).cloned().collect()
    }

    fn outputs(&self, id: &str) -> Vec<Connector> {
        self.conns(self.forward.get(id), |_| true)
    }

    fn inputs(&self, id: &str) -> Vec<Connector> {
        self.conns(self.backward.get(id), |_| true)
    }

    fn output_port(&self, id: &str, port: &str) -> Vec<Connector> {
        self.conns(self.forward.get(id), |c| c.from.port == port)
    }

    fn input_port(&self, id: &str, port: &str) -> Vec<Connector> {
        self.conns(self.backward.get(id), |c| c.to.port == port)
    }

    fn connect(&mut self, from: &Endpoint, id: &str, port: &str, replaces: &[&Connector]) {
        let to = Endpoint { id: id.into(), port: port.into() };
        self.add_connector(Connector { from: from.clone(), to, name: None, source_positions: None }, replaces);
    }

    fn transform(&mut self, f: fn(&mut Model, &str) -> bool) {
        // ponytail: restarts from the first device after every rewrite, like
        // the JS; quadratic, fine for the netlists students write
        'again: loop {
            let ids: Vec<String> = self.devices.keys().cloned().collect();
            for id in ids {
                if self.devices.contains_key(&id) && f(self, &id) {
                    continue 'again;
                }
            }
            break;
        }
    }

    fn into_circuit(self) -> Circuit {
        Circuit { devices: self.devices, connectors: self.connectors.into_values().collect(), subcircuits: None }
    }
}

fn remove_repeater(m: &mut Model, id: &str) -> bool {
    if !matches!(m.dev(id), Some(Cell::Repeater(_))) {
        return false;
    }
    let (outs, ins) = (m.output_port(id, "out"), m.input_port(id, "in"));
    m.remove_device(id);
    for i in ins.iter().filter(|c| c.from.id != id) {
        for o in outs.iter().filter(|c| c.to.id != id) {
            m.connect(&i.from, &o.to.id, &o.to.port, &[i, o]);
        }
    }
    true
}

fn negated(c: &Cell) -> Option<Cell> {
    Some(match c.clone() {
        Cell::And(g) => Cell::Nand(g),
        Cell::Nand(g) => Cell::And(g),
        Cell::Nor(g) => Cell::Or(g),
        Cell::Or(g) => Cell::Nor(g),
        Cell::Xor(g) => Cell::Xnor(g),
        Cell::Xnor(g) => Cell::Xor(g),
        Cell::AndReduce(u) => Cell::NandReduce(u),
        Cell::NandReduce(u) => Cell::AndReduce(u),
        Cell::NorReduce(u) => Cell::OrReduce(u),
        Cell::OrReduce(u) => Cell::NorReduce(u),
        Cell::XorReduce(u) => Cell::XnorReduce(u),
        Cell::XnorReduce(u) => Cell::XorReduce(u),
        _ => return None,
    })
}

fn integrate_negation(m: &mut Model, id: &str) -> bool {
    let Some(neg) = m.dev(id).and_then(negated) else { return false };
    let outs = m.output_port(id, "out");
    let [out] = &outs[..] else { return false };
    if out.to.id == id || !matches!(m.dev(&out.to.id), Some(Cell::Not(_))) {
        return false;
    }
    m.devices[id].cell = neg;
    let neg_outs = m.output_port(&out.to.id, "out");
    m.remove_device(&out.to.id);
    for n in &neg_outs {
        m.connect(&out.from, &n.to.id, &n.to.port, &[n, out]);
    }
    true
}

type MakeConst = fn(ConstOp) -> Cell;

/// The cell with a constant operand, and its operand (in1/in2) widths and
/// signedness.
fn const_cell(c: &Cell) -> Option<(MakeConst, &BinOp)> {
    Some(match c {
        Cell::Addition(b) => (Cell::AdditionConst, b),
        Cell::Subtraction(b) => (Cell::SubtractionConst, b),
        Cell::Multiplication(b) => (Cell::MultiplicationConst, b),
        Cell::Division(b) => (Cell::DivisionConst, b),
        Cell::Modulo(b) => (Cell::ModuloConst, b),
        Cell::Power(b) => (Cell::PowerConst, b),
        Cell::ShiftLeft(b) => (Cell::ShiftLeftConst, b),
        Cell::ShiftRight(b) => (Cell::ShiftRightConst, b),
        Cell::Lt(b) => (Cell::LtConst, b),
        Cell::Le(b) => (Cell::LeConst, b),
        Cell::Gt(b) => (Cell::GtConst, b),
        Cell::Ge(b) => (Cell::GeConst, b),
        Cell::Eq(b) => (Cell::EqConst, b),
        Cell::Ne(b) => (Cell::NeConst, b),
        _ => return None,
    })
}

/// The value of a constant if it is fully defined and fits in an i64.
fn small_int(v: &LogicVec, signed: bool) -> Option<i64> {
    if !v.is_fully_defined() {
        return None;
    }
    let v = if v.bits() > 64 {
        // the high part must be a pure zero/sign extension
        let hi = v.slice(63, v.bits());
        if !(hi.is_low() || signed && hi.is_high()) {
            return None;
        }
        v.slice(0, 64)
    } else {
        v.clone()
    };
    if signed { v.to_i64() } else { v.to_u64().and_then(|x| i64::try_from(x).ok()) }
}

fn integrate_arith_constant(m: &mut Model, id: &str) -> bool {
    let Some((mk, op)) = m.dev(id).and_then(const_cell) else { return false };
    let op = op.clone();
    let outs = m.output_port(id, "out");
    let (in1, in2) = (m.input_port(id, "in1"), m.input_port(id, "in2"));
    let help = |m: &mut Model, ins: &[Connector], others: &[Connector], left: bool| {
        let [inc] = ins else { return false };
        let const_id = inc.from.id.clone();
        let Some(Cell::Constant { constant }) = m.dev(&const_id) else { return false };
        let sgn = if left { op.signed.in1 } else { op.signed.in2 };
        let Some(i) = LogicVec::from_bin(constant, Some(constant.len())).and_then(|v| small_int(&v, sgn)) else {
            return false;
        };
        if !(-99..=999).contains(&i) {
            return false;
        }
        let other_bits = if left { op.bits.in2 } else { op.bits.in1 };
        let mut dev = m.devices[id].clone();
        dev.cell = mk(ConstOp {
            bits: ConstBits { r#in: if other_bits == 0 { 1 } else { other_bits }, out: op.bits.out },
            signed: ConstSigned { r#in: op.signed.in1 && op.signed.in2, out: op.signed.out },
            left_op: left,
            constant: i,
            fillx: op.fillx,
        });
        m.remove_device(id);
        if m.output_port(&const_id, "out").is_empty() {
            m.remove_device(&const_id);
        }
        m.add_device(dev, id.into());
        for c in outs.iter() {
            m.add_connector(c.clone(), &[]);
        }
        for c in others {
            let mut c = c.clone();
            c.to.port = "in".into();
            m.add_connector(c, &[]);
        }
        true
    };
    help(m, &in1, &in2, true) || help(m, &in2, &in1, false)
}

fn input_number(port: &str) -> u32 {
    port.strip_prefix("in").and_then(|n| n.parse().ok()).expect("a gate input port")
}

fn make_nary_gates(m: &mut Model, id: &str) -> bool {
    // the gate type whose inputs can be merged into this one
    let mergeable = |c: &Cell| match c {
        Cell::And(_) | Cell::Nand(_) => Some("And"),
        Cell::Or(_) | Cell::Nor(_) => Some("Or"),
        Cell::Xor(_) | Cell::Xnor(_) => Some("Xor"),
        _ => None,
    };
    let is = |c: &Cell, name| match c {
        Cell::And(_) => name == "And",
        Cell::Or(_) => name == "Or",
        Cell::Xor(_) => name == "Xor",
        _ => false,
    };
    let Some(want) = m.dev(id).and_then(mergeable) else { return false };
    let dev = m.devices[id].clone();
    let inputs = match &dev.cell {
        Cell::And(g) | Cell::Nand(g) | Cell::Or(g) | Cell::Nor(g) | Cell::Xor(g) | Cell::Xnor(g) => {
            g.inputs.unwrap_or(2)
        }
        _ => unreachable!(),
    };
    let ins = m.inputs(id);
    let outs = m.output_port(id, "out");
    for conn in &ins {
        let in_id = conn.from.id.clone();
        if !m.dev(&in_id).is_some_and(|c| is(c, want)) {
            continue;
        }
        let prev_outs = m.outputs(&in_id);
        if prev_outs.len() != 1 || prev_outs[0].to.id != id {
            continue;
        }
        let merge = m.inputs(&in_id);
        let input_no = input_number(&conn.to.port);
        let extra = merge.len() as i64 - 1;
        m.remove_device(&in_id);
        m.remove_device(id);
        let mut new_dev = dev.clone();
        if let Cell::And(g) | Cell::Nand(g) | Cell::Or(g) | Cell::Nor(g) | Cell::Xor(g) | Cell::Xnor(g) =
            &mut new_dev.cell
        {
            g.inputs = Some((inputs as i64 + extra) as u32);
        }
        m.add_device(new_dev, id.into());
        for c in &outs {
            m.add_connector(c.clone(), &[]);
        }
        for c in &ins {
            let n = input_number(&c.to.port);
            if n == input_no {
                continue;
            }
            let mut c = c.clone();
            if n > input_no {
                c.to.port = format!("in{}", n as i64 + extra);
            }
            m.add_connector(c, &[]);
        }
        for c in &merge {
            let mut c = c.clone();
            c.to = Endpoint { id: id.into(), port: format!("in{}", input_number(&c.to.port) + input_no - 1) };
            m.add_connector(c, &[]);
        }
        return true;
    }
    false
}

/// State of `makeBinaryMuxes`'s walk back from a one-hot mux's select:
/// which compared value selects which mux input.
struct MuxWalk {
    group_ids: Vec<String>,
    mapping: BTreeMap<i64, u32>,
    src: Option<Connector>,
    bits: Option<u32>,
}

impl MuxWalk {
    fn handle_const(&mut self, value: i64, pbits: Option<u32>, ins: &[Connector], base: u32) -> bool {
        if value < 0 || self.mapping.contains_key(&value) {
            return false;
        }
        let [inc] = ins else { return false };
        let src = self.src.get_or_insert_with(|| inc.clone());
        if src.from != inc.from {
            return false;
        }
        let cbits = pbits.filter(|&b| b != 0).unwrap_or(1);
        if *self.bits.get_or_insert(cbits) != cbits {
            return false;
        }
        self.mapping.insert(value, base);
        true
    }

    fn traverse(&mut self, m: &Model, group_id: &str, base: u32) -> bool {
        self.group_ids.push(group_id.into());
        match m.dev(group_id) {
            Some(Cell::BusGroup { groups }) => {
                let mut offset = 0;
                for (n, size) in groups.iter().enumerate() {
                    let conns = m.input_port(group_id, &format!("in{n}"));
                    let [c] = &conns[..] else { return false };
                    if !self.traverse(m, &c.from.id, base + offset) {
                        return false;
                    }
                    offset += size;
                }
                true
            }
            Some(Cell::EqConst(op)) => {
                let (value, bits) = (op.constant, Some(op.bits.r#in));
                self.handle_const(value, bits, &m.inputs(group_id), base)
            }
            Some(Cell::NorReduce(u)) => self.handle_const(0, u.bits, &m.input_port(group_id, "in"), base),
            Some(Cell::OrReduce(_)) => {
                let conns = m.input_port(group_id, "in");
                let [c] = &conns[..] else { return false };
                let prev = c.from.id.clone();
                if !matches!(m.dev(&prev), Some(Cell::BusGroup { .. })) {
                    return false;
                }
                self.group_ids.push(prev.clone());
                // the original checks `groups` of the OrReduce here (meaning
                // the BusGroup's?), which it doesn't have, so it passes.
                m.inputs(&prev).iter().all(|c| self.traverse(m, &c.from.id, base))
            }
            _ => false,
        }
    }
}

fn make_binary_muxes(m: &mut Model, id: &str) -> bool {
    let Some(Cell::Mux1Hot(mux)) = m.dev(id) else { return false };
    let Some(mux_bits) = mux.bits.clone() else { return false };
    let sels = m.input_port(id, "sel");
    let [sel] = &sels[..] else { return false };
    let mut w = MuxWalk { group_ids: vec![], mapping: BTreeMap::new(), src: None, bits: None };
    if !w.traverse(m, &sel.from.id, 1) {
        return false;
    }
    let mux_inputs: Vec<Vec<Connector>> = (0..=mux_bits.sel).map(|n| m.input_port(id, &format!("in{n}"))).collect();
    let (Some(src), Some(bits)) = (w.src.clone(), w.bits) else { return false };
    if bits > 9 {
        return false;
    }
    // the original also goes sparse when fewer than 2**(dev.bits-1) values are
    // mapped, but `dev.bits` is an object there, so that test is always false.
    let sparse = bits > 6;
    let outs = m.output_port(id, "out");
    let mut dev = m.devices[id].clone();
    m.remove_device(id);
    for g in &w.group_ids {
        if m.outputs(g).is_empty() {
            m.remove_device(g);
        }
    }
    let new_bits = MuxBits { r#in: mux_bits.r#in, sel: bits };
    let inputs: Vec<i64> = w.mapping.keys().copied().collect();
    let mut default_input = false;
    if sparse {
        default_input = !mux_inputs[0].iter().all(|c| match m.dev(&c.from.id) {
            Some(Cell::Constant { constant }) => {
                LogicVec::from_bin(constant, Some(bits as usize)).is_some_and(|v| v.xmask().is_high())
            }
            _ => false,
        });
        dev.cell = Cell::MuxSparse(MuxSparse { bits: new_bits, inputs: inputs.clone(), default_input });
    } else {
        dev.cell = Cell::Mux(Mux { bits: Some(new_bits) });
    }
    m.add_device(dev, id.into());
    m.connect(&src.from, &sel.to.id, &sel.to.port, &[&src, sel]);
    for c in &outs {
        m.add_connector(c.clone(), &[]);
    }
    let none = vec![];
    let mux_in = |n: u32| mux_inputs.get(n as usize).unwrap_or(&none);
    if sparse {
        for (n, constant) in inputs.iter().enumerate() {
            let new_n = if default_input { n + 1 } else { n };
            for c in mux_in(w.mapping[constant]) {
                m.connect(&c.from, id, &format!("in{new_n}"), &[c]);
            }
        }
        if default_input {
            for c in &mux_inputs[0] {
                m.connect(&c.from, id, "in0", &[c]);
            }
        }
    } else {
        for n in 0..1i64 << bits {
            for c in mux_in(w.mapping.get(&n).copied().unwrap_or(0)) {
                m.connect(&c.from, id, &format!("in{n}"), &[c]);
            }
        }
    }
    for c in &mux_inputs[0] {
        if m.outputs(&c.from.id).is_empty() {
            m.remove_device(&c.from.id);
        }
    }
    true
}

fn make_dff_with_enable(m: &mut Model, id: &str) -> bool {
    let Some(Cell::Dff(dff)) = m.dev(id) else { return false };
    if dff.polarity.as_ref().is_some_and(|p| p.enable.is_some()) {
        return false;
    }
    let ins = m.input_port(id, "in");
    let [inc] = &ins[..] else { return false };
    let pre = inc.from.id.clone();
    let Some(Cell::Mux(mux)) = m.dev(&pre) else { return false };
    if mux.bits.as_ref().map_or(1, |b| b.sel) != 1 || m.output_port(&pre, "out").len() != 1 {
        return false;
    }
    let (in0, in1) = (m.input_port(&pre, "in0"), m.input_port(&pre, "in1"));
    let help = |m: &mut Model, lp: &[Connector], data: &[Connector], polarity: bool| {
        let [l] = lp else { return false };
        if l.from.id != id || l.from.port != "out" {
            return false;
        }
        if let Cell::Dff(d) = &mut m.devices[id].cell {
            d.polarity.get_or_insert_default().enable = Some(polarity);
        }
        let sel = m.input_port(&pre, "sel");
        m.remove_device(&pre);
        for c in data {
            m.connect(&c.from, id, "in", &[c]);
        }
        for c in &sel {
            m.connect(&c.from, id, "en", &[c]);
        }
        true
    };
    help(m, &in0, &in1, true) || help(m, &in1, &in0, false)
}

const TRANSFORMATIONS: [fn(&mut Model, &str) -> bool; 6] = [
    remove_repeater,
    integrate_negation,
    integrate_arith_constant,
    make_nary_gates,
    make_binary_muxes,
    make_dff_with_enable,
];

/// `transformCircuit`: the top level and each subcircuit on its own.
pub fn transform_circuit(c: Circuit) -> Circuit {
    let one = |c: Circuit| {
        let mut m = Model::new(c);
        for f in TRANSFORMATIONS {
            m.transform(f);
        }
        m.into_circuit()
    };
    let subs = c.subcircuits.clone();
    let mut ret = one(Circuit { subcircuits: None, ..c });
    ret.subcircuits = subs.map(|s| s.into_iter().map(|(k, v)| (k, one(v))).collect());
    ret
}
