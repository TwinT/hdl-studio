//
'use strict';

// Builds the yosys synthesis script (everything except the final `json -o`).
// Kept free of the `vscode` module so it can be imported from tests as well as
// from the extension host.

import * as path from 'path';

export function build_yosys_script(files, opts = {}) {
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
