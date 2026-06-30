//
'use strict';

// Synthesis pipeline test: runs every example in test/verilog through the same
// flow the extension uses (yosys -> yosys2digitaljs -> io_ui) and checks it
// converts without error. This catches the "Unknown yosys2digitaljs error" /
// "Invalid cell type" class of bugs. It needs the `yosys` binary on PATH but
// does NOT need VS Code, so it is named *.spec.mjs to stay out of the
// @vscode/test-electron suite (which globs **/**.test.js).

import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import { yosys2digitaljs, io_ui } from 'yosys2digitaljs/core';
import { build_yosys_script } from '../src/yosys_script.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const verilogDir = path.resolve(__dirname, 'verilog');

function synth(svPath) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hdl-test-'));
    try {
        const file = path.basename(svPath);
        fs.copyFileSync(svPath, path.join(tmp, file));
        const outJson = path.join(tmp, 'out.json');
        // Reuse the extension's own script builder so the test can't drift.
        const script = build_yosys_script({ [file]: '' }, {}) + `\njson -o ${outJson}`;
        fs.writeFileSync(path.join(tmp, 'synth.ys'), script);
        execFileSync('yosys', ['-q', '-s', 'synth.ys'], { cwd: tmp, stdio: 'pipe' });
        const raw = JSON.parse(fs.readFileSync(outJson, 'utf8'));
        const output = yosys2digitaljs(raw, {});
        io_ui(output);
        return output;
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
}

function yosysAvailable() {
    try {
        execFileSync('yosys', ['--version'], { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
}

describe('Synthesis pipeline (yosys -> yosys2digitaljs)', function () {
    this.timeout(60000);

    before(function () {
        if (!yosysAvailable()) {
            console.warn('  yosys not found on PATH - skipping pipeline tests');
            this.skip();
        }
    });

    const files = fs.readdirSync(verilogDir).filter((f) => f.endsWith('.sv')).sort();
    assert.ok(files.length > 0, 'no .sv examples found in test/verilog');

    for (const f of files) {
        it(`synthesizes and converts ${f}`, function () {
            const output = synth(path.join(verilogDir, f));
            assert.ok(output && output.devices, `${f}: no output produced`);
            assert.ok(Object.keys(output.devices).length > 0, `${f}: no devices produced`);
        });
    }

    it('keeps "decada" as a subcircuit in 08_contador_decadas.sv', function () {
        const output = synth(path.join(verilogDir, '08_contador_decadas.sv'));
        assert.ok(output.subcircuits && 'decada' in output.subcircuits,
                  'expected a "decada" subcircuit (module instantiation should not be flattened)');
    });
});
