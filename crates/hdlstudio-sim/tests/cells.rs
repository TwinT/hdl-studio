//! Cell semantics worth pinning beyond the frozen traces (test/golden),
//! whose random stimulus rarely sets an input to z.

use hdlstudio_logic::LogicVec;
use hdlstudio_netlist::Circuit;
use hdlstudio_sim::Sim;

fn sim(json: serde_json::Value) -> Sim {
    Sim::new(&serde_json::from_value::<Circuit>(json).unwrap(), false).unwrap()
}

fn v(s: &str) -> LogicVec {
    LogicVec::from_bin(s, Some(s.len())).unwrap()
}

fn settle(sim: &mut Sim) {
    while sim.has_pending_events() {
        sim.update_gates_next().unwrap();
    }
}

fn out(sim: &Sim, path: &str) -> String {
    let p = sim.find_probe(path, "out").unwrap();
    sim.value(&sim.probes[p]).to_bin()
}

#[test]
fn arithmetic_with_a_z_operand_is_all_x() {
    let mut s = sim(serde_json::json!({
        "devices": {
            "a": { "type": "NumEntry", "net": "a", "bits": 4 },
            "b": { "type": "NumEntry", "net": "b", "bits": 4 },
            "sum": { "type": "Addition", "bits": { "in1": 4, "in2": 4, "out": 4 }, "signed": { "in1": false, "in2": false } }
        },
        "connectors": [
            { "from": { "id": "a", "port": "out" }, "to": { "id": "sum", "port": "in1" } },
            { "from": { "id": "b", "port": "out" }, "to": { "id": "sum", "port": "in2" } }
        ]
    }));
    s.set_input("a", v("0001")).unwrap();
    s.set_input("b", v("0011")).unwrap();
    settle(&mut s);
    assert_eq!(out(&s, "sum"), "0100");
    s.set_input("a", v("0z01")).unwrap();
    settle(&mut s);
    assert_eq!(out(&s, "sum"), "xxxx");
}

#[test]
fn a_one_hot_mux_with_a_z_select_is_all_x() {
    let mut s = sim(serde_json::json!({
        "devices": {
            "sel": { "type": "NumEntry", "net": "sel", "bits": 2 },
            "c0": { "type": "Constant", "constant": "0000" },
            "c1": { "type": "Constant", "constant": "1111" },
            "c2": { "type": "Constant", "constant": "0101" },
            "mux": { "type": "Mux1Hot", "bits": { "in": 4, "sel": 2 } }
        },
        "connectors": [
            { "from": { "id": "sel", "port": "out" }, "to": { "id": "mux", "port": "sel" } },
            { "from": { "id": "c0", "port": "out" }, "to": { "id": "mux", "port": "in0" } },
            { "from": { "id": "c1", "port": "out" }, "to": { "id": "mux", "port": "in1" } },
            { "from": { "id": "c2", "port": "out" }, "to": { "id": "mux", "port": "in2" } }
        ]
    }));
    s.set_input("sel", v("01")).unwrap();
    settle(&mut s);
    assert_eq!(out(&s, "mux"), "1111");
    s.set_input("sel", v("z0")).unwrap();
    settle(&mut s);
    assert_eq!(out(&s, "mux"), "xxxx");
}
