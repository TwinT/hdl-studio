use crate::{Bit, LogicVec};

/// One item of 4vl's memory JSON representation (`Mem4vl.fromJSON`): a
/// count repeats the value that follows it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum MemItem {
    Repeat(usize),
    Value(String),
}

/// A memory: `len` words of `bits` bits each (4vl's `Mem4vl`).
// ponytail: one LogicVec per word; flat planes if big memories get slow.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LogicMem {
    bits: usize,
    data: Vec<LogicVec>,
}

impl LogicMem {
    pub fn new(bits: usize, len: usize, init: Bit) -> LogicMem {
        LogicMem { bits, data: vec![LogicVec::make(bits, init); len] }
    }

    pub fn from_data(bits: usize, data: Vec<LogicVec>) -> LogicMem {
        assert!(
            data.iter().all(|v| v.bits() == bits),
            "LogicMem::from_data() called with vectors of different sizes"
        );
        LogicMem { bits, data }
    }

    /// Each string is one word in binary if it is `bits` long, one word in hex
    /// if it is `ceil(bits / 4)` long, else several hex words back to back.
    pub fn from_json(bits: usize, rep: &[MemItem]) -> Option<LogicMem> {
        let hexlen = bits.div_ceil(4);
        let mut data = Vec::new();
        let decode = |x: &str, data: &mut Vec<LogicVec>| -> Option<()> {
            if x.len() == bits {
                data.push(LogicVec::from_bin(x, Some(bits))?);
            } else if hexlen > 0 {
                for chunk in x.as_bytes().chunks(hexlen) {
                    data.push(LogicVec::from_hex(std::str::from_utf8(chunk).ok()?, Some(bits))?);
                }
            }
            Some(())
        };
        let mut items = rep.iter();
        while let Some(item) = items.next() {
            match item {
                MemItem::Value(x) => decode(x, &mut data)?,
                MemItem::Repeat(count) => {
                    let MemItem::Value(x) = items.next()? else { return None };
                    for _ in 0..*count {
                        decode(x, &mut data)?;
                    }
                }
            }
        }
        Some(LogicMem { bits, data })
    }

    pub fn bits(&self) -> usize {
        self.bits
    }

    pub fn len(&self) -> usize {
        self.data.len()
    }

    pub fn is_empty(&self) -> bool {
        self.data.is_empty()
    }

    pub fn get(&self, i: usize) -> &LogicVec {
        &self.data[i]
    }

    pub fn set(&mut self, i: usize, v: LogicVec) {
        assert_eq!(v.bits(), self.bits, "LogicMem::set() called with a vector of a different width");
        self.data[i] = v;
    }
}
