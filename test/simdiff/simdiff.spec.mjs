//
'use strict';

// Differential test of the simulator: every example, synthesized and
// converted like the extension does, runs on digitaljs's own engine and on
// hdlstudio's (`hdlstudio simtrace`) with the same seeded stimulus; the
// traces (trace.mjs) must be identical. Temporary, like digitaljs: the
// safety net of the migration. Needs yosys with read_slang.

import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { hdlstudio_bin } from '../../src/hdlstudio_bin.mjs';
import { makeStimulus, digitaljsTrace } from './trace.mjs';
import { designs, synthesize, slangAvailable } from './designs.mjs';

function same(js, rs, what) {
    const n = Math.max(js.length, rs.length);
    for (let i = 0; i < n; i++)
        if (js[i] !== rs[i])
            assert.fail(`traces differ at line ${i + 1}:\n  digitaljs: ${js[i]}\n  ${what}: ${rs[i]}`);
}

// `adapter`: also run digitaljs's model on hdlstudio's engine through the
// UI's adapter (view/remote_engine.mjs), as the extension does.
async function compare(yosysJson, { ticks, transform, defaultcomb, adapter }) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hdl-simdiff-'));
    try {
        const circuitFile = path.join(tmp, 'circuit.json');
        const stimulusFile = path.join(tmp, 'stimulus.json');
        const circuitText = execFileSync(hdlstudio_bin(), ['yosys2hdlstudio', ...(transform ? ['--transform'] : [])],
            { input: yosysJson, maxBuffer: 1 << 30, stdio: ['pipe', 'pipe', 'pipe'] });
        fs.writeFileSync(circuitFile, circuitText);
        const circuit = JSON.parse(circuitText);
        const stimulus = makeStimulus(circuit, { ticks, seed: 7 });
        fs.writeFileSync(stimulusFile, JSON.stringify(stimulus));
        const js = await digitaljsTrace(circuit, { ticks, stimulus, defaultcomb });
        const rs = execFileSync(hdlstudio_bin(),
            ['simtrace', ...(defaultcomb ? ['--defaultcomb'] : []), circuitFile, stimulusFile, String(ticks)],
            { maxBuffer: 1 << 30 }).toString().trimEnd().split('\n');
        same(js, rs, 'hdlstudio');
        if (adapter)
            same(js, await digitaljsTrace(circuit, { ticks, stimulus, defaultcomb, remote: true }), 'adapter');
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
}

describe('hdlstudio simulator vs digitaljs (end-of-tick traces)', function () {
    this.timeout(300000);

    before(function () {
        if (!slangAvailable()) {
            console.warn('  yosys with read_slang not found - skipping the simulator diff');
            this.skip();
        }
    });

    for (const d of designs) {
        let yosysJson;
        const synth = () => (yosysJson ??= synthesize(d));
        it(`${d.name}`, async function () {
            await compare(synth(), { ticks: d.ticks, transform: true, adapter: true });
        });
        it(`${d.name} without transform`, async function () {
            await compare(synth(), { ticks: d.ticks, transform: false });
        });
        it(`${d.name} with zero combinational delay`, async function () {
            await compare(synth(), { ticks: d.ticks, transform: true, defaultcomb: true });
        });
    }
});
