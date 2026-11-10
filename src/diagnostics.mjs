//
'use strict';

// What a synthesis has to say about the sources, for the Problems panel:
// the frontends' own errors and warnings in yosys's log, and the latches the
// netlist shows. Kept free of the `vscode` module so tests can import it.
//
// A diagnostic: { file, line, col, end, severity: 'error' | 'warning',
// message, source, code }. `file` is the name yosys was given (the sources'
// display names once FileMap has unmapped them), `line` and `col` count from
// 1, `end` is the column after the last one (col and end undefined: the
// whole line).

// slang: `file:line:col: error: message [-Wflag]`, then the source line and
// a line of `^`/`~` under what it is about.
const SLANG = /^(.+?):(\d+):(\d+): (error|fatal error|warning): (.*?)(?: \[(-W[\w-]+)\])?$/;
const CARETS = /^ *[~^][~^ ]*$/;
// read_verilog: `file:line: ERROR: message` (no column)
const VERILOG = /^(.+?):(\d+): (ERROR|Warning): (.*)$/;
// read_verilog's proc refuses an always_comb that makes a latch; the place
// is in the process's name: `$proc$file:line$N`
const COMB_LATCH = /^ERROR: Latch inferred for signal `\\?[^']*?\.\\?([^'.]+)' from always_comb process `.*?\$proc\$(.+):(\d+)\$\d+'/;

export function log_diagnostics(log) {
    const lines = log.split(/\r?\n/);
    const out = [];
    for (let i = 0; i < lines.length; i++) {
        let m = SLANG.exec(lines[i]);
        if (m) {
            const d = { file: m[1], line: Number(m[2]), col: Number(m[3]), end: Number(m[3]) + 1,
                        severity: m[4] === 'warning' ? 'warning' : 'error', message: m[5],
                        source: 'slang', code: m[6] };
            // the marks under the source line: from the first to the last
            const carets = lines[i + 2];
            if (carets !== undefined && CARETS.test(carets) && carets.includes('^')) {
                d.col = Math.min(d.col, carets.search(/[~^]/) + 1);
                d.end = Math.max(d.end, carets.trimEnd().length + 1);
            }
            out.push(d);
            continue;
        }
        m = VERILOG.exec(lines[i]);
        if (m) {
            out.push({ file: m[1], line: Number(m[2]), severity: m[3] === 'ERROR' ? 'error' : 'warning',
                       message: m[4], source: 'yosys' });
            continue;
        }
        m = COMB_LATCH.exec(lines[i]);
        if (m)
            out.push({ file: m[2], line: Number(m[3]), severity: 'error', source: 'yosys', code: 'latch',
                       message: `${m[1]} isn't assigned in every case, so it would keep its value: a latch, ` +
                                'which always_comb forbids. ' + LATCH_HINT });
    }
    return out;
}

const LATCH_HINT = 'Give it a value in every branch (or a default at the top of the block); ' +
                   'for a latch on purpose, use always_latch.';

// `file:line.col[-line.col]`, the first of a yosys `src` attribute's |-separated places
function place(src) {
    const m = /^(.+?):(\d+)\.(\d+)(?:-(\d+)\.(\d+))?/.exec((src ?? '').split('|')[0]);
    if (!m) return;
    const p = { file: m[1], line: Number(m[2]), col: Number(m[3]) };
    if (m[4] && Number(m[4]) === p.line) p.end = Number(m[5]);
    return p;
}

const LATCH = /latch/i; // $dlatch, $adlatch, $dlatchsr, $_DLATCH_P_...
const MUX = new Set(['$mux', '$pmux', '$_MUX_']);

// A signal that keeps its value when a combinational block doesn't assign it
// is a latch. yosys shows one as a latch cell (`always @*`), or, through
// read_slang's `always_comb`, as a mux whose output feeds one of its own
// inputs. A latch written as one (`always_latch`) is left alone. `sources`:
// each file's text, by the name yosys was given.
export function latch_diagnostics(json, sources) {
    const out = [];
    const seen = new Set();
    for (const m of Object.values(json.modules ?? {})) {
        const nameOf = (bits) => {
            const named = Object.entries(m.netnames ?? {}).filter(([, n]) => !n.hide_name);
            for (const b of bits)
                for (const [name, n] of named)
                    if (n.bits.includes(b)) return name;
        };
        for (const c of Object.values(m.cells ?? {})) {
            const conn = c.connections ?? {};
            let held;
            if (LATCH.test(c.type)) {
                held = conn.Q;
            } else if (MUX.has(c.type)) {
                const ins = new Set([...(conn.A ?? []), ...(conn.B ?? [])].filter((b) => typeof b === 'number'));
                held = (conn.Y ?? []).filter((b) => ins.has(b));
                if (!held.length) continue;
            } else {
                continue;
            }
            const p = place(c.attributes?.src);
            if (!p) continue;
            const text = sources[p.file]?.split(/\r?\n/)[p.line - 1] ?? '';
            if (text.slice(p.col - 1).startsWith('always_latch')) continue;
            const name = nameOf(held ?? []) ?? 'a signal';
            const key = `${p.file}:${p.line}:${name}`;
            if (seen.has(key)) continue;
            seen.add(key);
            out.push({
                ...p, end: p.end ?? p.col + (/^\w+/.exec(text.slice(p.col - 1))?.[0].length || 1),
                severity: 'warning', source: 'HDL Studio', code: 'latch',
                message: `${name} isn't assigned in every case, so it keeps its value: a latch. ${LATCH_HINT}`,
            });
        }
    }
    return out;
}
