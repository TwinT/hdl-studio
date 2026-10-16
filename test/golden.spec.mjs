//
'use strict';

// The engine and the schematic against what digitaljs did, frozen in
// test/golden/ before digitaljs went away (by test/golden/freeze.mjs, in git
// history): per example and mode (t: transform, nt: none, dc: zero
// combinational delay), the converted circuit, a seeded stimulus, the
// end-of-tick trace and the ports of every cell; per Lua script (`file`, run
// as it is now), what it printed. Needs only the hdlstudio binary.
// `BLESS=1 npm run test:golden` rewrites the traces and Lua outputs from the
// engine, after an intended change (review what it changed).

import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import { hdlstudio_bin, set_hdlstudio_root } from '../src/hdlstudio_bin.mjs';
import { shape } from '../view/schematic/cells.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
set_hdlstudio_root(root);
const dir = path.join(root, 'test/golden');
const bless = !!process.env.BLESS;
const read = (file) => JSON.parse(zlib.gunzipSync(fs.readFileSync(file)));
const write = (file, data) => fs.writeFileSync(file, zlib.gzipSync(JSON.stringify(data), { level: 9 }));
const fixtures = (sub) => fs.readdirSync(path.join(dir, sub)).filter((f) => f.endsWith('.json.gz')).sort()
    .map((f) => path.join(dir, sub, f));

function inTmp(files, fn) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hdl-golden-'));
    try {
        for (const [name, data] of Object.entries(files)) fs.writeFileSync(path.join(tmp, name), data);
        return fn((name) => path.join(tmp, name));
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
}

function same(expected, actual) {
    const n = Math.max(expected.length, actual.length);
    for (let i = 0; i < n; i++)
        if (expected[i] !== actual[i])
            assert.fail(`differ at line ${i + 1}:\n  expected: ${expected[i]}\n  engine:   ${actual[i]}`);
}

describe('engine traces match the frozen ones (digitaljs)', function () {
    this.timeout(300000);
    for (const file of fixtures('.')) {
        it(path.basename(file, '.json.gz'), function () {
            const f = read(file);
            const trace = inTmp({ 'circuit.json': JSON.stringify(f.circuit), 'stimulus.json': JSON.stringify(f.stimulus) }, (p) =>
                execFileSync(hdlstudio_bin(), ['simtrace', ...(f.defaultcomb ? ['--defaultcomb'] : []), p('circuit.json'), p('stimulus.json'), String(f.ticks)],
                             { maxBuffer: 1 << 30 }).toString().trimEnd().split('\n'));
            if (bless) write(file, { ...f, trace });
            else same(f.trace, trace);
        });
    }
});

describe('schematic cell ports match the frozen ones (digitaljs)', function () {
    for (const file of fixtures('.').filter((f) => !f.endsWith('.dc.json.gz'))) {
        it(path.basename(file, '.json.gz'), function () {
            const { circuit, ports } = read(file);
            const subs = circuit.subcircuits ?? {};
            for (const [key, expected] of Object.entries(ports)) {
                const [type, id] = key.split('|');
                const device = (type ? subs[type] : circuit).devices[id];
                const actual = shape(device, type === '', subs).ports.map((p) => `${p.id}:${p.dir}:${p.bits}`).sort();
                assert.deepStrictEqual(actual, expected, `${key} ${device.type}`);
            }
        });
    }
});

describe('Lua scripts print what they did on digitaljs_lua', function () {
    this.timeout(300000);
    for (const file of fixtures('lua')) {
        it(path.basename(file, '.json.gz'), function () {
            const f = read(file);
            const source = fs.readFileSync(path.join(root, f.file), 'utf8');
            const output = inTmp({ 'circuit.json': JSON.stringify(f.circuit), 'script.lua': source }, (p) =>
                execFileSync(hdlstudio_bin(), ['lua', '--json', p('circuit.json'), p('script.lua'), '5000000'], { maxBuffer: 1 << 30 })
                    .toString().split('\n').filter(Boolean).map((l) => {
                        const e = JSON.parse(l);
                        return 'print' in e ? e.print : `ERROR: ${e.error}`;
                    }));
            assert.ok(f.output.length > 0, 'the script printed nothing');
            if (bless) write(file, { ...f, output });
            else assert.deepStrictEqual(output, f.output);
        });
    }
});
