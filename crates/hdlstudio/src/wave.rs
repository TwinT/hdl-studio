//! The history of a watched signal, for the waveform monitor: every
//! end-of-tick change, kept by the engine; the UI asks for the window it
//! draws, reduced to one entry per pixel column.

use hdlstudio_logic::LogicVec;
use serde_json::{Value, json};
use std::io::{self, Write};

/// Changes kept per signal; past it the oldest quarter goes.
// ponytail: a cap, not a smarter store; at flat-out speed a clock fills it
// in seconds. Compress runs or spill to disk if longer histories matter.
const MAX: usize = 1_000_000;

#[derive(Default)]
pub struct Wave {
    ticks: Vec<u64>,
    values: Vec<LogicVec>,
}

impl Wave {
    pub fn push(&mut self, tick: u64, value: LogicVec) {
        if self.values.last() == Some(&value) {
            return;
        }
        if self.ticks.last() == Some(&tick) {
            *self.values.last_mut().unwrap() = value;
            return;
        }
        if self.ticks.len() >= MAX {
            self.ticks.drain(..MAX / 4);
            self.values.drain(..MAX / 4);
        }
        self.ticks.push(tick);
        self.values.push(value);
    }

    /// The changes in `from..=to` in at most `bins` entries: `[tick, value]`
    /// for a lone change, `[tick, value, last]` for several changes in one
    /// bin (from `tick` to `last`, ending with `value`). `start` is the value
    /// at `from` (null before the history begins), `first` the oldest tick
    /// kept.
    pub fn window(&self, from: u64, to: u64, bins: u64) -> Value {
        let bin = |t: u64| (t - from) as u128 * bins.max(1) as u128 / ((to - from) as u128 + 1);
        let i0 = self.ticks.partition_point(|&t| t <= from);
        let start = i0.checked_sub(1).map(|i| Value::String(self.values[i].to_bin()));
        let i1 = self.ticks.partition_point(|&t| t <= to);
        let mut changes: Vec<Value> = vec![];
        let mut i = i0;
        while i < i1 {
            let b = bin(self.ticks[i]);
            let mut j = i + 1;
            while j < i1 && bin(self.ticks[j]) == b {
                j += 1;
            }
            let value = self.values[j - 1].to_bin();
            changes.push(if j - i == 1 {
                json!([self.ticks[i], value])
            } else {
                json!([self.ticks[i], value, self.ticks[j - 1]])
            });
            i = j;
        }
        json!({"start": start, "first": self.ticks.first(), "changes": changes})
    }
}

/// A watched signal in a VCD file: its scopes (outermost first) and name.
pub struct VcdSignal<'a> {
    pub scope: Vec<String>,
    pub name: String,
    pub bits: usize,
    pub wave: &'a Wave,
}

/// The signals' recorded changes as a VCD file (GTKWave, Surfer): a tick is
/// `scale` times `unit` (a VCD timescale: 1, 10 or 100 s, ms, us, ns, ps or
/// fs), up to tick `end`. A signal is x before its history begins (the cap
/// drops the oldest changes of a long run).
pub fn write_vcd(out: &mut impl Write, signals: &[VcdSignal], unit: &str, scale: u64, end: u64) -> io::Result<()> {
    let ident = |s: &str| s.split_whitespace().collect::<Vec<_>>().join("_");
    // short codes made of the printable characters `!`..`~`
    let code = |mut i: usize| {
        let mut c = String::new();
        loop {
            c.push((b'!' + (i % 94) as u8) as char);
            i /= 94;
            if i == 0 {
                return c;
            }
            i -= 1;
        }
    };
    writeln!(out, "$version HDL Studio {} $end", env!("CARGO_PKG_VERSION"))?;
    writeln!(out, "$timescale {unit} $end")?;
    // the signals of a scope together, in their order
    let mut order: Vec<usize> = (0..signals.len()).collect();
    order.sort_by(|&a, &b| signals[a].scope.cmp(&signals[b].scope));
    let mut open: Vec<String> = vec![];
    for &i in &order {
        let s = &signals[i];
        let scope: Vec<String> = s.scope.iter().map(|x| ident(x)).collect();
        let common = open.iter().zip(&scope).take_while(|(a, b)| a == b).count();
        for _ in common..open.len() {
            writeln!(out, "$upscope $end")?;
        }
        open.truncate(common);
        for name in &scope[common..] {
            writeln!(out, "$scope module {name} $end")?;
            open.push(name.clone());
        }
        let range = if s.bits > 1 { format!(" [{}:0]", s.bits - 1) } else { String::new() };
        writeln!(out, "$var wire {} {} {}{range} $end", s.bits, code(i), ident(&s.name))?;
    }
    for _ in &open {
        writeln!(out, "$upscope $end")?;
    }
    writeln!(out, "$enddefinitions $end")?;
    let value = |out: &mut dyn Write, i: usize, v: &str| match signals[i].bits {
        1 => writeln!(out, "{v}{}", code(i)),
        _ => writeln!(out, "b{v} {}", code(i)),
    };
    writeln!(out, "#0\n$dumpvars")?;
    for (i, s) in signals.iter().enumerate() {
        let at0 = (s.wave.ticks.first() == Some(&0)).then(|| s.wave.values[0].to_bin());
        value(out, i, &at0.unwrap_or_else(|| "x".repeat(s.bits)))?;
    }
    writeln!(out, "$end")?;
    let mut changes: Vec<(u64, usize, &LogicVec)> = signals
        .iter()
        .enumerate()
        .flat_map(|(i, s)| {
            s.wave.ticks.iter().zip(&s.wave.values).filter(|(t, _)| **t > 0).map(move |(&t, v)| (t, i, v))
        })
        .collect();
    changes.sort_by_key(|&(t, i, _)| (t, i));
    let mut last = 0;
    for (t, i, v) in changes {
        if t != last {
            writeln!(out, "#{}", t * scale)?;
            last = t;
        }
        value(out, i, &v.to_bin())?;
    }
    if end > last {
        writeln!(out, "#{}", end * scale)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn v(s: &str) -> LogicVec {
        LogicVec::from_bin(s, Some(s.len())).unwrap()
    }

    #[test]
    fn keeps_changes_and_bins_them() {
        let mut w = Wave::default();
        w.push(0, v("0"));
        w.push(5, v("0")); // no change
        for t in (10..20).step_by(2) {
            w.push(t, v(if t % 4 == 0 { "1" } else { "0" }));
        }
        w.push(100, v("1"));
        w.push(100, v("x")); // same tick: the last value wins
        // 10 bins over 0..=99: the changes at 12..18 share bin 1 (10 is no change)
        assert_eq!(w.window(0, 99, 10), json!({"start": "0", "first": 0, "changes": [[12, "0", 18]]}));
        // one bin per tick: each change alone; 12 and 16 go to 1
        assert_eq!(w.window(11, 20, 10)["changes"], json!([[12, "1"], [14, "0"], [16, "1"], [18, "0"]]));
        assert_eq!(w.window(11, 20, 10)["start"], json!("0"));
        assert_eq!(w.window(100, 200, 10)["start"], json!("x"));
    }

    #[test]
    fn writes_a_vcd_with_scopes_codes_and_merged_changes() {
        let (mut clk, mut count, mut late) = (Wave::default(), Wave::default(), Wave::default());
        for t in 0..4 {
            clk.push(t * 50, v(if t % 2 == 0 { "0" } else { "1" }));
        }
        count.push(0, v("0000"));
        count.push(50, v("0001"));
        late.push(120, v("z")); // its history begins later
        let signals = [
            VcdSignal { scope: vec![], name: "clk".into(), bits: 1, wave: &clk },
            VcdSignal { scope: vec!["my group".into(), "u_cnt".into()], name: "count".into(), bits: 4, wave: &count },
            VcdSignal { scope: vec![], name: "late".into(), bits: 1, wave: &late },
        ];
        let mut out = vec![];
        write_vcd(&mut out, &signals, "10 ns", 2, 200).unwrap();
        let text = String::from_utf8(out).unwrap();
        let body = text.split_once("$timescale").unwrap().1;
        assert_eq!(
            body,
            " 10 ns $end\n$var wire 1 ! clk $end\n$var wire 1 # late $end\n$scope module my_group $end\n\
             $scope module u_cnt $end\n$var wire 4 \" count [3:0] $end\n$upscope $end\n$upscope $end\n\
             $enddefinitions $end\n#0\n$dumpvars\n0!\nb0000 \"\nx#\n$end\n#100\n1!\nb0001 \"\n#200\n0!\n\
             #240\nz#\n#300\n1!\n#400\n"
        );
    }
}
