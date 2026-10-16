// One circuit graph (the top level or a subcircuit) drawn as SVG, coloured
// live with the engine's values. Pan with a drag on the background or the
// wheel, zoom with ctrl+wheel or a pinch, drag cells to move them.

import { CellView, Connector, Device, GraphData, Shape, draw, el, shape, text } from './cells';
import { Rect, midpoint, pathD, route } from './route';
import { Level, level, levelColor, show, xes } from './values';

export interface SchematicHooks {
    setInput(id: string, value: string): void;
    setParam(id: string, name: string, value: any): void;
    open(id: string): void;
    marker(item: Device | Connector | null): void;
    moved(): void;
    watch(c: Connector): void;
}

interface Wire {
    c: Connector; i: number; src: string; bits: number;
    path: SVGPathElement; hit: SVGPathElement; label?: SVGTextElement;
}

const tooltip = (() => {
    let div: HTMLDivElement | undefined;
    return {
        show(x: number, y: number, html: string) {
            if (!div) {
                div = document.createElement('div');
                div.className = 'wire_hover';
                document.body.appendChild(div);
            }
            div.style.left = x + 'px';
            div.style.top = y + 'px';
            div.innerHTML = html;
        },
        hide() { div?.remove(); div = undefined; },
    };
})();

export class Schematic {
    readonly svg: SVGSVGElement;
    readonly graph: GraphData;
    #top: boolean;
    #subcircuits: Record<string, GraphData>;
    #hooks: SchematicHooks;
    #viewport: SVGGElement;
    #wireLayer: SVGGElement;
    #cellLayer: SVGGElement;
    #shapes = new Map<string, Shape>();
    #cells = new Map<string, CellView>();
    #wires: Wire[] = [];
    // values of the cells' outputs, by "id:port"
    #values = new Map<string, string>();
    // the driver of each connected input, by "id:port"
    #drivers = new Map<string, string>();
    // what shows each output's value
    #readers = new Map<string, { wires: Wire[], cells: Set<string>, circles: SVGCircleElement[] }>();
    #dirty = new Set<string>();
    #frame = 0;
    #hover?: { wire: Wire, x: number, y: number };
    #t = { x: 0, y: 0, k: 1 };

    constructor(container: HTMLElement, graph: GraphData, opts: { top: boolean, subcircuits: Record<string, GraphData>, hooks: SchematicHooks }) {
        this.graph = graph;
        this.#top = opts.top;
        this.#subcircuits = opts.subcircuits;
        this.#hooks = opts.hooks;
        this.svg = el('svg', { class: 'schematic', width: '100%', height: '100%' }, container) as SVGSVGElement;
        this.#viewport = el('g', {}, this.svg);
        this.#wireLayer = el('g', {}, this.#viewport);
        this.#cellLayer = el('g', {}, this.#viewport);
        for (const [id, d] of Object.entries(graph.devices))
            this.#shapes.set(id, shape(d, this.#top, this.#subcircuits));
        this.#panZoom();
    }

    get shapes() {
        return this.#shapes;
    }
    get needsLayout() {
        return Object.values(this.graph.devices).some((d) => !d.position);
    }

    // Draws everything; positions must be set.
    render() {
        this.#cellLayer.replaceChildren();
        this.#wireLayer.replaceChildren();
        this.#cells.clear();
        this.#wires = [];
        this.#drivers.clear();
        this.#readers.clear();
        const readers = (key: string) => {
            let r = this.#readers.get(key);
            if (!r) this.#readers.set(key, r = { wires: [], cells: new Set(), circles: [] });
            return r;
        };
        for (const [id, d] of Object.entries(this.graph.devices)) {
            const s = this.#shapes.get(id)!;
            const view = draw(d, s, this.#top, {
                setInput: (v) => this.#hooks.setInput(id, v),
                setParam: (name, value) => { d[name] = value; this.#hooks.setParam(id, name, value); },
                numbase: () => d.numbase ?? 'hex',
                setNumbase: (b) => { d.numbase = b; this.#update(id); },
                open: () => this.#hooks.open(id),
            });
            view.g.setAttribute('transform', `translate(${d.position!.x},${d.position!.y})`);
            view.g.dataset.id = id;
            view.g.addEventListener('pointerenter', () => this.#hooks.marker(d));
            view.g.addEventListener('pointerleave', () => this.#hooks.marker(null));
            if (s.open) view.g.addEventListener('dblclick', (e) => { e.stopPropagation(); this.#hooks.open(id); });
            this.#drag(id, view.g);
            this.#cellLayer.appendChild(view.g);
            this.#cells.set(id, view);
            for (const p of s.ports) {
                const key = `${id}:${p.id}`;
                if (p.dir === 'out') {
                    readers(key).circles.push(view.circles.get(p.id)!);
                    readers(key).cells.add(id);
                }
            }
        }
        this.graph.connectors.forEach((c, i) => {
            const from = this.#port(c.from.id, c.from.port), to = this.#port(c.to.id, c.to.port);
            if (!from || !to) return;
            const src = `${c.from.id}:${c.from.port}`;
            this.#drivers.set(`${c.to.id}:${c.to.port}`, src);
            const w: Wire = {
                c, i, src, bits: from.bits,
                path: el('path', { fill: 'none', stroke: levelColor.undef, 'stroke-width': from.bits > 1 ? 4 : 2 }, this.#wireLayer),
                hit: el('path', { fill: 'none', stroke: 'transparent', 'stroke-width': 10, class: 'wirehit' }, this.#wireLayer),
            };
            // one name per net, not one per connector (they overlap)
            if (c.name && !this.#readers.get(src)?.wires.length) w.label = text(this.#wireLayer, 0, 0, c.name, { 'text-anchor': 'middle', 'dominant-baseline': 'central', 'pointer-events': 'none' });
            w.hit.addEventListener('pointerenter', (e) => { this.#hooks.marker(c); this.#hoverWire(w, e); });
            w.hit.addEventListener('pointermove', (e) => this.#hoverWire(w, e));
            w.hit.addEventListener('pointerleave', () => { this.#hooks.marker(null); this.#hover = undefined; tooltip.hide(); });
            w.hit.addEventListener('dblclick', (e) => { e.stopPropagation(); this.#hooks.watch(c); });
            this.#wires.push(w);
            const r = readers(src);
            r.wires.push(w);
            r.circles.push(this.#cells.get(c.to.id)!.circles.get(c.to.port)!);
            r.cells.add(c.to.id);
            this.#routeWire(w);
        });
        for (const key of this.#readers.keys()) this.#dirty.add(key);
        for (const id of this.#cells.keys()) this.#update(id);
        this.#flush();
    }

    #port(id: string, port: string) {
        return this.#shapes.get(id)?.ports.find((p) => p.id === port);
    }

    // `fast`: an L/Z shape, without looking for cells in the way (while dragging)
    #routeWire(w: Wire, fast = false) {
        const a = this.graph.devices[w.c.from.id].position!, b = this.graph.devices[w.c.to.id].position!;
        const pa = this.#port(w.c.from.id, w.c.from.port)!, pb = this.#port(w.c.to.id, w.c.to.port)!;
        const pts = route({ x: a.x + pa.x, y: a.y + pa.y }, pa.side, { x: b.x + pb.x, y: b.y + pb.y }, pb.side, w.c.vertices,
                          w.c.vertices || fast ? undefined : this.#obstacles());
        const d = pathD(pts);
        w.path.setAttribute('d', d);
        w.hit.setAttribute('d', d);
        if (w.label) {
            const m = midpoint(pts);
            w.label.setAttribute('x', String(m.x));
            w.label.setAttribute('y', String(m.y));
        }
    }

    // The cells' bodies, with a margin, for routing wires around them.
    #obstacles(): Rect[] {
        return [...this.#shapes].map(([id, s]) => {
            const p = this.graph.devices[id].position!;
            return { x0: p.x - 10, y0: p.y - 10, x1: p.x + s.w + 10, y1: p.y + s.h + 10 };
        });
    }

    // The value at a cell's port: its own output, or what drives an input.
    value(id: string, port: string): string {
        const key = `${id}:${port}`;
        const src = this.#drivers.get(key) ?? key;
        return this.#values.get(src) ?? xes(this.#port(id, port)?.bits ?? 1);
    }

    // Engine updates for this graph: [id, port, value].
    apply(changes: [string, string, string][]) {
        for (const [id, port, v] of changes) {
            const key = `${id}:${port}`;
            if (this.#values.get(key) === v) continue;
            this.#values.set(key, v);
            this.#dirty.add(key);
        }
        if (this.#dirty.size && !this.#frame)
            this.#frame = requestAnimationFrame(() => this.#flush());
    }

    #update(id: string) {
        const view = this.#cells.get(id);
        view?.update?.((port) => this.value(id, port));
    }

    #flush() {
        if (this.#frame) cancelAnimationFrame(this.#frame);
        this.#frame = 0;
        const cells = new Set<string>();
        for (const key of this.#dirty) {
            const r = this.#readers.get(key);
            if (!r) continue;
            const v = this.#values.get(key);
            const lv: Level = v === undefined ? 'undef' : level(v);
            for (const w of r.wires) w.path.setAttribute('stroke', levelColor[lv]);
            for (const c of r.circles) c.setAttribute('stroke', levelColor[lv]);
            for (const id of r.cells) cells.add(id);
        }
        this.#dirty.clear();
        for (const id of cells) this.#update(id);
        if (this.#hover) this.#hoverWire(this.#hover.wire);
    }

    #hoverWire(w: Wire, e?: PointerEvent) {
        if (e) this.#hover = { wire: w, x: e.clientX + 5, y: e.clientY + 5 };
        const v = this.#values.get(w.src) ?? xes(w.bits);
        const lines = w.bits === 1 ? [`Value: ${v}`]
            : ['hex', 'dec', 'oct', 'bin'].map((b) => `${b[0].toUpperCase() + b.slice(1)}: ${show(b, v)}`);
        tooltip.show(this.#hover!.x, this.#hover!.y, [...lines, '<i>Double-click: add to the waveform</i>'].join('<br>'));
    }

    // Moving a cell drops the routes of its wires (they go straight then).
    #drag(id: string, g: SVGGElement) {
        g.addEventListener('pointerdown', (e) => {
            if (e.button !== 0 || (e.target as Element).closest('foreignObject')) return;
            e.stopPropagation();
            const d = this.graph.devices[id];
            const start = { x: e.clientX, y: e.clientY }, from = { ...d.position! };
            let moved = false;
            const wires = this.#wires.filter((w) => w.c.from.id === id || w.c.to.id === id);
            const move = (ev: PointerEvent) => {
                const dx = (ev.clientX - start.x) / this.#t.k, dy = (ev.clientY - start.y) / this.#t.k;
                if (!moved && Math.hypot(dx, dy) * this.#t.k < 3) return;
                moved = true;
                d.position = { x: Math.round(from.x + dx), y: Math.round(from.y + dy) };
                g.setAttribute('transform', `translate(${d.position.x},${d.position.y})`);
                for (const w of wires) {
                    delete w.c.vertices;
                    this.#routeWire(w, true);
                }
            };
            const up = () => {
                window.removeEventListener('pointermove', move);
                window.removeEventListener('pointerup', up);
                window.removeEventListener('pointercancel', up);
                if (!moved) return;
                for (const w of wires) this.#routeWire(w);
                this.#hooks.moved();
            };
            window.addEventListener('pointermove', move);
            window.addEventListener('pointerup', up);
            window.addEventListener('pointercancel', up);
        });
    }

    get transform() {
        return { ...this.#t };
    }
    set transform(t: { x: number, y: number, k: number }) {
        this.#t = { ...t };
        this.#viewport.setAttribute('transform', `translate(${t.x},${t.y}) scale(${t.k})`);
    }
    // The drawing's extent, in its own coordinates.
    bbox() {
        return this.#viewport.getBBox();
    }
    // Content at the top left, at zoom 1 (digitaljs's initial view), or
    // smaller if it doesn't fit in `fit` (a window's size).
    home(fit?: { w: number, h: number }) {
        const b = this.bbox();
        const k = fit ? Math.min(1, (fit.w - 60) / b.width, (fit.h - 60) / b.height) : 1;
        this.transform = { x: 30 - b.x * k, y: 30 - b.y * k, k };
    }
    #zoomAt(k: number, x: number, y: number) {
        k = Math.min(10, Math.max(0.1, k));
        const t = this.#t;
        this.transform = { x: x - (x - t.x) * k / t.k, y: y - (y - t.y) * k / t.k, k };
    }

    #panZoom() {
        const svg = this.svg;
        const local = (e: { clientX: number, clientY: number }) => {
            const r = svg.getBoundingClientRect();
            return { x: e.clientX - r.left, y: e.clientY - r.top };
        };
        svg.addEventListener('wheel', (e) => {
            e.preventDefault();
            if (e.ctrlKey || e.metaKey) {
                const p = local(e);
                this.#zoomAt(this.#t.k * Math.exp(-e.deltaY * 0.002), p.x, p.y);
            } else {
                const [dx, dy] = e.shiftKey ? [e.deltaY, e.deltaX] : [e.deltaX, e.deltaY];
                this.transform = { ...this.#t, x: this.#t.x - dx, y: this.#t.y - dy };
            }
        }, { passive: false });
        svg.addEventListener('dblclick', (e) => {
            if ((e.target as Element).closest('.cell')) return;
            const p = local(e), k = this.#t.k;
            if (k >= 0.99 && k <= 2) this.#zoomAt(k * 1.5, p.x, p.y);
            else this.home();
        });
        // drag on the background pans, two fingers pinch
        const pointers = new Map<number, { x: number, y: number }>();
        let pinch: { d: number, k: number } | undefined;
        svg.addEventListener('pointerdown', (e) => {
            if ((e.target as Element).closest('.cell, foreignObject')) return;
            svg.setPointerCapture(e.pointerId);
            pointers.set(e.pointerId, local(e));
            if (pointers.size === 2) {
                const [a, b] = [...pointers.values()];
                pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), k: this.#t.k };
            }
        });
        svg.addEventListener('pointermove', (e) => {
            const last = pointers.get(e.pointerId);
            if (!last) return;
            const p = local(e);
            pointers.set(e.pointerId, p);
            if (pointers.size === 2 && pinch) {
                const [a, b] = [...pointers.values()];
                this.#zoomAt(pinch.k * Math.hypot(a.x - b.x, a.y - b.y) / pinch.d, (a.x + b.x) / 2, (a.y + b.y) / 2);
            } else if (pointers.size === 1) {
                this.transform = { ...this.#t, x: this.#t.x + p.x - last.x, y: this.#t.y + p.y - last.y };
            }
        });
        const end = (e: PointerEvent) => {
            pointers.delete(e.pointerId);
            pinch = undefined;
        };
        svg.addEventListener('pointerup', end);
        svg.addEventListener('pointercancel', end);
    }

    destroy() {
        cancelAnimationFrame(this.#frame);
        tooltip.hide();
        this.svg.remove();
    }
}
