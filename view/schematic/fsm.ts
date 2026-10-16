// An FSM cell's state diagram, laid out by ELK: the current state is
// yellow, the transition it takes on the next clock edge green.

import ELK from 'elkjs/lib/elk.bundled.js';
import type { ElkExtendedEdge, ElkNode } from 'elkjs/lib/elk-api';
import { Device, el, text, textWidth } from './cells.ts';

interface Trans { id: string; from: number; to: number; ctrlIn: string; ctrlOut: string }

export function transitions(d: Device): Trans[] {
    return d.trans_table.map((t: any, i: number) => ({ id: 'tr' + i, from: t.state_in, to: t.state_out, ctrlIn: t.ctrl_in, ctrlOut: t.ctrl_out }))
        .filter((t: Trans) => t.from !== null && t.to !== null);
}

// The transition taken from `state` with input `input` (x bits of its
// condition are don't-cares).
export function nextTransition(trans: Trans[], state: number, input: string) {
    return trans.find((t) => t.from === state && [...t.ctrlIn].every((c, i) => c === 'x' || c === input[i]));
}

export async function fsmView(d: Device) {
    const trans = transitions(d);
    const label = (t: Trans) => `${t.ctrlIn}/${t.ctrlOut}`;
    const graph: ElkNode = {
        id: 'root',
        children: Array.from({ length: d.states }, (_, n) => ({ id: 'state' + n, width: 50, height: 50 })),
        edges: trans.map((t) => ({
            id: t.id, sources: ['state' + t.from], targets: ['state' + t.to],
            labels: [{ text: label(t), width: textWidth(label(t), '10px sans-serif'), height: 12 }],
        })),
        layoutOptions: { 'elk.algorithm': 'layered', 'elk.edgeRouting': 'POLYLINE', 'elk.spacing.edgeLabel': '4' },
    };
    const res = await new ELK().layout(graph);
    const svg = el('svg', { class: 'fsm', 'font-family': 'sans-serif' }) as SVGSVGElement;
    const defs = el('defs', {}, svg);
    for (const [id, color] of [['arrow', 'black'], ['arrow-next', '#03c03c']]) {
        const m = el('marker', { id, viewBox: '0 0 10 10', refX: 10, refY: 5, markerWidth: 8, markerHeight: 8, orient: 'auto-start-reverse' }, defs);
        el('path', { d: 'M0 0 L10 5 L0 10 z', fill: color }, m);
    }
    const g = el('g', { transform: 'translate(30,30)' }, svg);
    const edges = new Map<string, SVGPathElement>();
    for (const e of (res.edges ?? []) as ElkExtendedEdge[]) {
        const s = e.sections?.[0];
        if (!s) continue;
        const pts = [s.startPoint, ...(s.bendPoints ?? []), s.endPoint];
        edges.set(e.id, el('path', { d: 'M' + pts.map((p) => `${p.x} ${p.y}`).join(' L'), fill: 'none', stroke: 'black', 'stroke-width': 1.5, 'marker-end': 'url(#arrow)' }, g));
        for (const l of e.labels ?? [])
            text(g, l.x!, l.y! + 10, l.text!, { 'font-size': '10px', 'font-family': 'sans-serif' });
    }
    const states = new Map<number, SVGCircleElement>();
    for (const n of res.children ?? []) {
        const k = Number(n.id.slice(5));
        states.set(k, el('circle', { cx: n.x! + 25, cy: n.y! + 25, r: 25, fill: 'white', stroke: 'black', 'stroke-width': k === d.init_state ? 3 : 1.5 }, g));
        text(g, n.x! + 25, n.y! + 25, String(k), { 'font-size': '14px', 'text-anchor': 'middle', 'dominant-baseline': 'central' });
    }
    svg.setAttribute('width', String((res.width ?? 0) + 60));
    svg.setAttribute('height', String((res.height ?? 0) + 60));
    return {
        svg,
        update(state: number, input: string) {
            for (const [k, c] of states) c.setAttribute('fill', k === state ? 'yellow' : 'white');
            const next = nextTransition(trans, state, input)?.id;
            for (const [id, p] of edges) {
                p.setAttribute('stroke', id === next ? '#03c03c' : 'black');
                p.setAttribute('marker-end', id === next ? 'url(#arrow-next)' : 'url(#arrow)');
            }
        },
    };
}
