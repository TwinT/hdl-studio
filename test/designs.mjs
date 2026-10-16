//
'use strict';

// The examples, synthesized like the extension does (yosys with
// read_slang), for the tests that need a fresh netlist (test/golden/ holds
// frozen ones).

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import { build_yosys_script, isHdlFile } from '../src/yosys_script.mjs';
import { set_hdlstudio_root, hdlstudio_bin } from '../src/hdlstudio_bin.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const verilog = path.join(root, 'test/verilog');
set_hdlstudio_root(root);

export function slangAvailable() {
    try {
        return !execFileSync('yosys', ['-p', 'help read_slang'], { stdio: 'pipe' }).toString().includes('No such command');
    } catch {
        return false;
    }
}

const walk = (d) => fs.readdirSync(d, { withFileTypes: true })
    .flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)).map((f) => path.join(e.name, f)) : [e.name]);

// name, directory, files (all if omitted), top, ticks
export const designs = [];
for (const e of fs.readdirSync(verilog, { withFileTypes: true }).filter((e) => e.isDirectory())) {
    const svs = fs.readdirSync(path.join(verilog, e.name)).filter((f) => f.endsWith('.sv'));
    if (svs.length === 1)
        designs.push({ name: e.name, dir: path.join(verilog, e.name), files: svs, top: e.name === 'bmux_regfile' ? e.name : undefined, ticks: 4000,
                   lua: fs.readdirSync(path.join(verilog, e.name)).filter((f) => f.endsWith('.lua')).map((f) => path.join(verilog, e.name, f)) });
}
designs.push(
    { name: 'micro', dir: path.join(verilog, 'micro'), top: 'datapath', ticks: 20000 },
    { name: 'control_unit', dir: path.join(verilog, 'control_unit/rtl'), ticks: 20000 },
    { name: 'alu', dir: path.join(verilog, 'alu'), files: ['tp1_pkg.sv', 'alu_if.sv', 'alu.sv', 'reg_file.sv', 'fsm.sv', 'top_module.sv'], top: 'top_module', ticks: 20000 },
    { name: 'soc cpu_ram', dir: path.join(verilog, 'soc/rtl'), top: 'cpu_ram', ticks: 20000 },
    { name: 'soc board', dir: path.join(verilog, 'soc/rtl'), top: 'board', ticks: 60000, lua: [path.join(verilog, 'soc/rtl/board_sim.lua')] },
    // small values of `a` matter (in range), so its stimulus is limited to 0..31 half the time (see makeStimulus)
    { name: 'wide_idx', dir: path.join(root, 'test/golden/wide_idx'), top: 'wide_idx', ticks: 20000 },
);

export function synthesize(d) {
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

// The circuit the extension would show: converted with io_ui and transform.
export function convert(yosysJson, transform = true) {
    return execFileSync(hdlstudio_bin(), ['yosys2hdlstudio', ...(transform ? ['--transform'] : [])],
        { input: yosysJson, maxBuffer: 1 << 30, stdio: ['pipe', 'pipe', 'pipe'] });
}
