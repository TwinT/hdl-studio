//
'use strict';

// Freezes what the differential tests (test/simdiff/) checked against
// digitaljs into the fixtures test/golden.spec.mjs checks the engine and the
// schematic against, once digitaljs is gone (the cutover). Needs digitaljs,
// digitaljs_lua and yosys with read_slang: `node test/golden/freeze.mjs`.
// After the cutover, `BLESS=1 npm run test:golden` rewrites the expected
// traces from the engine instead (after an intended change).
//
// Per design and mode (t: transform, nt: no transform, dc: transform and
// zero combinational delay), <name>.<mode>.json.gz holds the converted
// circuit (so yosys's version doesn't matter), the stimulus, digitaljs's
// trace and the ports digitaljs gives each cell. lua/<name>.<script>.json.gz
// holds a circuit, a script and what digitaljs_lua printed.

import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';
import { makeStimulus, digitaljsTrace } from '../simdiff/trace.mjs';
import { designs, synthesize, convert } from '../simdiff/designs.mjs';
import { HeadlessCircuit } from '../simdiff/digitaljs_src.mjs';

const dir = path.dirname(fileURLToPath(import.meta.url));
const { LuaRunner } = await import('digitaljs_lua');
const write = (file, data) => fs.writeFileSync(file, zlib.gzipSync(JSON.stringify(data), { level: 9 }));
const slug = (s) => s.replace(/[^\w.-]+/g, '_');

// "celltype|device" ('' for the top level) -> sorted "id:dir:bits"
function ports(data) {
    const circuit = new HeadlessCircuit(JSON.parse(JSON.stringify(data)));
    const out = {};
    const seen = new Set();
    const walk = (graph, type) => {
        for (const cell of graph.getElements()) {
            out[`${type}|${cell.id}`] = cell.getPorts().map((p) => `${p.id}:${p.dir}:${p.bits}`).sort();
            const celltype = cell.get('celltype');
            if (cell.get('type') === 'Subcircuit' && !seen.has(celltype)) {
                seen.add(celltype);
                walk(cell.get('graph'), celltype);
            }
        }
    };
    walk(circuit._graph, '');
    circuit.shutdown();
    return out;
}

const MAX_TICKS = 5_000_000;
function luaOutput(data, script) {
    const circuit = new HeadlessCircuit(JSON.parse(JSON.stringify(data)));
    const runner = new LuaRunner(circuit);
    const out = [];
    runner.on('print', (msgs) => out.push(msgs.join('\t')));
    runner.on('thread:error', (pid, e) => out.push(`ERROR: ${e.luaMessage}`));
    let pid;
    try {
        pid = runner.runThread(script);
    } catch (e) {
        out.push(`ERROR: ${e.luaMessage}`);
    }
    while (pid !== undefined && runner.isThreadRunning(pid) && circuit.hasPendingEvents && circuit.tick < MAX_TICKS)
        circuit.updateGatesNext();
    runner.shutdown();
    circuit.shutdown();
    return out;
}

fs.mkdirSync(path.join(dir, 'lua'), { recursive: true });
for (const d of designs) {
    const yosys = synthesize(d);
    for (const [mode, transform, defaultcomb] of [['t', true, false], ['nt', false, false], ['dc', true, true]]) {
        const circuit = JSON.parse(convert(yosys, transform));
        const stimulus = makeStimulus(circuit, { ticks: d.ticks, seed: 7 });
        const trace = await digitaljsTrace(circuit, { ticks: d.ticks, stimulus, defaultcomb });
        write(path.join(dir, `${slug(d.name)}.${mode}.json.gz`),
              { design: d.name, circuit, stimulus, ticks: d.ticks, defaultcomb, trace, ports: ports(circuit) });
        console.log(d.name, mode, trace.length, 'lines');
    }
    const scripts = (d.lua ?? []).concat(d.name === '12_inout_bus' ? [path.join(dir, '../simdiff/lua_api.lua'), path.join(dir, 'inout_bus.lua')] : []);
    for (const file of scripts) {
        const circuit = JSON.parse(convert(yosys, true));
        const script = fs.readFileSync(file, 'utf8');
        const output = luaOutput(circuit, script);
        write(path.join(dir, 'lua', `${slug(d.name)}.${slug(path.basename(file))}.json.gz`),
              { design: d.name, script: path.basename(file), circuit, source: script, output });
        console.log(d.name, path.basename(file), output.length, 'lines');
    }
}
process.exit(0);
