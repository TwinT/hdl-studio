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
import { build_yosys_script, isHdlFile, data_file_paths } from '../src/yosys_script.mjs';
import { split_inout_ports } from '../src/inout_split.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const verilogDir = path.resolve(__dirname, 'verilog');

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
        const raw = JSON.parse(fs.readFileSync(outJson, 'utf8'));
        const output = yosys2digitaljs(split_inout_ports(raw), {});
        if (ui) io_ui(output);
        return output;
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
        const raw = JSON.parse(fs.readFileSync(outJson, 'utf8'));
        const output = yosys2digitaljs(split_inout_ports(raw), {});
        if (ui) io_ui(output);
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

describe('data_file_paths', function () {
    // The .sv sources are flattened to the synthesis dir root, so a $readmemh
    // with a bare name only finds a nested data file through its alias.
    it('adds a bare-name alias for a nested data file, nothing for a root one', function () {
        assert.deepStrictEqual(data_file_paths('control_unit.hex'), ['control_unit.hex']);
        assert.deepStrictEqual(data_file_paths('core/control_unit.hex'), ['core/control_unit.hex', 'control_unit.hex']);
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

    // `inout` ports: yosys2digitaljs only knows input/output, so
    // split_inout_ports() (src/inout_split.mjs) turns each inout P into an
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

    it('resolves a shared inout bus: one driver passes, none floats (no latch), two conflict', function () {
        const require = createRequire(import.meta.url);
        const { HeadlessCircuit } = require('../node_modules/digitaljs/lib/circuit.js');
        const { Vector4vl } = require('@twint/4vl');
        const circuit = new HeadlessCircuit(synth(path.join(verilogDir, '12_inout_bus', '12_inout_bus.sv'), {}, false));
        const set = (net, bin) => circuit.setInput(circuit.findInputByNet(net).id, Vector4vl.fromBin(bin));
        // updateGates() advances ONE tick; run to quiescence so a clock edge
        // never races the data it is meant to sample.
        const settle = () => { while (circuit.hasPendingEvents) circuit.updateGatesNext(); };
        const apply = (o) => { for (const [k, v] of Object.entries(o)) set(k, v); settle(); };
        const pulse = () => { apply({ clk: '1' }); apply({ clk: '0' }); };
        const seen = () => circuit.getOutput(circuit.findOutputByNet('seen').id).toBin();

        apply({ clk: '0', ld_a: '0', oe_a: '0', ld_b: '0', oe_b: '0', drive: '0', data: '0000' });
        // the outside world loads a.val through the top-level driver
        apply({ drive: '1', data: '0101', ld_a: '1' }); pulse();
        assert.strictEqual(seen(), '0101');
        // a drives the bus, b loads it from there (across the hierarchy)
        apply({ drive: '0', data: '0000', ld_a: '0', oe_a: '1', ld_b: '1' }); pulse();
        // nobody drives: floats, and must NOT keep the last driven value
        apply({ oe_a: '0', ld_b: '0' }); pulse();
        assert.strictEqual(seen(), 'zzzz', 'released bus must float, not hold its last value');
        // only b drives: proves b really loaded 0101 off the bus
        apply({ oe_b: '1' }); pulse();
        assert.strictEqual(seen(), '0101');
        // b and the external driver disagree: contention
        apply({ drive: '1', data: '1010' }); pulse();
        assert.strictEqual(seen(), 'xxxx');
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
    it('converts bmux_regfile.sv ($bmux) via the read_slang frontend', function () {
        const output = synth(path.join(verilogDir, 'bmux_regfile', 'bmux_regfile.sv'),
                              { useSlang: true, top: 'bmux_regfile' });
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
    // instantiated cells, and yosys2digitaljs's topsort-based top-detection
    // then picked whichever now-orphaned leaf module happened to sort last.
    // Fixed by keeping the requested top's contents alive across the opt
    // passes (see build_yosys_script's `if (opts.top)` block).
    it('keeps datapath.sv as top even though it has no output ports', function () {
        const output = synthDir(path.join(verilogDir, 'micro'), { useSlang: true, top: 'datapath' });
        for (const name of ['alu', 'branch_unit', 'control_unit', 'decoder', 'ir',
                             'load_unit', 'memory', 'pc', 'register_file', 'store_unit']) {
            const sub = Object.keys(output.subcircuits || {}).find((k) => k.startsWith(name + '$datapath.'));
            assert.ok(sub, `expected a "${name}" subcircuit under datapath, got none ` +
                            `(top devices: ${Object.keys(output.devices).join(', ')})`);
        }
    });

    // Regression: yosys keeps the width of an index expression, so a 32-bit
    // signal into a 16-word memory gives ABITS=32. Memory._calcaddr() (and a
    // constant << variable-amount ShiftConst, which the default `transform`
    // produces) used to hit toNumber()'s `bits < 32` assertion even for a=5,
    // killing the simulation. Both are exercised with and without transform.
    it('simulates a memory indexed by a 32-bit signal and a constant << 32-bit amount', function () {
        const require = createRequire(import.meta.url);
        const { HeadlessCircuit } = require('../node_modules/digitaljs/lib/circuit.js');
        const { transformCircuit } = require('../node_modules/digitaljs/lib/transform.js');
        const { Vector4vl } = require('@twint/4vl');
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hdl-wide-'));
        let base;
        try {
            const sv = path.join(dir, 'wide_idx.sv');
            fs.writeFileSync(sv, `
module wide_idx (
    input  logic        clk,
    input  logic [31:0] a,
    input  logic [7:0]  d,
    input  logic        we,
    output logic [7:0]  q,
    output logic [31:0] one_hot
);
    logic [7:0] mem [16];
    always_ff @(posedge clk) if (we) mem[a] <= d;
    assign q = mem[a];
    assign one_hot = 32'd1 << a;
endmodule
`);
            base = synth(sv, { useSlang: true, top: 'wide_idx' }, false);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }

        for (const transform of [false, true]) {
            const data = JSON.parse(JSON.stringify(base));
            const circuit = new HeadlessCircuit(transform ? transformCircuit(data) : data);
            if (transform)
                assert.ok(Object.values(circuit.toJSON().devices).some((d) => /ShiftLeftConst/.test(d.type)),
                          'transform should turn 1 << a into a ShiftLeftConst (leftOp), the other fixed site');
            const settle = () => { while (circuit.hasPendingEvents) circuit.updateGatesNext(); };
            const set = (net, bin) => circuit.setInput(circuit.findInputByNet(net).id, Vector4vl.fromBin(bin));
            const out = (net) => circuit.getOutput(circuit.findOutputByNet(net).id).toBin();
            const a32 = (n) => (n >>> 0).toString(2).padStart(32, '0');
            const where = `transform=${transform}`;

            set('clk', '0'); set('we', '1'); set('d', '10101011'); set('a', a32(5)); settle();
            set('clk', '1'); settle(); set('clk', '0'); settle(); set('we', '0'); settle();
            assert.strictEqual(out('q'), '10101011', `${where}: mem[5] should read back what was written`);
            assert.strictEqual(out('one_hot'), a32(1 << 5), `${where}: 1 << 5`);

            // |amount| >= the output width: all-fill, not an assertion
            set('a', a32(33)); settle();
            assert.strictEqual(out('one_hot'), a32(0), `${where}: 1 << 33`);
            set('a', a32(0x80000000)); settle();
            assert.strictEqual(out('one_hot'), a32(0), `${where}: 1 << 2^31`);
            assert.ok(!/[01]/.test(out('q')), `${where}: out-of-range address must read as undefined, got ${out('q')}`);
        }
    });

    // The micro's memory.hex used to be a 2-word placeholder: the CPU fetched
    // two zero words, then an uninitialized (x) one, and everything went x
    // forever. It now holds a small RV32I program (sum 5+4+3+2+1 in x2, store
    // it, load it back into x3, then spin on `jal x0, 0`). Runs the real
    // datapath headlessly: proves both .hex files load and the CPU executes.
    it('runs the micro/memory.hex program to completion (x2 = x3 = 15)', function () {
        const require = createRequire(import.meta.url);
        const { HeadlessCircuit } = require('../node_modules/digitaljs/lib/circuit.js');
        const { Vector4vl } = require('@twint/4vl');
        const output = synthDir(path.join(verilogDir, 'micro'), { useSlang: true, top: 'datapath' }, false);
        const circuit = new HeadlessCircuit(output);
        // updateGates() advances ONE tick; run to quiescence instead.
        const settle = () => { while (circuit.hasPendingEvents) circuit.updateGatesNext(); };
        const set = (net, bin) => circuit.setInput(circuit.findInputByNet(net).id, Vector4vl.fromBin(bin));
        const tick = () => { set('clk', '1'); settle(); set('clk', '0'); settle(); };
        set('clk', '0'); set('rst', '1'); settle(); tick(); tick(); set('rst', '0'); settle();
        for (let i = 0; i < 100; i++) tick();

        const regs = {};
        (function walk(graph) {
            for (const c of graph.getElements()) {
                if (c.get('type') !== 'Subcircuit') continue;
                const m = /^gen_regs\[(\d+)\]\.register/.exec(c.get('label') || '');
                const dff = m && c.get('graph').getElements().find((e) => e.get('type') === 'Dff');
                if (dff) regs[m[1]] = dff.get('outputSignals').out.toBin();
                else if (c.get('graph')) walk(c.get('graph'));
            }
        })(circuit._graph);
        const val = (r) => parseInt(regs[r], 2);
        assert.strictEqual(val(1), 0, `x1 (loop counter) should have counted down to 0, got ${regs[1]}`);
        assert.strictEqual(val(2), 15, `x2 (running sum) should be 5+4+3+2+1, got ${regs[2]}`);
        assert.strictEqual(val(3), 15, `x3 (loaded back from memory) should be 15, got ${regs[3]}`);
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

// digitaljs's cell operation() logic for z-input safety. Loads the compiled
// lib/ tree (CJS) directly: proven to construct real cell instances and call
// operation() in plain Node without a DOM, unlike importing the ESM src/
// tree (base.mjs pulls in @joint/core + tools.mjs, which need a real browser
// DOM). Locks in two representative patterns confirmed safe by direct
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

    // Regression: Tribuf.operation() reads this.get('bits'), but that only
    // works via a live Backbone model (this describe block's own instances,
    // and SynchEngine/HeadlessCircuit). The real webview runs WorkerEngine,
    // which reconstructs each cell from getGateParams() - a pick() of only
    // the keys listed in _gateParams - inside the worker. Tribuf originally
    // had no _gateParams override, so 'bits' silently became undefined
    // there: Vector4vl.zes(undefined) collapsed to a 0-bit vector instead of
    // an N-bit all-z one, corrupting every downstream TriMerge. This test
    // targets the actual mechanism (getGateParams()), not operation()'s
    // already-covered logic, so it fails the same way the real bug did.
    it('Tribuf includes bits in its gate params (needed by the Worker engine)', function () {
        const dev = new cells.Tribuf({ id: 't1', type: 'Tribuf', bits: 4 });
        assert.strictEqual(dev.getGateParams().bits, 4,
            'Tribuf.operation() reads this.get("bits"); if it is missing from ' +
            '_gateParams, WorkerEngine reconstructs the cell without it and ' +
            'operation() silently computes a 0-bit vector for a disabled driver');
    });

    // Regression: MuxSparse.initialize() used to mutate its own 'inputs'
    // attribute in place, converting every element from Number to BigInt
    // (needed so muxInput()'s .indexOf(i.toBigInt()) comparison works).
    // 'inputs' is listed in _gateParams, so getGateParams()/circuit.toJSON()
    // returned that same corrupted BigInt array - and view/main.mjs sends
    // circuit.toJSON() to the extension host via vscode.postMessage(), which
    // JSON.stringifies in the webview and throws "Do not know how to
    // serialize a BigInt" the moment any MuxSparse device exists (e.g. a
    // wide sparse case/dispatch, like control_unit.sv's opcode switch).
    // Fixed by keeping the BigInt-converted values in a private instance
    // field instead of mutating the serializable attribute.
    it('MuxSparse keeps inputs as plain Numbers in its gate params (JSON-serializable for postMessage)', function () {
        const dev = new cells.MuxSparse({
            id: 'm1', type: 'MuxSparse',
            bits: { in: 4, sel: 7 },
            inputs: [1, 2, 3],
            default_input: false
        });
        const params = dev.getGateParams();
        for (const v of params.inputs)
            assert.strictEqual(typeof v, 'number',
                'MuxSparse.initialize() must not mutate the serializable "inputs" ' +
                'attribute into BigInt - it gets sent to the webview via ' +
                'circuit.toJSON() -> postMessage, which JSON.stringifies and ' +
                'throws on BigInt');
        assert.deepStrictEqual(params.inputs, [1, 2, 3]);
        assert.doesNotThrow(() => JSON.stringify(params));
    });
});

// Regression: yosys can hand a Shift cell an amount wider than 32 bits (e.g.
// the 34-bit signed `$shift` behind `a[i*W +: W] <= d`), and Shift.operation()
// used to feed it to Vector4vl.toNumber(), which asserts bits < 32 - killing
// the whole simulation as soon as the amount became defined. Any |amount| >=
// max(in1, out) gives the same all-fill result, so the cell now saturates.
describe('digitaljs Shift saturates wide shift amounts', function () {
    const require = createRequire(import.meta.url);
    const cells = require('../node_modules/digitaljs/lib/cells.js');
    const { Vector4vl } = require('@twint/4vl');

    const shift = (Cell, n) => {
        const dev = new cells[Cell]({
            id: 's1', type: Cell,
            bits: { in1: 32, in2: 34, out: 1024 },
            signed: { in1: false, in2: true, out: false }
        });
        const amount = Vector4vl.fromBin(BigInt.asUintN(34, BigInt(n)).toString(2).padStart(34, '0'));
        const in1 = Vector4vl.fromBin('1111'.padStart(32, '0'));
        return dev.operation({ in1, in2: amount }).out.toBin();
    };
    const wide = (bin) => bin.padStart(1024, '0');

    it('still shifts by the exact amount when it is small (negative = reverse direction)', function () {
        assert.strictEqual(shift('ShiftRight', 0), wide('1111'));
        assert.strictEqual(shift('ShiftRight', 2), wide('11'));
        assert.strictEqual(shift('ShiftRight', -5), wide('111100000'));
        assert.strictEqual(shift('ShiftLeft', 5), wide('111100000'));
    });

    it('does not throw for amounts that need more than 32 bits, and gives all-fill', function () {
        const zeros = '0'.repeat(1024);
        assert.strictEqual(shift('ShiftRight', 2n ** 33n), zeros);
        assert.strictEqual(shift('ShiftRight', -(2n ** 33n)), zeros);
        assert.strictEqual(shift('ShiftLeft', 2n ** 33n), zeros);
    });
});

// Regression: digitaljs's paper-wide defaultRouter (index.js) assumes every
// wire leaves its source on the right and enters its target on the left -
// true for ordinary left-in/right-out gates, but wrong for a port whose own
// group sits on a different side, like Tribuf's bottom 'en' or Mux's top
// 'sel'. That mismatch forced an artificial elbow right at the port, which
// the paper's 'rounded' connector then rendered as a visible curve/loop.
// Wire._updateRouting() (cells/base.js) now sets a per-link router only when
// a port's side deviates from the default, leaving ordinary wiring alone.
describe('Wire per-link routing for non-default-side ports', function () {
    const require = createRequire(import.meta.url);
    const { HeadlessCircuit } = require('../node_modules/digitaljs/lib/circuit.js');

    it('routes a Tribuf en wire and Mux sel wire per their real port side, leaves ordinary wiring on the paper default', function () {
        const data = {
            devices: {
                d_in: { type: 'Not', bits: 4 }, d_en: { type: 'Not', bits: 1 },
                t1: { type: 'Tribuf', bits: 4 }, d_out: { type: 'Not', bits: 4 },
                d_sel: { type: 'Not', bits: 1 }, d_i0: { type: 'Not', bits: 4 },
                d_i1: { type: 'Not', bits: 4 }, m1: { type: 'Mux', bits: { in: 4, sel: 1 } }
            },
            connectors: [
                { from: { id: 'd_in', port: 'out' }, to: { id: 't1', port: 'in' } },
                { from: { id: 'd_en', port: 'out' }, to: { id: 't1', port: 'en' } },
                { from: { id: 't1', port: 'out' }, to: { id: 'd_out', port: 'in' } },
                { from: { id: 'd_sel', port: 'out' }, to: { id: 'm1', port: 'sel' } },
                { from: { id: 'd_i0', port: 'out' }, to: { id: 'm1', port: 'in0' } },
                { from: { id: 'd_i1', port: 'out' }, to: { id: 'm1', port: 'in1' } }
            ]
        };
        const circuit = new HeadlessCircuit(data);
        const wireTo = (id, port) => circuit._graph.getCells()
            .find((c) => c.isLink() && c.get('target').id === id && c.get('target').port === port);

        assert.strictEqual(wireTo('t1', 'in').router(), null,
            'ordinary left-entering wire must keep the paper default');
        assert.strictEqual(wireTo('d_out', 'in').router(), null,
            'ordinary left-entering wire must keep the paper default');
        assert.deepStrictEqual(wireTo('t1', 'en').router(),
            { name: 'metro', args: { startDirections: ['right'], endDirections: ['bottom'], maximumLoops: 200, step: 2.5 } });
        assert.deepStrictEqual(wireTo('m1', 'sel').router(),
            { name: 'metro', args: { startDirections: ['right'], endDirections: ['top'], maximumLoops: 200, step: 2.5 } });
    });
});

// Regression: Input._resetPortValue (cells/io.mjs) used to default a
// multi-bit NumEntry widget's initial value to Vector4vl.xes(bits) ('x'),
// while a single-bit Button already defaulted to Vector4vl.zeros(bits) ('0')
// - an inconsistency with no functional reason. Both now default to 0.
describe('Input widget (Button/NumEntry) initial value', function () {
    const require = createRequire(import.meta.url);
    const { HeadlessCircuit } = require('../node_modules/digitaljs/lib/circuit.js');

    it('a multi-bit NumEntry starts at all-zero, not all-x', function () {
        const circuit = new HeadlessCircuit({
            devices: { n1: { type: 'NumEntry', bits: 4, net: 'n1' } },
            connectors: []
        });
        const dev = circuit._graph.getCell('n1');
        assert.strictEqual(dev.get('outputSignals').out.toBin(), '0000');
    });

    it('a single-bit Button still starts at 0 (unchanged behavior)', function () {
        const circuit = new HeadlessCircuit({
            devices: { b1: { type: 'Button', bits: 1, net: 'b1' } },
            connectors: []
        });
        const dev = circuit._graph.getCell('b1');
        assert.strictEqual(dev.get('outputSignals').out.toBin(), '0');
    });
});

// A Verilog output port only has one bit-width - there's no way to recover
// two independent dimensions from it alone (64 bits could be 8x8 or 4x16).
// An LED matrix's rows/cols instead ride a pair of custom attributes on the
// port (led_matrix_rows/led_matrix_cols), which survive synthesis onto the
// port's backing wire (yosys2digitaljs core.js's "Add inputs/outputs" loop
// reads mod.netnames[pname].attributes, same technique already used there
// for a Dff's .initial value) and get picked up by io_ui().
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
            const output = yosys2digitaljs(raw, {});
            io_ui(output);
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
            const output = yosys2digitaljs(raw, {});
            io_ui(output);
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
            const output = yosys2digitaljs(raw, {});
            io_ui(output);
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
            const output = yosys2digitaljs(raw, {});
            io_ui(output);
            const dev = Object.values(output.devices).find((d) => d.net === 'btn');
            assert.strictEqual(dev.type, 'Button');
        } finally {
            fs.rmSync(tmp, { recursive: true, force: true });
        }
    });
});

// The PushButton cell itself (node_modules/digitaljs): press()/release()
// drive the output directly, unlike Button/Input's click-to-toggle
// toggleInput().
describe('PushButton cell press/release', function () {
    const require = createRequire(import.meta.url);
    const { HeadlessCircuit } = require('../node_modules/digitaljs/lib/circuit.js');

    it('is low at rest, high while pressed, low again on release', function () {
        const circuit = new HeadlessCircuit({
            devices: { p1: { type: 'PushButton', bits: 1, net: 'p1' } },
            connectors: []
        });
        const dev = circuit._graph.getCell('p1');
        assert.strictEqual(dev.get('outputSignals').out.toBin(), '0');
        dev.press();
        assert.strictEqual(dev.get('outputSignals').out.toBin(), '1');
        dev.release();
        assert.strictEqual(dev.get('outputSignals').out.toBin(), '0');
    });
});

// The LEDMatrix cell itself (node_modules/digitaljs): its LED grid is built
// once from rows/cols in initialize() (markup + per-LED attrs), not from a
// fixed template like Display7's - this is the part that makes "more LEDs"
// mean "smaller LEDs", not "a bigger widget" (see ledmatrix.mjs's
// computeLayout()).
describe('LEDMatrix cell layout and bit mapping', function () {
    const require = createRequire(import.meta.url);
    const { HeadlessCircuit } = require('../node_modules/digitaljs/lib/circuit.js');
    const { Vector4vl } = require('@twint/4vl');

    it('lays out one LED per bit, sized once from rows x cols', function () {
        const circuit = new HeadlessCircuit({
            devices: { m1: { type: 'LEDMatrix', rows: 4, cols: 4, bits: 16, net: 'matrix' } },
            connectors: []
        });
        const dev = circuit._graph.getCell('m1');
        // base box markup (body rect + label) + one circle per LED
        assert.strictEqual(dev.get('markup').length, 2 + 16);
        assert.ok(dev.get('attrs').led0_0, 'top-left LED should have computed attrs');
        assert.ok(dev.get('attrs').led3_3, 'bottom-right LED should have computed attrs');
    });

    it('a bigger grid gets a finer pitch instead of a bigger widget', function () {
        const makeMatrix = (rows, cols) => {
            const circuit = new HeadlessCircuit({
                devices: { m1: { type: 'LEDMatrix', rows, cols, bits: rows * cols, net: 'm' } },
                connectors: []
            });
            return circuit._graph.getCell('m1');
        };
        const small = makeMatrix(8, 8);
        const big = makeMatrix(32, 32);
        // both grids are capped to roughly the same footprint...
        assert.ok(Math.abs(small.get('size').width - big.get('size').width) < 20);
        // ...so the LED radius, not the widget, is what shrinks
        assert.ok(big.get('attrs').led0_0.r < small.get('attrs').led0_0.r);
    });

    it('reads back the bit-to-LED mapping (row-major, bit 0 = top-left)', function () {
        const circuit = new HeadlessCircuit({
            devices: { m1: { type: 'LEDMatrix', rows: 2, cols: 2, bits: 4, net: 'matrix' } },
            connectors: []
        });
        const dev = circuit._graph.getCell('m1');
        dev.set('inputSignals', { in: Vector4vl.fromBin('0010', 4) }); // bit 1 -> row0,col1
        const out = dev.getOutput();
        // Vector4vl.get() returns 1 for high, -1 for low (not 0/1) - matching
        // the same "=== 1" convention the cell's own view code uses to
        // decide a lit vs. unlit LED.
        assert.strictEqual(out.get(1), 1, 'bit 1 (row0,col1) should be high');
        assert.notStrictEqual(out.get(0), 1, 'bit 0 (row0,col0) should not be high');
    });
});

// A 4th visual state for Z in wire/lamp/waveform coloring. The coloring code
// itself lives in View classes that need a real DOM, so it can't be
// exercised directly here; this locks in the pure helper each patched
// ternary is keyed on instead.
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
