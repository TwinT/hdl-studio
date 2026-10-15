use std::io::{Read, Write};
use std::process::ExitCode;

const USAGE: &str = "usage: hdlstudio --version
       hdlstudio yosys2hdlstudio [--transform] [--no-io-ui] < yosys.json > circuit.json";

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let result = match args.first().map(String::as_str) {
        Some("--version") => {
            println!("hdlstudio {}", env!("CARGO_PKG_VERSION"));
            Ok(())
        }
        Some("yosys2hdlstudio") => yosys2hdlstudio(&args[1..]),
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
