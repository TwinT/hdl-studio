//! Every circuit in the converter's golden file builds and runs; a counter
//! counts. The real check is the differential test against digitaljs
//! (test/simdiff), which needs Node and yosys.

use hdlstudio_logic::LogicVec;
use hdlstudio_netlist::{Cell, Circuit};
use hdlstudio_sim::{Event, Sim};
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
            sim.update_gates().unwrap();
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
            sim.update_gates().unwrap();
        }
    };
    sim.set_input(&id("rst"), LogicVec::ones(1)).unwrap();
    run(&mut sim, 500);
    sim.set_input(&id("rst"), LogicVec::zeros(1)).unwrap();
    run(&mut sim, 200 * 5);
    let count = sim.value(&sim.probes[probe]).to_u64().unwrap();
    assert!((4..=6).contains(&count), "count {count} after 5 clock periods");
}

#[test]
fn a_zero_delay_loop_that_never_settles_is_an_error() {
    // y = sel ? ~y : 0 with no delay: once sel is 1 it toggles forever in the
    // same tick (digitaljs hangs on it); until then it settles at 0
    let circuit: Circuit = serde_json::from_value(serde_json::json!({
        "devices": {
            "dev0": { "type": "Button", "net": "sel", "order": 0, "bits": 1 },
            "dev1": { "type": "Constant", "constant": "0" },
            "dev2": { "type": "Not", "propagation": 0 },
            "dev3": { "type": "Mux", "propagation": 0 }
        },
        "connectors": [
            { "from": { "id": "dev0", "port": "out" }, "to": { "id": "dev3", "port": "sel" } },
            { "from": { "id": "dev1", "port": "out" }, "to": { "id": "dev3", "port": "in0" } },
            { "from": { "id": "dev2", "port": "out" }, "to": { "id": "dev3", "port": "in1" } },
            { "from": { "id": "dev3", "port": "out" }, "to": { "id": "dev2", "port": "in" } }
        ]
    }))
    .unwrap();
    let mut sim = Sim::new(&circuit, false).unwrap();
    for _ in 0..10 {
        sim.update_gates().unwrap();
    }
    sim.set_input("dev0", LogicVec::ones(1)).unwrap();
    let err = sim.update_gates().expect_err("the loop should be reported");
    assert!(err.contains("did not settle"), "{err}");
}

#[test]
fn an_alarm_on_a_tick_that_has_events_fires_once() {
    // digitaljs queued that tick twice and broke its event queue; "Run for"
    // lands on such ticks all the time
    let (_, circuit) = golden().into_iter().find(|(n, _)| n == "04_counter").unwrap();
    let mut sim = Sim::new(&circuit, false).unwrap();
    for _ in 0..5 {
        sim.update_gates_next().unwrap();
    }
    let k = sim.next_event_tick().unwrap();
    sim.alarm(1, k + 1, false);
    let mut fired = 0;
    for _ in 0..20 {
        sim.update_gates_next().unwrap();
        fired += sim.take_events().0.iter().filter(|e| matches!(e, Event::Alarm { id: 1, .. })).count();
    }
    assert_eq!(fired, 1);
    assert!(sim.tick() > k + 1);
}
