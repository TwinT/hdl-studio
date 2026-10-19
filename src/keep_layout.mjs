//
'use strict';

// A new synthesis result keeps the layout of the circuit it replaces (cells
// placed by hand). Kept free of the `vscode` module so tests can import it.

// A device keeps its position only if it is the same cell: same id and same
// kind (yosys numbers devices, so an id alone may now be another cell).
const same = (a, b) => a && b && a.type === b.type && a.celltype === b.celltype && a.net === b.net && a.label === b.label;
const ends = (c) => `${c.from.id}.${c.from.port}>${c.to.id}.${c.to.port}`;

function keepGraph(old, fresh) {
    if (!old || !fresh)
        return;
    let all = Object.keys(old.devices ?? {}).length === Object.keys(fresh.devices ?? {}).length;
    for (const [id, d] of Object.entries(fresh.devices ?? {})) {
        const o = old.devices?.[id];
        if (same(o, d) && o.position)
            d.position = o.position;
        else
            all = false;
    }
    // the wires' bends only fit if nothing moved or changed; else they route
    // around the cells, as after a move
    const oldConns = old.connectors ?? [], conns = fresh.connectors ?? [];
    if (all && oldConns.length === conns.length && conns.every((c, i) => ends(c) === ends(oldConns[i])))
        conns.forEach((c, i) => { if (oldConns[i].vertices) c.vertices = oldConns[i].vertices; });
}

// Copies `old`'s layout into `fresh` (changed in place) where they match.
export function keep_layout(old, fresh) {
    keepGraph(old, fresh);
    for (const [name, sub] of Object.entries(fresh.subcircuits ?? {}))
        keepGraph(old.subcircuits?.[name], sub);
    return fresh;
}
