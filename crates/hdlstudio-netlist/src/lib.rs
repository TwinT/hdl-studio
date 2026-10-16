//! The circuit model: devices (cells), connectors and subcircuits.
//!
//! Its serde form is digitaljs's circuit JSON, field for field, so the
//! extension's digitaljs UI can keep loading what the engine produces until
//! the new UI replaces it.
// ponytail: fields mirror digitaljs, including its quirks (`bits` is a number
// for some cells and an object for others); a cleaner .hdls form can come
// with the new UI.

use hdlstudio_logic::MemItem;
use indexmap::IndexMap;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Circuit {
    pub devices: IndexMap<String, Device>,
    pub connectors: Vec<Connector>,
    /// Only on the top-level circuit.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subcircuits: Option<IndexMap<String, Circuit>>,
}

#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct Endpoint {
    pub id: String,
    pub port: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Connector {
    pub from: Endpoint,
    pub to: Endpoint,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_positions: Option<Vec<SourcePos>>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct SourcePos {
    pub name: String,
    pub from: LineCol,
    pub to: LineCol,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct LineCol {
    pub line: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub column: Option<u32>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Device {
    #[serde(flatten)]
    pub cell: Cell,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(default, skip_serializing_if = "is_false")]
    pub hide_label: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_positions: Option<Vec<SourcePos>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub propagation: Option<u32>,
}

impl Device {
    pub fn new(cell: Cell) -> Device {
        Device { cell, label: None, hide_label: false, source_positions: None, propagation: None }
    }
}

fn is_false(b: &bool) -> bool {
    !b
}

fn one() -> u32 {
    1
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum Cell {
    // Ports of a module, and what io_ui turns the top-level ones into.
    Input(Io),
    Output(Io),
    Clock(Io),
    Button(Io),
    PushButton(Io),
    NumEntry(Io),
    Lamp(Io),
    NumDisplay(Io),
    Display7(Io),
    #[serde(rename = "LEDMatrix")]
    LedMatrix(Io),

    Not(Unary),
    Repeater(Unary),
    Tribuf(Unary),
    And(Gate),
    Nand(Gate),
    Or(Gate),
    Nor(Gate),
    Xor(Gate),
    Xnor(Gate),
    AndReduce(Unary),
    NandReduce(Unary),
    OrReduce(Unary),
    NorReduce(Unary),
    XorReduce(Unary),
    XnorReduce(Unary),

    Negation(Neg),
    UnaryPlus(Neg),
    Addition(BinOp),
    Subtraction(BinOp),
    Multiplication(BinOp),
    Division(BinOp),
    Modulo(BinOp),
    Power(BinOp),
    ShiftLeft(BinOp),
    ShiftRight(BinOp),
    Lt(BinOp),
    Le(BinOp),
    Eq(BinOp),
    Ne(BinOp),
    Gt(BinOp),
    Ge(BinOp),
    // Made by transform from the above, with one operand a small constant.
    AdditionConst(ConstOp),
    SubtractionConst(ConstOp),
    MultiplicationConst(ConstOp),
    DivisionConst(ConstOp),
    ModuloConst(ConstOp),
    PowerConst(ConstOp),
    ShiftLeftConst(ConstOp),
    ShiftRightConst(ConstOp),
    LtConst(ConstOp),
    LeConst(ConstOp),
    EqConst(ConstOp),
    NeConst(ConstOp),
    GtConst(ConstOp),
    GeConst(ConstOp),

    Mux(Mux),
    Mux1Hot(Mux),
    MuxSparse(MuxSparse),
    Dff(Dff),
    Memory(Memory),
    #[serde(rename = "FSM")]
    Fsm(Fsm),

    BusGroup { groups: Vec<u32> },
    BusSlice { slice: Slice },
    ZeroExtend { extend: Extend },
    SignExtend { extend: Extend },
    Constant { constant: String },
    TriMerge { bits: u32, inputs: u32 },
    Subcircuit { celltype: String },
}

/// digitaljs doesn't save `net`, `order` or `bits` for a Clock.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Io {
    #[serde(default)]
    pub net: String,
    #[serde(default)]
    pub order: u32,
    #[serde(default = "one")]
    pub bits: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rows: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cols: Option<u32>,
    #[serde(default, skip_serializing_if = "is_false")]
    pub momentary: bool,
}

/// One input, `bits` wide (absent means 1).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Unary {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bits: Option<u32>,
}

/// A bitwise gate with `inputs` inputs (absent means 2).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Gate {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bits: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub inputs: Option<u32>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Neg {
    pub bits: InOut,
    pub signed: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct InOut {
    pub r#in: u32,
    pub out: u32,
}

/// Arithmetic (`out` set, `signed.out` not), comparisons (neither) and
/// shifts (both, plus `fillx`).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct BinOp {
    pub bits: BinBits,
    pub signed: BinSigned,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fillx: Option<bool>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct BinBits {
    pub in1: u32,
    pub in2: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub out: Option<u32>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct BinSigned {
    pub in1: bool,
    pub in2: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub out: Option<bool>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ConstOp {
    pub bits: ConstBits,
    pub signed: ConstSigned,
    #[serde(rename = "leftOp")]
    pub left_op: bool,
    pub constant: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fillx: Option<bool>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ConstBits {
    pub r#in: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub out: Option<u32>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ConstSigned {
    pub r#in: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub out: Option<bool>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Mux {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bits: Option<MuxBits>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct MuxBits {
    pub r#in: u32,
    pub sel: u32,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct MuxSparse {
    pub bits: MuxBits,
    pub inputs: Vec<i64>,
    pub default_input: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Dff {
    pub bits: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub polarity: Option<DffPolarity>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub arst_value: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub srst_value: Option<String>,
    #[serde(default, skip_serializing_if = "is_false")]
    pub enable_srst: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    pub no_data: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub initial: Option<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct DffPolarity {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub clock: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub enable: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub arst: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub srst: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub aload: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub set: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub clr: Option<bool>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Memory {
    pub bits: u32,
    pub abits: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub words: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub offset: Option<i64>,
    pub rdports: Vec<MemPort>,
    pub wrports: Vec<MemPort>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub memdata: Option<Vec<MemItem>>,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct MemPort {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub clock_polarity: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub enable_polarity: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub no_bit_enable: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transparent: Option<PortMask>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub collision: Option<PortMask>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub enable_srst: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub init_value: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub arst_polarity: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub arst_value: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub srst_polarity: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub srst_value: Option<String>,
}

/// All write ports (`true`) or one flag per write port.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum PortMask {
    All(bool),
    Each(Vec<bool>),
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Fsm {
    pub polarity: FsmPolarity,
    /// Not saved by digitaljs.
    #[serde(default)]
    pub wirename: serde_json::Value,
    pub bits: InOut,
    pub states: u32,
    pub init_state: u32,
    pub trans_table: Vec<Transition>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct FsmPolarity {
    pub clock: bool,
    pub arst: bool,
}

/// `None` states are what digitaljs gets as NaN (an empty state field).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Transition {
    pub state_in: Option<i64>,
    pub ctrl_in: String,
    pub state_out: Option<i64>,
    pub ctrl_out: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Slice {
    pub first: u32,
    pub count: u32,
    pub total: u32,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Extend {
    pub input: u32,
    pub output: u32,
}
