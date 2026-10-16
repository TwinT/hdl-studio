// What each cell looks like: its ports, size and SVG drawing, and how the
// drawing follows the simulation. The geometry is digitaljs's (same sizes,
// port positions and leads), so a layout saved by either UI works in the
// other: a device's `position` is its body's top-left corner.

import { level, levelColor, show, xes, read as readValue } from './values';

export interface Point { x: number; y: number }
export interface End { id: string; port: string }
// A device as the circuit JSON has it (hdlstudio-netlist's serde form).
export interface Device {
    type: string; label?: string; net?: string; order?: number; bits?: any;
    celltype?: string; position?: Point; [k: string]: any;
}
export interface Connector { from: End; to: End; name?: string; vertices?: Point[]; source_positions?: any[] }
export interface GraphData { devices: Record<string, Device>; connectors: Connector[] }
export interface CircuitData extends GraphData { subcircuits?: Record<string, GraphData> }

export type Side = 'left' | 'right' | 'top' | 'bottom';
export interface Port {
    id: string; dir: 'in' | 'out'; bits: number; side: Side;
    ax: number; ay: number; // where the lead meets the body
    x: number; y: number; // the port circle, where wires attach
    label?: string; overline?: boolean; clock?: boolean; check?: boolean; idx?: number;
}

const SVG = 'http://www.w3.org/2000/svg';
export const FONT = 'verdana, sans-serif';

export function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, any> = {}, parent?: Element): SVGElementTagNameMap[K] {
    const e = document.createElementNS(SVG, tag);
    for (const k in attrs) e.setAttribute(k, String(attrs[k]));
    parent?.appendChild(e);
    return e;
}

export function text(parent: Element, x: number, y: number, s: string, attrs: Record<string, any> = {}) {
    const t = el('text', { x, y, 'font-size': '8pt', fill: 'black', ...attrs }, parent);
    t.textContent = s;
    return t;
}

const canvas = document.createElement('canvas').getContext('2d')!;
export function textWidth(s: string, font = `8pt ${FONT}`) {
    canvas.font = font;
    return canvas.measureText(s).width;
}

const inputTypes = new Set(['Input', 'Button', 'NumEntry', 'PushButton']);
const outputTypes = new Set(['Output', 'Lamp', 'NumDisplay']);
export const isInput = (d: Device) => inputTypes.has(d.type);
export const isOutput = (d: Device) => outputTypes.has(d.type) || d.type === 'Display7' || d.type === 'LEDMatrix';
// ELK puts these in the first/last layer (digitaljs's instanceof Input/Clock/Output).
export const layer = (d: Device) => isInput(d) || d.type === 'Clock' ? 'FIRST' : outputTypes.has(d.type) ? 'LAST' : 'NONE';

const gatePaths: Record<string, string> = {
    and: 'M19 0v32h16c9 0 16-7 16-16S44 0 35 0H20z',
    or: 'M14.3 0l1.6 2s4.5 5.6 4.5 14s-4.5 14-4.5 14l-1.6 2H28c3.8 0 16.6-.5 25-16h0A28 28 0 0028 0H16.8z',
    buf: 'M18-2v36l2-1 32-17h0L20-1z',
};
const xorArc = 'M6.8-1.2 10 2.7S14.2 8 14.2 16S10 29.3 10 29.3l-3.2 3.9H10l1.7-2.4s4.8-6 4.8-14.8c0-8.9-4.8-14.8-4.8-14.8l-1.7-2.4z';
// [shape, xor arc, negation bubble]
const gates: Record<string, [string, boolean, boolean]> = {
    Not: ['buf', false, true], Repeater: ['buf', false, false], Tribuf: ['buf', false, false],
    And: ['and', false, false], Nand: ['and', false, true], Or: ['or', false, false], Nor: ['or', false, true],
    Xor: ['or', true, false], Xnor: ['or', true, true],
    AndReduce: ['and', false, false], NandReduce: ['and', false, true], OrReduce: ['or', false, false],
    NorReduce: ['or', false, true], XorReduce: ['or', true, false], XnorReduce: ['or', true, true],
};
const arithSymbols: Record<string, string> = {
    Negation: '-', UnaryPlus: '+', Addition: '+', Subtraction: '-', Multiplication: '×', Division: '÷',
    Modulo: '%', Power: '^', ShiftLeft: '≪', ShiftRight: '≫', Lt: '<', Le: '≤', Gt: '>', Ge: '≥', Eq: '=', Ne: '≠',
};
const clockDecor = 'M0 -6 L6 0 L0 6';
const checkDecor = 'M2 0 L5 5 L10 -5';

type Spec = { id: string; bits: number; label?: string; overline?: boolean; clock?: boolean; idx?: number };

// Ports spread along a side like jointjs's left/right layouts, or stacked
// every 16 (digitaljs's _getStackedPosition). `inset` is where the lead
// starts inside the body, `lead` how far out the circle is from there.
function side(specs: Spec[], s: 'left' | 'right', dir: 'in' | 'out', w: number, h: number,
              { stacked = false, inset = 0, lead = 25, dy = 0 } = {}): Port[] {
    return specs.map((sp, i) => {
        const ay = (stacked ? (i + (sp.idx ?? 0)) * 16 + 12 : Math.round(h * (i + 0.5) / specs.length)) + dy;
        const ax = s === 'left' ? inset : w - inset;
        return { ...sp, dir, side: s, ax, ay, x: s === 'left' ? ax - lead : ax + lead, y: ay };
    });
}

const n = (v: any, d = 1) => (typeof v === 'number' ? v : d);
const polLabel = (sp: Spec, pol: boolean | undefined) => ({ ...sp, overline: pol === false });

// IO mode: 0 inside a subcircuit, 1 a top-level bit, 2 a top-level bus.
export const ioMode = (d: Device, top: boolean) => (!top ? 0 : n(d.bits) === 1 ? 1 : 2);

export interface Shape {
    w: number; h: number; ports: Port[];
    labelY: number; // where the cell's label hangs from
    top?: string; // text above the body (a subcircuit's type)
    open?: boolean; // has a zoom icon (subcircuit, memory, FSM)
    splits?: number[]; // a memory's lines between its ports (in rows)
}

export function muxInputs(d: Device): (string | undefined)[] {
    const sel = d.bits?.sel ?? 1;
    if (d.type === 'Mux1Hot') return Array(sel + 1).fill(undefined);
    if (d.type === 'MuxSparse') return (d.default_input ? ['*'] : []).concat(d.inputs.map(String));
    return Array(1 << sel).fill(undefined);
}

export function ledLayout(rows: number, cols: number) {
    const pitch = Math.max(3, Math.min(14, (140 - 16) / Math.max(rows, cols)));
    return { pitch, r: pitch * 0.35, w: cols * pitch + 16, h: rows * pitch + 16 };
}

function labelsWidth(ports: Port[], dir: 'in' | 'out') {
    const ws = ports.filter((p) => p.dir === dir && p.label !== undefined).map((p) => textWidth(p.label!));
    return ws.length ? Math.max(...ws) : -5;
}
// digitaljs's _autoResizeBox: the widest label on each side + 25.
const autoWidth = (ports: Port[]) => labelsWidth(ports, 'in') + labelsWidth(ports, 'out') + 25;

export function subcircuitIOs(sub: GraphData) {
    const ios = Object.entries(sub.devices).filter(([, d]) => d.type === 'Input' || d.type === 'Output');
    ios.sort(([, a], [, b]) => (a.order ?? 0) - (b.order ?? 0) || (a.net ?? '').localeCompare(b.net ?? ''));
    return {
        inputs: ios.filter(([, d]) => d.type === 'Input').map(([id, d]) => ({ id, net: d.net!, bits: n(d.bits) })),
        outputs: ios.filter(([, d]) => d.type === 'Output').map(([id, d]) => ({ id, net: d.net!, bits: n(d.bits) })),
    };
}

export function shape(d: Device, top: boolean, subcircuits: Record<string, GraphData>): Shape {
    const t = d.type;
    const box = (w: number, h: number, ports: Port[], extra: Partial<Shape> = {}): Shape =>
        ({ w, h, ports, labelY: h + 3, ...extra });
    if (t in gates) {
        const bits = n(d.bits);
        if (t === 'Tribuf') {
            const ports = side([{ id: 'in', bits }], 'left', 'in', 60, 32, { inset: 30, lead: 50 })
                .concat(side([{ id: 'out', bits }], 'right', 'out', 60, 32, { inset: 30, lead: 50 }));
            ports.push({ id: 'en', dir: 'in', bits: 1, side: 'bottom', ax: 35, ay: 16, x: 35, y: 52 });
            return box(60, 52, ports);
        }
        const inputs = t.endsWith('Reduce') || t === 'Not' || t === 'Repeater' ? 1 : n(d.inputs, 2);
        const s = inputs === 1 ? 1 : inputs / 2;
        const w = 60 * s, h = 32 * s;
        const ins: Spec[] = inputs === 1 ? [{ id: 'in', bits }] : Array.from({ length: inputs }, (_, i) => ({ id: 'in' + (i + 1), bits }));
        const out = t.endsWith('Reduce') ? 1 : bits;
        return box(w, h, side(ins, 'left', 'in', w, h, { inset: 30 * s, lead: 30 * s + 20 })
            .concat(side([{ id: 'out', bits: out }], 'right', 'out', w, h, { inset: 30 * s, lead: 30 * s + 20 })));
    }
    if (t in arithSymbols || t.endsWith('Const')) {
        let w = 40;
        if (t.endsWith('Const')) w = 30 + String(d.constant).length * 10;
        const b = d.bits;
        const cmp = /^(Lt|Le|Gt|Ge|Eq|Ne)/.test(t);
        const ins: Spec[] = t.endsWith('Const') || t === 'Negation' || t === 'UnaryPlus'
            ? [{ id: 'in', bits: b.in }] : [{ id: 'in1', bits: b.in1 }, { id: 'in2', bits: b.in2 }];
        return box(w, w, side(ins, 'left', 'in', w, w, { inset: 10, lead: 35 })
            .concat(side([{ id: 'out', bits: cmp ? 1 : b.out }], 'right', 'out', w, w, { inset: 10, lead: 35 })));
    }
    switch (t) {
        case 'Mux': case 'Mux1Hot': case 'MuxSparse': {
            const labels = muxInputs(d);
            const h = labels.length * 16 + 8;
            const ins = labels.map((label, i) => ({ id: 'in' + i, bits: d.bits.in, label, check: true }));
            const ports = side(ins, 'left', 'in', 40, h).concat(side([{ id: 'out', bits: d.bits.in }], 'right', 'out', 40, h));
            ports.push({ id: 'sel', dir: 'in', bits: d.bits.sel, side: 'top', ax: 20, ay: 5, x: 20, y: -20 });
            return { w: 40, h, ports, labelY: h + 8 };
        }
        case 'Dff': {
            const bits = d.bits, pol = d.polarity ?? {};
            const ins: Spec[] = [];
            if (!d.no_data) ins.push({ id: 'in', bits, label: 'D' });
            if ('aload' in pol) ins.push({ id: 'ain', bits, label: 'AD' }, polLabel({ id: 'aload', bits: 1, label: 'aload' }, pol.aload));
            if ('clock' in pol) ins.push(polLabel({ id: 'clk', bits: 1, label: 'clk', clock: true }, pol.clock));
            if ('set' in pol) ins.push(polLabel({ id: 'set', bits, label: 'S' }, pol.set));
            if ('clr' in pol) ins.push(polLabel({ id: 'clr', bits, label: 'R' }, pol.clr));
            for (const [id, p] of [['srst', 'srst'], ['arst', 'arst'], ['en', 'enable']])
                if (p in pol) ins.push(polLabel({ id, bits: 1, label: id }, pol[p]));
            const h = Math.max(ins.length, 1) * 16 + 8;
            const ports = side(ins, 'left', 'in', 0, h, { stacked: true })
                .concat(side([{ id: 'out', bits, label: 'Q' }], 'right', 'out', 0, h, { stacked: true }));
            return place(box(autoWidth(ports), h, ports));
        }
        case 'Memory': {
            const ins: Spec[] = [], outs: Spec[] = [];
            let rows = 0, idx = 0;
            const splits: number[] = [];
            d.rdports.forEach((p: any, i: number) => {
                const pn = 'rd' + i;
                ins.push({ id: pn + 'addr', bits: d.abits, label: 'addr' });
                outs.push({ id: pn + 'data', bits: d.bits, label: 'data', idx });
                rows++;
                for (const [k, pk] of [['srst', 'srst_polarity'], ['arst', 'arst_polarity'], ['en', 'enable_polarity'], ['clk', 'clock_polarity']])
                    if (pk in p) {
                        rows++; idx++;
                        ins.push(polLabel({ id: pn + k, bits: 1, label: k, clock: k === 'clk' }, p[pk]));
                    }
                splits.push(rows);
            });
            d.wrports.forEach((p: any, i: number) => {
                const pn = 'wr' + i;
                ins.push({ id: pn + 'data', bits: d.bits, label: 'data' }, { id: pn + 'addr', bits: d.abits, label: 'addr' });
                rows += 2;
                if ('enable_polarity' in p) { rows++; ins.push(polLabel({ id: pn + 'en', bits: p.no_bit_enable ? 1 : d.bits, label: 'en' }, p.enable_polarity)); }
                if ('clock_polarity' in p) { rows++; ins.push(polLabel({ id: pn + 'clk', bits: 1, label: 'clk', clock: true }, p.clock_polarity)); }
                splits.push(rows);
            });
            splits.pop();
            const h = rows * 16 + 8;
            // data outputs line up with their read port's address (idx)
            const ports = side(ins, 'left', 'in', 0, h, { stacked: true })
                .concat(side(outs, 'right', 'out', 0, h, { stacked: true }));
            return place(box(autoWidth(ports), h, ports, { open: true, splits }));
        }
        case 'FSM': {
            const pol = d.polarity;
            const ins: Spec[] = [{ id: 'in', bits: d.bits.in, label: 'in' },
                polLabel({ id: 'clk', bits: 1, label: 'clk', clock: true }, pol.clock),
                polLabel({ id: 'arst', bits: 1, label: 'arst' }, pol.arst)];
            const h = 3 * 16 + 8;
            const ports = side(ins, 'left', 'in', 0, h, { stacked: true })
                .concat(side([{ id: 'out', bits: d.bits.out, label: 'out' }], 'right', 'out', 0, h, { stacked: true }));
            return place(box(autoWidth(ports), h, ports, { open: true }));
        }
        case 'BusSlice': {
            const s = d.slice;
            const label = s.count === 1 ? String(s.first) : `${s.first}-${s.first + s.count - 1}`;
            const ports = side([{ id: 'in', bits: s.total }], 'left', 'in', 0, 24)
                .concat(side([{ id: 'out', bits: s.count, label }], 'right', 'out', 0, 24));
            return place(box(autoWidth(ports), 24, ports));
        }
        case 'BusGroup': {
            let bits = 0;
            const ins = d.groups.map((g: number, i: number) => {
                const label = String(bits) + (g > 1 ? '-' + (bits + g - 1) : '');
                bits += g;
                return { id: 'in' + i, bits: g, label };
            });
            const h = d.groups.length * 16 + 8;
            const ports = side(ins, 'left', 'in', 0, h).concat(side([{ id: 'out', bits }], 'right', 'out', 0, h));
            return place(box(autoWidth(ports), h, ports));
        }
        case 'ZeroExtend': case 'SignExtend': {
            const w = textWidth(t === 'ZeroExtend' ? 'zero-extend' : 'sign-extend') + 10;
            return box(w, 30, side([{ id: 'in', bits: d.extend.input }], 'left', 'in', w, 30)
                .concat(side([{ id: 'out', bits: d.extend.output }], 'right', 'out', w, 30)));
        }
        case 'TriMerge': {
            const h = d.inputs * 16 + 8;
            const ins = Array.from({ length: d.inputs }, (_, i) => ({ id: 'in' + i, bits: d.bits }));
            return box(10, h, side(ins, 'left', 'in', 10, h).concat(side([{ id: 'out', bits: d.bits }], 'right', 'out', 10, h)));
        }
        case 'Subcircuit': {
            const { inputs, outputs } = subcircuitIOs(subcircuits[d.celltype!] ?? { devices: {}, connectors: [] });
            const h = Math.max(inputs.length, outputs.length) * 16 + 8;
            const ports = side(inputs.map((io) => ({ id: io.net, bits: io.bits, label: io.net })), 'left', 'in', 0, h)
                .concat(side(outputs.map((io) => ({ id: io.net, bits: io.bits, label: io.net })), 'right', 'out', 0, h));
            return place(box(autoWidth(ports), h, ports, { top: d.celltype, open: true }));
        }
        case 'Constant': {
            const w = textWidth('0'.repeat(d.constant.length), '10px monospace') + 20;
            return box(w, 30, side([{ id: 'out', bits: d.constant.length }], 'right', 'out', w, 30));
        }
        case 'Clock':
            return box(30, 30, side([{ id: 'out', bits: 1 }], 'right', 'out', 30, 30));
        case 'Display7':
            return box(76.5, 110, side([{ id: 'in', bits: 8 }], 'left', 'in', 76.5, 110));
        case 'LEDMatrix': {
            const { w, h } = ledLayout(d.rows, d.cols);
            return box(w, h, side([{ id: 'in', bits: n(d.bits) }], 'left', 'in', w, h));
        }
    }
    if (isInput(d) || isOutput(d)) {
        const bits = n(d.bits), mode = ioMode(d, top);
        const w = mode === 0 ? textWidth(d.net ?? '', `bold 10pt ${FONT}`) + 10
            : mode === 1 ? 30 : textWidth('0'.repeat(bits), '10px monospace') + 20;
        const p = isInput(d) ? side([{ id: 'out', bits }], 'right', 'out', w, 30) : side([{ id: 'in', bits }], 'left', 'in', w, 30);
        return box(w, 30, p);
    }
    throw new Error(`Unknown cell type: ${t}`);
}

// Moves the right-hand ports of an auto-sized box onto its final width.
function place(s: Shape): Shape {
    for (const p of s.ports)
        if (p.side === 'right') { p.ax = s.w; p.x = s.w + 25; }
    return s;
}

// The drawing of one cell, with what changes while it runs.
export interface CellView {
    g: SVGGElement;
    // the port circles, recoloured with the port's value
    circles: Map<string, SVGCircleElement>;
    // redraws what shows a value: `value(port)` is an input's driver or an output
    update?(value: (port: string) => string): void;
}

export interface CellHooks {
    setInput(value: string): void;
    setParam(name: string, value: any): void;
    numbase(): string;
    setNumbase(base: string): void;
    open(): void;
}

function foreign(g: Element, x: number, y: number, w: number, h: number, cls: string) {
    const fo = el('foreignObject', { x, y, width: w, height: h, class: cls }, g);
    const div = document.createElement('div');
    fo.appendChild(div);
    return div;
}

function baseSelect(div: HTMLDivElement, bits: number, hooks: CellHooks) {
    const sel = document.createElement('select');
    for (const b of ['bin', 'dec', 'dec2c', 'hex', 'oct']) {
        if (b === 'dec2c' && bits === 0) continue;
        const o = document.createElement('option');
        o.value = o.textContent = b;
        sel.appendChild(o);
    }
    sel.value = hooks.numbase();
    sel.addEventListener('change', () => hooks.setNumbase(sel.value));
    div.appendChild(sel);
    return sel;
}

export function draw(d: Device, s: Shape, top: boolean, hooks: CellHooks): CellView {
    const t = d.type;
    const g = el('g', { class: 'cell' });
    const circles = new Map<string, SVGCircleElement>();
    const checks = new Map<string, SVGPathElement>();
    // leads, circles and port texts first: the body covers the leads
    for (const p of s.ports) {
        el('line', { x1: p.ax, y1: p.ay, x2: p.x, y2: p.y, stroke: '#4B4F6A' }, g);
        circles.set(p.id, el('circle', { cx: p.x, cy: p.y, r: 7, fill: 'white', stroke: levelColor.undef, 'stroke-width': 2, 'stroke-opacity': 0.5, class: 'port' }, g));
        if (p.bits > 1) {
            const left = p.side === 'left';
            text(g, p.side === 'top' ? p.x + 3 : left ? p.x + 8 : p.x - 8, p.y - 8, String(p.bits),
                 { 'font-size': '7pt', 'text-anchor': left || p.side === 'top' ? 'start' : 'end' });
        }
    }
    const body = el('g', { class: 'body' }, g);
    const rect = (attrs: Record<string, any> = {}) =>
        el('rect', { width: s.w, height: s.h, fill: 'white', stroke: 'black', 'stroke-width': 2, ...attrs }, body);
    let update: CellView['update'];
    if (t in gates) {
        const [kind, arc, neg] = gates[t];
        // only the multi-input gates are scaled (digitaljs's GateX1)
        const x1 = /^(N?And|N?Or|Xn?or)$/.test(t);
        const sc = x1 ? s.w / 60 : 1;
        const gg = el('g', x1 ? { transform: `translate(-4,0) scale(${sc})` } : {}, body);
        // 2px however the shape is scaled (digitaljs's non-scaling-stroke
        // also kept it at 2 screen pixels when zoomed out)
        const attrs = { stroke: 'black', 'stroke-width': 2 / sc };
        el('path', { d: gatePaths[kind], fill: 'white', ...attrs }, gg);
        if (arc) el('path', { d: xorArc, fill: 'black' }, gg);
        if (neg) el('circle', { cx: 56, cy: 16, r: 4, fill: 'white', ...attrs }, gg);
    } else if (t in arithSymbols || t.endsWith('Const')) {
        el('circle', { cx: s.w / 2, cy: s.h / 2, r: s.w / 2, fill: 'white', stroke: 'black', 'stroke-width': 2 }, body);
        let sym = arithSymbols[t.replace(/Const$/, '')];
        if (t.endsWith('Const')) sym = d.leftOp ? d.constant + sym : sym + d.constant;
        text(body, s.w / 2, s.h / 2, sym, { 'font-size': '12pt', 'text-anchor': 'middle', 'dominant-baseline': 'central' });
    } else if (t === 'Mux' || t === 'Mux1Hot' || t === 'MuxSparse') {
        el('polygon', { points: `0,-5 ${s.w},5 ${s.w},${s.h - 5} 0,${s.h + 5}`, fill: 'white', stroke: 'black', 'stroke-width': 2 }, body);
        if (t === 'Mux1Hot')
            text(body, 0, 0, '1Hot', { transform: `translate(${s.w / 2},${s.h / 2}) rotate(90)`, 'text-anchor': 'middle', 'dominant-baseline': 'central' });
        const inputs = muxInputs(d);
        update = (value) => {
            const sel = value('sel');
            let i: number | undefined;
            if (!/[xz]/.test(sel)) {
                if (t === 'Mux') i = parseInt(sel, 2);
                else if (t === 'Mux1Hot') {
                    const ones = [...sel].reverse().map((c, k) => (c === '1' ? k : -1)).filter((k) => k >= 0);
                    i = ones.length <= 1 ? (ones[0] ?? -1) + 1 : undefined;
                } else {
                    const k = d.inputs.map((x: number) => BigInt(x)).indexOf(BigInt('0b' + (sel || '0')));
                    i = k < 0 ? (d.default_input ? 0 : undefined) : d.default_input ? k + 1 : k;
                }
            }
            inputs.forEach((_, k) => checks.get('in' + k)?.setAttribute('visibility', k === i ? 'visible' : 'hidden'));
        };
    } else if (t === 'Display7') {
        rect({ fill: '#333333', stroke: '#222222' });
        const segs = ['1,1 2,0 8,0 9,1 8,2 2,2', '9,1 10,2 10,8 9,9 8,8 8,2', '9,9 10,10 10,16 9,17 8,16 8,10',
            '9,17 8,18 2,18 1,17 2,16 8,16', '1,17 0,16 0,10 1,9 2,10 2,16', '1,9 0,8 0,2 1,1 2,2 2,8', '1,9 2,8 8,8 9,9 8,10 2,10'];
        const leds = el('g', { transform: 'translate(1,1) scale(6)' }, body);
        // bit 7 is the decimal point, bits 6..0 segments a..g
        const parts = segs.map((p) => el('polygon', { points: p, fill: '#dddddd' }, leds) as SVGElement)
            .concat([el('circle', { cx: 11.3, cy: 16.9, r: 1.1, fill: '#dddddd' }, leds)]);
        update = (value) => {
            const v = value('in');
            parts.forEach((p, k) => p.setAttribute('fill', v[k === 7 ? 0 : k + 1] === '1' ? '#ff3b30' : '#dddddd'));
        };
    } else if (t === 'LEDMatrix') {
        rect({ fill: '#333333', stroke: '#222222' });
        const { pitch, r } = ledLayout(d.rows, d.cols);
        const leds: SVGCircleElement[] = [];
        let last = '';
        for (let i = 0; i < d.rows * d.cols; i++)
            leds.push(el('circle', { cx: 8 + pitch * (i % d.cols + 0.5), cy: 8 + pitch * (Math.floor(i / d.cols) + 0.5), r, fill: '#dddddd' }, body));
        // bit 0 (the last character) is the top-left LED, row-major
        update = (value) => {
            const v = value('in');
            for (let i = 0; i < leds.length; i++) {
                const on = v[v.length - 1 - i] === '1';
                if (on !== (last[last.length - 1 - i] === '1') || !last) leds[i].setAttribute('fill', on ? '#ff3b30' : '#dddddd');
            }
            last = v;
        };
    } else if (t === 'Clock') {
        rect();
        el('path', { d: 'M7.5 7.5 L7.5 22.5 L15 22.5 L15 7.5 L22.5 7.5 L22.5 22.5', stroke: 'black', fill: 'none' }, body);
        const div = foreign(g, 0, -30, Math.max(s.w, 55), 30, 'tooltip');
        const input = document.createElement('input');
        input.type = 'number'; input.min = '1'; input.step = '1';
        input.value = String(d.propagation ?? 100);
        input.addEventListener('input', () => {
            const ok = String(input.value) === String(Number(input.value));
            input.classList.toggle('invalid', !ok);
            if (ok) hooks.setParam('propagation', Number(input.value) || 1);
        });
        div.appendChild(input);
        update = () => { if (document.activeElement !== input) input.value = String(d.propagation ?? 100); };
    } else if (t === 'Constant') {
        rect();
        const v = text(body, s.w / 2, s.h / 2, show(hooks.numbase(), d.constant), { class: 'numvalue', 'text-anchor': 'middle', 'dominant-baseline': 'central' });
        update = () => { v.textContent = show(hooks.numbase(), d.constant); };
    } else if (isInput(d) || isOutput(d)) {
        rect();
        const mode = ioMode(d, top);
        const bits = n(d.bits);
        if (mode === 0) {
            text(body, s.w / 2, s.h / 2, d.net ?? '', { 'font-size': '10pt', 'font-weight': 'bold', 'text-anchor': 'middle', 'dominant-baseline': 'central' });
        } else if (mode === 1 && isInput(d)) {
            const face = el('rect', { x: 6, y: 6, width: 18, height: 18, fill: 'white', stroke: 'black', 'stroke-width': 2, class: 'button' }, body);
            let cur = '0';
            update = (value) => { cur = value('out'); face.setAttribute('fill', cur === '1' ? 'black' : 'white'); };
            face.addEventListener('pointerdown', (e) => e.stopPropagation()); // not a drag
            if (t === 'PushButton') {
                // high only while held
                face.addEventListener('pointerdown', () => hooks.setInput('1'));
                face.addEventListener('pointerup', () => hooks.setInput('0'));
                face.addEventListener('pointerleave', () => { if (cur === '1') hooks.setInput('0'); });
            } else {
                face.addEventListener('click', () => hooks.setInput(cur === '1' ? '0' : '1'));
            }
        } else if (mode === 1) {
            const led = el('circle', { cx: 15, cy: 15, r: 10.5, fill: '#bfc5c6' }, body);
            update = (value) => {
                const l = level(value('in'));
                led.setAttribute('fill', l === 'high' ? '#03c03c' : l === 'low' ? '#fc7c68' : l === 'highz' ? '#f39c12' : '#bfc5c6');
            };
        } else if (isInput(d)) {
            const div = foreign(g, 5, 5, s.w - 10, s.h - 10, 'valinput');
            const input = document.createElement('input');
            input.type = 'text';
            let cur = xes(bits);
            input.addEventListener('change', () => {
                const v = readValue(hooks.numbase(), input.value, bits);
                input.classList.toggle('invalid', v === undefined);
                if (v !== undefined) hooks.setInput(v);
            });
            input.addEventListener('wheel', (e) => {
                e.preventDefault(); e.stopPropagation();
                if (/[xz]/.test(cur)) return;
                const m = 1n << BigInt(bits);
                const next = (BigInt('0b' + cur) + (e.deltaY < 0 ? 1n : m - 1n)) % m;
                hooks.setInput(next.toString(2).padStart(bits, '0'));
            });
            div.appendChild(input);
            baseSelect(foreign(g, 0, -30, Math.max(s.w, 70), 30, 'tooltip'), bits, hooks);
            update = (value) => {
                cur = value('out');
                if (document.activeElement !== input) {
                    input.value = show(hooks.numbase(), cur);
                    input.classList.remove('invalid');
                }
            };
        } else {
            const v = text(body, s.w / 2, s.h / 2, '', { class: 'numvalue', 'text-anchor': 'middle', 'dominant-baseline': 'central' });
            baseSelect(foreign(g, 0, -30, Math.max(s.w, 70), 30, 'tooltip'), bits, hooks);
            update = (value) => { v.textContent = show(hooks.numbase(), value('in')); };
        }
    } else {
        rect();
        if (t === 'ZeroExtend' || t === 'SignExtend')
            text(body, s.w / 2, s.h / 2, t === 'ZeroExtend' ? 'zero-extend' : 'sign-extend', { 'text-anchor': 'middle', 'dominant-baseline': 'central' });
        for (const k of s.splits ?? [])
            el('line', { x1: 0, y1: 16 * k + 4, x2: s.w, y2: 16 * k + 4, stroke: 'black' }, body);
    }
    // port labels and decorations go over the body
    for (const p of s.ports) {
        if (p.clock) el('path', { d: clockDecor, transform: `translate(${p.ax},${p.ay})`, stroke: 'black', fill: 'none' }, g);
        if (p.check) checks.set(p.id, el('path', { d: checkDecor, transform: `translate(${p.ax},${p.ay})`, stroke: 'black', fill: 'none', visibility: 'hidden' }, g));
        if (p.label !== undefined) {
            const left = p.side === 'left';
            text(g, p.ax + (left ? (p.clock || p.check ? 10 : 5) : -5), p.ay, p.label,
                 { 'text-anchor': left ? 'start' : 'end', 'dominant-baseline': 'central', ...(p.overline ? { 'text-decoration': 'overline' } : {}) });
        }
    }
    if (d.label !== undefined) text(g, s.w / 2, s.labelY, d.label, { 'text-anchor': 'middle', 'dominant-baseline': 'hanging' });
    if (s.top !== undefined) text(g, s.w / 2, -10, s.top, { 'text-anchor': 'middle', 'dominant-baseline': 'central' });
    if (s.open) {
        const icon = el('g', { class: 'open', transform: `translate(${s.w - 14},${s.top !== undefined ? -34 : -20})` }, g);
        el('rect', { x: -2, y: -2, width: 16, height: 16, fill: 'white', stroke: '#888', rx: 2 }, icon);
        el('circle', { cx: 5, cy: 5, r: 4, fill: 'none', stroke: 'black', 'stroke-width': 1.5 }, icon);
        el('path', { d: 'M8 8 L12 12 M3 5 H7 M5 3 V7', stroke: 'black', 'stroke-width': 1.5 }, icon);
        const title = el('title', {}, icon);
        title.textContent = 'Open';
        icon.addEventListener('pointerdown', (e) => e.stopPropagation());
        icon.addEventListener('click', (e) => { e.stopPropagation(); hooks.open(); });
    }
    return { g, circles, update };
}

