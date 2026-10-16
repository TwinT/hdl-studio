mod lua;
mod serve;
mod wave;

use std::io::{Read, Write};
use std::process::ExitCode;

const USAGE: &str = "usage: hdlstudio --version
       hdlstudio yosys2hdlstudio [--transform] [--no-io-ui] < yosys.json > circuit.json
       hdlstudio simtrace [--defaultcomb] circuit.json stimulus.json TICKS   (test/simdiff's trace)
       hdlstudio serve   (the engine, JSON lines on stdin/stdout: see serve.rs)
       hdlstudio lua [--json] circuit.json script.lua [MAX_TICKS]   (runs a sim.lua headless)";

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let result = match args.first().map(String::as_str) {
        Some("--version") => {
            println!("hdlstudio {}", env!("CARGO_PKG_VERSION"));
            Ok(())
        }
        Some("yosys2hdlstudio") => yosys2hdlstudio(&args[1..]),
        Some("simtrace") => simtrace(&args[1..]),
        Some("serve") => serve::serve(),
        Some("lua") => lua_headless(&args[1..]),
        _ => Err(USAGE.into()),
    };
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("{e}");
            ExitCode::FAILURE
        }
    }
}

/// Yosys JSON on stdin to a circuit on stdout (digitaljs's format for now).
fn yosys2hdlstudio(args: &[String]) -> Result<(), String> {
    let (mut transform, mut io_ui) = (false, true);
    for a in args {
        match a.as_str() {
            "--transform" => transform = true,
            "--no-io-ui" => io_ui = false,
            _ => return Err(USAGE.into()),
        }
    }
    let mut input = String::new();
    std::io::stdin().read_to_string(&mut input).map_err(|e| e.to_string())?;
    let mut design: hdlstudio_yosys::Design =
        serde_json::from_str(&input).map_err(|e| format!("not a yosys JSON netlist: {e}"))?;
    hdlstudio_yosys::split_inout_ports(&mut design);
    let mut circuit = hdlstudio_yosys::yosys2digitaljs(&design)?;
    if io_ui {
        hdlstudio_yosys::io_ui(&mut circuit);
    }
    if transform {
        circuit = hdlstudio_yosys::transform_circuit(circuit);
    }
    let mut out = std::io::stdout().lock();
    serde_json::to_writer(&mut out, &circuit).map_err(|e| e.to_string())?;
    out.flush().map_err(|e| e.to_string())
}

fn simtrace(args: &[String]) -> Result<(), String> {
    let defaultcomb = args.first().is_some_and(|a| a == "--defaultcomb");
    let [circuit, stimulus, ticks] = &args[defaultcomb as usize..] else { return Err(USAGE.into()) };
    let read = |f: &str| std::fs::read_to_string(f).map_err(|e| format!("{f}: {e}"));
    let circuit: hdlstudio_netlist::Circuit = serde_json::from_str(&read(circuit)?).map_err(|e| e.to_string())?;
    let stimulus: Vec<(u64, String, String)> = serde_json::from_str(&read(stimulus)?).map_err(|e| e.to_string())?;
    let ticks = ticks.parse().map_err(|_| USAGE.to_string())?;
    let mut out = std::io::BufWriter::new(std::io::stdout().lock());
    for line in hdlstudio_sim::trace(&circuit, ticks, &stimulus, defaultcomb)? {
        writeln!(out, "{line}").map_err(|e| e.to_string())?;
    }
    out.flush().map_err(|e| e.to_string())
}

/// Runs a script against a circuit, flat out, until it finishes (or the
/// circuit has nothing left to do, or MAX_TICKS): its prints on stdout, one
/// line each (`--json`: one JSON object per print or error).
fn lua_headless(args: &[String]) -> Result<(), String> {
    let json = args.first().is_some_and(|a| a == "--json");
    let args = &args[json as usize..];
    let (circuit, script, max) = match args {
        [c, s] => (c, s, 100_000_000),
        [c, s, m] => (c, s, m.parse().map_err(|_| USAGE.to_string())?),
        _ => return Err(USAGE.into()),
    };
    let read = |f: &str| std::fs::read_to_string(f).map_err(|e| format!("{f}: {e}"));
    let circuit: hdlstudio_netlist::Circuit = serde_json::from_str(&read(circuit)?).map_err(|e| e.to_string())?;
    let sim = std::rc::Rc::new(std::cell::RefCell::new(Some(hdlstudio_sim::Sim::new(&circuit, false)?)));
    let mut engine = lua::LuaEngine::new(sim.clone());
    let label = std::path::Path::new(script).file_name().map_or(script.clone(), |n| n.to_string_lossy().into_owned());
    let mut out = std::io::stdout().lock();
    let mut show = |events: Vec<lua::LuaEvent>| -> Result<(), String> {
        for e in events {
            let line = match (e, json) {
                (lua::LuaEvent::Print { messages, .. }, false) => messages.join("\t"),
                (lua::LuaEvent::Error { message, .. }, false) => format!("ERROR: {message}"),
                (lua::LuaEvent::Print { messages, .. }, true) => serde_json::json!({"print": messages.join("\t")}).to_string(),
                (lua::LuaEvent::Error { message, .. }, true) => serde_json::json!({"error": message}).to_string(),
                _ => continue,
            };
            writeln!(out, "{line}").map_err(|e| e.to_string())?;
        }
        Ok(())
    };
    engine.run("script", &read(script)?, false, &label);
    show(engine.take_events())?;
    while engine.active() {
        let events = {
            let mut s = sim.borrow_mut();
            let s = s.as_mut().unwrap();
            if !s.has_pending_events() || s.tick() >= max {
                break;
            }
            s.update_gates_next()?;
            s.take_events().0
        };
        engine.on_events(events);
        show(engine.take_events())?;
    }
    Ok(())
}
