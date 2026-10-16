// Wire geometry: orthogonal routes, around cells when a wire has no saved
// route, and their rounded SVG paths. No DOM, so tests import it directly.

import type { Point, Side } from './cells.ts';

export interface Rect { x0: number; y0: number; x1: number; y1: number }

const dirs: Record<Side, [number, number]> = { left: [-1, 0], right: [1, 0], top: [0, -1], bottom: [0, 1] };
const hz = (s: Side) => s === 'left' || s === 'right';

export function simplify(pts: Point[]): Point[] {
    const out: Point[] = [];
    for (const p of pts) {
        const a = out[out.length - 1], b = out[out.length - 2];
        if (a && a.x === p.x && a.y === p.y) continue;
        if (a && b && ((b.x === a.x && a.x === p.x) || (b.y === a.y && a.y === p.y))) out.pop();
        out.push(p);
    }
    return out;
}

// Out of `a` (a port on side `as`) and into `b`: through `vertices` if the
// wire has them, else around `obstacles` (cell bodies), else an L/Z shape.
export function route(a: Point, as: Side, b: Point, bs: Side, vertices?: Point[], obstacles?: Rect[]): Point[] {
    if (vertices?.length) {
        const pts = [a, ...vertices, b];
        // keep the first and last legs straight
        const v0 = vertices[0], vn = vertices[vertices.length - 1];
        if (v0.x !== a.x && v0.y !== a.y) pts.splice(1, 0, hz(as) ? { x: v0.x, y: a.y } : { x: a.x, y: v0.y });
        if (vn.x !== b.x && vn.y !== b.y) pts.splice(pts.length - 1, 0, hz(bs) ? { x: vn.x, y: b.y } : { x: b.x, y: vn.y });
        return simplify(pts);
    }
    const s = 15;
    const a1 = { x: a.x + dirs[as][0] * s, y: a.y + dirs[as][1] * s };
    const b1 = { x: b.x + dirs[bs][0] * s, y: b.y + dirs[bs][1] * s };
    const around = obstacles && astar(a1, as, b1, bs, obstacles);
    if (around) return simplify([a, ...around, b]);
    let mid: Point[];
    if (hz(as) && hz(bs)) {
        const mx = (a1.x + b1.x) / 2;
        mid = (b1.x - a1.x) * dirs[as][0] >= 0 ? [{ x: mx, y: a.y }, { x: mx, y: b.y }]
            : [a1, { x: a1.x, y: (a.y + b.y) / 2 }, { x: b1.x, y: (a.y + b.y) / 2 }, b1];
    } else if (!hz(as) && !hz(bs)) {
        const my = (a1.y + b1.y) / 2;
        mid = [a1, { x: a.x, y: my }, { x: b.x, y: my }, b1];
    } else if (hz(as)) {
        mid = [a1, { x: b1.x, y: a1.y }, b1];
    } else {
        mid = [a1, { x: a1.x, y: b1.y }, b1];
    }
    return simplify([a, ...mid, b]);
}

// The shortest route with few bends from `s` (leaving towards side `ss`)
// to `t` (entering against side `ts`), on the grid of the obstacles' edges
// near them. Undefined if there is none.
// ponytail: A* on an "orthogonal visibility" grid, obstacles within 200px
// of the two ends only; a wire that must go further round gets the L/Z.
function astar(s: Point, ss: Side, t: Point, ts: Side, obstacles: Rect[]): Point[] | undefined {
    const pad = 200;
    const box = { x0: Math.min(s.x, t.x) - pad, y0: Math.min(s.y, t.y) - pad, x1: Math.max(s.x, t.x) + pad, y1: Math.max(s.y, t.y) + pad };
    const inside = (p: Point, r: Rect) => p.x > r.x0 && p.x < r.x1 && p.y > r.y0 && p.y < r.y1;
    const obs = obstacles.filter((r) => r.x0 < box.x1 && r.x1 > box.x0 && r.y0 < box.y1 && r.y1 > box.y0 && !inside(s, r) && !inside(t, r));
    const uniq = (v: number[]) => [...new Set(v)].sort((p, q) => p - q);
    const xs = uniq([s.x, t.x, box.x0, box.x1, ...obs.flatMap((r) => [r.x0, r.x1])]);
    const ys = uniq([s.y, t.y, box.y0, box.y1, ...obs.flatMap((r) => [r.y0, r.y1])]);
    const nx = xs.length, ny = ys.length;
    // a segment is blocked if it crosses an obstacle's inside
    const blocked = (x0: number, y0: number, x1: number, y1: number) => obs.some((r) =>
        x0 === x1 ? x0 > r.x0 && x0 < r.x1 && Math.max(y0, y1) > r.y0 && Math.min(y0, y1) < r.y1
                  : y0 > r.y0 && y0 < r.y1 && Math.max(x0, x1) > r.x0 && Math.min(x0, x1) < r.x1);
    const steps = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const dirOf = (side: Side) => steps.findIndex(([i, j]) => i === dirs[side][0] && j === dirs[side][1]);
    const startDir = dirOf(ss), endDir = steps.findIndex(([i, j]) => i === -dirs[ts][0] && j === -dirs[ts][1]);
    const bend = 30;
    const si = xs.indexOf(s.x), sj = ys.indexOf(s.y), ti = xs.indexOf(t.x), tj = ys.indexOf(t.y);
    const key = (i: number, j: number, d: number) => ((i * ny + j) << 2) | d;
    const cost = new Map<number, number>(), from = new Map<number, number>();
    const h = (i: number, j: number) => Math.abs(xs[i] - t.x) + Math.abs(ys[j] - t.y);
    // a binary heap of [f, state]
    const heap: [number, number][] = [];
    const push = (f: number, k: number) => {
        heap.push([f, k]);
        for (let n = heap.length - 1; n > 0;) {
            const p = (n - 1) >> 1;
            if (heap[p][0] <= heap[n][0]) break;
            [heap[p], heap[n]] = [heap[n], heap[p]];
            n = p;
        }
    };
    const pop = () => {
        const top = heap[0], last = heap.pop()!;
        if (heap.length) {
            heap[0] = last;
            for (let n = 0; ;) {
                const l = 2 * n + 1, r = l + 1;
                let m = n;
                if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
                if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
                if (m === n) break;
                [heap[m], heap[n]] = [heap[n], heap[m]];
                n = m;
            }
        }
        return top;
    };
    const k0 = key(si, sj, startDir);
    cost.set(k0, 0);
    push(h(si, sj), k0);
    while (heap.length) {
        const [, k] = pop();
        const d = k & 3, node = k >> 2, i = Math.floor(node / ny), j = node % ny;
        if (i === ti && j === tj) {
            const pts: Point[] = [];
            for (let c: number | undefined = k; c !== undefined; c = from.get(c))
                pts.push({ x: xs[Math.floor((c >> 2) / ny)], y: ys[(c >> 2) % ny] });
            return pts.reverse();
        }
        const g = cost.get(k)!;
        steps.forEach(([di, dj], nd) => {
            if ((nd ^ d) === 1) return; // no U-turns
            const i2 = i + di, j2 = j + dj;
            if (i2 < 0 || j2 < 0 || i2 >= nx || j2 >= ny || blocked(xs[i], ys[j], xs[i2], ys[j2])) return;
            let g2 = g + Math.abs(xs[i2] - xs[i]) + Math.abs(ys[j2] - ys[j]) + (nd === d ? 0 : bend);
            if (i2 === ti && j2 === tj) {
                if ((nd ^ endDir) === 1) return; // the port would be entered from behind
                if (nd !== endDir) g2 += bend;
            }
            const k2 = key(i2, j2, nd);
            if (g2 >= (cost.get(k2) ?? Infinity)) return;
            cost.set(k2, g2);
            from.set(k2, k);
            push(g2 + h(i2, j2), k2);
        });
    }
}

export function pathD(pts: Point[], r = 10) {
    let d = `M${pts[0].x} ${pts[0].y}`;
    for (let i = 1; i < pts.length - 1; i++) {
        const [a, p, b] = [pts[i - 1], pts[i], pts[i + 1]];
        const la = Math.hypot(a.x - p.x, a.y - p.y), lb = Math.hypot(b.x - p.x, b.y - p.y);
        const rr = Math.min(r, la / 2, lb / 2);
        const p1 = { x: p.x + (a.x - p.x) * rr / la, y: p.y + (a.y - p.y) * rr / la };
        const p2 = { x: p.x + (b.x - p.x) * rr / lb, y: p.y + (b.y - p.y) * rr / lb };
        d += ` L${p1.x} ${p1.y} Q${p.x} ${p.y} ${p2.x} ${p2.y}`;
    }
    const z = pts[pts.length - 1];
    return d + ` L${z.x} ${z.y}`;
}

export function midpoint(pts: Point[]): Point {
    const lens = pts.slice(1).map((p, i) => Math.hypot(p.x - pts[i].x, p.y - pts[i].y));
    let half = lens.reduce((a, b) => a + b, 0) / 2;
    for (let i = 0; i < lens.length; i++) {
        if (half <= lens[i] && lens[i] > 0) {
            const t = half / lens[i];
            return { x: pts[i].x + (pts[i + 1].x - pts[i].x) * t, y: pts[i].y + (pts[i + 1].y - pts[i].y) * t };
        }
        half -= lens[i];
    }
    return pts[0];
}
