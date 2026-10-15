//
'use strict';

// Pre-pass over yosys's JSON netlist that makes `inout` ports convertible by
// yosys2digitaljs, which only knows input/output ("Invalid port direction:
// inout"). Kept free of the `vscode` module so tests can import it.
//
// digitaljs subcircuit ports are one-directional, but multi-driver nets are
// already supported (TriMerge, see patches/yosys2digitaljs+*.patch), so every
// inout `P` is split into two ports:
//
//   P      input  - what the module's insides *read* (already resolved outside)
//   P__out output - only what the module's own drivers ($tribuf, outputs of
//                   child cells) put on the bus
//
// The output must carry the module's own drivers only, never the resolved
// value: the parent merges every P__out and feeds the result back into P, so
// exporting the resolved value would close a loop x = merge(x, z) = x that
// latches the last bus value forever.
//
// Mutates and returns `json` (callers pass a freshly parsed netlist).

const isId = (bit) => typeof bit === 'number';

export function split_inout_ports(json) {
    const modules = json.modules;
    const inouts = (m) => Object.entries(m.ports).filter(([, p]) => p.direction === 'inout').map(([n]) => n);
    if (!Object.values(modules).some((m) => inouts(m).length)) return json;

    // Fresh bit ids: past every id used anywhere, so they can't collide.
    // (reduce, not Math.max(...spread): wide buses overflow the arg limit.)
    let nextBit = 1;
    const seen = (bits) => { for (const b of bits) if (isId(b) && b >= nextBit) nextBit = b + 1; };
    for (const m of Object.values(modules)) {
        Object.values(m.ports).forEach((p) => seen(p.bits));
        Object.values(m.cells).forEach((c) => Object.values(c.connections).forEach(seen));
    }

    // module name -> { inout port -> name of its new output half, or null if
    // nothing inside drives it (then it simply becomes an input).
    const split = {};

    const visit = (name) => {
        if (name in split || !(name in modules)) return;
        split[name] = {};
        const mod = modules[name];

        // Children first: an instance's inout is only a driver in this
        // module if the child kept an output half.
        for (const cell of Object.values(mod.cells)) visit(cell.type);

        // Instances of split modules: P (inout) -> P (input) + P__out (output).
        for (const cell of Object.values(mod.cells)) {
            for (const [p, out] of Object.entries(split[cell.type] ?? {})) {
                cell.port_directions[p] = 'input';
                if (out && cell.connections[p]) {
                    cell.port_directions[out] = 'output';
                    cell.connections[out] = cell.connections[p].slice();
                }
            }
        }

        const drivers = (cell) => Object.keys(cell.connections).filter((p) => cell.port_directions[p] === 'output');
        const ports = inouts(mod);
        for (const p of ports) {
            const bits = mod.ports[p].bits;
            const portBits = new Set(bits.filter(isId));
            const driven = new Set();
            for (const c of Object.values(mod.cells))
                for (const q of drivers(c))
                    for (const b of c.connections[q]) if (portBits.has(b)) driven.add(b);
            if (!driven.size) {
                split[name][p] = null;
                mod.ports[p].direction = 'input';
                continue;
            }
            let out = p + '__out';
            while (out in mod.ports) out += '_';
            // Redirect only the driver side of the cells onto fresh bits;
            // readers keep reading `bits`, now driven by the input port alone.
            const fresh = new Map([...driven].map((b) => [b, nextBit++]));
            for (const cell of Object.values(mod.cells)) {
                for (const q of drivers(cell)) {
                    cell.connections[q] = cell.connections[q].map((b) => fresh.get(b) ?? b);
                }
            }
            const outBits = bits.map((b) => fresh.get(b) ?? 'z');
            // Keep declaration order (Input/Output `order` in yosys2digitaljs).
            mod.ports = Object.fromEntries(Object.entries(mod.ports).flatMap(([n, port]) =>
                n !== p ? [[n, port]]
                    : [[n, { ...port, direction: 'input' }], [out, { direction: 'output', bits: outBits }]]));
            if (mod.netnames) mod.netnames[out] = { hide_name: 0, bits: outBits, attributes: {} };
            split[name][p] = out;
        }

        // A parent's own bits that the child's __out half now drives: the
        // instance's output connection must not carry constants (an output
        // wired to a constant isn't a driver yosys2digitaljs can place).
        for (const cell of Object.values(mod.cells)) {
            for (const out of Object.values(split[cell.type] ?? {})) {
                if (out && cell.connections[out]) cell.connections[out] = cell.connections[out].map((b) => isId(b) ? b : nextBit++);
            }
        }
    };
    for (const name of Object.keys(modules)) visit(name);

    return json;
}
