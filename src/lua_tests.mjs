//
'use strict';

// Lua test scripts (`*_test.lua`): `test(name, function () ... end)` calls,
// each run alone on a fresh simulation of the circuit by `hdlstudio lua
// --tests` (crates/hdlstudio/src/main.rs `lua_tests`). Kept free of the
// `vscode` module so tests can import it; src/test_explorer.mjs puts them in
// VS Code's Testing view.

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as child_process from 'child_process';
import * as readline from 'readline';
import { hdlstudio_bin } from './hdlstudio_bin.mjs';

export const isLuaTest = (file) => file.endsWith('_test.lua');

// The tests a script declares, by its text: `test("name", ...` at the start of
// a line. A name built at run time isn't seen here (the run reports it).
export function lua_test_names(text) {
    const out = [];
    text.split(/\r?\n/).forEach((l, line) => {
        const m = /^\s*test\s*\(\s*(["'])((?:\\.|(?!\1).)*)\1/.exec(l);
        if (m) out.push({ name: m[2].replace(/\\(.)/g, '$1'), line });
    });
    return out;
}

// Where an error message points in the script `label`: "label:12: ..." → 12.
export function error_line(message, label) {
    const m = new RegExp(`(?:^|\\s)${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:(\\d+):`).exec(message ?? '');
    return m ? Number(m[1]) : undefined;
}

// Runs the script's tests on `circuit`. `label`: the script's file name (its
// errors say "label:line:"). Calls `onResult` with each result as it comes:
// { test: name or null (the whole script), ok, error, prints, tick }; returns
// the names the script declared. `signal` (an AbortSignal) kills the run.
export function run_lua_tests({ circuit, script, label, defaultcomb = false, maxTicks = 10_000_000, signal }, onResult) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hdl-luatest-'));
    const done = () => fs.rmSync(tmp, { recursive: true, force: true });
    fs.writeFileSync(path.join(tmp, 'circuit.json'), JSON.stringify(circuit));
    fs.writeFileSync(path.join(tmp, label), script);
    const args = ['lua', '--tests', ...(defaultcomb ? ['--defaultcomb'] : []), 'circuit.json', label, String(maxTicks)];
    return new Promise((resolve, reject) => {
        let names = [];
        let stderr = '';
        const proc = child_process.spawn(hdlstudio_bin(), args, { cwd: tmp, signal });
        proc.stderr.on('data', (d) => stderr += d);
        readline.createInterface({ input: proc.stdout }).on('line', (line) => {
            let r;
            try {
                r = JSON.parse(line);
            } catch {
                return;
            }
            if (Array.isArray(r.tests)) names = r.tests;
            else onResult(r);
        });
        proc.on('error', (e) => {
            done();
            reject(e.code === 'ENOENT' ? new Error(`The HDL Studio engine is missing (${hdlstudio_bin()}).`) : e);
        });
        proc.on('close', (code) => {
            done();
            if (code === 0) resolve(names);
            else reject(new Error(stderr.trim() || `the engine exited with ${code}`));
        });
    });
}
