// Differential simulation harness, digitaljs side: runs a circuit on
// digitaljs's own engine (HeadlessCircuit + SynchEngine, src/ tree) and
// writes a trace that hdlstudio's engine must reproduce line for line.
// Temporary: it goes away with digitaljs.
//
// Trace format, one line per value:
//   init <path>.<port> <value>   every cell output after construction
//   <tick> <path>.<port> <value> outputs whose value at the end of <tick>
//                                differs from the end of the previous tick
// <path> is the device id, prefixed by its subcircuits' ids ("dev3/dev12").
// Only end-of-tick values are compared: glitches inside a tick depend on the
// order zero-delay cells run in, which the engines don't have to share.

import { HeadlessCircuit, Vector4vl } from './digitaljs_src.mjs';

// mulberry32, so a seed always gives the same stimulus
function rng(seed) {
    return () => {
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const SETTABLE = new Set(['Input', 'Button', 'PushButton', 'NumEntry']);

// [tick, device id, binary value] events for the top level's settable
// inputs (clocks run themselves). A reset input is pulsed at the start and
// then left alone, so a CPU gets to run; the rest change at random.
export function makeStimulus(circuit, { ticks, seed = 1, every = 300 }) {
    const rand = rng(seed);
    const events = [];
    const inputs = Object.entries(circuit.devices).filter(([, d]) => SETTABLE.has(d.type));
    const random = [];
    for (const [id, dev] of inputs) {
        if (/^(rst|reset)$/.test(dev.net)) {
            events.push([0, id, '1'], [Math.min(500, ticks - 1), id, '0']);
        } else {
            random.push([id, dev.bits]);
        }
    }
    for (let t = 1 + Math.floor(rand() * every); random.length && t < ticks; t += 1 + Math.floor(rand() * every)) {
        const [id, bits] = random[Math.floor(rand() * random.length)];
        let v = '';
        for (let i = 0; i < bits; i++) v += rand() < 0.5 ? '0' : '1';
        events.push([t, id, v]);
    }
    return events.sort((a, b) => a[0] - b[0]);
}

export function digitaljsTrace(circuitJson, { ticks, stimulus, defaultcomb = false }) {
    const circuit = new HeadlessCircuit(JSON.parse(JSON.stringify(circuitJson)),
        defaultcomb ? { defaultCombinationalPropagation: 0 } : {});
    const lines = [];
    const last = new Map();
    const touched = new Set();
    const cells = [];
    const walk = (graph, prefix) => {
        for (const cell of graph.getElements()) {
            const path = prefix + cell.id;
            cells.push([path, cell]);
            cell.on('change:outputSignals', () => touched.add(path));
            if (cell.get('type') === 'Subcircuit')
                walk(cell.get('graph'), path + '/');
        }
    };
    walk(circuit._graph, '');
    const byPath = new Map(cells);
    const emit = (tick, path) => {
        const sigs = byPath.get(path).get('outputSignals');
        const out = [];
        for (const port of Object.keys(sigs).sort()) {
            const key = `${path}.${port}`;
            const v = sigs[port].toBin();
            if (last.get(key) !== v) {
                last.set(key, v);
                out.push(`${tick} ${key} ${v}`);
            }
        }
        return out;
    };
    lines.push(...cells.map(([p]) => p).sort().flatMap((p) => emit('init', p)));
    touched.clear();
    let next = 0;
    for (let t = 0; t < ticks; t++) {
        for (; next < stimulus.length && stimulus[next][0] === t; next++) {
            const [, id, v] = stimulus[next];
            circuit.setInput(id, Vector4vl.fromBin(v, v.length));
        }
        circuit.updateGates();
        lines.push(...[...touched].sort().flatMap((p) => emit(t, p)));
        touched.clear();
    }
    circuit.shutdown();
    return lines;
}
