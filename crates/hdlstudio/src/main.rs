mod lua;
mod serve;
mod wave;

use std::io::{Read, Write};
use std::process::ExitCode;

const USAGE: &str = "usage: hdlstudio --version
       hdlstudio yosys2hdlstudio [--transform] [--no-io-ui] < yosys.json > circuit.json   (warnings on stderr)
       hdlstudio simtrace [--defaultcomb] circuit.json stimulus.json TICKS   (test/simdiff's trace)
       hdlstudio serve   (the engine, JSON lines on stdin/stdout: see serve.rs)
       hdlstudio lua [--json] [--tests] [--defaultcomb] circuit.json script.lua [MAX_TICKS]
           (runs a sim.lua headless; --tests: each test(name, fn) on a fresh simulation, a JSON line each)";

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

/// Yosys JSON on stdin to a circuit on stdout.
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
    let mut circuit = hdlstudio_yosys::convert(&design)?;
    // (the extension shows "warning: " lines)
    if let [shown, others @ ..] = &hdlstudio_yosys::top_modules(&design)[..]
        && !others.is_empty()
    {
        eprintln!("warning: several top-level modules ({shown}, {}): {shown} is shown", others.join(", "));
    }
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

/// How a headless run ended.
struct Ran {
    /// The script ended (else it still waited for the simulation).
    finished: bool,
    tick: u64,
    /// It stopped at MAX_TICKS (else the circuit had nothing left to do).
    limit: bool,
}

/// Runs a script on a fresh simulation of the circuit, flat out, until it
/// finishes, the circuit has nothing left to do or MAX_TICKS; its events go
/// to `show` as they come.
fn run_script(
    circuit: &hdlstudio_netlist::Circuit,
    defaultcomb: bool,
    (script, label): (&str, &str),
    max: u64,
    tests: lua::Tests,
    mut show: impl FnMut(lua::LuaEvent) -> Result<(), String>,
) -> Result<Ran, String> {
    let sim = std::rc::Rc::new(std::cell::RefCell::new(Some(hdlstudio_sim::Sim::new(circuit, defaultcomb)?)));
    let mut engine = lua::LuaEngine::new(sim.clone());
    engine.set_tests(tests);
    engine.run("script", script, false, label);
    engine.take_events().into_iter().try_for_each(&mut show)?;
    let mut limit = false;
    while engine.active() {
        let events = {
            let mut s = sim.borrow_mut();
            let s = s.as_mut().unwrap();
            limit = s.tick() >= max;
            if !s.has_pending_events() || limit {
                break;
            }
            s.update_gates_next()?;
            s.take_events().0
        };
        engine.on_events(events);
        engine.take_events().into_iter().try_for_each(&mut show)?;
    }
    let tick = sim.borrow().as_ref().map_or(0, |s| s.tick());
    Ok(Ran { finished: !engine.active(), tick, limit })
}

/// Runs a script against a circuit, flat out, until it finishes (or the
/// circuit has nothing left to do, or MAX_TICKS): its prints on stdout, one
/// line each (`--json`: one JSON object per print or error). `--tests`: see
/// `lua_tests`.
fn lua_headless(args: &[String]) -> Result<(), String> {
    let (mut json, mut tests, mut defaultcomb) = (false, false, false);
    let mut args = args;
    while let [flag, rest @ ..] = args
        && flag.starts_with("--")
    {
        match flag.as_str() {
            "--json" => json = true,
            "--tests" => tests = true,
            "--defaultcomb" => defaultcomb = true,
            _ => return Err(USAGE.into()),
        }
        args = rest;
    }
    let (circuit, script, max) = match args {
        [c, s] => (c, s, 100_000_000),
        [c, s, m] => (c, s, m.parse().map_err(|_| USAGE.to_string())?),
        _ => return Err(USAGE.into()),
    };
    let read = |f: &str| std::fs::read_to_string(f).map_err(|e| format!("{f}: {e}"));
    let circuit: hdlstudio_netlist::Circuit = serde_json::from_str(&read(circuit)?).map_err(|e| e.to_string())?;
    let label = std::path::Path::new(script).file_name().map_or(script.clone(), |n| n.to_string_lossy().into_owned());
    let script = read(script)?;
    let mut out = std::io::stdout().lock();
    if tests {
        return lua_tests(&circuit, defaultcomb, (&script, &label), max, &mut out);
    }
    run_script(&circuit, defaultcomb, (&script, &label), max, lua::Tests::All, |e| {
        let line = match (e, json) {
            (lua::LuaEvent::Print { messages, .. }, false) => messages.join("\t"),
            (lua::LuaEvent::Error { message, .. }, false) => format!("ERROR: {message}"),
            (lua::LuaEvent::Print { messages, .. }, true) => {
                serde_json::json!({"print": messages.join("\t")}).to_string()
            }
            (lua::LuaEvent::Error { message, .. }, true) => serde_json::json!({"error": message}).to_string(),
            _ => return Ok(()),
        };
        writeln!(out, "{line}").map_err(|e| e.to_string())
    })?;
    Ok(())
}

/// A test script's results, one JSON line each: first `{"tests": [names]}`,
/// then per test `{"test", "ok", "error", "prints", "tick"}`. A pass collects
/// the names (`test(name, fn)` runs nothing); then each test runs alone on a
/// fresh simulation (the script again, the other tests skipped). A script
/// without tests, or one that fails outside them, is one result with
/// `"test": null`. A test still waiting for the simulation when it ends
/// fails.
fn lua_tests(
    circuit: &hdlstudio_netlist::Circuit,
    defaultcomb: bool,
    script: (&str, &str),
    max: u64,
    out: &mut impl Write,
) -> Result<(), String> {
    let run = |tests: lua::Tests| -> Result<serde_json::Value, String> {
        let (mut prints, mut error) = (vec![], None);
        let ran = run_script(circuit, defaultcomb, script, max, tests, |e| {
            match e {
                lua::LuaEvent::Print { messages, .. } => prints.push(messages.join("\t")),
                lua::LuaEvent::Error { message, .. } => error = Some(message),
                _ => {}
            }
            Ok(())
        })?;
        let why =
            if ran.limit { format!("the tick limit ({max})") } else { "a circuit with nothing left to do".into() };
        let error = error.or_else(|| {
            (!ran.finished).then(|| format!("still waiting (sim.wait or sim.sleep) at tick {}: {why}", ran.tick))
        });
        Ok(serde_json::json!({"ok": error.is_none(), "error": error, "prints": prints, "tick": ran.tick}))
    };
    let line = |out: &mut dyn Write, v: serde_json::Value| writeln!(out, "{v}").map_err(|e| e.to_string());
    let found = std::rc::Rc::new(std::cell::RefCell::new(Vec::<String>::new()));
    let mut whole = run(lua::Tests::Collect(found.clone()))?;
    let mut names = found.take();
    let mut seen = std::collections::HashSet::new();
    names.retain(|n| seen.insert(n.clone()));
    line(out, serde_json::json!({"tests": names}))?;
    if names.is_empty() || whole["ok"] == false {
        whole["test"] = serde_json::Value::Null;
        return line(out, whole);
    }
    for name in names {
        let mut result = run(lua::Tests::Only(name.clone()))?;
        result["test"] = name.into();
        line(out, result)?;
    }
    Ok(())
}
