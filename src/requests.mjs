//
'use strict';
import * as vscode from 'vscode';
import * as path from 'path';
import * as child_process from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import { promisify } from 'util';
import { yosys2digitaljs, io_ui } from 'yosys2digitaljs/core';
import * as digitaljs_transform from '../node_modules/digitaljs/src/transform.mjs';

const execFile = promisify(child_process.execFile);

let _outputChannel;
function yosysLog() {
    if (!_outputChannel)
        _outputChannel = vscode.window.createOutputChannel('HDL Studio (Yosys)');
    return _outputChannel;
}

const rand_prefix = 'djs-IxU5De4QZDxUgn43Zwj1-_';
const rand_suffix = '_-hbtdHFLoSvFPbPLnGSp8';
const match_regex = new RegExp(`${rand_prefix}(\\d+)${rand_suffix}`, 'g');

class FileMap {
    #names = []
    map_name(name) {
        const idx = this.#names.length;
        this.#names.push(name);
        return `${rand_prefix}${idx}${rand_suffix}`;
    }
    unmap_string(str) {
        return str.replaceAll(match_regex, (match, p1) => this.#names[parseInt(p1)]);
    }
}

function build_yosys_script(files, opts = {}) {
    const cmds = ['design -reset'];

    for (const [name, _] of Object.entries(files)) {
        const ext = path.extname(name);
        if (ext === '.sv') {
            cmds.push(`read_verilog -sv ${name}`);
        } else {
            cmds.push(`read_verilog ${name}`);
        }
    }

    cmds.push('hierarchy -auto-top');
    cmds.push('proc');
    cmds.push(opts.optimize ? 'opt' : 'opt_clean');

    if (opts.fsm && opts.fsm !== 'no') {
        const fsmexpand = opts.fsmexpand ? ' -expand' : '';
        cmds.push(opts.fsm === 'nomap' ? `fsm -nomap${fsmexpand}` : `fsm${fsmexpand}`);
    }

    cmds.push('memory -nomap');
    cmds.push('wreduce -memx');
    cmds.push(opts.optimize ? 'opt -full' : 'opt_clean');

    return cmds.join('\n');
}

export async function run_yosys(files, options) {
    // Resolve yosys binary: use setting if defined, otherwise rely on PATH
    const config = vscode.workspace.getConfiguration('hdl-studio');
    const yosysBin = config.get('yosysPath') || 'yosys';

    // Write source files to a temp directory
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hdl-studio-'));
    const outputJson = path.join(tmpDir, 'output.json');
    const file_map = new FileMap();

    try {
        // Write each source file with a mapped name to avoid path issues
        const mappedFiles = {};
        for (const [name, content] of Object.entries(files)) {
            const ext = path.extname(name);
            const pre_ext = name.substring(0, name.length - ext.length);
            const mappedName = file_map.map_name(pre_ext) + ext;
            const fullPath = path.join(tmpDir, mappedName);
            fs.writeFileSync(fullPath, content);
            mappedFiles[mappedName] = content;
        }

        const script = build_yosys_script(mappedFiles, options) + `\njson -o ${outputJson}`;
        const scriptPath = path.join(tmpDir, 'synth.ys');
        fs.writeFileSync(scriptPath, script);

        const log = yosysLog();
        log.clear();
        log.appendLine(file_map.unmap_string(script));
        log.appendLine('\n--- yosys output ---');

        try {
            const { stdout, stderr } = await execFile(yosysBin, ['-s', scriptPath], { cwd: tmpDir });
            log.append(file_map.unmap_string((stdout || '') + (stderr || '')));
        } catch (e) {
            if (e.code === 'ENOENT') {
                throw { error: `Yosys binary not found ("${yosysBin}"). Please make sure Yosys is installed and available in your PATH, or configure the "hdl-studio.yosysPath" setting.` };
            }
            log.append(file_map.unmap_string((e.stdout || '') + (e.stderr || '')));
            log.show(true);
            const errMsg = file_map.unmap_string(e.stderr || e.message || String(e));
            throw { error: errMsg };
        }

        try {
            const raw = JSON.parse(
                file_map.unmap_string(fs.readFileSync(outputJson, 'utf8'))
            );

            let output = yosys2digitaljs(raw, options);
            io_ui(output);

            if (options.transform)
                output = digitaljs_transform.transformCircuit(output);

            return { output };
        } catch (e) {
            // Yosys ran fine but the netlist couldn't be converted (e.g. a testbench
            // with no synthesizable top, $display, delays, etc.). Surface the real error.
            log.appendLine('\n--- yosys2digitaljs error ---');
            log.appendLine(e.stack || String(e));
            log.show(true);
            throw { error: `${e.message || e}. See the "HDL Studio (Yosys)" output panel for the full log.` };
        }

    } finally {
        // Clean up temp dir
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
}
