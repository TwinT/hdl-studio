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
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import { build_yosys_script, isHdlFile } from '../../src/yosys_script.mjs';
import { set_hdlstudio_root, hdlstudio_bin } from '../../src/hdlstudio_bin.mjs';
import { makeStimulus, digitaljsTrace } from './trace.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const verilog = path.join(root, 'test/verilog');
set_hdlstudio_root(root);

function slangAvailable() {
    try {
        return !execFileSync('yosys', ['-p', 'help read_slang'], { stdio: 'pipe' }).toString().includes('No such command');
    } catch {
        return false;
    }
}

const walk = (d) => fs.readdirSync(d, { withFileTypes: true })
    .flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)).map((f) => path.join(e.name, f)) : [e.name]);

// name, directory, files (all if omitted), top, ticks
const designs = [];
for (const e of fs.readdirSync(verilog, { withFileTypes: true }).filter((e) => e.isDirectory())) {
    const svs = fs.readdirSync(path.join(verilog, e.name)).filter((f) => f.endsWith('.sv'));
    if (svs.length === 1)
        designs.push({ name: e.name, dir: path.join(verilog, e.name), files: svs, top: e.name === 'bmux_regfile' ? e.name : undefined, ticks: 4000 });
}
designs.push(
    { name: 'micro', dir: path.join(verilog, 'micro'), top: 'datapath', ticks: 20000 },
    { name: 'control_unit', dir: path.join(verilog, 'control_unit/rtl'), ticks: 20000 },
    { name: 'alu', dir: path.join(verilog, 'alu'), files: ['tp1_pkg.sv', 'alu_if.sv', 'alu.sv', 'reg_file.sv', 'fsm.sv', 'top_module.sv'], top: 'top_module', ticks: 20000 },
    { name: 'soc cpu_ram', dir: path.join(verilog, 'soc/rtl'), top: 'cpu_ram', ticks: 20000 },
    { name: 'soc board', dir: path.join(verilog, 'soc/rtl'), top: 'board', ticks: 60000 },
);

function synthesize(d) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hdl-simdiff-'));
    try {
        const files = {};
        for (const f of d.files ?? walk(d.dir)) {
            if (!(isHdlFile(f) || f.endsWith('.hex') || f.endsWith('.mem'))) continue;
            fs.copyFileSync(path.join(d.dir, f), path.join(tmp, path.basename(f)));
            if (isHdlFile(f)) files[path.basename(f)] = '';
        }
        const script = build_yosys_script(files, { useSlang: true, top: d.top }) + '\njson -o out.json';
        fs.writeFileSync(path.join(tmp, 'synth.ys'), script);
        execFileSync('yosys', ['-q', '-s', 'synth.ys'], { cwd: tmp, stdio: 'pipe' });
        return fs.readFileSync(path.join(tmp, 'out.json'));
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
}

async function compare(yosysJson, { ticks, transform, defaultcomb }) {
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
        const n = Math.max(js.length, rs.length);
        for (let i = 0; i < n; i++)
            if (js[i] !== rs[i])
                assert.fail(`traces differ at line ${i + 1}:\n  digitaljs: ${js[i]}\n  hdlstudio: ${rs[i]}`);
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
            await compare(synth(), { ticks: d.ticks, transform: true });
        });
        it(`${d.name} without transform`, async function () {
            await compare(synth(), { ticks: d.ticks, transform: false });
        });
        it(`${d.name} with zero combinational delay`, async function () {
            await compare(synth(), { ticks: d.ticks, transform: true, defaultcomb: true });
        });
    }
});
