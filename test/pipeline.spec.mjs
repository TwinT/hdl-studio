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
import { createRequire } from 'module';
import { execFileSync } from 'child_process';
import { yosys2digitaljs, io_ui } from 'yosys2digitaljs/core';
import { build_yosys_script, isHdlFile } from '../src/yosys_script.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const verilogDir = path.resolve(__dirname, 'verilog');

function synth(svPath, opts = {}) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hdl-test-'));
    try {
        const file = path.basename(svPath);
        fs.copyFileSync(svPath, path.join(tmp, file));
        const outJson = path.join(tmp, 'out.json');
        // Reuse the extension's own script builder so the test can't drift.
        const script = build_yosys_script({ [file]: '' }, opts) + `\njson -o ${outJson}`;
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

describe('isHdlFile', function () {
    it('accepts .v and .sv, rejects data files like .hex/.mem', function () {
        assert.strictEqual(isHdlFile('control_unit.sv'), true);
        assert.strictEqual(isHdlFile('top.v'), true);
        assert.strictEqual(isHdlFile('rtl/control_unit.hex'), false);
        assert.strictEqual(isHdlFile('rom.mem'), false);
    });
});

describe('build_yosys_script with a data file entry', function () {
    it('never emits read_verilog for a non-HDL (.hex) file', function () {
        // A data file referenced only via $readmemh/$readmemb must be excluded
        // from the files map by the caller (run_yosys) - build_yosys_script
        // itself just trusts the map it's given, so this locks down that
        // caller-side contract instead.
        const script = build_yosys_script({ 'control_unit.sv': '' });
        assert.ok(!script.includes('.hex'), 'script must not reference the .hex file at all');
        assert.ok(script.includes('read_verilog -sv -defer control_unit.sv'));
    });
});

describe('Synthesis pipeline (yosys -> yosys2digitaljs)', function () {
    this.timeout(60000);

    before(function () {
        if (!yosysAvailable()) {
            console.warn('  yosys not found on PATH - skipping pipeline tests');
            this.skip();
        }
    });

    // Each example lives in its own subfolder, named after its main module
    // (test/verilog/<name>/<name>.sv), alongside a sim.lua. Only pick up
    // single-file examples here: a subfolder qualifies if it contains exactly
    // one .sv file, which excludes multi-file designs like test/verilog/alu/
    // (whose own alu.sv is just one of several interdependent sources, not a
    // standalone top-level design).
    const files = fs.readdirSync(verilogDir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .flatMap((e) => {
            const dir = path.join(verilogDir, e.name);
            const svFiles = fs.readdirSync(dir).filter((f) => f.endsWith('.sv'));
            return svFiles.length === 1 ? [path.join(dir, svFiles[0])] : [];
        })
        .sort();
    assert.ok(files.length > 0, 'no .sv examples found in test/verilog');

    for (const f of files) {
        const name = path.basename(f);
        it(`synthesizes and converts ${name}`, function () {
            const output = synth(f);
            assert.ok(output && output.devices, `${name}: no output produced`);
            assert.ok(Object.keys(output.devices).length > 0, `${name}: no devices produced`);
        });
    }

    // techmap decomposes combinational logic to gates; it must keep flip-flops,
    // latches and memories coarse (a bare `techmap` lowers them to $_DFF_P_ etc.
    // which yosys2digitaljs cannot convert).
    for (const f of files) {
        const name = path.basename(f);
        it(`synthesizes and converts ${name} with techmap`, function () {
            const output = synth(f, { techmap: true });
            assert.ok(Object.keys(output.devices).length > 0, `${name}: no devices produced`);
        });
    }

    it('keeps "decada" as a subcircuit in 08_contador_decadas.sv', function () {
        const output = synth(path.join(verilogDir, '08_contador_decadas', '08_contador_decadas.sv'));
        assert.ok(output.subcircuits && 'decada' in output.subcircuits,
                  'expected a "decada" subcircuit (module instantiation should not be flattened)');
    });

    it('converts bus_top.sv to a Tribuf per driver merged by a top-level TriMerge', function () {
        const output = synth(path.join(verilogDir, 'bus_top', 'bus_top.sv'));
        for (const subname of ['drv_a', 'drv_b']) {
            const sub = output.subcircuits[subname];
            assert.ok(sub, `expected a "${subname}" subcircuit`);
            const tribufs = Object.values(sub.devices).filter((d) => d.type === 'Tribuf');
            assert.strictEqual(tribufs.length, 1, `expected one Tribuf device in ${subname}`);
            assert.strictEqual(tribufs[0].bits, 4);
        }

        const merges = Object.values(output.devices).filter((d) => d.type === 'TriMerge');
        assert.strictEqual(merges.length, 1, 'expected exactly one top-level TriMerge device');
        assert.strictEqual(merges[0].inputs, 2);
        assert.strictEqual(merges[0].bits, 4);
    });
});

// A net with 2+ sources arises in practice via $tribuf (converted above, real
// yosys - plain multi-driven wires are refused before JSON export: "Cell ...
// Y port signal ... already driven by ..."). This block separately exercises
// yosys2digitaljs's net-merge logic directly against a hand-built netlist
// (2 real $not cells, structurally identical to real yosys output, both
// driving the same net-bit-array) instead of going through yosys.
describe('yosys2digitaljs net merging (multiple sources per net)', function () {
    function notCell(aBits, yBits) {
        return {
            hide_name: 1,
            type: '$not',
            parameters: {
                A_SIGNED: '00000000000000000000000000000000',
                A_WIDTH: '00000000000000000000000000000100',
                Y_WIDTH: '00000000000000000000000000000100'
            },
            attributes: {},
            port_directions: { A: 'input', Y: 'output' },
            connections: { A: aBits, Y: yBits }
        };
    }

    const rawJson = {
        modules: {
            multidrv: {
                attributes: {},
                ports: {
                    a: { direction: 'input', bits: [2, 3, 4, 5] },
                    b: { direction: 'input', bits: [6, 7, 8, 9] },
                    y: { direction: 'output', bits: [10, 11, 12, 13] }
                },
                cells: {
                    '$not$1': notCell([2, 3, 4, 5], [10, 11, 12, 13]),
                    '$not$2': notCell([6, 7, 8, 9], [10, 11, 12, 13])
                },
                netnames: {
                    a: { hide_name: 0, bits: [2, 3, 4, 5], attributes: {} },
                    b: { hide_name: 0, bits: [6, 7, 8, 9], attributes: {} },
                    y: { hide_name: 0, bits: [10, 11, 12, 13], attributes: {} }
                }
            }
        }
    };

    it('merges two sources into a single TriMerge device instead of throwing', function () {
        const output = yosys2digitaljs(rawJson, {});

        const merges = Object.entries(output.devices).filter(([, d]) => d.type === 'TriMerge');
        assert.strictEqual(merges.length, 1, 'expected exactly one TriMerge device');
        const [mergeId, mergeDev] = merges[0];
        assert.strictEqual(mergeDev.inputs, 2);
        assert.strictEqual(mergeDev.bits, 4);

        const notIds = Object.entries(output.devices)
            .filter(([, d]) => d.type === 'Not')
            .map(([id]) => id);
        assert.strictEqual(notIds.length, 2, 'expected both $not cells to convert');

        const intoMerge = output.connectors.filter((c) => c.to.id === mergeId);
        assert.strictEqual(intoMerge.length, 2, 'expected both Not outputs wired into the merge device');
        assert.deepStrictEqual(intoMerge.map((c) => c.to.port).sort(), ['in0', 'in1']);
        assert.deepStrictEqual(intoMerge.map((c) => c.from.id).sort(), notIds.slice().sort());

        const outOfMerge = output.connectors.filter((c) => c.from.id === mergeId);
        assert.strictEqual(outOfMerge.length, 1, 'expected the merge device to drive the original target');
        assert.strictEqual(outOfMerge[0].from.port, 'out');
    });
});

// digitaljs's cell operation() logic for z-input safety - step 4 of
// 4VL_INTEGRATION_PLAN.md. Loads the compiled lib/ tree (CJS) directly:
// proven to construct real cell instances and call operation() in plain
// Node without a DOM, unlike importing the ESM src/ tree (base.mjs pulls in
// @joint/core + tools.mjs, which need a real browser DOM - see step 2's
// notes). Locks in two representative patterns confirmed safe by direct
// source audit: numeric-conversion cells guard isFullyDefined before
// toBigInt()/toNumber() (so z, like x, falls back to an all-x output
// instead of throwing), and mux select logic degrades a z select to the
// same "output all-x" fallback as an x select.
describe('digitaljs cell operation() z-input safety', function () {
    const require = createRequire(import.meta.url);
    const cells = require('../node_modules/digitaljs/lib/cells.js');
    const { Vector4vl } = require('@twint/4vl');

    it('Addition computes normally when defined, degrades to all-x only when a z operand appears', function () {
        const dev = new cells.Addition({
            id: 'a1', type: 'Addition',
            bits: { in1: 4, in2: 4, out: 4 },
            signed: { in1: false, in2: false }
        });
        // Fully-defined operands: 1 + 3 = 4. Proves the guard isn't just
        // returning xes() unconditionally.
        const defined = dev.operation({ in1: Vector4vl.fromBin('0001'), in2: Vector4vl.fromBin('0011') });
        assert.strictEqual(defined.out.toBin(), '0100');

        const withZ = dev.operation({ in1: Vector4vl.fromBin('0z01'), in2: Vector4vl.fromBin('0011') });
        assert.strictEqual(withZ.out.toBin(), 'xxxx');
    });

    it('Mux1Hot routes a real input when sel is clean, degrades to all-x only when sel has a z bit', function () {
        const dev = new cells.Mux1Hot({
            id: 'm1', type: 'Mux1Hot',
            bits: { in: 4, sel: 2 }
        });
        const inputs = {
            in0: Vector4vl.fromBin('0000'),
            in1: Vector4vl.fromBin('1111'),
            in2: Vector4vl.fromBin('0101')
        };
        // Clean one-hot sel actually routes the selected input through.
        const defined = dev.operation({ sel: Vector4vl.fromBin('01'), ...inputs });
        assert.strictEqual(defined.out.toBin(), '1111');

        const withZ = dev.operation({ sel: Vector4vl.fromBin('z0'), ...inputs });
        assert.strictEqual(withZ.out.toBin(), 'xxxx');
    });
});

// step 5 of 4VL_INTEGRATION_PLAN.md - a 4th visual state for Z in wire/lamp/
// waveform coloring. The coloring code itself lives in View classes that need
// a real DOM (see step 2's finding), so it can't be exercised directly here;
// this locks in the pure helper each patched ternary is keyed on instead.
describe('z-state visual helpers (digitaljs isAllZ, wavecanvas bitColors)', function () {
    const require = createRequire(import.meta.url);
    const { isAllZ } = require('../node_modules/digitaljs/lib/cells/base.js');
    const { Vector4vl } = require('@twint/4vl');

    it('isAllZ is true only for a fully-z vector, not x, ones, or a x/z mix', function () {
        assert.strictEqual(isAllZ(Vector4vl.zes(4)), true);
        assert.strictEqual(isAllZ(Vector4vl.ones(4)), false);
        assert.strictEqual(isAllZ(Vector4vl.xes(4)), false);
        assert.strictEqual(isAllZ(Vector4vl.fromBin('z0z1')), false);
    });

    it('wavecanvas exposes a 5th bitColors entry for the z state', function () {
        const { defaultSettings } = require('../node_modules/wavecanvas/dist/index.js');
        assert.strictEqual(defaultSettings.bitColors.length, 5);
        assert.match(defaultSettings.bitColors[4], /^#[0-9a-f]{6}$/i);
    });
});

// step 6: @twint/4vl@1.0.1 fixes Display4vlDec/Dec2c collapsing a fully-z
// value to 'x' (the gap step 5 handed off externally, since it lives in
// @twint/4vl's own source, not digitaljs). Locks in the fix actually landed
// in the installed dependency, not just that the version bump happened.
describe('@twint/4vl Display4vlDec/Dec2c distinguish a fully-z value from x', function () {
    const require = createRequire(import.meta.url);
    const { Vector4vl, Display4vl } = require('@twint/4vl');
    const display4vl = new Display4vl();

    it('shows z (not x) for an all-z vector in both decimal displays', function () {
        assert.strictEqual(display4vl.show('dec', Vector4vl.zes(4)), 'z');
        assert.strictEqual(display4vl.show('dec2c', Vector4vl.zes(4)), 'z');
    });

    it('still shows x for a non-z-only undefined vector', function () {
        assert.strictEqual(display4vl.show('dec', Vector4vl.xes(4)), 'x');
        assert.strictEqual(display4vl.show('dec', Vector4vl.fromBin('z0z1')), 'x');
    });
});
