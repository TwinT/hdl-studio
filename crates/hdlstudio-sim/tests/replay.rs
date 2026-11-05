//! A checkpoint replayed to a tick is the run as it was at that tick: every
//! output, memory word and FSM state, whatever came from outside (inputs,
//! memory words written by hand, clock periods) and in whatever order the
//! ticks are asked for.

use hdlstudio_logic::LogicVec;
use hdlstudio_netlist::Circuit;
use hdlstudio_sim::Sim;
use serde_json::Value;

fn golden(name: &str) -> (Circuit, Value) {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../hdlstudio-yosys/tests/golden.json");
    let golden: Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    let json = golden[name]["transform"].clone();
    (serde_json::from_value(json.clone()).unwrap(), json)
}

struct Rng(u64);
impl Rng {
    fn next(&mut self, n: u64) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0 % n
    }
    fn bits(&mut self, bits: usize) -> LogicVec {
        let s: String = (0..bits).map(|_| if self.next(2) == 1 { '1' } else { '0' }).collect();
        LogicVec::from_bin(&s, Some(bits)).unwrap()
    }
}

fn same(a: &Sim, b: &Sim, what: &str) {
    for p in &a.probes {
        let q = &b.probes[b.find_probe(&p.path, &p.port).unwrap()];
        assert_eq!(a.value(p), b.value(q), "{what}: {}.{}", p.path, p.port);
    }
    assert!(a.memory_diff(b).is_empty(), "{what}: memories");
    assert_eq!(a.fsm_states(), b.fsm_states(), "{what}: FSM states");
}

#[test]
fn a_checkpoint_replays_to_any_tick() {
    for name in ["04_counter", "06_ram", "coverage_fsm_nomap", "control_unit", "handmade"] {
        let (circuit, json) = golden(name);
        let devices = json["devices"].as_object().unwrap();
        let of = |types: &[&str]| -> Vec<String> {
            devices
                .iter()
                .filter(|(_, d)| types.contains(&d["type"].as_str().unwrap()))
                .map(|(id, _)| id.clone())
                .collect()
        };
        let (inputs, mems, clocks) =
            (of(&["Button", "NumEntry", "PushButton", "Input"]), of(&["Memory"]), of(&["Clock"]));
        let mut rng = Rng(0x9e37_79b9_7f4a_7c15);
        let mut live = Sim::new(&circuit, false).unwrap();
        let start = live.checkpoint();
        let mut middle = None;
        // the run as it was at some ticks, kept to compare with
        let mut seen: Vec<(u64, Sim)> = vec![];
        while live.tick() < 3000 {
            let t = live.tick();
            if !inputs.is_empty() && rng.next(15) == 0 {
                let id = &inputs[rng.next(inputs.len() as u64) as usize];
                let v = rng.bits(live.input_bits(id).unwrap());
                live.set_input(id, v).unwrap();
            }
            if !mems.is_empty() && rng.next(100) == 0 {
                let d = &devices[&mems[0]];
                let (bits, words) = (d["bits"].as_u64().unwrap() as usize, d["words"].as_u64().unwrap());
                let v = rng.bits(bits);
                live.write_memory(&mems[0], rng.next(words) as usize, v).unwrap();
            }
            if !clocks.is_empty() && rng.next(400) == 0 {
                live.set_propagation(&clocks[0], 1 + rng.next(20)).unwrap();
            }
            if middle.is_none() && t >= 1500 {
                middle = Some(live.checkpoint());
            }
            if rng.next(4) == 0 {
                seen.push((t, live.checkpoint()));
            }
            // as the server runs: tick by tick, event to event, empty ticks
            // skipped (a tick is left once: what was kept is all it got)
            let next = live.next_event_tick();
            match rng.next(3) {
                1 if next.is_some() => live.update_gates_next().unwrap(),
                2 if next.is_none_or(|k| k > t + 1) => {
                    live.skip_to(next.unwrap_or(t + 7).min(t + 7));
                    0
                }
                _ => live.update_gates().unwrap(),
            };
        }
        assert!(seen.len() > 10, "{name}: {} ticks kept", seen.len());
        let middle = middle.unwrap();
        // the kept ticks in a jumbled order, each from the latest checkpoint
        // before it or, going forward, from where the last one got to
        let mut replica: Option<Sim> = None;
        for i in 0..seen.len() {
            let (t, ref was) = seen[(i * 7) % seen.len()];
            let mut r = match replica.take() {
                Some(r) if r.tick() <= t => r,
                _ if middle.tick() <= t => middle.clone(),
                _ => start.clone(),
            };
            r.replay_to(&live, t).unwrap();
            assert_eq!(r.tick(), t);
            same(&r, was, &format!("{name} at {t}"));
            replica = Some(r);
        }
        // to the present
        let mut r = start.clone();
        r.replay_to(&live, live.tick()).unwrap();
        same(&r, &live, &format!("{name} now"));
    }
}
