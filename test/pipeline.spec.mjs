//
'use strict';

// Synthesis pipeline test: runs every example in test/verilog through the same
// flow the extension uses (yosys -> the hdlstudio engine's yosys2hdlstudio)
// and checks it converts without error. This catches the
// "Invalid cell type" class of bugs. It needs the `yosys` binary on PATH but
// does NOT need VS Code, so it is named *.spec.mjs to stay out of the
// @vscode/test-electron suite (which globs **/**.test.js).

import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import { build_yosys_script, isHdlFile, data_file_paths } from '../src/yosys_script.mjs';
import { convert_yosys_json, set_hdlstudio_root } from '../src/hdlstudio_bin.mjs';
import { parseTime, formatTime, formatFreq, vcdTimescale } from '../src/time_units.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const verilogDir = path.resolve(__dirname, 'verilog');
set_hdlstudio_root(path.resolve(__dirname, '..'));

// ui=false skips io_ui, keeping plain Input/Output devices (for simulation).
function synth(svPath, opts = {}, ui = true) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hdl-test-'));
    try {
        const file = path.basename(svPath);
        fs.copyFileSync(svPath, path.join(tmp, file));
        const outJson = path.join(tmp, 'out.json');
        // Reuse the extension's own script builder so the test can't drift.
        const script = build_yosys_script({ [file]: '' }, opts) + `\njson -o ${outJson}`;
        fs.writeFileSync(path.join(tmp, 'synth.ys'), script);
        execFileSync('yosys', ['-q', '-s', 'synth.ys'], { cwd: tmp, stdio: 'pipe' });
        return convert_yosys_json(fs.readFileSync(outJson, 'utf8'), {}, ui);
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
}

// Like synth(), but for a multi-file design: copies every file in `dir`
// (source + any .hex/.mem data files) into the temp synth dir instead of
// just one. Needed for test/verilog/micro/, a multi-file design excluded
// from the single-.sv-per-subfolder loop above.
function synthDir(dir, opts = {}, ui = true) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hdl-test-'));
    try {
        const names = fs.readdirSync(dir).filter((f) => isHdlFile(f) || f.endsWith('.hex') || f.endsWith('.mem'));
        const files = {};
        for (const name of names) {
            fs.copyFileSync(path.join(dir, name), path.join(tmp, name));
            if (isHdlFile(name)) files[name] = '';
        }
        const outJson = path.join(tmp, 'out.json');
        const script = build_yosys_script(files, opts) + `\njson -o ${outJson}`;
        fs.writeFileSync(path.join(tmp, 'synth.ys'), script);
        execFileSync('yosys', ['-q', '-s', 'synth.ys'], { cwd: tmp, stdio: 'pipe' });
        return convert_yosys_json(fs.readFileSync(outJson, 'utf8'), {}, ui);
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
}

// Each example lives in its own subfolder, named after its main module
// (test/verilog/<name>/<name>.sv), alongside a sim.lua. Only pick up
// single-file examples here: a subfolder qualifies if it contains exactly
// one .sv file, which excludes multi-file designs like test/verilog/alu/
// (whose own alu.sv is just one of several interdependent sources, not a
// standalone top-level design).
function singleFileExamples() {
    return fs.readdirSync(verilogDir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .flatMap((e) => {
            const dir = path.join(verilogDir, e.name);
            const svFiles = fs.readdirSync(dir).filter((f) => f.endsWith('.sv'));
            return svFiles.length === 1 ? [path.join(dir, svFiles[0])] : [];
        })
        .sort();
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

describe('data_file_paths', function () {
    // The .sv sources are flattened to the synthesis dir root, so a $readmemh
    // with a bare name only finds a nested data file through its alias.
    it('adds a bare-name alias for a nested data file, nothing for a root one', function () {
        assert.deepStrictEqual(data_file_paths('control_unit.hex'), ['control_unit.hex']);
        assert.deepStrictEqual(data_file_paths('core/control_unit.hex'), ['core/control_unit.hex', 'control_unit.hex']);
    });
    it('gives only the alias to a data file outside the project directory', function () {
        assert.deepStrictEqual(data_file_paths('../../rtl/core/control_unit.hex'), [undefined, 'control_unit.hex']);
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

describe('Synthesis pipeline (yosys -> yosys2hdlstudio)', function () {
    this.timeout(60000);

    before(function () {
        if (!yosysAvailable()) {
            console.warn('  yosys not found on PATH - skipping pipeline tests');
            this.skip();
        }
    });

    const files = singleFileExamples();
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
    // which the converter cannot convert).
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

    // `inout` ports: circuit ports are one-directional, so the converter
    // (crates/hdlstudio-yosys/src/inout.rs) turns each inout P into an
    // input P (what the insides read) plus an output P__out that carries only
    // the module's own drivers.
    it('splits inout ports into an input plus a driver-only __out output (12_inout_bus.sv)', function () {
        const output = synth(path.join(verilogDir, '12_inout_bus', '12_inout_bus.sv'));
        const nets = (sub, type) => Object.values(sub.devices).filter((d) => d.type === type).map((d) => d.net);
        const merges = (sub) => Object.values(sub.devices).filter((d) => d.type === 'TriMerge');

        // drives + reads: both halves
        assert.deepStrictEqual(nets(output.subcircuits.bus_reg, 'Input').filter((n) => n.startsWith('bus')), ['bus']);
        assert.deepStrictEqual(nets(output.subcircuits.bus_reg, 'Output'), ['bus__out']);
        // only reads: no output half, nothing to drive
        assert.deepStrictEqual(nets(output.subcircuits.bus_probe, 'Input').filter((n) => n.startsWith('bus')), ['bus']);
        assert.ok(!nets(output.subcircuits.bus_probe, 'Output').includes('bus__out'));
        // passes the bus down to two bus_reg: both of their drivers merge
        assert.deepStrictEqual(nets(output.subcircuits.bus_pair, 'Output'), ['bus__out']);
        assert.strictEqual(merges(output.subcircuits.bus_pair).length, 1);
        assert.strictEqual(merges(output.subcircuits.bus_pair)[0].inputs, 2);
        // top: the external tribuf + bus_pair's driver half
        assert.strictEqual(merges(output)[0].inputs, 2);
    });

    // bmux_regfile.sv's q[] is populated by separate module instances (not a
    // single memory-inferring write), so a dynamic read of q[raddr] compiles
    // to a $bmux cell (word-wide binary-select) - but only through the
    // read_slang frontend (the classic read_verilog frontend resolves the
    // same RTL straight to $mux without ever producing $bmux, which is why
    // the generic per-example loop above, run without useSlang, doesn't
    // exercise this path). This is the only test in this suite that passes
    // useSlang:true - the real extension always does when yosys has slang
    // support (see src/requests.mjs's slang_available()), so this path
    // matters even though nothing else here covers it.
    it('converts bmux_regfile.sv ($bmux) via the read_slang frontend', async function () {
        const { slangSupport } = await import('./designs.mjs');
        if (!slangSupport()) this.skip();
        const output = synth(path.join(verilogDir, 'bmux_regfile', 'bmux_regfile.sv'),
                              { useSlang: slangSupport(), top: 'bmux_regfile' });
        const muxes = Object.values(output.devices).filter((d) => d.type === 'Mux' && d.bits.sel > 1);
        assert.strictEqual(muxes.length, 1, 'expected exactly one wide (binary-select) Mux device');
        assert.strictEqual(muxes[0].bits.sel, 2);
        assert.strictEqual(muxes[0].bits.in, 8);

        assert.ok(!Object.values(output.devices).some((d) => d.type === 'Mux1Hot'),
                  '$bmux must not fall back to a one-hot Mux1Hot device');
        assert.ok(!Object.values(output.devices).some((d) => d.type === 'BusGroup'),
                  '$bmux\'s select is already a plain binary bus - no BusGroup should be needed');

        const cellNames = Object.keys(output.subcircuits || {});
        assert.strictEqual(cellNames.length, 4, 'expected 4 distinct bmux_regfile_cell subcircuits');
    });

    // Regression: forcing top to a module with no output ports (datapath.sv's
    // only effect is internal register/memory state) used to render an
    // arbitrary other module instead (e.g. alu.sv) - opt_clean's
    // reachable-from-outputs sweep silently deleted every one of datapath's
    // instantiated cells, and the converter's topsort-based top-detection
    // then picked whichever now-orphaned leaf module happened to sort last.
    // Fixed by keeping the requested top's contents alive across the opt
    // passes (see build_yosys_script's `if (opts.top)` block).
    it('keeps datapath.sv as top even though it has no output ports', async function () {
        const { slangSupport } = await import('./designs.mjs');
        if (!slangSupport()) this.skip();
        const output = synthDir(path.join(verilogDir, 'micro'), { useSlang: slangSupport(), top: 'datapath' });
        for (const name of ['alu', 'branch_unit', 'control_unit', 'decoder', 'ir',
                             'load_unit', 'memory', 'pc', 'register_file', 'store_unit']) {
            const sub = Object.keys(output.subcircuits || {}).find((k) => k.startsWith(name + '$datapath.'));
            assert.ok(sub, `expected a "${name}" subcircuit under datapath, got none ` +
                            `(top devices: ${Object.keys(output.devices).join(', ')})`);
        }
    });

});

// A net with 2+ sources arises in practice via $tribuf (converted above, real
// yosys - plain multi-driven wires are refused before JSON export: "Cell ...
// Y port signal ... already driven by ..."). This block separately exercises
// the converter's net-merge logic directly against a hand-built netlist
// (2 real $not cells, structurally identical to real yosys output, both
// driving the same net-bit-array) instead of going through yosys.
describe('Converter net merging (multiple sources per net)', function () {
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
        const output = convert_yosys_json(rawJson, {}, false);

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

// A Verilog output port only has one bit-width - there's no way to recover
// two independent dimensions from it alone (64 bits could be 8x8 or 4x16).
// An LED matrix's rows/cols instead ride a pair of custom attributes on the
// port (led_matrix_rows/led_matrix_cols), which survive synthesis onto the
// port's backing wire (the converter's "Add inputs/outputs" step reads the
// port's netnames attributes, same technique it uses for a Dff's .initial
// value) and get picked up by io_ui.
describe('LED matrix widget (led_matrix_rows/led_matrix_cols attributes)', function () {
    before(function () {
        if (!yosysAvailable()) {
            console.warn('  yosys not found on PATH - skipping pipeline tests');
            this.skip();
        }
    });

    it('io_ui infers an 8x8 LEDMatrix from port attributes', function () {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hdl-test-'));
        try {
            const file = 'ledmatrix_attr.sv';
            fs.writeFileSync(path.join(tmp, file), `
module top(
  (* led_matrix_rows = 8, led_matrix_cols = 8 *)
  output logic [63:0] matrix
);
  assign matrix = 64'd0;
endmodule
`);
            const outJson = path.join(tmp, 'out.json');
            const script = build_yosys_script({ [file]: '' }, {}) + `\njson -o ${outJson}`;
            fs.writeFileSync(path.join(tmp, 'synth.ys'), script);
            execFileSync('yosys', ['-q', '-s', 'synth.ys'], { cwd: tmp, stdio: 'pipe' });
            const raw = JSON.parse(fs.readFileSync(outJson, 'utf8'));
            const output = convert_yosys_json(raw);
            const dev = Object.values(output.devices).find((d) => d.net === 'matrix');
            assert.strictEqual(dev.type, 'LEDMatrix');
            assert.strictEqual(dev.rows, 8);
            assert.strictEqual(dev.cols, 8);
        } finally {
            fs.rmSync(tmp, { recursive: true, force: true });
        }
    });
});

// Two ways to opt a 1-bit Input into the momentary PushButton widget instead
// of the default toggling Button: a (* momentary *) attribute (same
// technique as led_matrix_rows/led_matrix_cols above - it survives synthesis
// onto the port's backing wire), or a "pushbutton"-prefixed port name (same
// technique io_ui() already uses for clk/clock -> Clock). Neither one
// changes an otherwise plain 1-bit input.
describe('Pushbutton widget (momentary attribute / name)', function () {
    before(function () {
        if (!yosysAvailable()) {
            console.warn('  yosys not found on PATH - skipping pipeline tests');
            this.skip();
        }
    });

    it('io_ui infers a PushButton from the momentary attribute', function () {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hdl-test-'));
        try {
            const file = 'pushbutton_attr.sv';
            fs.writeFileSync(path.join(tmp, file), `
module top(
  (* momentary *) input logic btn,
  output logic led
);
  assign led = btn;
endmodule
`);
            const outJson = path.join(tmp, 'out.json');
            const script = build_yosys_script({ [file]: '' }, {}) + `\njson -o ${outJson}`;
            fs.writeFileSync(path.join(tmp, 'synth.ys'), script);
            execFileSync('yosys', ['-q', '-s', 'synth.ys'], { cwd: tmp, stdio: 'pipe' });
            const raw = JSON.parse(fs.readFileSync(outJson, 'utf8'));
            const output = convert_yosys_json(raw);
            const dev = Object.values(output.devices).find((d) => d.net === 'btn');
            assert.strictEqual(dev.type, 'PushButton');
        } finally {
            fs.rmSync(tmp, { recursive: true, force: true });
        }
    });

    it('io_ui infers a PushButton from a "pushbutton"-prefixed name, no attribute needed', function () {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hdl-test-'));
        try {
            const file = 'pushbutton_name.sv';
            fs.writeFileSync(path.join(tmp, file), `
module top(
  input logic pushbutton_start,
  output logic led
);
  assign led = pushbutton_start;
endmodule
`);
            const outJson = path.join(tmp, 'out.json');
            const script = build_yosys_script({ [file]: '' }, {}) + `\njson -o ${outJson}`;
            fs.writeFileSync(path.join(tmp, 'synth.ys'), script);
            execFileSync('yosys', ['-q', '-s', 'synth.ys'], { cwd: tmp, stdio: 'pipe' });
            const raw = JSON.parse(fs.readFileSync(outJson, 'utf8'));
            const output = convert_yosys_json(raw);
            const dev = Object.values(output.devices).find((d) => d.net === 'pushbutton_start');
            assert.strictEqual(dev.type, 'PushButton');
        } finally {
            fs.rmSync(tmp, { recursive: true, force: true });
        }
    });

    it('a 1-bit input without the attribute stays a plain Button', function () {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hdl-test-'));
        try {
            const file = 'plain_button.sv';
            fs.writeFileSync(path.join(tmp, file), `
module top(
  input logic btn,
  output logic led
);
  assign led = btn;
endmodule
`);
            const outJson = path.join(tmp, 'out.json');
            const script = build_yosys_script({ [file]: '' }, {}) + `\njson -o ${outJson}`;
            fs.writeFileSync(path.join(tmp, 'synth.ys'), script);
            execFileSync('yosys', ['-q', '-s', 'synth.ys'], { cwd: tmp, stdio: 'pipe' });
            const raw = JSON.parse(fs.readFileSync(outJson, 'utf8'));
            const output = convert_yosys_json(raw);
            const dev = Object.values(output.devices).find((d) => d.net === 'btn');
            assert.strictEqual(dev.type, 'Button');
        } finally {
            fs.rmSync(tmp, { recursive: true, force: true });
        }
    });
});

// Control panel time units (src/time_units.mjs): the project's timescale says
// how long a tick is; the panel converts both ways.
describe('time units', function () {
    const close = (a, b) => Math.abs(a - b) <= Math.abs(b) * 1e-12;
    it('parses a number with an optional unit (default ns)', function () {
        assert.ok(close(parseTime('1ns'), 1e-9));
        assert.ok(close(parseTime(' 2.5 us '), 2.5e-6));
        assert.ok(close(parseTime('2.5µs'), 2.5e-6));
        assert.ok(close(parseTime('200'), 200e-9));
        assert.ok(close(parseTime('10 ps'), 1e-11));
        assert.ok(close(parseTime('1s'), 1));
        assert.ok(close(parseTime('1e3 fs'), 1e-12));
    });
    it('rejects garbage, negative and zero times', function () {
        for (const bad of ['', 'ns', '1 ks', '-1ns', '0', '1 n s', 'abc'])
            assert.strictEqual(parseTime(bad), undefined, bad);
    });
    it('formats with the biggest unit >= 1 and 4 significant digits', function () {
        assert.strictEqual(formatTime(200 * 1e-9), '200 ns');
        assert.strictEqual(formatTime(12345 * 1e-9), '12.35 µs');
        assert.strictEqual(formatTime(1e-9), '1 ns');
        assert.strictEqual(formatTime(1e-3), '1 ms');
        assert.strictEqual(formatTime(0), '0 s');
        assert.strictEqual(formatTime(5e-16), '0.5 fs');
        assert.strictEqual(formatFreq(1 / 200e-9), '5 MHz');
        assert.strictEqual(formatFreq(50), '50 Hz');
    });
    it('round-trips through format and parse', function () {
        for (const t of [1e-15, 3e-12, 1e-9, 7.5e-6, 2e-3, 42])
            assert.ok(close(parseTime(formatTime(t)), t), formatTime(t));
    });
    it('writes a tick as a VCD timescale: the coarsest it is a whole number of', function () {
        assert.deepStrictEqual(['1ns', '20ns', '1.5ns', '250ns', '1ms', '100us'].map((t) => vcdTimescale(parseTime(t))), [
            { unit: '1 ns', scale: 1 }, { unit: '10 ns', scale: 2 }, { unit: '100 ps', scale: 15 },
            { unit: '10 ns', scale: 25 }, { unit: '1 ms', scale: 1 }, { unit: '100 us', scale: 1 },
        ]);
    });
});

describe('the top found by yosys (no Top option)', function () {
    // read_slang without --top marks every module nobody instantiates `top`
    it('several: shows the biggest, says which, and drops the other', async function () {
        const { slangSupport } = await import('./designs.mjs');
        if (!slangSupport()) this.skip();
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hdl-test-'));
        try {
            fs.writeFileSync(path.join(tmp, 'two_tops.sv'), `
                module helper (input logic a, output logic y);
                    assign y = ~a;
                endmodule
                module counter (input logic clk, rst, output logic [3:0] q);
                    always_ff @(posedge clk) q <= rst ? 4'd0 : q + 4'd1;
                endmodule`);
            fs.writeFileSync(path.join(tmp, 'synth.ys'), build_yosys_script({ 'two_tops.sv': '' }, { useSlang: slangSupport() }) + '\njson -o out.json');
            execFileSync('yosys', ['-q', '-s', 'synth.ys'], { cwd: tmp, stdio: 'pipe' });
            const warnings = [];
            const c = convert_yosys_json(fs.readFileSync(path.join(tmp, 'out.json'), 'utf8'), {}, true, warnings);
            assert.deepStrictEqual(Object.values(c.devices).filter((d) => d.net).map((d) => d.label).sort(), ['clk', 'q', 'rst']);
            assert.deepStrictEqual(Object.keys(c.subcircuits), []);
            assert.deepStrictEqual(warnings, ['several top-level modules (counter, helper): counter is shown']);
        } finally {
            fs.rmSync(tmp, { recursive: true, force: true });
        }
    });
    // opt_clean sweeps from the outputs: a top without any (micro's
    // datapath, whose effect is its registers and memory) lost every cell
    it('keeps the cells of a top without outputs', async function () {
        this.timeout(120000);
        const { slangAvailable, designs, synthesize, convert } = await import('./designs.mjs');
        if (!slangAvailable()) this.skip();
        const d = designs.find((d) => d.name === 'micro');
        for (const optimize of [false, true]) {
            const found = convert(synthesize(d, { optimize, top: undefined })).toString();
            assert.ok(Object.keys(JSON.parse(found).devices).length > 20, `optimize: ${optimize}`);
            assert.strictEqual(found, convert(synthesize(d, { optimize })).toString(), `optimize: ${optimize}`);
        }
    });
});

describe('synthesis diagnostics (the Problems panel)', function () {
    it("reads slang's and read_verilog's messages, with the marked range", async function () {
        const { log_diagnostics } = await import('../src/diagnostics.mjs');
        const log = [
            '1. Executing SLANG frontend.',
            'width.sv:2:14: warning: implicit conversion truncates from 4 to 2 bits [-Wwidth-trunc]',
            '  assign y = a;',
            '           ~ ^',
            'core/alu.sv:7:17: error: expected expression',
            'Build failed: 1 error, 1 warning',
            "syntax.sv:2: ERROR: syntax error, unexpected ';'",
            'ERROR: Design elaboration failed; see full log for details',
        ].join('\n');
        assert.deepStrictEqual(log_diagnostics(log), [
            { file: 'width.sv', line: 2, col: 12, end: 15, severity: 'warning', source: 'slang',
              message: 'implicit conversion truncates from 4 to 2 bits', code: '-Wwidth-trunc' },
            { file: 'core/alu.sv', line: 7, col: 17, end: 18, severity: 'error', source: 'slang',
              message: 'expected expression', code: undefined },
            { file: 'syntax.sv', line: 2, severity: 'error', source: 'yosys', message: "syntax error, unexpected ';'" },
        ]);
    });
    it("reads read_verilog's refusal of an always_comb that makes a latch", async function () {
        const { log_diagnostics } = await import('../src/diagnostics.mjs');
        const [d] = log_diagnostics("ERROR: Latch inferred for signal `\\comb.\\q' from always_comb process `\\comb.$proc$core/latches.sv:12$7'.");
        assert.deepStrictEqual([d.file, d.line, d.col, d.severity, d.code, d.message.split(' ')[0]], ['core/latches.sv', 12, undefined, 'error', 'latch', 'q']);
    });
    // a latch by mistake (a block that doesn't assign q in every case), not
    // one on purpose (always_latch) nor a loop of gates (an SR latch);
    // always_comb last: read_verilog refuses it (above)
    const latches = `module star(input logic en, d, output logic q);
  always @(*)
    if (en) q = d;
endmodule
module on_purpose(input logic en, d, output logic q);
  always_latch
    if (en) q = d;
endmodule
module sr(input logic s, r, output logic q, qn);
  assign q = ~(r | qn);
  assign qn = ~(s | q);
endmodule
module comb(input logic en, d, output logic q);
  always_comb
    if (en) q = d;
endmodule
`;
    for (const frontend of ['slang', 'read_verilog']) {
        it(`finds the latches made by mistake in the netlist (${frontend})`, async function () {
            const { slangSupport } = await import('./designs.mjs');
            const { latch_diagnostics } = await import('../src/diagnostics.mjs');
            const useSlang = frontend === 'slang' && slangSupport();
            if (frontend === 'slang' && !useSlang) this.skip();
            const source = useSlang ? latches : latches.slice(0, latches.indexOf('module comb'));
            const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hdl-test-'));
            try {
                fs.writeFileSync(path.join(tmp, 'latches.sv'), source);
                for (const opts of [{}, { optimize: true }, { optimize: true, techmap: true }]) {
                    fs.writeFileSync(path.join(tmp, 'synth.ys'), build_yosys_script({ 'latches.sv': '' }, { useSlang, ...opts }) + '\njson -o out.json');
                    execFileSync('yosys', ['-q', '-s', 'synth.ys'], { cwd: tmp, stdio: 'pipe' });
                    const diags = latch_diagnostics(JSON.parse(fs.readFileSync(path.join(tmp, 'out.json'), 'utf8')), { 'latches.sv': source });
                    // always @(*): its block; always_comb: the `if`
                    assert.deepStrictEqual(diags.map((d) => [d.line, d.severity, d.message.split(' ')[0]]).sort((a, b) => a[0] - b[0]),
                                           [[2, 'warning', 'q'], ...(useSlang ? [[15, 'warning', 'q']] : [])], JSON.stringify(opts));
                }
            } finally {
                fs.rmSync(tmp, { recursive: true, force: true });
            }
        });
    }
});

describe('Lua test scripts (the Testing view)', function () {
    this.timeout(60000);
    it('reads the tests a script declares, and where an error points', async function () {
        const { lua_test_names, error_line, isLuaTest } = await import('../src/lua_tests.mjs');
        const text = 'local n = 1\ntest("a b", function () end)\n  test(\'it\\\'s\', f)\n-- test("commented")\nfoo.test("method")\n';
        assert.deepStrictEqual(lua_test_names(text), [{ name: 'a b', line: 1 }, { name: "it's", line: 2 }]);
        assert.strictEqual(error_line('counter_test.lua:12: count is 4', 'counter_test.lua'), 12);
        assert.strictEqual(error_line('other.lua:3: no', 'counter_test.lua'), undefined);
        assert.deepStrictEqual(['counter_test.lua', 'counter_sim.lua'].map(isLuaTest), [true, false]);
    });
    it('runs each test alone on a fresh simulation', async function () {
        const zlib = await import('zlib');
        const { run_lua_tests } = await import('../src/lua_tests.mjs');
        const { circuit } = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(__dirname, 'golden/04_counter.t.json.gz'))));
        const run = async (script, label, opts = {}) => {
            const results = [];
            const names = await run_lua_tests({ circuit, script, label, ...opts }, (r) => results.push(r));
            return { names, results: results.map((r) => [r.test, r.ok, r.error ?? null]) };
        };
        // the example: each test resets, so their order doesn't matter
        const example = fs.readFileSync(path.join(verilogDir, '04_counter/counter_test.lua'), 'utf8');
        const names = ['arranca en 0 despues del reset', 'cuenta cada flanco de subida', 'vuelve a 0 despues de 15'];
        assert.deepStrictEqual(await run(example, 'counter_test.lua'), { names, results: names.map((n) => [n, true, null]) });
        // a failure, names built at run time, one that waits for ever (up to the tick limit)
        const bad = 'sim.setinput("rst", true)\n' +
                    'test("fails", function () assert(false, "nope") end)\n' +
                    'for i = 1, 2 do test("case " .. i, function () end) end\n' +
                    'test("waits", function () sim.wait(sim.posedge("rst")) end)\n';
        const r = await run(bad, 'bad_test.lua', { maxTicks: 10000 });
        assert.deepStrictEqual(r.names, ['fails', 'case 1', 'case 2', 'waits']);
        assert.deepStrictEqual(r.results.slice(0, 3), [['fails', false, 'bad_test.lua:2: nope'], ['case 1', true, null], ['case 2', true, null]]);
        assert.match(r.results[3][2], /^still waiting .* at tick \d+: the tick limit \(10000\)/);
        // no tests: the script is one; an error outside the tests fails it
        assert.deepStrictEqual(await run('assert(sim.getoutput("count"))', 'plain_test.lua'), { names: [], results: [[null, true, null]] });
        assert.deepStrictEqual((await run('test("x", function () end)\nerror("setup")', 'x_test.lua')).results, [[null, false, 'x_test.lua:2: setup']]);
    });
});

describe('techmap on the multi-file designs', function () {
    this.timeout(180000);
    // the board once failed with "Invalid cell type: $fa": yosys left the
    // adders' $alu/$fa/$lcu cells unmapped (not seen since yosys 0.68)
    const cases = [['micro'], ['alu'], ['soc board'], ['soc board', { top: undefined }]];
    for (const [name, override] of cases) {
        it(`${name}${override ? ' (top found by yosys)' : ''}: maps the adders to gates and converts`, async function () {
            const { slangAvailable, designs, synthesize, convert } = await import('./designs.mjs');
            if (!slangAvailable()) this.skip();
            const d = { ...designs.find((d) => d.name === name), ...override };
            for (const optimize of [false, true]) {
                const json = synthesize(d, { techmap: true, optimize });
                const types = Object.values(JSON.parse(json).modules).flatMap((m) => Object.values(m.cells).map((c) => c.type));
                assert.deepStrictEqual(types.filter((t) => ['$alu', '$fa', '$lcu', '$add', '$sub'].includes(t)), [], `optimize: ${optimize}`);
                assert.ok(Object.keys(JSON.parse(convert(json)).devices).length > 0);
            }
        });
    }
});

// A project synthesizes what it lists, not its folder: a module used but not
// listed fails only in the extension ("unknown module").
describe('Example projects (.hdls)', function () {
    this.timeout(120000);
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true })
        .flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.hdls') ? [path.join(d, e.name)] : []);
    for (const p of walk(verilogDir)) {
        it(`${path.relative(verilogDir, p)} lists every source it needs`, async function () {
            const { slangAvailable, synthesize } = await import('./designs.mjs');
            if (!slangAvailable()) this.skip();
            const project = JSON.parse(fs.readFileSync(p, 'utf8'));
            const files = project.sources.filter((s) => !s.deleted).map((s) => s.relpath);
            try {
                synthesize({ dir: path.dirname(p), files, top: project.options?.top || undefined });
            } catch (e) {
                assert.fail(String(e.stdout ?? '') + String(e.stderr ?? e.message));
            }
        });
    }
});
