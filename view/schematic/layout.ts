// Automatic layout with ELK's layered algorithm (the options digitaljs
// used). A node is a cell's body with its port leads, so the ports (the
// circles, fixed) are on its border; its labels only reserve room.

import ELK from 'elkjs/lib/elk.bundled.js';
import type { ElkNode, ElkExtendedEdge } from 'elkjs/lib/elk-api';
import { GraphData, Point, Shape, layer, textWidth } from './cells.ts';

const sides = { left: 'WEST', right: 'EAST', top: 'NORTH', bottom: 'SOUTH' };

export interface Layout {
    positions: Record<string, Point>;
    // bend points per connector index (absent: no route)
    vertices: Record<number, Point[]>;
}

export async function layout(graph: GraphData, shapes: Map<string, Shape>): Promise<Layout> {
    const children: ElkNode[] = [];
    const offsets = new Map<string, Point>();
    for (const [id, d] of Object.entries(graph.devices)) {
        const s = shapes.get(id)!;
        // the body plus the leads
        const x0 = Math.min(0, ...s.ports.map((p) => p.x)), y0 = Math.min(0, ...s.ports.map((p) => p.y));
        const x1 = Math.max(s.w, ...s.ports.map((p) => p.x)), y1 = Math.max(s.h, ...s.ports.map((p) => p.y));
        offsets.set(id, { x: x0, y: y0 });
        const labels = [];
        if (d.label) labels.push({ text: d.label, width: textWidth(d.label), height: 12,
                                    layoutOptions: { 'elk.nodeLabels.placement': 'OUTSIDE V_BOTTOM H_CENTER' } });
        if (s.top) labels.push({ text: s.top, width: textWidth(s.top), height: 12,
                                 layoutOptions: { 'elk.nodeLabels.placement': 'OUTSIDE V_TOP H_CENTER' } });
        children.push({
            id, width: x1 - x0, height: y1 - y0, labels,
            ports: s.ports.map((p) => ({
                id: `${id}.${p.id}`, x: p.x - x0, y: p.y - y0, width: 0, height: 0,
                layoutOptions: { 'elk.port.side': sides[p.side] },
            })),
            layoutOptions: {
                'elk.portConstraints': 'FIXED_POS',
                'elk.layered.layering.layerConstraint': layer(d),
            },
        });
    }
    const edges: ElkExtendedEdge[] = [];
    graph.connectors.forEach((c, i) => {
        if (shapes.has(c.from.id) && shapes.has(c.to.id))
            edges.push({ id: String(i), sources: [`${c.from.id}.${c.from.port}`], targets: [`${c.to.id}.${c.to.port}`] });
    });
    const res = await new ELK().layout({
        id: 'root', children, edges,
        layoutOptions: {
            'elk.algorithm': 'layered',
            'elk.edgeRouting': 'ORTHOGONAL',
            'elk.layered.spacing.nodeNodeBetweenLayers': '40',
            'elk.layered.nodePlacement.favorStraightEdges': 'true',
        },
    });
    const out: Layout = { positions: {}, vertices: {} };
    for (const n of res.children ?? []) {
        const o = offsets.get(n.id)!;
        out.positions[n.id] = { x: n.x! - o.x, y: n.y! - o.y };
    }
    for (const e of (res.edges ?? []) as ElkExtendedEdge[])
        out.vertices[Number(e.id)] = (e.sections?.[0]?.bendPoints ?? []).map((p) => ({ x: p.x, y: p.y }));
    return out;
}
