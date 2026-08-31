//
'use strict';

// Builds the yosys synthesis script (everything except the final `json -o`).
// Kept free of the `vscode` module so it can be imported from tests as well as
// from the extension host.

import * as path from 'path';

// Extensions read_verilog/read_slang can actually parse. Anything else added
// as a source (e.g. a .hex/.mem referenced by $readmemh/$readmemb) is a data
// file: it must exist on disk for yosys to find at elaboration time, but must
// never be passed to read_verilog/read_slang.
export const HDL_EXTENSIONS = new Set(['.v', '.sv']);
export function isHdlFile(name) {
    return HDL_EXTENSIONS.has(path.extname(name));
}

export function build_yosys_script(files, opts = {}) {
    const cmds = ['design -reset'];

    if (opts.useSlang) {
        // slang elaborates the whole design as a unit, so unlike read_verilog it
        // doesn't care what order the files are given in (packages/interfaces
        // used by another file don't need to be read first).
        const topArg = opts.top ? ` --top ${opts.top}` : '';
        cmds.push(`read_slang --best-effort-hierarchy ${Object.keys(files).join(' ')}${topArg}`);
    } else {
        for (const [name, _] of Object.entries(files)) {
            const ext = path.extname(name);
            if (ext === '.sv') {
                cmds.push(`read_verilog -sv -defer ${name}`);
            } else {
                cmds.push(`read_verilog -defer ${name}`);
            }
        }
        cmds.push(opts.top ? `hierarchy -top ${opts.top}` : 'hierarchy -auto-top');
    }

    cmds.push('proc');
    // yosys2digitaljs has no $tribuf cell type, so a tri-state output
    // (`assign x = en ? val : 'z;`) fails synthesis outright. `-formal`
    // converts every tristate buffer - including ones driving output ports -
    // into plain non-tristate logic (0 when disabled), which is all
    // digitaljs can represent anyway (it has no floating/shared-bus net).
    cmds.push('tribuf -formal');
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
