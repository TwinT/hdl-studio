//! Replays golden cases computed by the JavaScript library HDL Studio used
//! before (its generator is in git history).
#![allow(clippy::type_complexity)]

use hdlstudio_logic::{Bit, LogicMem, LogicVec, MemItem};
use serde_json::{Value, json};

fn vec(s: &Value) -> LogicVec {
    LogicVec::from_bin(s.as_str().unwrap(), None).unwrap()
}

fn nbits(c: &Value) -> Option<usize> {
    c["nbits"].as_u64().map(|n| n as usize)
}

// The fixtures' encoding: -1 is 0, 0 is x, 1 is 1, 2 is z.
fn bit_num(b: Bit) -> i64 {
    match b {
        Bit::Zero => -1,
        Bit::X => 0,
        Bit::One => 1,
        Bit::Z => 2,
    }
}

fn bin(v: Option<LogicVec>) -> Value {
    json!(v.map(|v| v.to_bin()))
}

fn check(c: &Value) -> Vec<String> {
    let mut errors = Vec::new();
    let mut expect = |what: &str, got: Value, want: &Value| {
        if &got != want {
            errors.push(format!("{what}: got {got}, want {want}"));
        }
    };
    let out = &c["out"];
    match c["op"].as_str().unwrap() {
        "unary" => {
            let v = vec(&c["a"]);
            let ops: [(&str, fn(&LogicVec) -> LogicVec); 8] = [
                ("not", LogicVec::not),
                ("xmask", LogicVec::xmask),
                ("reduceAnd", LogicVec::reduce_and),
                ("reduceOr", LogicVec::reduce_or),
                ("reduceNand", LogicVec::reduce_nand),
                ("reduceNor", LogicVec::reduce_nor),
                ("reduceXor", LogicVec::reduce_xor),
                ("reduceXnor", LogicVec::reduce_xnor),
            ];
            for (name, f) in ops {
                expect(name, json!(f(&v).to_bin()), &out[name]);
            }
            let preds: [(&str, fn(&LogicVec) -> bool); 5] = [
                ("isHigh", LogicVec::is_high),
                ("isLow", LogicVec::is_low),
                ("isZ", LogicVec::is_z),
                ("isDefined", LogicVec::is_defined),
                ("isFullyDefined", LogicVec::is_fully_defined),
            ];
            for (name, f) in preds {
                // A known bug of that library, deliberately not reproduced:
                // for a width that is a multiple of 32, an all-ones vector
                // wasn't isHigh and an all-z one wasn't isZ.
                let bug = matches!(name, "isHigh" | "isZ") && v.bits() > 0 && v.bits().is_multiple_of(32) && f(&v);
                let want = if bug { &json!(true) } else { &out[name] };
                expect(name, json!(f(&v)), want);
            }
            expect("msb", json!(bit_num(v.msb())), &out["msb"]);
            expect("lsb", json!(bit_num(v.lsb())), &out["lsb"]);
            for g in out["get"].as_array().unwrap() {
                let n = g[0].as_u64().unwrap() as usize;
                expect(&format!("get({n})"), json!(bit_num(v.get(n))), &g[1]);
            }
            let arr: Vec<i64> = v.to_bits().into_iter().map(bit_num).collect();
            expect("toArray", json!(arr), &out["toArray"]);
            expect("toHex", json!(v.to_hex()), &out["toHex"]);
            expect("toOct", json!(v.to_oct()), &out["toOct"]);
            if out.get("toU64").is_some() {
                expect("toU64", json!(v.to_u64().map(|x| x.to_string())), &out["toU64"]);
                expect("toI64", json!(v.to_i64().map(|x| x.to_string())), &out["toI64"]);
            }
        }
        "binary" => {
            let (a, b) = (vec(&c["a"]), vec(&c["b"]));
            let ops: [(&str, fn(&LogicVec, &LogicVec) -> LogicVec); 6] = [
                ("and", LogicVec::and),
                ("or", LogicVec::or),
                ("xor", LogicVec::xor),
                ("nand", LogicVec::nand),
                ("nor", LogicVec::nor),
                ("xnor", LogicVec::xnor),
            ];
            for (name, f) in ops {
                expect(name, json!(f(&a, &b).to_bin()), &out[name]);
            }
        }
        "concat" => {
            let parts: Vec<LogicVec> = c["args"].as_array().unwrap().iter().map(vec).collect();
            let refs: Vec<&LogicVec> = parts.iter().collect();
            expect("concat", json!(LogicVec::concat(&refs).to_bin()), out);
        }
        "slice" => {
            let (s, e) = (c["start"].as_u64().unwrap() as usize, c["end"].as_u64().unwrap() as usize);
            expect("slice", json!(vec(&c["a"]).slice(s, e).to_bin()), out);
        }
        "fromBin" => expect("fromBin", bin(LogicVec::from_bin(c["s"].as_str().unwrap(), nbits(c))), out),
        "fromOct" => expect("fromOct", bin(LogicVec::from_oct(c["s"].as_str().unwrap(), nbits(c))), out),
        "fromHex" => expect("fromHex", bin(LogicVec::from_hex(c["s"].as_str().unwrap(), nbits(c))), out),
        "fromDec" => expect("fromDec", bin(LogicVec::from_dec(c["s"].as_str().unwrap(), nbits(c))), out),
        "parse" => expect("parse", bin(LogicVec::parse(c["s"].as_str().unwrap())), out),
        "mem" => {
            let rep: Vec<MemItem> = c["rep"]
                .as_array()
                .unwrap()
                .iter()
                .map(|x| match x {
                    Value::Number(n) => MemItem::Repeat(n.as_u64().unwrap() as usize),
                    s => MemItem::Value(s.as_str().unwrap().to_owned()),
                })
                .collect();
            let mem = LogicMem::from_json(c["bits"].as_u64().unwrap() as usize, &rep).unwrap();
            let got: Vec<String> = (0..mem.len()).map(|i| mem.get(i).to_bin()).collect();
            expect("mem", json!(got), out);
            expect("toJSON", json!(mem.to_json()), &c["json"]);
        }
        op => panic!("unknown op {op}"),
    }
    errors
}

#[test]
fn matches_the_fixtures() {
    let cases: Vec<Value> = serde_json::from_str(include_str!("vectors.json")).unwrap();
    let mut failures = Vec::new();
    for c in &cases {
        for e in check(c) {
            failures.push(format!("{} {}: {e}", c["op"], c.get("a").or(c.get("s")).unwrap_or(&Value::Null)));
        }
    }
    assert!(
        failures.is_empty(),
        "{} mismatches, first 20:\n{}",
        failures.len(),
        failures[..failures.len().min(20)].join("\n")
    );
}

/// `shift` against its definition with concat and slice, on every width
/// around the word boundaries.
#[test]
fn shift_matches_concat_and_slice() {
    let bits = [Bit::Zero, Bit::One, Bit::X, Bit::Z];
    let mut seed = 7u64;
    let mut rand = |n: u64| {
        seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        (seed >> 33) % n
    };
    for width in [1, 2, 31, 63, 64, 65, 100, 127, 128, 129, 200] {
        let v = LogicVec::from_bits(&(0..width).map(|_| bits[rand(4) as usize]).collect::<Vec<_>>());
        for am in [-200i64, -129, -65, -64, -63, -33, -1, 0, 1, 7, 63, 64, 65, 128, 199, 300] {
            for fill in bits {
                let s = am.unsigned_abs() as usize;
                let pad = LogicVec::make(s, fill);
                let want = if am < 0 {
                    LogicVec::concat(&[&pad, &v]).slice(0, width)
                } else {
                    LogicVec::concat(&[&v.slice(s.min(width), width), &pad]).slice(0, width)
                };
                assert_eq!(v.shift(am, fill), want, "width {width} am {am} fill {fill:?}");
            }
        }
    }
}
