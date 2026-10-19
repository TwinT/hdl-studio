//! The history of a watched signal, for the waveform monitor: every
//! end-of-tick change, kept by the engine; the UI asks for the window it
//! draws, reduced to one entry per pixel column.

use hdlstudio_logic::LogicVec;
use serde_json::{Value, json};

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
}
