//
'use strict';

// Simulated-time units for the control panel. digitaljs only knows ticks; the
// project's `timescale` option (e.g. "1ns") says how long one tick is.
// Kept free of `vscode` so the webview bundle and the tests can import it.

const units = [['fs', 1e-15], ['ps', 1e-12], ['ns', 1e-9], ['µs', 1e-6], ['ms', 1e-3], ['s', 1]];

// "1ns", "2.5 µs", "10us", "200" (no unit = ns) -> seconds; undefined if invalid or <= 0.
export function parseTime(str) {
    const m = /^\s*(\d+(?:\.\d*)?|\.\d+)(?:e([+-]?\d+))?\s*(fs|ps|ns|us|µs|ms|s)?\s*$/.exec(String(str));
    if (!m)
        return;
    const unit = (m[3] || 'ns').replace('us', 'µs');
    const sec = Number(m[1] + (m[2] ? 'e' + m[2] : '')) * units.find(([u]) => u === unit)[1];
    return sec > 0 ? sec : undefined;
}

// Biggest unit giving a value >= 1, 4 significant digits: 2e-7 -> "200 ns".
export function formatTime(sec) {
    if (sec === 0)
        return '0 s';
    let [unit, scale] = units[0];
    for (const [u, s] of units) {
        if (Math.abs(sec) >= s * (1 - 1e-9))
            [unit, scale] = [u, s];
    }
    return `${Number((sec / scale).toPrecision(4))} ${unit}`;
}

export function formatFreq(hz) {
    const [unit, scale] = [['GHz', 1e9], ['MHz', 1e6], ['kHz', 1e3]].find(([, s]) => hz >= s * (1 - 1e-9)) || ['Hz', 1];
    return `${Number((hz / scale).toPrecision(4))} ${unit}`;
}
