//
'use strict';

// The native engine binary (crates/hdlstudio). Kept free of the `vscode`
// module so tests can import it. It ships inside the vsix at the same path
// cargo builds it to (see .vscodeignore).

import * as path from 'path';
import * as child_process from 'child_process';

let root;

// The extension's install directory (context.extensionPath), or the repo root.
export function set_hdlstudio_root(dir) {
    root = dir;
}

export function hdlstudio_bin() {
    return path.join(root, 'target', 'release', process.platform === 'win32' ? 'hdlstudio.exe' : 'hdlstudio');
}

// yosys JSON netlist -> digitaljs circuit (split inout ports, convert,
// io_ui unless `ui` is false, then transform if asked).
export function convert_yosys_json(raw, options = {}, ui = true) {
    if (!child_process.execFileSync)
        throw new Error('Converting a yosys netlist needs the desktop version of the extension.');
    const args = ['yosys2hdlstudio'];
    if (options.transform) args.push('--transform');
    if (!ui) args.push('--no-io-ui');
    try {
        const out = child_process.execFileSync(hdlstudio_bin(), args, {
            input: typeof raw === 'string' ? raw : JSON.stringify(raw),
            maxBuffer: 1 << 30,
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        return JSON.parse(out);
    } catch (e) {
        if (e.code === 'ENOENT')
            throw new Error(`The HDL Studio engine is missing (${hdlstudio_bin()}). Run "npm run compile".`);
        // the converter's own message (e.g. "Invalid cell type: $foo")
        throw new Error(e.stderr?.toString().trim().split('\n').pop() || e.message);
    }
}
