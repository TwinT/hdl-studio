//! Speed check: `cargo run --release -p hdlstudio-sim --example bench -- circuit.json TICKS`
//! Pulses `rst` if there is one, then runs flat out (like digitaljs's
//! startFast) and prints ticks/s and the LED matrix's lit LEDs, if any.

use hdlstudio_logic::LogicVec;
use hdlstudio_netlist::{Cell, Circuit};
use hdlstudio_sim::Sim;
use std::time::Instant;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let circuit: Circuit = serde_json::from_str(&std::fs::read_to_string(&args[0]).unwrap()).unwrap();
    let ticks: u64 = args[1].parse().unwrap();
    let mut sim = Sim::new(&circuit, false).unwrap();
    let rst = circuit.devices.iter().find(|(_, d)| matches!(&d.cell, Cell::Button(io) if io.net == "rst"));
    let run_to = |sim: &mut Sim, t: u64| {
        while sim.has_pending_events() && sim.next_event_tick().is_some_and(|k| k < t) {
            sim.update_gates_next();
        }
    };
    if let Some((id, _)) = rst {
        sim.set_input(id, LogicVec::ones(1)).unwrap();
        run_to(&mut sim, 500);
        sim.set_input(id, LogicVec::zeros(1)).unwrap();
    }
    let t0 = Instant::now();
    let start = sim.tick();
    run_to(&mut sim, start + ticks);
    let secs = t0.elapsed().as_secs_f64();
    println!("{ticks} ticks in {secs:.2} s: {:.0} ticks/s, {:.0} cycles/s (200-tick clock)", ticks as f64 / secs, ticks as f64 / secs / 200.0);
    let matrix = circuit.devices.iter().find(|(_, d)| matches!(d.cell, Cell::LedMatrix(_)));
    if let Some((id, _)) = matrix {
        let c = circuit.connectors.iter().find(|c| &c.to.id == id).unwrap();
        let p = sim.probes.iter().find(|p| p.path == c.from.id && p.port == c.from.port).unwrap();
        let v = sim.value(p).to_bin();
        println!("LED matrix: {} lit of {}", v.matches('1').count(), v.len());
    }
}
