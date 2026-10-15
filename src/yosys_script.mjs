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

// Where a data file must exist inside the synthesis directory so that a
// $readmemh/$readmemb finds it. The .sv sources are flattened into the root
// of that directory, so a bare reference (`"control_unit.hex"`, written
// relative to the source file) only resolves if the file is also at the
// root; a project-relative reference (`"core/control_unit.hex"`) needs the
// nested path. Write both. Exact names are written first by the caller, so
// an alias never shadows a file that really lives at the root.
export function data_file_paths(name) {
    const base = path.basename(name);
    return base === name ? [name] : [name, base];
}

export function build_yosys_script(files, opts = {}) {
    const cmds = ['design -reset'];

    if (opts.useSlang) {
        // slang elaborates the whole design as a unit, so unlike read_verilog it
        // doesn't care what order the files are given in (packages/interfaces
        // used by another file don't need to be read first).
        // --allow-toplevel-iface-ports: a top with an interface port (e.g. the
        // alu example's `alu_if.alu alu_io`) is an error in newer yosys-slang;
        // with it the interface is flattened into plain `alu_io.<signal>` ports.
        const topArg = opts.top ? ` --top ${opts.top}` : '';
        cmds.push(`read_slang --best-effort-hierarchy --allow-toplevel-iface-ports ${Object.keys(files).join(' ')}${topArg}`);
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

    if (opts.top) {
        // A module with no output ports (e.g. a CPU datapath whose only effect
        // is internal register/memory state) has nothing to anchor opt_clean's
        // reachable-from-outputs sweep below, so it silently loses all its
        // instantiated cells - and yosys2digitaljs's top-module detection (a
        // topsort over instantiation edges, not yosys's own `top` attribute)
        // then renders an arbitrary other now-orphaned module instead. Keep
        // the requested top's own contents alive across the opt passes.
        cmds.push(`select ${opts.top}/*`);
        cmds.push('setattr -set keep 1');
        cmds.push('select -clear');
    }

    cmds.push('proc');
    // Lowers $bwmux (per-bit select, e.g. a part-select write into a wide
    // register like `matrix[i*COLS+:COLS] <= d`) to $and/$or/$not:
    // yosys2digitaljs has no cell for it ("Invalid cell type: $bwmux").
    cmds.push('bwmuxmap');
    // Converts tri-state muxes (`assign x = en ? val : 'z;`) into $tribuf
    // cells with a genuine enable + high-Z output, instead of leaving them
    // as an inferred mux. yosys2digitaljs converts $tribuf directly (native
    // Z/4vl support), and a net with more than one driver - the norm for a
    // shared bus - gets merged via a synthesized TriMerge device.
    cmds.push('tribuf');
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
        // Exclude flip-flops, latches, memories and tri-state buffers: techmap
        // would lower them to gate-level primitives ($_DFF_P_, $_DLATCH_P_,
        // $_TBUF_, ...) that yosys2digitaljs cannot render. Keeping them coarse
        // leaves them as Dff/Dlatch/Memory/Tribuf.
        cmds.push('select *');
        cmds.push('select -del t:$dff t:$dffe t:$adff t:$adffe t:$aldff t:$aldffe ' +
                  't:$sdff t:$sdffe t:$sdffce t:$dffsr t:$dffsre ' +
                  't:$dlatch t:$adlatch t:$dlatchsr t:$sr t:$mem t:$mem_v2 t:$tribuf');
        cmds.push('techmap');
        cmds.push('select -clear');
        cmds.push(opts.optimize ? 'opt -full' : 'opt_clean');
    }

    return cmds.join('\n');
}
