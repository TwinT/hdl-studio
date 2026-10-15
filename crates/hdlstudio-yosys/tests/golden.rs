//! The converter against what the JS chain it replaces (yosys2digitaljs
//! 0.10.3 with this project's patch, `io_ui`, `src/inout_split.mjs`,
//! digitaljs's `src/transform.mjs`) produced for the same yosys netlists:
//! the examples small enough to keep, a design written to cover more cell
//! types (`coverage_*`) and hand-made netlists for cells our yosys script
//! never emits (`handmade*`). Run with BLESS=1 to rewrite the expected
//! outputs from this converter after an intended change.

use serde_json::{Value, json};

fn convert(yosys: &Value, transform: bool) -> Result<Value, String> {
    let mut design: hdlstudio_yosys::Design = serde_json::from_value(yosys.clone()).unwrap();
    hdlstudio_yosys::split_inout_ports(&mut design);
    let mut c = hdlstudio_yosys::yosys2digitaljs(&design)?;
    hdlstudio_yosys::io_ui(&mut c);
    if transform {
        c = hdlstudio_yosys::transform_circuit(c);
    }
    Ok(serde_json::to_value(c).unwrap())
}

#[test]
fn matches_the_js_chain() {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/golden.json");
    let mut golden: serde_json::Map<String, Value> = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    let bless = std::env::var_os("BLESS").is_some();
    let mut failures = vec![];
    for (name, case) in golden.iter_mut() {
        let got = match (convert(&case["yosys"], false), convert(&case["yosys"], true)) {
            (Ok(ui), Ok(transform)) => json!({ "ui": ui, "transform": transform }),
            (Err(e), _) | (_, Err(e)) => json!({ "error": e }),
        };
        // the model also reads digitaljs JSON back unchanged
        for key in ["ui", "transform"] {
            if let Some(v) = case.get(key) {
                let c: hdlstudio_netlist::Circuit = serde_json::from_value(v.clone()).unwrap();
                if &serde_json::to_value(c).unwrap() != v {
                    failures.push(format!("{name}: {key} doesn't round-trip through the model"));
                }
            }
        }
        for key in ["ui", "transform", "error"] {
            if got.get(key) != case.get(key) {
                failures.push(format!("{name}: {key} differs"));
                if bless {
                    match got.get(key) {
                        Some(v) => case[key] = v.clone(),
                        None => _ = case.as_object_mut().unwrap().remove(key),
                    }
                }
            }
        }
    }
    if bless {
        std::fs::write(path, serde_json::to_string(&golden).unwrap() + "\n").unwrap();
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}
