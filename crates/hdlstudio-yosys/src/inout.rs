//! Port of `src/inout_split.mjs`: every `inout` port `P` becomes an input
//! `P` (what the module reads) plus an output `P__out` carrying only the
//! module's own drivers; a parent merges the `P__out`s on a net through
//! TriMerge. An inout nothing drives just becomes an input. Exporting the
//! resolved value instead would close a `x = merge(x, z)` loop through the
//! parent that latches the last bus value.

use crate::{Bit, Design, NetName, Port};
use indexmap::{IndexMap, IndexSet};
use std::collections::HashMap;

/// module -> inout port -> its output half (`None`: became a plain input).
type Split = HashMap<String, IndexMap<String, Option<String>>>;

pub fn split_inout_ports(design: &mut Design) {
    let has_inout = |m: &crate::Module| m.ports.values().any(|p| p.direction == "inout");
    if !design.modules.values().any(has_inout) {
        return;
    }
    // Fresh bit ids: past every id used anywhere.
    let mut next = 1;
    for m in design.modules.values() {
        let conns = m.cells.values().flat_map(|c| c.connections.values());
        for b in m.ports.values().map(|p| &p.bits).chain(conns).flatten() {
            if let Bit::Id(n) = b {
                next = next.max(n + 1);
            }
        }
    }
    let mut split = Split::new();
    let names: Vec<String> = design.modules.keys().cloned().collect();
    for name in names {
        visit(design, &mut split, &mut next, &name);
    }
}

fn visit(design: &mut Design, split: &mut Split, next: &mut u64, name: &str) {
    if split.contains_key(name) || !design.modules.contains_key(name) {
        return;
    }
    split.insert(name.into(), IndexMap::new());
    // Children first: an instance's inout only drives here if the child
    // kept an output half.
    let children: Vec<String> = design.modules[name].cells.values().map(|c| c.ty.clone()).collect();
    for child in children {
        visit(design, split, next, &child);
    }
    let m = design.modules.get_mut(name).unwrap();

    // Instances of split modules: P (inout) -> P (input) + P__out (output).
    for cell in m.cells.values_mut() {
        for (p, out) in split.get(&cell.ty).into_iter().flatten() {
            cell.port_directions.insert(p.clone(), "input".into());
            if let (Some(out), Some(bits)) = (out, cell.connections.get(p).cloned()) {
                cell.port_directions.insert(out.clone(), "output".into());
                cell.connections.insert(out.clone(), bits);
            }
        }
    }

    let inouts: Vec<String> = m.ports.iter().filter(|(_, p)| p.direction == "inout").map(|(n, _)| n.clone()).collect();
    for p in inouts {
        let bits = m.ports[&p].bits.clone();
        let mut driven = IndexSet::new();
        for cell in m.cells.values() {
            for (q, conn) in &cell.connections {
                if cell.port_directions.get(q).map(String::as_str) == Some("output") {
                    driven.extend(conn.iter().filter(|b| matches!(b, Bit::Id(_)) && bits.contains(b)).cloned());
                }
            }
        }
        if driven.is_empty() {
            split.get_mut(name).unwrap().insert(p.clone(), None);
            m.ports[&p].direction = "input".into();
            continue;
        }
        let mut out = format!("{p}__out");
        while m.ports.contains_key(&out) {
            out.push('_');
        }
        // Only the driver side of the cells moves onto fresh bits; readers
        // keep reading `bits`, now driven by the input port alone.
        let fresh: HashMap<Bit, Bit> = driven
            .into_iter()
            .map(|b| {
                *next += 1;
                (b, Bit::Id(*next - 1))
            })
            .collect();
        for cell in m.cells.values_mut() {
            for (q, conn) in cell.connections.iter_mut() {
                if cell.port_directions.get(q).map(String::as_str) == Some("output") {
                    for b in conn.iter_mut() {
                        if let Some(f) = fresh.get(b) {
                            *b = f.clone();
                        }
                    }
                }
            }
        }
        let out_bits: Vec<Bit> = bits.iter().map(|b| fresh.get(b).cloned().unwrap_or(Bit::Str("z".into()))).collect();
        // Keep declaration order (the Input/Output `order`).
        let i = m.ports.get_index_of(&p).unwrap();
        m.ports[i].direction = "input".into();
        m.ports.shift_insert(i + 1, out.clone(), Port { direction: "output".into(), bits: out_bits.clone() });
        m.netnames.insert(out.clone(), NetName { hide_name: 0.into(), bits: out_bits, attributes: IndexMap::new() });
        split.get_mut(name).unwrap().insert(p, Some(out));
    }

    // The instance's output half must not carry constants: an output wired
    // to a constant isn't a driver the converter can place.
    for cell in m.cells.values_mut() {
        for out in split.get(&cell.ty).into_iter().flat_map(|s| s.values().flatten()) {
            if let Some(conn) = cell.connections.get_mut(out) {
                for b in conn.iter_mut() {
                    if !matches!(b, Bit::Id(_)) {
                        *b = Bit::Id(*next);
                        *next += 1;
                    }
                }
            }
        }
    }
}
