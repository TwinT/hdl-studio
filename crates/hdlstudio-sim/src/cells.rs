//! Cell behaviour: each digitaljs cell's `operation()` (src/cells/*.mjs,
//! with this project's patch), its ports and its initial outputs.

use crate::Args;
use crate::int::{self, ArithOp, CmpOp};
use hdlstudio_logic::{Bit, LogicMem, LogicVec};
use hdlstudio_netlist::{Cell, ConstOp, PortMask};

#[derive(Clone, Copy, Debug)]
pub enum BinGate {
    And,
    Or,
    Xor,
    Nand,
    Nor,
    Xnor,
}

#[derive(Clone, Copy, Debug)]
pub enum Reduce {
    And,
    Or,
    Xor,
    Nand,
    Nor,
    Xnor,
}

#[derive(Clone, Debug)]
pub enum Op {
    /// Does nothing when run: widgets and the worker's "special" cells.
    Nop,
    Repeater,
    Not,
    Gate(BinGate),
    Reduce(Reduce),
    Extend { sign: bool, output: usize },
    Slice { first: usize, count: usize },
    Group,
    Constant(LogicVec),
    Clock,
    Arith1 { neg: bool, signed: bool, out: usize },
    Arith2 { op: ArithOp, signed: bool, out: usize },
    Compare { op: CmpOp, signed: bool },
    Equal { ne: bool, bits1: usize, bits2: usize, signed: bool },
    Shift(Shift),
    ArithConst { op: ArithOp, left: bool, constant: i64, signed: bool, out: usize },
    ShiftConst { left: bool, constant: i64, shift: Shift },
    CompareConst { op: CmpOp, left: bool, constant: i64, signed: bool },
    EqualConst { ne: bool, constant: i64, bits: usize },
    /// Binary select (`sel` first, then the inputs).
    Mux { bits: usize },
    Mux1Hot { bits: usize },
    MuxSparse { bits: usize, values: Vec<i64>, default: bool },
    Tribuf { bits: usize },
    TriMerge,
    Dff(Box<Dff>),
    Memory(Box<Memory>),
    Fsm(Box<Fsm>),
}

#[derive(Clone, Debug)]
pub struct Shift {
    /// -1 left, 1 right
    dir: i64,
    in_bits: usize,
    out: usize,
    sgn_in: bool,
    sgn_amount: bool,
    sgn_out: bool,
    fillx: bool,
}

#[derive(Clone, Debug)]
pub struct Dff {
    bits: usize,
    /// Input index of each optional port; `d` is absent with `no_data`.
    d: Option<usize>,
    ain: Option<usize>,
    aload: Option<(usize, Bit)>,
    clk: Option<(usize, Bit)>,
    set: Option<(usize, bool)>,
    clr: Option<(usize, bool)>,
    srst: Option<(usize, Bit)>,
    arst: Option<(usize, Bit)>,
    en: Option<(usize, Bit)>,
    arst_value: LogicVec,
    srst_value: LogicVec,
    enable_srst: bool,
    last_clk: Bit,
}

#[derive(Clone, Debug)]
pub struct Memory {
    bits: usize,
    words: i64,
    offset: i64,
    rd: Vec<RdPort>,
    wr: Vec<WrPort>,
    pub mem: LogicMem,
}

#[derive(Clone, Debug)]
struct RdPort {
    addr: usize,
    clk: Option<(usize, Bit)>,
    en: Option<(usize, Bit)>,
    arst: Option<(usize, Bit, LogicVec)>,
    srst: Option<(usize, Bit, LogicVec)>,
    enable_srst: bool,
    transparent: Option<PortMask>,
    collision: Option<PortMask>,
    last_clk: Bit,
}

#[derive(Clone, Debug)]
struct WrPort {
    addr: usize,
    data: usize,
    clk: Option<(usize, Bit)>,
    en: Option<(usize, Bit)>,
    /// The enable masks the written bits (one enable bit per data bit).
    bit_enable: bool,
    last_clk: Bit,
}

#[derive(Clone, Debug)]
pub struct Fsm {
    out: usize,
    clk_pol: Bit,
    arst_pol: Bit,
    init: i64,
    state: i64,
    /// Per input state: (ctrl_in, next state, ctrl_out).
    transitions: std::collections::HashMap<i64, Vec<(LogicVec, i64, LogicVec)>>,
    last_clk: Bit,
}

/// A port: name and width.
pub type Port = (String, usize);

/// What the engine needs to instantiate a cell.
pub struct Spec {
    pub op: Op,
    pub inputs: Vec<Port>,
    pub outputs: Vec<Port>,
    /// Initial value of each output (digitaljs's `_resetPortValue`).
    pub initial: Vec<LogicVec>,
    pub propagation: u32,
    /// Skipped when its turn comes (the worker's `specialGates`).
    pub special: bool,
}

impl Op {
    /// digitaljs's `_gateKind == 'combinational'` (what `defaultcomb` affects).
    pub fn combinational(&self) -> bool {
        !matches!(
            self,
            Op::Dff(_) | Op::Memory(_) | Op::Fsm(_) | Op::Extend { .. } | Op::Slice { .. } | Op::Group | Op::TriMerge
        )
    }
}

fn ports(prefix: &str, widths: impl IntoIterator<Item = usize>) -> Vec<Port> {
    widths.into_iter().enumerate().map(|(i, b)| (format!("{prefix}{i}"), b)).collect()
}

fn one(name: &str, bits: usize) -> Vec<Port> {
    vec![(name.into(), bits)]
}

/// The active level of a port of the given polarity.
fn level(active_high: bool) -> Bit {
    if active_high { Bit::One } else { Bit::Zero }
}

fn opposite(b: Bit) -> Bit {
    if b == Bit::One { Bit::Zero } else { Bit::One }
}

impl Spec {
    fn new(op: Op, inputs: Vec<Port>, outputs: Vec<Port>, propagation: u32) -> Spec {
        let initial = outputs.iter().map(|(_, b)| LogicVec::xes(*b)).collect();
        Spec { op, inputs, outputs, initial, propagation, special: false }
    }
}

fn arith_op(c: &Cell) -> Option<ArithOp> {
    use Cell as C;
    Some(match c {
        C::Addition(_) | C::AdditionConst(_) => ArithOp::Add,
        C::Subtraction(_) | C::SubtractionConst(_) => ArithOp::Sub,
        C::Multiplication(_) | C::MultiplicationConst(_) => ArithOp::Mul,
        C::Division(_) | C::DivisionConst(_) => ArithOp::Div,
        C::Modulo(_) | C::ModuloConst(_) => ArithOp::Mod,
        C::Power(_) | C::PowerConst(_) => ArithOp::Pow,
        _ => return None,
    })
}

fn cmp_op(c: &Cell) -> Option<CmpOp> {
    use Cell as C;
    Some(match c {
        C::Lt(_) | C::LtConst(_) => CmpOp::Lt,
        C::Le(_) | C::LeConst(_) => CmpOp::Le,
        C::Gt(_) | C::GtConst(_) => CmpOp::Gt,
        C::Ge(_) | C::GeConst(_) => CmpOp::Ge,
        _ => return None,
    })
}

fn bin(s: &str, bits: usize) -> Result<LogicVec, String> {
    LogicVec::from_bin(s, Some(bits)).ok_or_else(|| format!("bad value {s}"))
}

/// The spec of a cell. Subcircuits and the Input/Output cells inside them
/// are flattened by the builder and never get here.
pub fn spec(cell: &Cell) -> Result<Spec, String> {
    use Cell as C;
    let bits = |b: Option<u32>| b.unwrap_or(1) as usize;
    let in_out = |i: usize, o: usize| (one("in", i), one("out", o));
    let bin_ports = |b1: u32, b2: u32, out: usize| (vec![("in1".into(), b1 as usize), ("in2".into(), b2 as usize)], one("out", out));
    Ok(match cell {
        C::Not(u) => Spec::new(Op::Not, one("in", bits(u.bits)), one("out", bits(u.bits)), 1),
        C::Repeater(u) => Spec::new(Op::Repeater, one("in", bits(u.bits)), one("out", bits(u.bits)), 1),
        C::And(g) | C::Or(g) | C::Xor(g) | C::Nand(g) | C::Nor(g) | C::Xnor(g) => {
            let kind = match cell {
                C::And(_) => BinGate::And,
                C::Or(_) => BinGate::Or,
                C::Xor(_) => BinGate::Xor,
                C::Nand(_) => BinGate::Nand,
                C::Nor(_) => BinGate::Nor,
                _ => BinGate::Xnor,
            };
            let (b, n) = (bits(g.bits), g.inputs.unwrap_or(2) as usize);
            let inputs = (1..=n).map(|i| (format!("in{i}"), b)).collect();
            Spec::new(Op::Gate(kind), inputs, one("out", b), 1)
        }
        C::AndReduce(u) | C::OrReduce(u) | C::XorReduce(u) | C::NandReduce(u) | C::NorReduce(u) | C::XnorReduce(u) => {
            let kind = match cell {
                C::AndReduce(_) => Reduce::And,
                C::OrReduce(_) => Reduce::Or,
                C::XorReduce(_) => Reduce::Xor,
                C::NandReduce(_) => Reduce::Nand,
                C::NorReduce(_) => Reduce::Nor,
                _ => Reduce::Xnor,
            };
            Spec::new(Op::Reduce(kind), one("in", bits(u.bits)), one("out", 1), 1)
        }
        C::ZeroExtend { extend } | C::SignExtend { extend } => {
            let (i, o) = (extend.input as usize, extend.output as usize);
            let op = Op::Extend { sign: matches!(cell, C::SignExtend { .. }), output: o };
            Spec::new(op, one("in", i), one("out", o), 0)
        }
        C::BusSlice { slice } => {
            let op = Op::Slice { first: slice.first as usize, count: slice.count as usize };
            Spec::new(op, one("in", slice.total as usize), one("out", slice.count as usize), 0)
        }
        C::BusGroup { groups } => {
            let total = groups.iter().sum::<u32>() as usize;
            Spec::new(Op::Group, ports("in", groups.iter().map(|&g| g as usize)), one("out", total), 0)
        }
        C::Constant { constant } => {
            let v = bin(constant, constant.len())?;
            Spec::new(Op::Constant(v), vec![], one("out", constant.len()), 0)
        }
        C::Clock(_) => {
            let mut s = Spec::new(Op::Clock, vec![], one("out", 1), 100);
            s.initial = vec![LogicVec::zeros(1)];
            s
        }
        // top-level inputs start at 0 (this project's patch)
        C::Input(io) | C::Button(io) | C::NumEntry(io) | C::PushButton(io) => {
            let b = io.bits as usize;
            let mut s = Spec::new(Op::Nop, vec![], one("out", b), 0);
            s.initial = vec![LogicVec::zeros(b)];
            s.special = !matches!(cell, C::PushButton(_));
            s
        }
        C::Output(io) | C::Lamp(io) | C::NumDisplay(io) | C::Display7(io) | C::LedMatrix(io) => {
            let mut s = Spec::new(Op::Nop, one("in", io.bits as usize), vec![], 0);
            s.special = matches!(cell, C::Output(_) | C::Lamp(_) | C::NumDisplay(_));
            s
        }
        C::Negation(n) | C::UnaryPlus(n) => {
            let (i, o) = in_out(n.bits.r#in as usize, n.bits.out as usize);
            let op = Op::Arith1 { neg: matches!(cell, C::Negation(_)), signed: n.signed, out: n.bits.out as usize };
            Spec::new(op, i, o, 1)
        }
        C::Addition(b) | C::Subtraction(b) | C::Multiplication(b) | C::Division(b) | C::Modulo(b) | C::Power(b) => {
            let out = b.bits.out.unwrap_or(1) as usize;
            let (i, o) = bin_ports(b.bits.in1, b.bits.in2, out);
            let op = Op::Arith2 { op: arith_op(cell).unwrap(), signed: b.signed.in1 && b.signed.in2, out };
            Spec::new(op, i, o, 1)
        }
        C::Lt(b) | C::Le(b) | C::Gt(b) | C::Ge(b) => {
            let (i, o) = bin_ports(b.bits.in1, b.bits.in2, 1);
            Spec::new(Op::Compare { op: cmp_op(cell).unwrap(), signed: b.signed.in1 && b.signed.in2 }, i, o, 1)
        }
        C::Eq(b) | C::Ne(b) => {
            let (i, o) = bin_ports(b.bits.in1, b.bits.in2, 1);
            let op = Op::Equal {
                ne: matches!(cell, C::Ne(_)),
                bits1: b.bits.in1 as usize,
                bits2: b.bits.in2 as usize,
                signed: b.signed.in1 && b.signed.in2,
            };
            Spec::new(op, i, o, 1)
        }
        C::ShiftLeft(b) | C::ShiftRight(b) => {
            let out = b.bits.out.unwrap_or(1) as usize;
            let (i, o) = bin_ports(b.bits.in1, b.bits.in2, out);
            let shift = Shift {
                dir: if matches!(cell, C::ShiftLeft(_)) { -1 } else { 1 },
                in_bits: b.bits.in1 as usize,
                out,
                sgn_in: b.signed.in1,
                sgn_amount: b.signed.in2,
                sgn_out: b.signed.out.unwrap_or(false),
                fillx: b.fillx.unwrap_or(false),
            };
            Spec::new(Op::Shift(shift), i, o, 1)
        }
        C::AdditionConst(c)
        | C::SubtractionConst(c)
        | C::MultiplicationConst(c)
        | C::DivisionConst(c)
        | C::ModuloConst(c)
        | C::PowerConst(c) => {
            let out = c.bits.out.unwrap_or(1) as usize;
            let op =
                Op::ArithConst { op: arith_op(cell).unwrap(), left: c.left_op, constant: c.constant, signed: c.signed.r#in, out };
            let (i, o) = in_out(c.bits.r#in as usize, out);
            Spec::new(op, i, o, 1)
        }
        C::ShiftLeftConst(c) | C::ShiftRightConst(c) => {
            let out = c.bits.out.unwrap_or(1) as usize;
            let shift = Shift {
                dir: if matches!(cell, C::ShiftLeftConst(_)) { -1 } else { 1 },
                in_bits: c.bits.r#in as usize,
                out,
                sgn_in: c.signed.r#in,
                sgn_amount: c.signed.r#in,
                sgn_out: c.signed.out.unwrap_or(false),
                fillx: c.fillx.unwrap_or(false),
            };
            let (i, o) = in_out(c.bits.r#in as usize, out);
            Spec::new(Op::ShiftConst { left: c.left_op, constant: c.constant, shift }, i, o, 1)
        }
        C::LtConst(c) | C::LeConst(c) | C::GtConst(c) | C::GeConst(c) => {
            let op = Op::CompareConst { op: cmp_op(cell).unwrap(), left: c.left_op, constant: c.constant, signed: c.signed.r#in };
            let (i, o) = in_out(c.bits.r#in as usize, 1);
            Spec::new(op, i, o, 1)
        }
        C::EqConst(ConstOp { bits, constant, .. }) | C::NeConst(ConstOp { bits, constant, .. }) => {
            let op = Op::EqualConst { ne: matches!(cell, C::NeConst(_)), constant: *constant, bits: bits.r#in as usize };
            let (i, o) = in_out(bits.r#in as usize, 1);
            Spec::new(op, i, o, 1)
        }
        C::Mux(m) | C::Mux1Hot(m) => {
            let (b, sel) = m.bits.as_ref().map_or((1, 1), |b| (b.r#in as usize, b.sel as usize));
            let (n, op) = match cell {
                C::Mux(_) => (1usize << sel, Op::Mux { bits: b }),
                _ => (sel + 1, Op::Mux1Hot { bits: b }),
            };
            let mut inputs = one("sel", sel);
            inputs.extend(ports("in", std::iter::repeat_n(b, n)));
            Spec::new(op, inputs, one("out", b), 1)
        }
        C::MuxSparse(m) => {
            let (b, sel) = (m.bits.r#in as usize, m.bits.sel as usize);
            let n = m.inputs.len() + m.default_input as usize;
            let mut inputs = one("sel", sel);
            inputs.extend(ports("in", std::iter::repeat_n(b, n)));
            let op = Op::MuxSparse { bits: b, values: m.inputs.clone(), default: m.default_input };
            Spec::new(op, inputs, one("out", b), 1)
        }
        C::Tribuf(u) => {
            let b = bits(u.bits);
            Spec::new(Op::Tribuf { bits: b }, vec![("in".into(), b), ("en".into(), 1)], one("out", b), 0)
        }
        C::TriMerge { bits, inputs } => {
            let b = *bits as usize;
            Spec::new(Op::TriMerge, ports("in", std::iter::repeat_n(b, *inputs as usize)), one("out", b), 0)
        }
        C::Dff(d) => dff(d)?,
        C::Memory(m) => memory(m)?,
        C::Fsm(f) => fsm(f)?,
        other => {
            let name = format!("{other:?}");
            let name = name.split(['(', ' ', '{']).next().unwrap_or("?");
            return Err(format!("the simulator doesn't support {name} cells"));
        }
    })
}

fn dff(d: &hdlstudio_netlist::Dff) -> Result<Spec, String> {
    let bits = d.bits as usize;
    let pol = d.polarity.clone().unwrap_or_default();
    let mut inputs: Vec<Port> = vec![];
    let mut add = |name: &str, b: usize| {
        inputs.push((name.into(), b));
        inputs.len() - 1
    };
    let dport = (!d.no_data).then(|| add("in", bits));
    let (ain, aload) = match pol.aload {
        Some(p) => (Some(add("ain", bits)), Some((add("aload", 1), level(p)))),
        None => (None, None),
    };
    let clk = pol.clock.map(|p| (add("clk", 1), level(p)));
    let set = pol.set.map(|p| (add("set", bits), p));
    let clr = pol.clr.map(|p| (add("clr", bits), p));
    let srst = pol.srst.map(|p| (add("srst", 1), level(p)));
    let arst = pol.arst.map(|p| (add("arst", 1), level(p)));
    let en = pol.enable.map(|p| (add("en", 1), level(p)));
    // without a value, a reset clears the register
    let zeros = "0".repeat(bits);
    let op = Dff {
        bits,
        d: dport,
        ain,
        aload,
        clk,
        set,
        clr,
        srst,
        arst,
        en,
        arst_value: bin(d.arst_value.as_deref().unwrap_or(&zeros), bits)?,
        srst_value: bin(d.srst_value.as_deref().unwrap_or(&zeros), bits)?,
        enable_srst: d.enable_srst,
        last_clk: Bit::X,
    };
    let mut s = Spec::new(Op::Dff(Box::new(op)), inputs, one("out", bits), 1);
    s.initial = vec![bin(d.initial.as_deref().unwrap_or("x"), bits)?];
    Ok(s)
}

fn memory(m: &hdlstudio_netlist::Memory) -> Result<Spec, String> {
    let (bits, abits) = (m.bits as usize, m.abits as usize);
    let words = m.words.filter(|&w| w > 0).map_or(1usize << abits, |w| w as usize);
    let mem = match &m.memdata {
        Some(d) => LogicMem::from_json(bits, d).ok_or("bad memory contents")?,
        None => LogicMem::new(bits, words, Bit::X),
    };
    let mut inputs: Vec<Port> = vec![];
    let mut outputs: Vec<Port> = vec![];
    let mut initial = vec![];
    let mut add = |name: String, b: usize| {
        inputs.push((name, b));
        inputs.len() - 1
    };
    let lvl = |p: Option<bool>| level(p.unwrap_or(false));
    let mut rd = vec![];
    for (k, p) in m.rdports.iter().enumerate() {
        let n = format!("rd{k}");
        let value = |v: &Option<String>| v.as_deref().map_or(Ok(LogicVec::zeros(bits)), |s| bin(s, bits));
        rd.push(RdPort {
            addr: add(format!("{n}addr"), abits),
            clk: port_if(p.clock_polarity.is_some(), || (add(format!("{n}clk"), 1), lvl(p.clock_polarity))),
            en: port_if(p.enable_polarity.is_some(), || (add(format!("{n}en"), 1), lvl(p.enable_polarity))),
            arst: match p.arst_polarity {
                Some(pol) => Some((add(format!("{n}arst"), 1), level(pol), value(&p.arst_value)?)),
                None => None,
            },
            srst: match p.srst_polarity {
                Some(pol) => Some((add(format!("{n}srst"), 1), level(pol), value(&p.srst_value)?)),
                None => None,
            },
            enable_srst: p.enable_srst.is_some(),
            transparent: p.transparent.clone(),
            collision: p.collision.clone(),
            last_clk: Bit::X,
        });
        outputs.push((format!("{n}data"), bits));
        initial.push(match &p.init_value {
            Some(v) => bin(v, bits)?,
            None => LogicVec::xes(bits),
        });
    }
    let mut wr = vec![];
    for (k, p) in m.wrports.iter().enumerate() {
        let n = format!("wr{k}");
        let bit_enable = p.no_bit_enable.is_none();
        wr.push(WrPort {
            addr: add(format!("{n}addr"), abits),
            data: add(format!("{n}data"), bits),
            clk: port_if(p.clock_polarity.is_some(), || (add(format!("{n}clk"), 1), lvl(p.clock_polarity))),
            en: port_if(p.enable_polarity.is_some(), || {
                (add(format!("{n}en"), if bit_enable { bits } else { 1 }), lvl(p.enable_polarity))
            }),
            bit_enable,
            last_clk: Bit::X,
        });
    }
    let op = Memory {
        bits,
        words: words as i64,
        offset: m.offset.unwrap_or(0),
        rd,
        wr,
        mem,
    };
    let mut s = Spec::new(Op::Memory(Box::new(op)), inputs, outputs, 1);
    s.initial = initial;
    Ok(s)
}

fn port_if<T>(cond: bool, f: impl FnOnce() -> T) -> Option<T> {
    if cond { Some(f()) } else { None }
}

fn fsm(f: &hdlstudio_netlist::Fsm) -> Result<Spec, String> {
    let (bin_, bout) = (f.bits.r#in as usize, f.bits.out as usize);
    let mut transitions: std::collections::HashMap<i64, Vec<_>> = Default::default();
    for t in &f.trans_table {
        // ponytail: a transition with no state (NaN in JS) can never match
        if let (Some(si), Some(so)) = (t.state_in, t.state_out) {
            transitions.entry(si).or_default().push((bin(&t.ctrl_in, bin_)?, so, bin(&t.ctrl_out, bout)?));
        }
    }
    let op = Fsm {
        out: bout,
        clk_pol: level(f.polarity.clock),
        arst_pol: level(f.polarity.arst),
        init: f.init_state as i64,
        state: f.init_state as i64,
        transitions,
        last_clk: Bit::X,
    };
    let inputs = vec![("in".into(), bin_), ("clk".into(), 1), ("arst".into(), 1)];
    Ok(Spec::new(Op::Fsm(Box::new(op)), inputs, one("out", bout), 1))
}

/// digitaljs's `shiftHelp`.
fn shift_help(in1: &LogicVec, am: i64, bits_in: usize, bits_out: usize, sgn_in: bool, sgn_out: bool, fillx: bool) -> LogicVec {
    let msb = |v: &LogicVec| v.bits().checked_sub(1).map_or(Bit::Zero, |i| v.get(i));
    let fill = |signed: bool, v: &LogicVec| if fillx { Bit::X } else if signed { msb(v) } else { Bit::Zero };
    let ext = LogicVec::make(bits_out.saturating_sub(bits_in), fill(sgn_in, in1));
    let my_in = LogicVec::concat(&[in1, &ext]);
    // (pad ++ my_in) or (my_in[am..] ++ pad), cut to `bits_out`
    let pad = if am < 0 { if fillx { Bit::X } else { Bit::Zero } } else { fill(sgn_out, &my_in) };
    my_in.shift(am, pad).slice(0, bits_out)
}

/// A 4vl bit by its index; out of range reads as 0, like `get`.
fn bit0(v: &LogicVec) -> Bit {
    v.get(0)
}

impl Op {
    /// Runs the cell on its inputs (`cur` holds its current outputs) and
    /// returns its output, for the cells with one, and whether it must run
    /// again after its propagation delay (the clock). Memory pushes
    /// `(output index, value)` to `multi` instead, in the order digitaljs's
    /// `operation()` returns them.
    pub(crate) fn eval(&mut self, args: &Args, cur: &Args, multi: &mut Vec<(usize, LogicVec)>) -> (Option<LogicVec>, bool) {
        let v = match self {
            Op::Nop => None,
            Op::Repeater => Some(args[0].clone()),
            Op::Not => Some(args[0].not()),
            Op::Gate(kind) => {
                let f = match kind {
                    BinGate::And | BinGate::Nand => LogicVec::and,
                    BinGate::Or | BinGate::Nor => LogicVec::or,
                    BinGate::Xor | BinGate::Xnor => LogicVec::xor,
                };
                let mut v = args[0].clone();
                for i in 1..args.len() {
                    v = f(&v, &args[i])
                }
                if matches!(kind, BinGate::Nand | BinGate::Nor | BinGate::Xnor) {
                    v = v.not();
                }
                Some(v)
            }
            Op::Reduce(kind) => {
                let a = &args[0];
                Some(match kind {
                    Reduce::And => a.reduce_and(),
                    Reduce::Or => a.reduce_or(),
                    Reduce::Xor => a.reduce_xor(),
                    Reduce::Nand => a.reduce_nand(),
                    Reduce::Nor => a.reduce_nor(),
                    Reduce::Xnor => a.reduce_xnor(),
                })
            }
            Op::Extend { sign, output } => {
                let a = &args[0];
                let fill = if *sign { a.bits().checked_sub(1).map_or(Bit::Zero, |i| a.get(i)) } else { Bit::Zero };
                let ext = LogicVec::make(output.saturating_sub(a.bits()), fill);
                Some(LogicVec::concat(&[a, &ext]))
            }
            Op::Slice { first, count } => Some(args[0].slice(*first, *first + *count)),
            Op::Group => Some(LogicVec::concat(&(0..args.len()).map(|i| &args[i]).collect::<Vec<_>>())),
            Op::Constant(v) => Some(v.clone()),
            Op::Clock => return (Some(cur[0].not()), true),
            Op::Arith1 { neg, signed, out: bits } => {
                let a = &args[0];
                Some(if !a.is_fully_defined() {
                    LogicVec::xes(*bits)
                } else {
                    let zero = int::Int::Small(0);
                    let v = int::to_int(a, *signed);
                    if *neg { int::arith(ArithOp::Sub, zero, v, *bits) } else { int::from_int(&v, *bits) }
                })
            }
            Op::Arith2 { op, signed, out: bits } => {
                let (a, b) = (&args[0], &args[1]);
                Some(if !a.is_fully_defined() || !b.is_fully_defined() {
                    LogicVec::xes(*bits)
                } else {
                    int::arith(*op, int::to_int(a, *signed), int::to_int(b, *signed), *bits)
                })
            }
            Op::Compare { op, signed } => {
                let (a, b) = (&args[0], &args[1]);
                Some(if !a.is_fully_defined() || !b.is_fully_defined() {
                    LogicVec::xes(1)
                } else {
                    LogicVec::from_bool(int::compare(*op, int::to_int(a, *signed), int::to_int(b, *signed)), 1)
                })
            }
            Op::Equal { ne, bits1, bits2, signed } => {
                let ext = |v: &LogicVec, from: usize, to: usize| {
                    if from >= to {
                        v.clone()
                    } else {
                        LogicVec::concat(&[v, &LogicVec::make(to - from, if *signed { v.msb() } else { Bit::Zero })])
                    }
                };
                let (a, b) = (ext(&args[0], *bits1, *bits2), ext(&args[1], *bits2, *bits1));
                Some(if *ne { a.xor(&b).reduce_or() } else { a.xnor(&b).reduce_and() })
            }
            Op::Shift(s) => {
                let (a, am) = (&args[0], &args[1]);
                Some(if !am.is_fully_defined() {
                    LogicVec::xes(s.out)
                } else {
                    // a wide amount saturates: anything past max(in, out) is all fill
                    let am = int::clamped(am, s.sgn_amount, s.in_bits.max(s.out)) * s.dir;
                    shift_help(a, am, s.in_bits, s.out, s.sgn_in, s.sgn_out, s.fillx)
                })
            }
            Op::ArithConst { op, left, constant, signed, out: bits } => {
                let a = &args[0];
                Some(if !a.is_fully_defined() {
                    LogicVec::xes(*bits)
                } else {
                    let (c, v) = (int::Int::Small(*constant as i128), int::to_int(a, *signed));
                    if *left { int::arith(*op, c, v, *bits) } else { int::arith(*op, v, c, *bits) }
                })
            }
            Op::ShiftConst { left, constant, shift: s } => {
                let a = &args[0];
                Some(if *left {
                    if !a.is_fully_defined() {
                        LogicVec::xes(s.out)
                    } else {
                        let sig = LogicVec::from_i64(*constant, None);
                        let am = int::clamped(a, s.sgn_in, sig.bits().max(s.out)) * s.dir;
                        shift_help(&sig, am, sig.bits(), s.out, *constant < 0, s.sgn_out, s.fillx)
                    }
                } else {
                    shift_help(a, *constant * s.dir, s.in_bits, s.out, s.sgn_in, s.sgn_out, s.fillx)
                })
            }
            Op::CompareConst { op, left, constant, signed } => {
                let a = &args[0];
                Some(if !a.is_fully_defined() {
                    LogicVec::xes(1)
                } else {
                    let (c, v) = (int::Int::Small(*constant as i128), int::to_int(a, *signed));
                    let r = if *left { int::compare(*op, c, v) } else { int::compare(*op, v, c) };
                    LogicVec::from_bool(r, 1)
                })
            }
            Op::EqualConst { ne, constant, bits } => {
                let c = LogicVec::from_i64(*constant, Some(*bits));
                let a = &args[0];
                Some(if *ne { c.xor(a).reduce_or() } else { c.xnor(a).reduce_and() })
            }
            Op::Mux { bits } => {
                let sel = &args[0];
                let i = sel.is_fully_defined().then(|| sel.to_u64()).flatten();
                Some(mux_pick(args, i.map(|i| i as usize), *bits))
            }
            Op::Mux1Hot { bits } => {
                let sel = &args[0];
                let i = if !sel.is_fully_defined() {
                    None
                } else if let Some(v) = sel.to_u64() {
                    (v.count_ones() <= 1).then(|| if v == 0 { 0 } else { v.trailing_zeros() as usize + 1 })
                } else {
                    let b = sel.to_bits();
                    (b.iter().filter(|&&x| x == Bit::One).count() <= 1)
                        .then(|| b.iter().position(|&x| x == Bit::One).map_or(0, |p| p + 1))
                };
                Some(mux_pick(args, i, *bits))
            }
            Op::MuxSparse { bits, values, default } => {
                let sel = &args[0];
                let i = if !sel.is_fully_defined() {
                    None
                } else {
                    let v = sel.to_u64().map(|v| v as i64);
                    match values.iter().position(|&x| Some(x) == v) {
                        Some(idx) => Some(if *default { idx + 1 } else { idx }),
                        None => default.then_some(0),
                    }
                };
                Some(mux_pick(args, i, *bits))
            }
            Op::Tribuf { bits } => {
                let (a, en) = (&args[0], bit0(&args[1]));
                Some(match en {
                    Bit::One => a.clone(),
                    Bit::Zero => LogicVec::zes(*bits),
                    // per-bit ternary against a constant-z false branch
                    _ => LogicVec::from_bits(
                        &(0..*bits).map(|i| if a.get(i) == Bit::Z { Bit::Z } else { Bit::X }).collect::<Vec<_>>(),
                    ),
                })
            }
            Op::TriMerge => {
                let mut r = args[0].clone();
                for i in 1..args.len() {
                    r = r.resolve(&args[i]);
                }
                Some(r)
            }
            Op::Dff(d) => Some(d.eval(args, &cur[0])),
            Op::Memory(m) => {
                m.eval(args, cur, multi);
                None
            }
            Op::Fsm(f) => Some(f.eval(args)),
        };
        (v, false)
    }
}

fn mux_pick(args: &Args, i: Option<usize>, bits: usize) -> LogicVec {
    match i.filter(|&i| 1 + i < args.len()) {
        Some(i) => args[1 + i].clone(),
        None => LogicVec::xes(bits),
    }
}

impl Dff {
    fn eval(&mut self, args: &Args, cur: &LogicVec) -> LogicVec {
        let is = |p: Option<(usize, Bit)>| p.is_some_and(|(i, lvl)| bit0(&args[i]) == lvl);
        let mut last_clk = Bit::X;
        if let Some((i, _)) = self.clk {
            last_clk = self.last_clk;
            self.last_clk = bit0(&args[i]);
        }
        if is(self.arst) {
            return self.arst_value.clone();
        }
        if is(self.aload) {
            return args[self.ain.unwrap()].clone();
        }
        let mut sr: Option<(LogicVec, LogicVec)> = None;
        if let Some((i, pol)) = self.set {
            let s = &args[i];
            sr = Some(if pol { (s.clone(), s.not()) } else { (s.not(), s.clone()) });
        }
        if let Some((i, pol)) = self.clr {
            let c = &args[i];
            let clrmask = if pol { c.not() } else { c.clone() };
            sr = Some(match sr {
                Some((bits, mask)) => (bits, clrmask.and(&mask)),
                None => (LogicVec::zeros(self.bits), clrmask),
            });
        }
        let apply = |v: &LogicVec| match &sr {
            Some((bits, mask)) => v.and(mask).or(bits),
            None => v.clone(),
        };
        let disabled = self.en.is_some_and(|(i, lvl)| bit0(&args[i]) != lvl);
        if disabled && self.enable_srst {
            return apply(cur);
        }
        let edge = match self.clk {
            None => true,
            Some((i, lvl)) => bit0(&args[i]) == lvl && last_clk == opposite(lvl),
        };
        if !edge {
            return apply(cur);
        }
        if is(self.srst) {
            return apply(&self.srst_value);
        }
        if disabled {
            return apply(cur);
        }
        match self.d {
            Some(i) => apply(&args[i]),
            None => apply(cur),
        }
    }
}

impl Memory {
    fn calc_addr(&self, a: &LogicVec) -> i64 {
        // past 64 bits it's out of range anyway
        if !a.is_fully_defined() {
            return -1;
        }
        a.to_u64().map_or(i64::MAX, |v| (v as i64).saturating_sub(self.offset))
    }

    fn valid(&self, n: i64) -> bool {
        n >= 0 && n < self.words
    }

    fn eval(&mut self, args: &Args, cur: &Args, out: &mut Vec<(usize, LogicVec)>) {
        // enabled when any enable bit is at the active level
        let enabled = |en: Option<(usize, Bit)>| {
            en.is_none_or(|(i, lvl)| match lvl {
                Bit::One => args[i].reduce_or().get(0) == Bit::One,
                _ => args[i].reduce_and().get(0) == Bit::Zero,
            })
        };
        let active = |clk: Option<(usize, Bit)>, last: Bit| clk.is_none_or(|(i, lvl)| bit0(&args[i]) == lvl && last == opposite(lvl));
        let write_value = |w: &WrPort, old: &LogicVec, val: &LogicVec| match w.en {
            Some((i, lvl)) if w.bit_enable => {
                let mask = if lvl == Bit::One { args[i].clone() } else { args[i].not() };
                val.and(&mask).or(&old.and(&mask.not()))
            }
            _ => val.clone(),
        };
        let comb_read = |m: &Memory, addr: usize| {
            let a = m.calc_addr(&args[addr]);
            if m.valid(a) { m.mem.get(a as usize).clone() } else { LogicVec::xes(m.bits) }
        };
        let mut data: Vec<LogicVec> = (0..cur.len()).map(|i| cur[i].clone()).collect();
        for (k, p) in self.rd.iter().enumerate() {
            if p.clk.is_some() && enabled(p.en) && active(p.clk, p.last_clk) {
                data[k] = comb_read(self, p.addr);
                for (j, w) in self.wr.iter().enumerate() {
                    let hit = |mask: &Option<PortMask>| match mask {
                        Some(PortMask::All(b)) => *b,
                        Some(PortMask::Each(v)) => v.get(j).copied().unwrap_or(false),
                        None => false,
                    };
                    // Divergence: digitaljs compares the addresses with JS `==`, by
                    // object, which only holds when both came through the same
                    // objects (a Mux or Dff passes its input object on). By value
                    // here, which is what yosys's transparency means.
                    let writing = active(w.clk, w.last_clk) && enabled(w.en) && args[p.addr] == args[w.addr];
                    if hit(&p.transparent) && writing {
                        data[k] = write_value(w, &data[k], &args[w.data]);
                    }
                    if hit(&p.collision) && writing {
                        data[k] = write_value(w, &data[k], &LogicVec::xes(self.bits));
                    }
                }
            }
        }
        for w in &self.wr {
            if enabled(w.en) && active(w.clk, w.last_clk) {
                let a = self.calc_addr(&args[w.addr]);
                if self.valid(a) {
                    let old = self.mem.get(a as usize).clone();
                    self.mem.set(a as usize, write_value(w, &old, &args[w.data]));
                }
            }
        }
        for (k, p) in self.rd.iter().enumerate() {
            if p.clk.is_none() && enabled(p.en) {
                data[k] = comb_read(self, p.addr);
            }
        }
        for (k, p) in self.rd.iter().enumerate() {
            if let Some((i, lvl, v)) = &p.srst
                && (enabled(p.en) || !p.enable_srst)
                && active(p.clk, p.last_clk)
                && bit0(&args[*i]) == *lvl
            {
                data[k] = v.clone();
            }
            if let Some((i, lvl, v)) = &p.arst
                && bit0(&args[*i]) == *lvl
            {
                data[k] = v.clone();
            }
        }
        for p in self.rd.iter_mut() {
            if let Some((i, _)) = p.clk {
                p.last_clk = bit0(&args[i]);
            }
        }
        for w in self.wr.iter_mut() {
            if let Some((i, _)) = w.clk {
                w.last_clk = bit0(&args[i]);
            }
        }
        out.extend(data.into_iter().enumerate());
    }
}

impl Fsm {
    fn matches(input: &LogicVec, ctrl: &LogicVec, xmask: &LogicVec) -> bool {
        input.or(xmask) == ctrl.or(xmask)
    }

    fn eval(&mut self, args: &Args) -> LogicVec {
        let (input, clk, arst) = (&args[0], bit0(&args[1]), bit0(&args[2]));
        if arst == self.arst_pol {
            self.state = self.init;
        } else if clk == self.clk_pol && self.last_clk == opposite(self.clk_pol) {
            let next = self.transitions.get(&self.state).into_iter().flatten().find(|t| Self::matches(input, &t.0, &t.0.xmask()));
            self.state = next.map_or(self.init, |t| t.1);
        }
        self.last_clk = clk;
        // the output, merging every transition the (possibly x) input may take
        let ixmask = input.xmask();
        let mut results: Vec<LogicVec> = self
            .transitions
            .get(&self.state)
            .into_iter()
            .flatten()
            .filter(|t| Self::matches(input, &t.0, &t.0.xmask().or(&ixmask)))
            .map(|t| t.2.clone())
            .collect();
        let xes = LogicVec::xes(self.out);
        if results.is_empty() {
            return xes;
        }
        while results.len() > 1 {
            let other = results.pop().unwrap();
            let eqs = results[0].xnor(&other).or(&xes);
            results[0] = results[0].and(&eqs).or(&xes.and(&eqs.xmask()));
        }
        results.swap_remove(0)
    }
}
