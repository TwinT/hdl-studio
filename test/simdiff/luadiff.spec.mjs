//
'use strict';

// Differential test of the engine's Lua: every example's sim.lua runs on
// digitaljs_lua (fengari, on HeadlessCircuit + SynchEngine, whose ticks are
// exact) and on `hdlstudio lua`; the printed lines must be identical.
// Temporary, like digitaljs_lua.

import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { hdlstudio_bin } from '../../src/hdlstudio_bin.mjs';
import { HeadlessCircuit } from './digitaljs_src.mjs';
import { designs, synthesize, slangAvailable, convert } from './designs.mjs';

const { LuaRunner } = await import('digitaljs_lua');
const MAX_TICKS = 5_000_000;

function digitaljsLua(circuitJson, script) {
    const circuit = new HeadlessCircuit(JSON.parse(circuitJson));
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

function hdlstudioLua(circuitJson, scriptPath) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hdl-luadiff-'));
    try {
        const circuitFile = path.join(tmp, 'circuit.json');
        fs.writeFileSync(circuitFile, circuitJson);
        const out = execFileSync(hdlstudio_bin(), ['lua', '--json', circuitFile, scriptPath, String(MAX_TICKS)], { maxBuffer: 1 << 30 });
        return out.toString().split('\n').filter(Boolean).map((l) => {
            const e = JSON.parse(l);
            return 'print' in e ? e.print : `ERROR: ${e.error}`;
        });
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
}

describe('hdlstudio Lua vs digitaljs_lua (printed output)', function () {
    this.timeout(300000);

    before(function () {
        if (!slangAvailable()) {
            console.warn('  yosys with read_slang not found - skipping the Lua diff');
            this.skip();
        }
    });

    const api = path.join(path.dirname(new URL(import.meta.url).pathname), 'lua_api.lua');
    const inoutBus = designs.find((d) => d.name === '12_inout_bus');
    const cases = designs.filter((d) => d.lua?.length).flatMap((d) => d.lua.map((script) => [d, script]))
        .concat([[inoutBus, api]]);
    for (const [d, script] of cases) {
        it(`${d.name}: ${path.basename(script)}`, function () {
            const circuitJson = convert(synthesize(d)).toString();
            const source = fs.readFileSync(script, 'utf8');
            const js = digitaljsLua(circuitJson, source);
            const rs = hdlstudioLua(circuitJson, script);
            assert.ok(js.length > 0, 'the script printed nothing');
            assert.deepStrictEqual(rs, js);
        });
    }
});
