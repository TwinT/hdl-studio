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

    if (opts.techmap) {
        // Decompose complex cells into basic logic gates, then clean up.
        // Exclude flip-flops, latches and memories: techmap would lower them to
        // gate-level primitives ($_DFF_P_, $_DLATCH_P_, ...) that yosys2digitaljs
        // cannot render. Keeping them coarse leaves them as Dff/Dlatch/Memory.
        cmds.push('select *');
        cmds.push('select -del t:$dff t:$dffe t:$adff t:$adffe t:$aldff t:$aldffe ' +
                  't:$sdff t:$sdffe t:$sdffce t:$dffsr t:$dffsre ' +
                  't:$dlatch t:$adlatch t:$dlatchsr t:$sr t:$mem t:$mem_v2');
        cmds.push('techmap');
        cmds.push('select -clear');
        cmds.push(opts.optimize ? 'opt -full' : 'opt_clean');
    }

    return cmds.join('\n');
}
