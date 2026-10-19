//! Integer arithmetic on fully defined vectors, as JavaScript BigInts do it: operands exact (signed or not), results cut to the output
//! width in two's complement.
//! i128 for operands up to 64 bits, num-bigint past that.

use hdlstudio_logic::{Bit, LogicVec};
use num_bigint::{BigInt, BigUint, Sign};
use std::cmp::Ordering;

#[derive(Clone, Copy, Debug)]
pub enum ArithOp {
    Add,
    Sub,
    Mul,
    Div,
    Mod,
    Pow,
}

#[derive(Clone, Copy, Debug)]
pub enum CmpOp {
    Lt,
    Le,
    Gt,
    Ge,
}

/// `toBigInt(signed)`; only called on fully defined vectors.
pub enum Int {
    Small(i128),
    Big(BigInt),
}

pub fn to_int(v: &LogicVec, signed: bool) -> Int {
    if v.bits() <= 64 {
        let x = if signed && v.bits() > 0 { v.to_i64().unwrap() as i128 } else { v.to_u64().unwrap() as i128 };
        return Int::Small(x);
    }
    let u = BigUint::parse_bytes(v.to_bin().as_bytes(), 2).unwrap_or_default();
    let mut n = BigInt::from(u);
    if signed && v.msb() == Bit::One {
        n -= BigInt::from(1) << v.bits();
    }
    Int::Big(n)
}

pub fn from_i128(v: i128, bits: usize) -> LogicVec {
    let m = v.unsigned_abs();
    LogicVec::from_magnitude(v < 0, &[m as u64, (m >> 64) as u64], Some(bits))
}

pub fn from_int(n: &Int, bits: usize) -> LogicVec {
    match n {
        Int::Small(v) => from_i128(*v, bits),
        Int::Big(b) => LogicVec::from_magnitude(b.sign() == Sign::Minus, &b.magnitude().to_u64_digits(), Some(bits)),
    }
}

fn big(n: Int) -> BigInt {
    match n {
        Int::Small(v) => BigInt::from(v),
        Int::Big(b) => b,
    }
}

/// `arithop(i, j)` cut to `bits`.
pub fn arith(op: ArithOp, i: Int, j: Int, bits: usize) -> LogicVec {
    if let (Int::Small(x), Int::Small(y)) = (&i, &j)
        && bits <= 128
    {
        // exact operands, results mod 2^128: enough for a <= 128-bit output
        let (x, y) = (*x, *y);
        let r = match op {
            ArithOp::Add => x.wrapping_add(y),
            ArithOp::Sub => x.wrapping_sub(y),
            ArithOp::Mul => x.wrapping_mul(y),
            // as in IEEE Verilog: a zero divisor gives the dividend
            ArithOp::Div => {
                if y == 0 {
                    x
                } else {
                    x / y
                }
            }
            ArithOp::Mod => {
                if y == 0 {
                    x
                } else {
                    x % y
                }
            }
            ArithOp::Pow if y >= 0 => {
                let (mut acc, mut base, mut e) = (1i128, x, y as u128);
                while e > 0 {
                    if e & 1 == 1 {
                        acc = acc.wrapping_mul(base);
                    }
                    base = base.wrapping_mul(base);
                    e >>= 1;
                }
                acc
            }
            ArithOp::Pow => neg_pow(x == 1, x == -1, y % 2 != 0),
        };
        return from_i128(r, bits);
    }
    let (x, y) = (big(i), big(j));
    let zero = BigInt::from(0);
    let r = match op {
        ArithOp::Add => x + y,
        ArithOp::Sub => x - y,
        ArithOp::Mul => x * y,
        ArithOp::Div => {
            if y == zero {
                x
            } else {
                x / y
            }
        }
        ArithOp::Mod => {
            if y == zero {
                x
            } else {
                x % y
            }
        }
        ArithOp::Pow if y >= zero => {
            // only the low `bits` bits are kept, so work mod 2^bits
            let m = BigInt::from(1) << bits;
            let base = ((x % &m) + &m) % &m;
            base.modpow(&y, &m)
        }
        ArithOp::Pow => BigInt::from(neg_pow(x == BigInt::from(1), x == BigInt::from(-1), &y % 2 != zero)),
    };
    from_int(&Int::Big(r), bits)
}

/// `i ** j` for j < 0, as BigInt does it.
fn neg_pow(one: bool, minus_one: bool, odd: bool) -> i128 {
    if one {
        1
    } else if minus_one {
        if odd { -1 } else { 1 }
    } else {
        0
    }
}

pub fn compare(op: CmpOp, i: Int, j: Int) -> bool {
    let ord = match (i, j) {
        (Int::Small(x), Int::Small(y)) => x.cmp(&y),
        (i, j) => big(i).cmp(&big(j)),
    };
    match op {
        CmpOp::Lt => ord == Ordering::Less,
        CmpOp::Le => ord != Ordering::Greater,
        CmpOp::Gt => ord == Ordering::Greater,
        CmpOp::Ge => ord != Ordering::Less,
    }
}

/// `toBigInt(signed)` clamped to [-lim, lim] (the shift amount).
pub fn clamped(v: &LogicVec, signed: bool, lim: usize) -> i64 {
    let lim128 = lim as i128;
    match to_int(v, signed) {
        Int::Small(x) => x.clamp(-lim128, lim128) as i64,
        Int::Big(b) => b.clamp(BigInt::from(-lim128), BigInt::from(lim128)).try_into().unwrap(),
    }
}
