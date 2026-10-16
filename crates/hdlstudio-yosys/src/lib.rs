//! Yosys JSON netlist (`write_json`) to an HDL Studio circuit.
//!
//! The converter (multi-driver nets merged by TriMerge, `$tribuf`, `$bmux`,
//! `$buf`, the LEDMatrix/momentary port attributes), plus `io_ui`, the inout
//! split (`inout.rs`) and the simplifications (`transform.rs`). Its output is
//! identical to the JavaScript converter's it replaced, device numbering
//! included (tests/golden.json).
// Portions Copyright (c) 2018 Marek Materzok, BSD-2-Clause (see NOTICE).

mod inout;
mod transform;

pub use inout::split_inout_ports;
pub use transform::transform_circuit;

use hdlstudio_logic::{LogicMem, LogicVec, MemItem};
use hdlstudio_netlist::*;
use indexmap::IndexMap;
use serde::Deserialize;
use serde_json::Value;
use std::collections::HashMap;

#[derive(Debug, Deserialize)]
pub struct Design {
    pub modules: IndexMap<String, Module>,
}

#[derive(Debug, Deserialize)]
pub struct Module {
    #[serde(default)]
    pub ports: IndexMap<String, Port>,
    #[serde(default)]
    pub cells: IndexMap<String, YCell>,
    #[serde(default)]
    pub netnames: IndexMap<String, NetName>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct Port {
    pub direction: String,
    pub bits: Vec<Bit>,
}

#[derive(Debug, Deserialize)]
pub struct YCell {
    #[serde(default)]
    pub hide_name: Value,
    #[serde(rename = "type")]
    pub ty: String,
    #[serde(default)]
    pub parameters: IndexMap<String, Value>,
    #[serde(default)]
    pub attributes: IndexMap<String, Value>,
    #[serde(default)]
    pub port_directions: IndexMap<String, String>,
    #[serde(default)]
    pub connections: IndexMap<String, Vec<Bit>>,
}

#[derive(Debug, Deserialize)]
pub struct NetName {
    #[serde(default)]
    pub hide_name: Value,
    pub bits: Vec<Bit>,
    #[serde(default)]
    pub attributes: IndexMap<String, Value>,
}

/// A net bit: a yosys signal id, or a string (the constants "0", "1", "x",
/// "z", and the `bitN` names the converter makes up).
#[derive(Clone, Debug, PartialEq, Eq, Hash, Deserialize)]
#[serde(untagged)]
pub enum Bit {
    Id(u64),
    Str(String),
}

impl Bit {
    fn is_const(&self) -> bool {
        match self {
            Bit::Id(n) => *n < 2,
            Bit::Str(s) => matches!(s.as_str(), "0" | "1" | "x" | "z"),
        }
    }

    fn is(&self, c: &str) -> bool {
        matches!(self, Bit::Str(s) if s == c)
    }

    fn text(&self) -> String {
        match self {
            Bit::Id(n) => n.to_string(),
            Bit::Str(s) => s.clone(),
        }
    }
}

type R<T> = Result<T, String>;

macro_rules! ensure {
    ($c:expr) => {
        if !$c {
            return Err(format!("assertion failed: {}", stringify!($c)));
        }
    };
}

fn truthy(v: &Value) -> bool {
    match v {
        Value::Null => false,
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_f64() != Some(0.0),
        Value::String(s) => !s.is_empty(),
        _ => true,
    }
}

/// JS `parseInt(s, 2)`: the leading binary digits; `None` is NaN.
fn parse_bin(s: &str) -> Option<i64> {
    let s = s.trim_start();
    let (neg, s) = match s.as_bytes().first() {
        Some(b'-') => (true, &s[1..]),
        Some(b'+') => (false, &s[1..]),
        _ => (false, s),
    };
    let digits: String = s.chars().take_while(|c| matches!(c, '0' | '1')).collect();
    let v = digits.chars().fold(0i64, |a, c| a.wrapping_mul(2) + (c == '1') as i64);
    (!digits.is_empty()).then_some(if neg { -v } else { v })
}

/// The binary digits of a JSON number, least significant first.
fn num_bits_lsb(v: &Value) -> R<Vec<char>> {
    let n = v.as_u64().ok_or_else(|| format!("unsupported number parameter {v}"))?;
    Ok(format!("{n:b}").chars().rev().collect())
}

/// `decode_json_number`. NaN comes out as 0.
fn num(v: Option<&Value>) -> R<i64> {
    match v {
        Some(Value::String(s)) => Ok(parse_bin(s).unwrap_or(0)),
        Some(Value::Number(n)) => Ok(n.as_i64().unwrap_or_else(|| n.as_f64().unwrap_or(0.0) as i64)),
        _ => Err("assertion failed: a numeric parameter".into()),
    }
}

/// `decode_json_bigint_as_array(..).reverse()`: binary digits, LSB first.
fn bits_lsb(v: Option<&Value>) -> R<Vec<u8>> {
    match v {
        Some(Value::String(s)) => s
            .chars()
            .rev()
            .map(|c| match c {
                '0' => Ok(0),
                '1' => Ok(1),
                _ => Err(format!("Invalid integer: {s}")),
            })
            .collect(),
        Some(v @ Value::Number(_)) => Ok(num_bits_lsb(v)?.into_iter().map(|c| (c == '1') as u8).collect()),
        _ => Err("assertion failed: a numeric parameter".into()),
    }
}

fn bit_at(v: &[u8], k: usize) -> bool {
    v.get(k).is_some_and(|&b| b != 0)
}

/// `decode_json_constant`: a number becomes `bits` binary digits (MSB
/// first), a string is kept as is.
fn constant(v: Option<&Value>, bits: usize) -> R<Option<String>> {
    Ok(match v {
        Some(Value::String(s)) => Some(s.clone()),
        Some(v @ Value::Number(_)) => {
            let mut d = num_bits_lsb(v)?;
            d.resize(bits, '0');
            Some(d.into_iter().rev().collect())
        }
        _ => None,
    })
}

fn parse_source_positions(s: &str) -> Vec<SourcePos> {
    let mut ret = Vec::new();
    for entry in s.split('|') {
        let (name, pos) = entry.rsplit_once(':').unwrap_or(("", entry));
        let parts: Vec<&str> = pos.split('-').collect();
        if parts.len() != 2 {
            continue;
        }
        // ponytail: JS gives NaN (null) for a malformed number; yosys never writes one
        let lc = |p: &str| {
            let mut it = p.split('.').map(|v| v.parse().unwrap_or(0));
            LineCol { line: it.next().unwrap_or(0), column: it.next() }
        };
        ret.push(SourcePos { name: name.into(), from: lc(parts[0]), to: lc(parts[1]) });
    }
    ret
}

/// Clamped `Array.slice`.
fn sl<T: Clone>(v: &[T], a: usize, b: usize) -> Vec<T> {
    let b = b.min(v.len());
    v[a.min(b)..b].to_vec()
}

fn str_sl(s: &str, a: usize, b: usize) -> &str {
    let b = b.min(s.len());
    &s[a.min(b)..b]
}

fn port_name(p: &str, i: usize) -> String {
    format!("{p}{i}")
}

const UNARY_GATES: &[&str] = &[
    "$repeater", "$not", "$neg", "$pos", "$reduce_and", "$reduce_nand", "$reduce_or", "$reduce_nor", "$reduce_xor",
    "$reduce_xnor", "$reduce_bool", "$logic_not",
];
const TECHMAP_UNARY_GATES: &[&str] = &["$_BUF_", "$_NOT_"];
const BINARY_GATES: &[&str] = &[
    "$and", "$nand", "$or", "$nor", "$xor", "$xnor", "$add", "$sub", "$mul", "$div", "$mod", "$pow", "$lt", "$le", "$eq",
    "$ne", "$ge", "$gt", "$eqx", "$nex", "$shl", "$shr", "$sshl", "$sshr", "$shift", "$shiftx", "$logic_and", "$logic_or",
];
const TECHMAP_BINARY_GATES: &[&str] = &["$_AND_", "$_NAND_", "$_OR_", "$_NOR_", "$_XOR_", "$_XNOR_"];
const DFFS: &[&str] = &[
    "$dff", "$dffe", "$adff", "$adffe", "$sdff", "$sdffe", "$sdffce", "$dlatch", "$adlatch", "$dffsr", "$dffsre",
    "$aldff", "$aldffe",
];

/// Gate-level flip-flops (simcells.v): name prefix, control ports, data ports.
// The original builds this from a Map in which `$_DFF_` and `$_DFFE_`
// appear twice, so the later entries (with `arst`) win and plain `$_DFF_P_`
// / `$_DFFE_PP_` are "Invalid cell type". Kept that way.
const TECHMAP_DFF_KINDS: &[(&str, &[&str], &[&str])] = &[
    ("$_SR_", &["set", "clr"], &["out"]),
    ("$_DFF_", &["clk", "arst"], &["in", "out"]),
    ("$_DFFE_", &["clk", "arst", "en"], &["in", "out"]),
    ("$_DFFSR_", &["clk", "set", "clr"], &["in", "out"]),
    ("$_DFFSRE_", &["clk", "set", "clr", "en"], &["in", "out"]),
    ("$_ALDFF_", &["clk", "aload"], &["in", "ain", "out"]),
    ("$_ALDFFE_", &["clk", "aload", "en"], &["in", "ain", "out"]),
    ("$_SDFF_", &["clk", "srst"], &["in", "out"]),
    ("$_SDFFE_", &["clk", "srst", "en"], &["in", "out"]),
    ("$_SDFFCE_", &["clk", "srst", "en"], &["in", "out"]),
    ("$_DLATCH_", &["en"], &["in", "out"]),
    ("$_ADLATCH_", &["en", "arst"], &["in", "out"]),
    ("$_DLATCHSR_", &["en", "set", "clr"], &["in", "out"]),
];

fn techmap_port(p: &str) -> &'static str {
    match p {
        "set" => "S",
        "clr" | "arst" | "srst" => "R",
        "in" => "D",
        "out" => "Q",
        "clk" => "C",
        "en" => "E",
        "aload" => "L",
        "ain" => "AD",
        _ => unreachable!(),
    }
}

/// A gate-level flip-flop type: its kind and polarity characters, e.g.
/// `$_DFF_PN0_` is `$_DFF_` with "PN0".
fn techmap_dff(ty: &str) -> Option<(&'static str, &'static [&'static str], &'static [&'static str], &str)> {
    TECHMAP_DFF_KINDS.iter().find_map(|&(prefix, p1, p2)| {
        let params = ty.strip_prefix(prefix)?.strip_suffix('_')?;
        let mut cs = params.chars();
        for port in p1 {
            if !matches!(cs.next(), Some('N' | 'P')) {
                return None;
            }
            if port.ends_with("rst") && !matches!(cs.next(), Some('0' | '1')) {
                return None;
            }
        }
        cs.next().is_none().then_some((prefix, p1, p2, params))
    })
}

/// The circuit's port name for each yosys port of a cell type.
fn portmap(ty: &str, modules: &IndexMap<String, Module>) -> Option<HashMap<String, String>> {
    let m = |pairs: &[(&str, &str)]| Some(pairs.iter().map(|(a, b)| (a.to_string(), b.to_string())).collect());
    if let Some(module) = modules.get(ty) {
        return Some(module.ports.keys().map(|p| (p.clone(), p.clone())).collect());
    }
    if let Some((_, p1, p2, _)) = techmap_dff(ty) {
        return Some(p1.iter().chain(p2.iter()).map(|p| (techmap_port(p).to_string(), p.to_string())).collect());
    }
    if UNARY_GATES.contains(&ty) || TECHMAP_UNARY_GATES.contains(&ty) {
        return m(&[("A", "in"), ("Y", "out")]);
    }
    if BINARY_GATES.contains(&ty) || TECHMAP_BINARY_GATES.contains(&ty) {
        return m(&[("A", "in1"), ("B", "in2"), ("Y", "out")]);
    }
    let (clk, en, d, q) = (("CLK", "clk"), ("EN", "en"), ("D", "in"), ("Q", "out"));
    match ty {
        "$mux" | "$_MUX_" => m(&[("A", "in0"), ("B", "in1"), ("S", "sel"), ("Y", "out")]),
        "$tribuf" => m(&[("A", "in"), ("EN", "en"), ("Y", "out")]),
        "$buf" => m(&[("A", "in"), ("Y", "out")]),
        "$dff" => m(&[clk, d, q]),
        "$dffe" => m(&[clk, en, d, q]),
        "$adff" => m(&[clk, ("ARST", "arst"), d, q]),
        "$adffe" => m(&[clk, en, ("ARST", "arst"), d, q]),
        "$sdff" => m(&[clk, ("SRST", "srst"), d, q]),
        "$sdffe" | "$sdffce" => m(&[clk, en, ("SRST", "srst"), d, q]),
        "$dlatch" => m(&[en, d, q]),
        "$adlatch" => m(&[en, ("ARST", "arst"), d, q]),
        "$dffsr" => m(&[clk, ("SET", "set"), ("CLR", "clr"), d, q]),
        "$dffsre" => m(&[clk, en, ("SET", "set"), ("CLR", "clr"), d, q]),
        "$aldff" => m(&[clk, ("ALOAD", "aload"), ("AD", "ain"), d, q]),
        "$aldffe" => m(&[clk, en, ("ALOAD", "aload"), ("AD", "ain"), d, q]),
        "$sr" => m(&[("SET", "set"), ("CLR", "clr"), q]),
        "$fsm" => m(&[("ARST", "arst"), ("CLK", "clk"), ("CTRL_IN", "in"), ("CTRL_OUT", "out")]),
        _ => None,
    }
}

struct Net {
    sources: Vec<Endpoint>,
    targets: Vec<Endpoint>,
    name: Option<String>,
    source_positions: Vec<SourcePos>,
}

#[derive(Clone, PartialEq)]
struct BitInfo {
    id: String,
    port: String,
    num: usize,
}

/// One module's conversion.
struct Conv<'a> {
    name: &'a str,
    // Insertion-ordered like the original's map: its order decides
    // the device numbering.
    nets: IndexMap<Vec<Bit>, Net>,
    netnames: HashMap<Vec<Bit>, Vec<String>>,
    netsrc: HashMap<Vec<Bit>, Vec<SourcePos>>,
    bits: HashMap<Bit, BitInfo>,
    devnets: HashMap<String, HashMap<String, Vec<Bit>>>,
    n: u32,
    pn: u32,
    devices: IndexMap<String, Device>,
    connectors: Vec<Connector>,
}

impl Conv<'_> {
    fn get_net(&mut self, k: &[Bit]) -> &mut Net {
        if !self.nets.contains_key(k) {
            let net = Net {
                sources: vec![],
                targets: vec![],
                name: self.netnames.get(k).map(|v| v[0].clone()),
                source_positions: self.netsrc.get(k).cloned().unwrap_or_default(),
            };
            self.nets.insert(k.to_vec(), net);
        }
        self.nets.get_mut(k).unwrap()
    }

    fn add_net_source(&mut self, k: &[Bit], d: &str, p: &str, primary: bool) {
        if k.is_empty() {
            return; // unconnected port
        }
        let ep = Endpoint { id: d.into(), port: p.into() };
        self.get_net(k).sources.push(ep);
        if primary {
            for (num, bit) in k.iter().enumerate() {
                self.bits.insert(bit.clone(), BitInfo { id: d.into(), port: p.into(), num });
            }
        }
        self.devnets.get_mut(d).unwrap().insert(p.into(), k.to_vec());
    }

    fn add_net_target(&mut self, k: &[Bit], d: &str, p: &str) {
        if k.is_empty() {
            return;
        }
        let ep = Endpoint { id: d.into(), port: p.into() };
        self.get_net(k).targets.push(ep);
        self.devnets.get_mut(d).unwrap().insert(p.into(), k.to_vec());
    }

    fn add_device(&mut self, cell: Cell) -> String {
        let dname = format!("dev{}", self.n);
        self.n += 1;
        self.devnets.insert(dname.clone(), HashMap::new());
        self.devices.insert(dname.clone(), Device::new(cell));
        dname
    }

    fn add_busgroup(&mut self, nbits: &[Bit], groups: &[Vec<Bit>]) {
        if !self.get_net(nbits).sources.is_empty() {
            return; // the bits were already grouped
        }
        let dname = self.add_device(Cell::BusGroup { groups: groups.iter().map(|g| g.len() as u32).collect() });
        self.add_net_source(nbits, &dname, "out", false);
        for (gn, group) in groups.iter().enumerate() {
            self.add_net_target(group, &dname, &port_name("in", gn));
        }
    }

    /// Widens/narrows an input to `sz` bits, sign or zero extending.
    fn match_port(&mut self, con: &mut Vec<Bit>, signed: bool, sz: usize) {
        if con.len() > sz {
            con.truncate(sz);
        } else if con.len() < sz {
            let ccon = con.clone();
            let pad = if signed { con.last().cloned().unwrap_or(Bit::Str("0".into())) } else { Bit::Str("0".into()) };
            con.resize(sz, pad);
            if !con.iter().all(Bit::is_const) && self.get_net(con).sources.is_empty() {
                // "potentially troublesome hack for readability" (the original)
                let extend = Extend { input: ccon.len() as u32, output: con.len() as u32 };
                let ext = self.add_device(if signed { Cell::SignExtend { extend } } else { Cell::ZeroExtend { extend } });
                self.add_net_target(&ccon, &ext, "in");
                self.add_net_source(con, &ext, "out", false);
            }
        }
    }

    /// A 1-bit result on a wider output: the rest is zero-extended.
    fn zero_extend_output(&mut self, con: &mut Vec<Bit>) {
        if con.len() > 1 {
            let ccon = con.clone();
            con.truncate(1);
            let ext = self.add_device(Cell::ZeroExtend { extend: Extend { input: 1, output: ccon.len() as u32 } });
            self.add_net_source(&ccon, &ext, "out", false);
            self.add_net_target(con, &ext, "in");
        }
    }

    /// A multi-bit operand of a logic and/or: or-reduced to one bit first.
    fn reduce_input(&mut self, con: &mut Vec<Bit>) {
        let ccon = std::mem::replace(con, vec![Bit::Str(format!("bit{}", self.pn))]);
        self.pn += 1;
        let ext = self.add_device(Cell::OrReduce(Unary { bits: Some(ccon.len() as u32) }));
        self.add_net_source(con, &ext, "out", false);
        self.add_net_target(&ccon, &ext, "in");
    }

    fn convert(mut self, module: &Module, modules: &IndexMap<String, Module>) -> R<Circuit> {
        // Find net names
        for (nname, data) in &module.netnames {
            if truthy(&data.hide_name) {
                continue;
            }
            self.netnames.entry(data.bits.clone()).or_default().push(nname.clone());
            if let Some(Value::String(src)) = data.attributes.get("src")
                && !src.is_empty()
            {
                self.netsrc.entry(data.bits.clone()).or_default().extend(parse_source_positions(src));
            }
        }

        // Add inputs/outputs
        for (pname, port) in &module.ports {
            let mut io = Io { net: pname.clone(), order: self.n, bits: port.bits.len() as u32, rows: None, cols: None, momentary: false };
            // A port has no attributes of its own in yosys's JSON, but its
            // backing wire (same name, in netnames) does.
            if let Some(attrs) = module.netnames.get(pname).map(|n| &n.attributes) {
                if let (Some(r), Some(c)) = (attrs.get("led_matrix_rows"), attrs.get("led_matrix_cols")) {
                    io.rows = Some(num(Some(r))? as u32);
                    io.cols = Some(num(Some(c))? as u32);
                }
                io.momentary = attrs.contains_key("momentary");
            }
            match port.direction.as_str() {
                "input" => {
                    let dname = self.add_device(Cell::Input(io));
                    self.add_net_source(&port.bits, &dname, "out", true);
                }
                "output" => {
                    let dname = self.add_device(Cell::Output(io));
                    self.add_net_target(&port.bits, &dname, "in");
                }
                d => return Err(format!("Invalid port direction: {d}")),
            }
        }

        // Add gates
        for (cname, cell) in &module.cells {
            self.add_cell(cname, cell, modules)?;
        }

        // Group bits into nets for complex sources
        for i in 0..self.nets.len() {
            let (nbits, net) = self.nets.get_index(i).unwrap();
            if !net.sources.is_empty() {
                continue;
            }
            let nbits = nbits.clone();
            #[derive(PartialEq)]
            enum Info<'b> {
                Dev(&'b BitInfo),
                Const,
                Undriven,
            }
            let mut groups: Vec<Vec<Bit>> = vec![vec![]];
            let mut prev = Info::Undriven;
            for bit in &nbits {
                let info = match self.bits.get(bit) {
                    Some(b) => Info::Dev(b),
                    None if bit.is_const() => Info::Const,
                    None => Info::Undriven,
                };
                let split = match (&info, &prev) {
                    (Info::Dev(a), Info::Dev(b)) => a.id != b.id || a.port != b.port || a.num != b.num + 1,
                    (a, b) => std::mem::discriminant(a) != std::mem::discriminant(b),
                };
                if !groups.last().unwrap().is_empty() && split {
                    groups.push(vec![]);
                }
                groups.last_mut().unwrap().push(bit.clone());
                prev = info;
            }
            if groups.len() == 1 {
                continue;
            }
            if groups.last().unwrap().iter().all(|x| x.is("0")) {
                // infer zero-extend
                let ilen = nbits.len() - groups.last().unwrap().len();
                let extend = Extend { output: nbits.len() as u32, input: ilen as u32 };
                let dname = self.add_device(Cell::ZeroExtend { extend });
                let zbits = &nbits[..ilen];
                self.add_net_source(&nbits, &dname, "out", false);
                self.add_net_target(zbits, &dname, "in");
                if groups.len() > 2 {
                    self.add_busgroup(zbits, &groups[..groups.len() - 1]);
                }
            } else {
                self.add_busgroup(&nbits, &groups);
            }
        }

        // Add constants
        for i in 0..self.nets.len() {
            let (nbits, net) = self.nets.get_index(i).unwrap();
            if !net.sources.is_empty() || !nbits.iter().all(Bit::is_const) {
                continue;
            }
            let nbits = nbits.clone();
            let constant = nbits.iter().rev().map(Bit::text).collect();
            let dname = self.add_device(Cell::Constant { constant });
            self.add_net_source(&nbits, &dname, "out", false);
        }

        // Select bits from complex targets
        for i in 0..self.nets.len() {
            let (nbits, net) = self.nets.get_index(i).unwrap();
            if !net.sources.is_empty() {
                continue;
            }
            // constants should be already handled!
            ensure!(nbits.iter().all(|x| x.is_const() || matches!(x, Bit::Id(n) if *n > 1)));
            let Some(infos) = nbits.iter().map(|x| self.bits.get(x)).collect::<Option<Vec<_>>>() else {
                continue; // ignore not fully driven ports
            };
            // complex sources should be already handled!
            ensure!(infos.iter().all(|i| i.id == infos[0].id && i.port == infos[0].port));
            let cconn = self.devnets[&infos[0].id][&infos[0].port].clone();
            let slice = Slice { first: infos[0].num as u32, count: infos.len() as u32, total: cconn.len() as u32 };
            let nbits = nbits.clone();
            let dname = self.add_device(Cell::BusSlice { slice });
            self.add_net_source(&nbits, &dname, "out", false);
            self.add_net_target(&cconn, &dname, "in");
        }

        // Resolve multi-driver nets: N sources into one TriMerge, so every
        // net below has exactly one source.
        for i in 0..self.nets.len() {
            let (nbits, net) = self.nets.get_index(i).unwrap();
            if net.sources.len() <= 1 {
                continue;
            }
            let (bits, sources) = (nbits.len() as u32, net.sources.clone());
            let dname = self.add_device(Cell::TriMerge { bits, inputs: sources.len() as u32 });
            for (i, src) in sources.into_iter().enumerate() {
                let to = Endpoint { id: dname.clone(), port: port_name("in", i) };
                self.connectors.push(Connector { from: src, to, name: None, source_positions: None });
            }
            self.nets[i].sources = vec![Endpoint { id: dname, port: "out".into() }];
        }

        // Generate connections between devices
        for i in 0..self.nets.len() {
            let (nbits, net) = self.nets.get_index(i).unwrap();
            let Some(source) = net.sources.first().cloned() else {
                let bits: Vec<String> = nbits.iter().map(Bit::text).collect();
                eprintln!("Undriven net in {}: {}", self.name, bits.join(","));
                continue;
            };
            let (targets, name, sp) = (net.targets.clone(), net.name.clone(), net.source_positions.clone());
            for (n, to) in targets.into_iter().enumerate() {
                let mut from = source.clone();
                if n > 0
                    && let Cell::Constant { constant } = &self.devices[&source.id].cell
                {
                    // replicate constants for better clarity
                    let dname = self.add_device(Cell::Constant { constant: constant.clone() });
                    from = Endpoint { id: dname, port: "out".into() };
                }
                self.connectors.push(Connector { from, to, name: name.clone(), source_positions: Some(sp.clone()) });
            }
        }

        Ok(Circuit { devices: self.devices, connectors: self.connectors, subcircuits: None })
    }

    fn add_cell(&mut self, cname: &str, cell: &YCell, modules: &IndexMap<String, Module>) -> R<()> {
        let ty = cell.ty.as_str();
        let params = &cell.parameters;
        let p = |k: &str| num(params.get(k));
        let flag = |k: &str| Ok::<bool, String>(num(params.get(k))? != 0);
        let mut conns = cell.connections.clone();
        let conn = |conns: &IndexMap<String, Vec<Bit>>, k: &str| {
            conns.get(k).cloned().ok_or_else(|| format!("{ty} cell {cname} has no {k} connection"))
        };
        let dir = |k: &str| cell.port_directions.get(k).map(String::as_str);
        let len = |k: &str| conns.get(k).map_or(0, Vec::len);

        // The device is numbered before the helper devices made below.
        let dname = self.add_device(Cell::Constant { constant: String::new() });

        if UNARY_GATES.contains(&ty) {
            ensure!(len("A") as i64 == p("A_WIDTH")?);
            ensure!(len("Y") as i64 == p("Y_WIDTH")?);
            ensure!(dir("A") == Some("input"));
            ensure!(dir("Y") == Some("output"));
        }
        if TECHMAP_UNARY_GATES.contains(&ty) {
            ensure!(len("A") == 1 && len("Y") == 1);
            ensure!(dir("A") == Some("input"));
            ensure!(dir("Y") == Some("output"));
        }
        if BINARY_GATES.contains(&ty) {
            ensure!(len("A") as i64 == p("A_WIDTH")?);
            ensure!(len("B") as i64 == p("B_WIDTH")?);
            ensure!(len("Y") as i64 == p("Y_WIDTH")?);
            ensure!(dir("A") == Some("input") && dir("B") == Some("input"));
            ensure!(dir("Y") == Some("output"));
        }
        if TECHMAP_BINARY_GATES.contains(&ty) {
            ensure!(len("A") == 1 && len("B") == 1 && len("Y") == 1);
            ensure!(dir("A") == Some("input") && dir("B") == Some("input"));
            ensure!(dir("Y") == Some("output"));
        }
        if DFFS.contains(&ty) {
            ensure!(len("D") as i64 == p("WIDTH")?);
            ensure!(len("Q") as i64 == p("WIDTH")?);
            ensure!(dir("D") == Some("input"));
            ensure!(dir("Q") == Some("output"));
            if ty != "$dlatch" && ty != "$adlatch" {
                ensure!(len("CLK") == 1);
                ensure!(dir("CLK") == Some("input"));
            }
        }
        if ["$dffe", "$adffe", "$sdffe", "$sdffce", "$dffsre", "$aldffe", "$dlatch", "$adlatch"].contains(&ty) {
            ensure!(len("EN") == 1);
            ensure!(dir("EN") == Some("input"));
        }
        if ["$adff", "$adffe", "$adlatch"].contains(&ty) {
            ensure!(len("ARST") == 1);
            ensure!(dir("ARST") == Some("input"));
        }
        if ["$sdff", "$sdffe", "$sdffce"].contains(&ty) {
            ensure!(len("SRST") == 1);
            ensure!(dir("SRST") == Some("input"));
        }
        if ["$dffsr", "$dffsre"].contains(&ty) {
            ensure!(len("SET") as i64 == p("WIDTH")?);
            ensure!(len("CLR") as i64 == p("WIDTH")?);
            ensure!(dir("SET") == Some("input") && dir("CLR") == Some("input"));
        }

        let gate = |bits| Gate { bits, inputs: None };
        let unary = |bits| Unary { bits };
        let w = || Ok::<u32, String>(p("WIDTH")? as u32);
        let dff = |bits, polarity| Dff {
            bits,
            polarity: Some(polarity),
            arst_value: None,
            srst_value: None,
            enable_srst: false,
            no_data: false,
            initial: None,
        };
        let pol = |clock: Option<&str>, enable: Option<&str>, other: &[(&str, &str)]| -> R<DffPolarity> {
            let get = |k: Option<&str>| k.map(flag).transpose();
            let mut pol = DffPolarity { clock: get(clock)?, enable: get(enable)?, ..Default::default() };
            for &(field, param) in other {
                let v = Some(flag(param)?);
                match field {
                    "arst" => pol.arst = v,
                    "srst" => pol.srst = v,
                    "aload" => pol.aload = v,
                    "set" => pol.set = v,
                    _ => pol.clr = v,
                }
            }
            Ok(pol)
        };
        let (clk, en) = (Some("CLK_POLARITY"), Some("EN_POLARITY"));
        let arst = ("arst", "ARST_POLARITY");
        let srst = ("srst", "SRST_POLARITY");
        let (set, clr) = (("set", "SET_POLARITY"), ("clr", "CLR_POLARITY"));
        let yw = len("Y") as u32;

        let new_cell = if let Some((prefix, p1, p2, params)) = techmap_dff(ty) {
            for port in p1.iter().chain(p2.iter()) {
                let mport = techmap_port(port);
                ensure!(len(mport) == 1);
                ensure!(dir(mport) == Some(if mport == "Q" { "output" } else { "input" }));
            }
            let mut d = dff(1, DffPolarity::default());
            let polarity = d.polarity.as_mut().unwrap();
            let mut cs = params.chars();
            for port in p1.iter() {
                let v = Some(cs.next() == Some('P'));
                match *port {
                    "clk" => polarity.clock = v,
                    "en" => polarity.enable = v,
                    "arst" => polarity.arst = v,
                    "srst" => polarity.srst = v,
                    "aload" => polarity.aload = v,
                    "set" => polarity.set = v,
                    _ => polarity.clr = v,
                }
                if port.ends_with("rst") {
                    let v = Some(cs.next().unwrap().to_string());
                    if *port == "arst" { d.arst_value = v } else { d.srst_value = v }
                }
            }
            d.no_data = !p2.contains(&"in");
            d.enable_srst = prefix == "$_SDFFCE_";
            Cell::Dff(d)
        } else {
            match ty {
                "$neg" | "$pos" => {
                    let n = Neg { bits: InOut { r#in: len("A") as u32, out: yw }, signed: flag("A_SIGNED")? };
                    if ty == "$neg" { Cell::Negation(n) } else { Cell::UnaryPlus(n) }
                }
                "$not" => {
                    let mut a = conn(&conns, "A")?;
                    self.match_port(&mut a, flag("A_SIGNED")?, yw as usize);
                    conns.insert("A".into(), a);
                    Cell::Not(unary(Some(yw)))
                }
                "$_NOT_" => Cell::Not(unary(None)),
                "$buf" => {
                    ensure!(len("A") as i64 == p("WIDTH")?);
                    ensure!(len("Y") as i64 == p("WIDTH")?);
                    ensure!(dir("A") == Some("input"));
                    ensure!(dir("Y") == Some("output"));
                    Cell::Repeater(unary(Some(yw)))
                }
                "$repeater" | "$_BUF_" => Cell::Repeater(unary(None)),
                "$tribuf" => Cell::Tribuf(unary(Some(yw))),
                "$add" | "$sub" | "$mul" | "$div" | "$mod" | "$pow" => {
                    let op = BinOp {
                        bits: BinBits { in1: len("A") as u32, in2: len("B") as u32, out: Some(yw) },
                        signed: BinSigned { in1: flag("A_SIGNED")?, in2: flag("B_SIGNED")?, out: None },
                        fillx: None,
                    };
                    match ty {
                        "$add" => Cell::Addition(op),
                        "$sub" => Cell::Subtraction(op),
                        "$mul" => Cell::Multiplication(op),
                        "$div" => Cell::Division(op),
                        "$mod" => Cell::Modulo(op),
                        _ => Cell::Power(op),
                    }
                }
                "$and" | "$nand" | "$or" | "$nor" | "$xor" | "$xnor" => {
                    for (k, s) in [("A", "A_SIGNED"), ("B", "B_SIGNED")] {
                        let mut c = conn(&conns, k)?;
                        self.match_port(&mut c, flag(s)?, yw as usize);
                        conns.insert(k.into(), c);
                    }
                    bitwise(ty, gate(Some(yw)))
                }
                "$_AND_" | "$_NAND_" | "$_OR_" | "$_NOR_" | "$_XOR_" | "$_XNOR_" => {
                    bitwise(&ty.replace('_', "").to_lowercase(), gate(None))
                }
                "$reduce_and" | "$reduce_or" | "$reduce_xor" | "$reduce_xnor" | "$reduce_bool" | "$logic_not" => {
                    let bits = len("A") as u32;
                    let mut y = conn(&conns, "Y")?;
                    self.zero_extend_output(&mut y);
                    conns.insert("Y".into(), y);
                    let u = unary(Some(bits));
                    match ty {
                        "$reduce_xnor" | "$logic_not" if bits == 1 => Cell::Not(u),
                        _ if bits == 1 => Cell::Repeater(u),
                        "$reduce_and" => Cell::AndReduce(u),
                        "$reduce_or" | "$reduce_bool" => Cell::OrReduce(u),
                        "$reduce_xor" => Cell::XorReduce(u),
                        "$reduce_xnor" => Cell::XnorReduce(u),
                        _ => Cell::NorReduce(u),
                    }
                }
                "$reduce_nand" => Cell::NandReduce(unary(None)),
                "$reduce_nor" => Cell::NorReduce(unary(None)),
                "$eq" | "$ne" | "$lt" | "$le" | "$gt" | "$ge" | "$eqx" | "$nex" => {
                    let op = BinOp {
                        bits: BinBits { in1: len("A") as u32, in2: len("B") as u32, out: None },
                        signed: BinSigned { in1: flag("A_SIGNED")?, in2: flag("B_SIGNED")?, out: None },
                        fillx: None,
                    };
                    let mut y = conn(&conns, "Y")?;
                    self.zero_extend_output(&mut y);
                    conns.insert("Y".into(), y);
                    match ty {
                        "$eq" | "$eqx" => Cell::Eq(op),
                        "$ne" | "$nex" => Cell::Ne(op),
                        "$lt" => Cell::Lt(op),
                        "$le" => Cell::Le(op),
                        "$gt" => Cell::Gt(op),
                        _ => Cell::Ge(op),
                    }
                }
                "$shl" | "$shr" | "$sshl" | "$sshr" | "$shift" | "$shiftx" => {
                    let a_signed = flag("A_SIGNED")?;
                    let op = BinOp {
                        bits: BinBits { in1: len("A") as u32, in2: len("B") as u32, out: Some(yw) },
                        signed: BinSigned {
                            in1: a_signed,
                            in2: flag("B_SIGNED")? && matches!(ty, "$shift" | "$shiftx"),
                            out: Some(a_signed && matches!(ty, "$sshl" | "$sshr")),
                        },
                        fillx: Some(ty == "$shiftx"),
                    };
                    if matches!(ty, "$shl" | "$sshl") { Cell::ShiftLeft(op) } else { Cell::ShiftRight(op) }
                }
                "$logic_and" | "$logic_or" => {
                    for k in ["A", "B"] {
                        let mut c = conn(&conns, k)?;
                        if c.len() > 1 {
                            self.reduce_input(&mut c);
                        }
                        conns.insert(k.into(), c);
                    }
                    let mut y = conn(&conns, "Y")?;
                    self.zero_extend_output(&mut y);
                    conns.insert("Y".into(), y);
                    if ty == "$logic_and" { Cell::And(gate(None)) } else { Cell::Or(gate(None)) }
                }
                "$mux" => {
                    ensure!(len("A") as i64 == p("WIDTH")? && len("B") as i64 == p("WIDTH")?);
                    ensure!(len("Y") as i64 == p("WIDTH")?);
                    ensure!(dir("A") == Some("input") && dir("B") == Some("input"));
                    ensure!(dir("Y") == Some("output"));
                    Cell::Mux(Mux { bits: Some(MuxBits { r#in: w()?, sel: 1 }) })
                }
                "$_MUX_" => Cell::Mux(Mux { bits: None }),
                "$pmux" => {
                    ensure!(len("B") as i64 == p("WIDTH")? * p("S_WIDTH")?);
                    ensure!(len("A") as i64 == p("WIDTH")?);
                    ensure!(len("S") as i64 == p("S_WIDTH")?);
                    ensure!(len("Y") as i64 == p("WIDTH")?);
                    ensure!(dir("A") == Some("input") && dir("B") == Some("input") && dir("S") == Some("input"));
                    ensure!(dir("Y") == Some("output"));
                    Cell::Mux1Hot(Mux { bits: Some(MuxBits { r#in: w()?, sel: p("S_WIDTH")? as u32 }) })
                }
                "$bmux" => {
                    ensure!(len("A") as i64 == p("WIDTH")? * (1 << p("S_WIDTH")?));
                    ensure!(len("S") as i64 == p("S_WIDTH")?);
                    ensure!(len("Y") as i64 == p("WIDTH")?);
                    ensure!(dir("A") == Some("input") && dir("S") == Some("input"));
                    ensure!(dir("Y") == Some("output"));
                    Cell::Mux(Mux { bits: Some(MuxBits { r#in: w()?, sel: p("S_WIDTH")? as u32 }) })
                }
                "$dff" => Cell::Dff(dff(w()?, pol(clk, None, &[])?)),
                "$dffe" => Cell::Dff(dff(w()?, pol(clk, en, &[])?)),
                "$aldff" => Cell::Dff(dff(w()?, pol(clk, None, &[("aload", "ALOAD_POLARITY")])?)),
                "$aldffe" => Cell::Dff(dff(w()?, pol(clk, en, &[("aload", "ALOAD_POLARITY")])?)),
                "$adff" | "$adffe" | "$adlatch" => {
                    let c = if ty == "$adlatch" { None } else { clk };
                    let e = if ty == "$adff" { None } else { en };
                    let mut d = dff(w()?, pol(c, e, &[arst])?);
                    d.arst_value = constant(params.get("ARST_VALUE"), d.bits as usize)?;
                    Cell::Dff(d)
                }
                "$sdff" | "$sdffe" | "$sdffce" => {
                    let mut d = dff(w()?, pol(clk, if ty == "$sdff" { None } else { en }, &[srst])?);
                    d.enable_srst = ty == "$sdffce";
                    d.srst_value = constant(params.get("SRST_VALUE"), d.bits as usize)?;
                    Cell::Dff(d)
                }
                "$dlatch" => Cell::Dff(dff(w()?, pol(None, en, &[])?)),
                "$dffsr" => Cell::Dff(dff(w()?, pol(clk, None, &[set, clr])?)),
                "$dffsre" => Cell::Dff(dff(w()?, pol(clk, en, &[set, clr])?)),
                "$sr" => {
                    ensure!(len("Q") as i64 == p("WIDTH")?);
                    ensure!(dir("Q") == Some("output"));
                    let mut d = dff(w()?, pol(None, None, &[set, clr])?);
                    d.no_data = true;
                    Cell::Dff(d)
                }
                "$fsm" => self.fsm(cell, &p)?,
                "$mem" | "$mem_v2" => self.memory(cell, &p)?,
                "$lut" => {
                    ensure!(len("A") as i64 == p("WIDTH")?);
                    ensure!(len("Y") == 1);
                    ensure!(dir("A") == Some("input"));
                    ensure!(dir("Y") == Some("output"));
                    let Some(Value::String(lut)) = params.get("LUT") else {
                        return Err(format!("$lut cell {cname} has no LUT string"));
                    };
                    let abits = len("A") as u32;
                    let memdata: Vec<MemItem> = lut.chars().rev().map(|c| MemItem::Value(c.to_string())).collect();
                    ensure!(memdata.len() as u64 == 1u64 << abits);
                    // Rewrite cell connections to be $mem compatible for port mapping
                    let a = conns.shift_remove("A").unwrap();
                    let y = conns.shift_remove("Y").unwrap();
                    conns.insert("RD_ADDR".into(), a);
                    conns.insert("RD_DATA".into(), y);
                    Cell::Memory(Memory {
                        bits: yw,
                        abits,
                        words: None,
                        offset: None,
                        rdports: vec![MemPort::default()],
                        wrports: vec![],
                        memdata: Some(memdata),
                    })
                }
                _ if modules.contains_key(ty) => Cell::Subcircuit { celltype: ty.into() },
                _ => return Err(format!("Invalid cell type: {ty}")),
            }
        };

        let mut dev = Device::new(new_cell);
        dev.label = Some(cname.into());
        dev.hide_label = truthy(&cell.hide_name);
        if let Some(Value::String(src)) = cell.attributes.get("src")
            && !src.is_empty()
        {
            dev.source_positions = Some(parse_source_positions(src));
        }
        if let Cell::Dff(d) = &mut dev.cell
            && let Some(nms) = cell.connections.get("Q").and_then(|q| self.netnames.get(q))
        {
            // Yosys puts initial values in net attributes; there can be
            // many for a single actual net!
            for nm in nms {
                if let Some(init) = module_netname_attr(modules, self.name, nm, "init") {
                    d.initial = constant(Some(init), d.bits as usize)?;
                }
            }
        }

        match &dev.cell {
            _ if portmap(ty, modules).is_some() => {
                let pm = portmap(ty, modules).unwrap();
                for (pname, pdir) in &cell.port_directions {
                    let pconn = conn(&conns, pname)?;
                    let port = pm.get(pname).map_or("undefined", String::as_str);
                    match pdir.as_str() {
                        "input" => self.add_net_target(&pconn, &dname, port),
                        "output" => self.add_net_source(&pconn, &dname, port, true),
                        d => return Err(format!("Invalid port direction: {d}")),
                    }
                }
            }
            _ if ty == "$pmux" => {
                let (width, swidth) = (p("WIDTH")? as usize, p("S_WIDTH")? as usize);
                let s: Vec<Bit> = conn(&conns, "S")?.into_iter().rev().collect();
                self.add_net_target(&conn(&conns, "A")?, &dname, "in0");
                self.add_net_target(&s, &dname, "sel");
                self.add_net_source(&conn(&conns, "Y")?, &dname, "out", true);
                let b = conn(&conns, "B")?;
                for i in 0..swidth {
                    let p = (swidth - i - 1) * width;
                    self.add_net_target(&sl(&b, p, p + width), &dname, &port_name("in", i + 1));
                }
            }
            _ if ty == "$bmux" => {
                let (width, swidth) = (p("WIDTH")? as usize, p("S_WIDTH")? as usize);
                self.add_net_target(&conn(&conns, "S")?, &dname, "sel");
                self.add_net_source(&conn(&conns, "Y")?, &dname, "out", true);
                let a = conn(&conns, "A")?;
                for i in 0..1usize << swidth {
                    self.add_net_target(&sl(&a, i * width, (i + 1) * width), &dname, &port_name("in", i));
                }
            }
            Cell::Memory(m) => {
                let m = m.clone();
                self.connect_mem(&dname, &conns, &m)?;
            }
            _ => return Err(format!("Invalid cell type: {ty}")),
        }
        self.devices[&dname] = dev;
        Ok(())
    }

    fn fsm(&mut self, cell: &YCell, p: &dyn Fn(&str) -> R<i64>) -> R<Cell> {
        let params = &cell.parameters;
        let len = |k: &str| cell.connections.get(k).map_or(0, Vec::len) as i64;
        let flag = |k: &str| Ok::<bool, String>(p(k)? != 0);
        ensure!(len("ARST") == 1);
        ensure!(len("CLK") == 1);
        ensure!(len("CTRL_IN") == p("CTRL_IN_WIDTH")?);
        ensure!(len("CTRL_OUT") == p("CTRL_OUT_WIDTH")?);
        let (trans_num, log2) = (p("TRANS_NUM")? as usize, p("STATE_NUM_LOG2")? as usize);
        let (ciw, cow) = (p("CTRL_IN_WIDTH")? as usize, p("CTRL_OUT_WIDTH")? as usize);
        let step = 2 * log2 + ciw + cow;
        let tt = match params.get("TRANS_TABLE") {
            // workaround for yosys silliness
            Some(v @ Value::Number(_)) => {
                let bin: String = num_bits_lsb(v)?.into_iter().rev().collect();
                LogicVec::from_bin(&bin, Some(trans_num * step)).unwrap().to_bin()
            }
            Some(Value::String(s)) => s.clone(),
            _ => return Err("$fsm cell has no TRANS_TABLE".into()),
        };
        ensure!(tt.len() == trans_num * step);
        let mut trans_table = Vec::new();
        for i in 0..trans_num {
            let mut base = i * step;
            let mut f = |sz: usize| {
                let ret = str_sl(&tt, base, base + sz);
                base += sz;
                ret
            };
            let state_in = parse_bin(f(log2));
            let ctrl_in = f(ciw).replace('-', "x");
            let state_out = parse_bin(f(log2));
            let ctrl_out = f(cow).to_string();
            trans_table.push(Transition { state_in, ctrl_in, state_out, ctrl_out });
        }
        Ok(Cell::Fsm(Fsm {
            polarity: FsmPolarity { clock: flag("CLK_POLARITY")?, arst: flag("ARST_POLARITY")? },
            wirename: params.get("NAME").cloned().unwrap_or(Value::Null),
            bits: InOut { r#in: ciw as u32, out: cow as u32 },
            states: p("STATE_NUM")? as u32,
            init_state: p("STATE_RST")? as u32,
            trans_table,
        }))
    }

    fn memory(&mut self, cell: &YCell, p: &dyn Fn(&str) -> R<i64>) -> R<Cell> {
        let params = &cell.parameters;
        let v2 = cell.ty == "$mem_v2";
        let c = |k: &str| cell.connections.get(k).cloned().unwrap_or_default();
        let (rd, wr) = (p("RD_PORTS")? as usize, p("WR_PORTS")? as usize);
        let (width, abits) = (p("WIDTH")? as usize, p("ABITS")? as usize);
        ensure!(c("RD_EN").len() == rd);
        ensure!(c("RD_CLK").len() == rd);
        ensure!(c("RD_DATA").len() == rd * width);
        ensure!(c("RD_ADDR").len() == rd * abits);
        ensure!(c("WR_EN").len() == wr * width);
        ensure!(c("WR_CLK").len() == wr);
        ensure!(c("WR_DATA").len() == wr * width);
        ensure!(c("WR_ADDR").len() == wr * abits);
        if v2 {
            ensure!(c("RD_ARST").len() == rd);
            ensure!(c("RD_SRST").len() == rd);
        }
        let words = p("SIZE")? as usize;
        let rdpol = bits_lsb(params.get("RD_CLK_POLARITY"))?;
        let rden = bits_lsb(params.get("RD_CLK_ENABLE"))?;
        let rdtr = if v2 { vec![] } else { bits_lsb(params.get("RD_TRANSPARENT"))? };
        let wrpol = bits_lsb(params.get("WR_CLK_POLARITY"))?;
        let wren = bits_lsb(params.get("WR_CLK_ENABLE"))?;
        let init_param = params.get("INIT").ok_or("memory cell has no INIT")?;
        let init: Vec<char> = match init_param {
            Value::String(s) => s.chars().rev().collect(),
            v => num_bits_lsb(v)?,
        };
        let v2_feature = |k: &str| if v2 { bits_lsb(params.get(k)) } else { Ok(vec![]) };
        let v2_feature_const = |k: &str, size| -> R<String> {
            if v2 { constant(params.get(k), size)?.ok_or(format!("memory cell has no {k}")) } else { Ok(String::new()) }
        };
        let rdtrmask = v2_feature("RD_TRANSPARENCY_MASK")?;
        let rdcolmask = v2_feature("RD_COLLISION_X_MASK")?;
        let rdensrst = v2_feature("RD_CE_OVER_SRST")?;
        let rdinit = v2_feature_const("RD_INIT_VALUE", width * rd)?;
        let rdarst = v2_feature_const("RD_ARST_VALUE", width * rd)?;
        let rdsrst = v2_feature_const("RD_SRST_VALUE", width * rd)?;
        let mut memdata = None;
        if truthy(init_param) {
            let fill = if init.last() == Some(&'x') { 'x' } else { '0' };
            let mut data = Vec::with_capacity(words);
            for k in 0..words {
                let mut wrd = sl(&init, width * k, width * (k + 1));
                wrd.resize(width, fill);
                let s: String = wrd.into_iter().rev().collect();
                data.push(LogicVec::from_bin(&s, None).ok_or(format!("bad memory INIT word {s}"))?);
            }
            memdata = Some(LogicMem::from_data(width, data).to_json());
        }
        let (rd_en, rd_arst, rd_srst) = (c("RD_EN"), c("RD_ARST"), c("RD_SRST"));
        let mut rdports = Vec::new();
        for k in 0..rd {
            let mut port = MemPort::default();
            if bit_at(&rden, k) {
                port.clock_polarity = Some(bit_at(&rdpol, k));
                if !rd_en[k].is("1") {
                    port.enable_polarity = Some(true);
                }
            }
            if bit_at(&rdtr, k) {
                port.transparent = Some(PortMask::All(true));
            }
            if v2 {
                if bit_at(&rdensrst, k) {
                    port.enable_srst = Some(true);
                }
                let mk_init = |s: &str| {
                    let v = str_sl(s, width * k, width * (k + 1));
                    (!v.chars().all(|c| c == 'x')).then(|| v.to_string())
                };
                port.init_value = mk_init(&rdinit);
                if !rd_arst[k].is("0") {
                    port.arst_polarity = Some(true);
                    port.arst_value = mk_init(&rdarst);
                }
                if !rd_srst[k].is("0") {
                    port.srst_polarity = Some(true);
                    port.srst_value = mk_init(&rdsrst);
                }
                let mk_mask = |s: &[u8]| {
                    let mut v = vec![0u8; wr];
                    for (i, c) in sl(s, wr * k, wr * (k + 1)).into_iter().enumerate() {
                        v[i] = c;
                    }
                    if v.iter().all(|&c| c != 0) {
                        Some(PortMask::All(true))
                    } else if v.iter().any(|&c| c != 0) {
                        Some(PortMask::Each(v.iter().map(|&c| c != 0).collect()))
                    } else {
                        None
                    }
                };
                if let Some(m) = mk_mask(&rdtrmask) {
                    port.transparent = Some(m);
                }
                port.collision = mk_mask(&rdcolmask);
            }
            rdports.push(port);
        }
        let wr_en = c("WR_EN");
        let mut wrports = Vec::new();
        for k in 0..wr {
            let mut port = MemPort::default();
            if bit_at(&wren, k) {
                port.clock_polarity = Some(bit_at(&wrpol, k));
                let en = sl(&wr_en, width * k, width * (k + 1));
                if en.iter().any(|z| !z.is("1")) {
                    port.enable_polarity = Some(true);
                    if en.iter().all(|z| *z == en[0]) {
                        port.no_bit_enable = Some(true);
                    }
                }
            }
            wrports.push(port);
        }
        Ok(Cell::Memory(Memory {
            bits: width as u32,
            abits: abits as u32,
            words: Some(words as u32),
            offset: Some(p("OFFSET")?),
            rdports,
            wrports,
            memdata,
        }))
    }

    fn connect_mem(&mut self, dname: &str, conns: &IndexMap<String, Vec<Bit>>, m: &Memory) -> R<()> {
        let (bits, abits) = (m.bits as usize, m.abits as usize);
        let c = |k: &str| conns.get(k).cloned().unwrap_or_default();
        let one = |k: &str, i: usize| -> R<Vec<Bit>> {
            conns.get(k).and_then(|v| v.get(i)).map(|b| vec![b.clone()]).ok_or(format!("memory cell has no {k}[{i}]"))
        };
        for (k, port) in m.rdports.iter().enumerate() {
            let pn = format!("rd{k}");
            self.add_net_target(&sl(&c("RD_ADDR"), abits * k, abits * (k + 1)), dname, &format!("{pn}addr"));
            self.add_net_source(&sl(&c("RD_DATA"), bits * k, bits * (k + 1)), dname, &format!("{pn}data"), true);
            if port.clock_polarity.is_some() {
                self.add_net_target(&one("RD_CLK", k)?, dname, &format!("{pn}clk"));
            }
            if port.enable_polarity.is_some() {
                self.add_net_target(&one("RD_EN", k)?, dname, &format!("{pn}en"));
            }
            if port.arst_polarity.is_some() {
                self.add_net_target(&one("RD_ARST", k)?, dname, &format!("{pn}arst"));
            }
            if port.srst_polarity.is_some() {
                self.add_net_target(&one("RD_SRST", k)?, dname, &format!("{pn}srst"));
            }
        }
        for (k, port) in m.wrports.iter().enumerate() {
            let pn = format!("wr{k}");
            self.add_net_target(&sl(&c("WR_ADDR"), abits * k, abits * (k + 1)), dname, &format!("{pn}addr"));
            self.add_net_target(&sl(&c("WR_DATA"), bits * k, bits * (k + 1)), dname, &format!("{pn}data"));
            if port.clock_polarity.is_some() {
                self.add_net_target(&one("WR_CLK", k)?, dname, &format!("{pn}clk"));
            }
            if port.enable_polarity.is_some() {
                let en = if port.no_bit_enable.is_some() {
                    one("WR_EN", bits * k)?
                } else {
                    sl(&c("WR_EN"), bits * k, bits * (k + 1))
                };
                self.add_net_target(&en, dname, &format!("{pn}en"));
            }
        }
        Ok(())
    }
}

fn module_netname_attr<'a>(modules: &'a IndexMap<String, Module>, m: &str, nm: &str, attr: &str) -> Option<&'a Value> {
    modules.get(m)?.netnames.get(nm)?.attributes.get(attr)
}

/// `$and` .. `$xnor` (or the techmap names, lowercased) to their gate.
fn bitwise(ty: &str, g: Gate) -> Cell {
    match ty {
        "$and" => Cell::And(g),
        "$nand" => Cell::Nand(g),
        "$or" => Cell::Or(g),
        "$nor" => Cell::Nor(g),
        "$xor" => Cell::Xor(g),
        _ => Cell::Xnor(g),
    }
}

/// The original's module order (the `topsort` npm package): the last one
/// is the top level.
// ponytail: JS sorts each node's successors with a comparator that calls the
// Infinity sentinel equal to every name; plain string order here. Only the
// order of the subcircuits can differ, and only with several top modules.
fn module_order(modules: &IndexMap<String, Module>) -> Vec<String> {
    const INF: &str = "Infinity";
    let mut nodes: IndexMap<String, Vec<String>> = IndexMap::new();
    let mut edge = |from: &str, to: &str| {
        nodes.entry(to.into()).or_default();
        nodes.entry(from.into()).or_default().push(to.into());
    };
    for (name, m) in modules {
        edge(name, INF);
        for cell in m.cells.values() {
            if modules.contains_key(&cell.ty) {
                edge(&cell.ty, name);
            }
        }
    }
    fn visit(id: &str, nodes: &IndexMap<String, Vec<String>>, visited: &mut Vec<String>, sorted: &mut Vec<String>) {
        if visited.iter().any(|v| v == id) {
            return;
        }
        visited.push(id.into());
        let mut afters = nodes[id].clone();
        afters.sort_by(|a, b| b.cmp(a));
        for a in &afters {
            visit(a, nodes, visited, sorted);
        }
        sorted.push(id.into());
    }
    let mut keys: Vec<String> = nodes.keys().cloned().collect();
    keys.sort_by(|a, b| b.cmp(a));
    let (mut visited, mut sorted) = (vec![], vec![]);
    for k in &keys {
        visit(k, &nodes, &mut visited, &mut sorted);
    }
    sorted.reverse();
    sorted.retain(|m| m != INF || modules.contains_key(INF));
    sorted
}

/// Every module converted, the top level one with the others as its
/// subcircuits.
pub fn convert(design: &Design) -> R<Circuit> {
    let mut out = IndexMap::new();
    for (name, module) in &design.modules {
        let conv = Conv {
            name,
            nets: IndexMap::new(),
            netnames: HashMap::new(),
            netsrc: HashMap::new(),
            bits: HashMap::new(),
            devnets: HashMap::new(),
            n: 0,
            pn: 0,
            devices: IndexMap::new(),
            connectors: vec![],
        };
        out.insert(name.clone(), conv.convert(module, &design.modules)?);
    }
    let mut order = module_order(&design.modules);
    let top = order.pop().ok_or("no modules in the yosys netlist")?;
    let mut circuit = out.shift_remove(&top).unwrap();
    circuit.subcircuits = Some(order.into_iter().map(|m| { let c = out.shift_remove(&m).unwrap(); (m, c) }).collect());
    Ok(circuit)
}

/// `io_ui`: the top level's ports become widgets, by name and width.
pub fn io_ui(circuit: &mut Circuit) {
    for dev in circuit.devices.values_mut() {
        let (Cell::Input(io) | Cell::Output(io)) = &dev.cell else { continue };
        let io = io.clone();
        let label = io.net.clone();
        let one = io.bits == 1;
        dev.cell = if let Cell::Input(_) = dev.cell {
            if one && (label == "clk" || label == "clock") {
                dev.propagation = Some(100);
                Cell::Clock(io)
            } else if one && (io.momentary || label.starts_with("pushbutton")) {
                Cell::PushButton(io)
            } else if one {
                Cell::Button(io)
            } else {
                Cell::NumEntry(io)
            }
        } else if one {
            Cell::Lamp(io)
        } else if let (Some(r @ 1..), Some(c @ 1..)) = (io.rows, io.cols)
            && r as u64 * c as u64 == io.bits as u64
        {
            // attributes that don't match the width fall through
            Cell::LedMatrix(io)
        } else if io.bits == 8 && (label == "display7" || label.starts_with("display7_")) {
            Cell::Display7(io)
        } else {
            Cell::NumDisplay(io)
        };
        dev.label = Some(label);
    }
}
