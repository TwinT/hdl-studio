//
'use strict';
import * as vscode from 'vscode';
import * as path from 'path';
import * as child_process from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import { promisify } from 'util';
import { build_yosys_script, isHdlFile, data_file_paths } from './yosys_script.mjs';
import { convert_yosys_json } from './hdlstudio_bin.mjs';

const execFile = promisify(child_process.execFile);

let _outputChannel;
function yosysLog() {
    if (!_outputChannel)
        _outputChannel = vscode.window.createOutputChannel('HDL Studio (Yosys)');
    return _outputChannel;
}

async function slang_available(yosysBin) {
    try {
        const { stdout } = await execFile(yosysBin, ['-p', 'help read_slang']);
        return !stdout.includes('No such command');
    } catch {
        return false;
    }
}

const rand_prefix = 'hdls-IxU5De4QZDxUgn43Zwj1-_';
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

export async function run_yosys(files, options) {
    // Resolve yosys binary: use setting if defined, otherwise rely on PATH
    const config = vscode.workspace.getConfiguration('hdl-studio');
    const yosysBin = config.get('yosysPath') || 'yosys';
    const useSlang = await slang_available(yosysBin);

    // Write source files to a temp directory
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hdl-studio-'));
    const outputJson = path.join(tmpDir, 'output.json');
    const file_map = new FileMap();

    try {
        // Write each source file with a mapped name to avoid path issues
        const mappedFiles = {};
        const dataAliases = [];
        for (const [name, content] of Object.entries(files)) {
            if (!isHdlFile(name)) {
                // Data file (e.g. .hex/.mem read via $readmemh/$readmemb):
                // must exist on disk under its own (possibly nested) name for
                // yosys to find it, but must never be read_verilog'd, so it's
                // kept out of mappedFiles/FileMap entirely. Its bare-name
                // alias (see data_file_paths) is written after all exact names.
                const [exact, alias] = data_file_paths(name);
                const fullPath = path.join(tmpDir, exact);
                if (!fullPath.startsWith(tmpDir + path.sep)) {
                    throw { error: `Refusing to write source "${name}" outside the synthesis directory.` };
                }
                fs.mkdirSync(path.dirname(fullPath), { recursive: true });
                fs.writeFileSync(fullPath, content);
                if (alias) dataAliases.push([alias, content]);
                continue;
            }
            const ext = path.extname(name);
            const pre_ext = name.substring(0, name.length - ext.length);
            const mappedName = file_map.map_name(pre_ext) + ext;
            const fullPath = path.join(tmpDir, mappedName);
            fs.writeFileSync(fullPath, content);
            mappedFiles[mappedName] = content;
        }

        for (const [alias, content] of dataAliases) {
            const aliasPath = path.join(tmpDir, alias);
            if (!fs.existsSync(aliasPath)) fs.writeFileSync(aliasPath, content);
        }

        const script = build_yosys_script(mappedFiles, { ...options, useSlang }) + `\njson -o ${outputJson}`;
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
            const raw = file_map.unmap_string(fs.readFileSync(outputJson, 'utf8'));
            return { output: convert_yosys_json(raw, options) };
        } catch (e) {
            // Yosys ran fine but the netlist couldn't be converted (e.g. a testbench
            // with no synthesizable top, $display, delays, etc.). Surface the real error.
            log.appendLine('\n--- netlist conversion error ---');
            log.appendLine(e.stack || String(e));
            log.show(true);
            throw { error: `${e.message || e}. See the "HDL Studio (Yosys)" output panel for the full log.` };
        }

    } finally {
        // Clean up temp dir
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
}
