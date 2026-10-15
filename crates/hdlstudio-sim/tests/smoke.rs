//! Every circuit in the converter's golden file builds and runs; a counter
//! counts. The real check is the differential test against digitaljs
//! (test/simdiff), which needs Node and yosys.

use hdlstudio_logic::LogicVec;
use hdlstudio_netlist::{Cell, Circuit};
use hdlstudio_sim::Sim;
use serde_json::Value;

fn golden() -> Vec<(String, Circuit)> {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../hdlstudio-yosys/tests/golden.json");
    let golden: serde_json::Map<String, Value> = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    golden
        .into_iter()
        .filter_map(|(name, case)| Some((name, serde_json::from_value(case.get("transform")?.clone()).unwrap())))
        .collect()
}

#[test]
fn every_golden_circuit_runs() {
    for (name, circuit) in golden() {
        let mut sim = Sim::new(&circuit, false).unwrap_or_else(|e| panic!("{name}: {e}"));
        for _ in 0..2000 {
            sim.update_gates();
        }
        assert_eq!(sim.tick(), 2000, "{name}");
    }
}

#[test]
fn counter_counts() {
    let (_, circuit) = golden().into_iter().find(|(n, _)| n == "04_counter").unwrap();
    let mut sim = Sim::new(&circuit, false).unwrap();
    let id = |net: &str| {
        circuit.devices.iter().find(|(_, d)| matches!(&d.cell, Cell::Button(io) | Cell::NumDisplay(io) if io.net == net)).unwrap().0.clone()
    };
    // the count is the input of the `count` display: find its driver's probe
    let display = id("count");
    let from = &circuit.connectors.iter().find(|c| c.to.id == display).unwrap().from;
    let probe = sim.probes.iter().position(|p| p.path == from.id && p.port == from.port).unwrap();
    let run = |sim: &mut Sim, ticks| {
        for _ in 0..ticks {
            sim.update_gates();
        }
    };
    sim.set_input(&id("rst"), LogicVec::ones(1)).unwrap();
    run(&mut sim, 500);
    sim.set_input(&id("rst"), LogicVec::zeros(1)).unwrap();
    run(&mut sim, 200 * 5);
    let count = sim.value(&sim.probes[probe]).to_u64().unwrap();
    assert!((4..=6).contains(&count), "count {count} after 5 clock periods");
}
