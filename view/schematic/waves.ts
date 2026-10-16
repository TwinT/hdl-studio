// The waveform monitor under the schematic. The engine records the
// watched outputs (`watch`); after each update this asks for the window it
// shows (`wave`, one entry per pixel column) and draws it on canvases.

import { bases, level, levelColor, read, show } from './values';

export interface WatchSpec {
    path: string; port: string; // the output driving the wire
    name: string; bits: number;
}

interface Watch extends WatchSpec {
    id: number;
    base: string;
    trigger: string[];
    triggerId?: number;
    row: HTMLDivElement;
    canvas: HTMLCanvasElement;
    data?: Win;
}

// What the engine returns for one watch (crates/hdlstudio/src/wave.rs).
interface Win { start: string | null; first: number | null; changes: ([number, string] | [number, string, number])[] }

export interface MonitorHooks {
    send(req: any): void;
    request(req: any): Promise<any>;
    // a trigger stops the simulation; its id
    trigger(path: string, port: string, values: string[]): number;
    untrigger(id: number): void;
}

const NAME_W = 300; // the columns left of the canvas

// Ticks between grid lines: 1, 2, 5, 10, 20... at least 10px apart (wavecanvas's).
function gridStep(ppt: number) {
    let g = 1;
    while (g * ppt < 10) {
        if (10 * g * ppt < 10) g *= 10;
        else if (2 * g * ppt >= 10) g *= 2;
        else if (5 * g * ppt >= 10) g *= 5;
        else g *= 10;
    }
    return g;
}

export class Monitor {
    readonly root: HTMLDivElement;
    #rows: HTMLDivElement;
    #hooks: MonitorHooks;
    #watches = new Map<number, Watch>();
    #ids = 0;
    #start = 0;
    #ppt = 5;
    #live = true;
    #tick = 0;
    #asking = false;
    #again = false;
    #range: HTMLSpanElement;
    #liveBtn: HTMLButtonElement;

    constructor(parent: HTMLElement, hooks: MonitorHooks) {
        this.#hooks = hooks;
        this.root = document.createElement('div');
        this.root.id = 'monitor';
        this.root.innerHTML = `<div class="gutter"></div><div class="toolbar">
            <button name="in" class="codicon codicon-zoom-in" title="Zoom in"></button>
            <button name="out" class="codicon codicon-zoom-out" title="Zoom out"></button>
            <button name="live" class="codicon codicon-debug-pause" title="Pause plot"></button>
            <button name="left" class="codicon codicon-arrow-small-left" title="Move left"></button>
            <button name="right" class="codicon codicon-arrow-small-right" title="Move right"></button>
            <span class="range"></span></div><div class="rows"></div>`;
        parent.appendChild(this.root);
        const $ = (q: string) => this.root.querySelector(q) as HTMLElement;
        this.#rows = $('.rows') as HTMLDivElement;
        this.#range = $('.range') as HTMLSpanElement;
        this.#liveBtn = $('[name=live]') as HTMLButtonElement;
        $('[name=in]').addEventListener('click', () => this.#zoom(2));
        $('[name=out]').addEventListener('click', () => this.#zoom(0.5));
        this.#liveBtn.addEventListener('click', () => this.#setLive(!this.#live));
        $('[name=left]').addEventListener('click', () => this.#scroll(-this.#span() / 4));
        $('[name=right]').addEventListener('click', () => this.#scroll(this.#span() / 4));
        // drag the top edge to resize; drag a waveform to scroll; wheel zooms
        const gutter = $('.gutter');
        gutter.addEventListener('pointerdown', (e) => {
            gutter.setPointerCapture(e.pointerId);
            const y0 = e.clientY, h0 = this.root.offsetHeight;
            const move = (ev: PointerEvent) => { this.root.style.height = `${Math.max(60, h0 - (ev.clientY - y0))}px`; this.#resize(); };
            gutter.addEventListener('pointermove', move);
            gutter.addEventListener('pointerup', () => gutter.removeEventListener('pointermove', move), { once: true });
        });
        new ResizeObserver(() => this.#resize()).observe(this.root);
        this.#rows.addEventListener('wheel', (e) => {
            if (!(e.target instanceof HTMLCanvasElement)) return;
            e.preventDefault();
            this.#zoom(e.deltaY < 0 ? 2 : 0.5, e.offsetX);
        }, { passive: false });
        this.#rows.addEventListener('pointerdown', (e) => {
            if (!(e.target instanceof HTMLCanvasElement)) return;
            const c = e.target, x0 = e.clientX, s0 = this.#start;
            c.setPointerCapture(e.pointerId);
            this.#setLive(false);
            const move = (ev: PointerEvent) => { this.#start = Math.max(0, s0 - (ev.clientX - x0) / this.#ppt); this.#ask(); };
            c.addEventListener('pointermove', move);
            c.addEventListener('pointerup', () => c.removeEventListener('pointermove', move), { once: true });
        });
        this.#show();
    }

    get specs(): WatchSpec[] {
        return [...this.#watches.values()].map(({ path, port, name, bits }) => ({ path, port, name, bits }));
    }
    has(path: string, port: string) {
        return [...this.#watches.values()].some((w) => w.path === path && w.port === port);
    }

    add(spec: WatchSpec) {
        if (this.has(spec.path, spec.port)) return;
        const id = ++this.#ids;
        const row = document.createElement('div');
        row.className = 'row';
        const name = document.createElement('span');
        name.className = 'name';
        name.textContent = name.title = spec.name;
        const base = document.createElement('select');
        for (const b of bases) base.add(new Option(b, b, b === 'hex', b === 'hex'));
        const trig = spec.bits === 1 ? document.createElement('select') : document.createElement('input');
        if (trig instanceof HTMLSelectElement)
            for (const [v, t] of [['', 'none'], ['1', '↑'], ['0', '↓'], ['1,0', '↕'], ['x', 'x']]) trig.add(new Option(t, v));
        else trig.placeholder = 'trigger';
        trig.title = 'Stop the simulation when the signal takes this value';
        const remove = document.createElement('button');
        remove.className = 'codicon codicon-close';
        remove.title = 'Remove';
        const canvas = document.createElement('canvas');
        canvas.height = 30;
        row.append(name, spec.bits > 1 ? base : document.createElement('span'), trig, remove, canvas);
        this.#rows.appendChild(row);
        const w: Watch = { ...spec, id, base: 'hex', trigger: [], row, canvas };
        this.#watches.set(id, w);
        base.addEventListener('change', () => { w.base = base.value; this.#draw(w); });
        trig.addEventListener('change', () => {
            if (w.triggerId !== undefined) this.#hooks.untrigger(w.triggerId);
            w.triggerId = undefined;
            const vals = trig instanceof HTMLSelectElement ? trig.value.split(',').filter(Boolean)
                : trig.value ? [read(w.base, trig.value, w.bits)].filter((v): v is string => v !== undefined) : [];
            trig.classList.toggle('invalid', trig instanceof HTMLInputElement && !!trig.value && !vals.length);
            w.trigger = vals;
            if (vals.length) w.triggerId = this.#hooks.trigger(w.path, w.port, vals);
        });
        remove.addEventListener('click', () => this.remove(id));
        this.#hooks.send({ op: 'watch', id, path: spec.path, port: spec.port });
        this.#show();
        this.#resize();
    }

    remove(id: number) {
        const w = this.#watches.get(id);
        if (!w) return;
        if (w.triggerId !== undefined) this.#hooks.untrigger(w.triggerId);
        this.#hooks.send({ op: 'unwatch', id });
        w.row.remove();
        this.#watches.delete(id);
        this.#show();
    }

    // After the engine loaded the circuit again (a reset): watch again, from tick 0.
    reloaded() {
        this.#tick = 0;
        this.#start = 0;
        for (const w of this.#watches.values()) {
            w.data = undefined;
            this.#hooks.send({ op: 'watch', id: w.id, path: w.path, port: w.port });
            if (w.trigger.length) w.triggerId = this.#hooks.trigger(w.path, w.port, w.trigger);
        }
        this.#ask();
    }

    clear() {
        for (const id of [...this.#watches.keys()]) this.remove(id);
    }

    // The engine's tick, after an update.
    tick(tick: number) {
        this.#tick = tick;
        if (this.#live) this.#start = Math.max(0, tick - this.#span());
        this.#ask();
    }

    #show() {
        this.root.style.display = this.#watches.size ? '' : 'none';
    }
    #width() {
        return Math.max(100, this.#rows.clientWidth - NAME_W);
    }
    #span() {
        return this.#width() / this.#ppt;
    }
    #resize() {
        for (const w of this.#watches.values()) w.canvas.width = this.#width();
        this.#ask();
    }
    #zoom(f: number, x = this.#width() / 2) {
        const t = this.#start + x / this.#ppt;
        this.#ppt = Math.min(100, Math.max(1e-6, this.#ppt * f));
        if (!this.#live) this.#start = Math.max(0, t - x / this.#ppt);
        else this.#start = Math.max(0, this.#tick - this.#span());
        this.#ask();
    }
    #scroll(dt: number) {
        this.#setLive(false);
        this.#start = Math.max(0, this.#start + dt);
        this.#ask();
    }
    #setLive(live: boolean) {
        this.#live = live;
        this.#liveBtn.className = `codicon codicon-${live ? 'debug-pause' : 'debug-start'}`;
        this.#liveBtn.title = live ? 'Pause plot' : 'Live plot';
        if (live) this.tick(this.#tick);
    }

    // One request at a time; the latest view wins.
    async #ask() {
        if (!this.#watches.size) return;
        if (this.#asking) {
            this.#again = true;
            return;
        }
        this.#asking = true;
        const from = Math.floor(this.#start), to = Math.ceil(this.#start + this.#span());
        this.#range.textContent = `ticks ${from} – ${to}, grid ${gridStep(this.#ppt)}`;
        const res = await this.#hooks.request({ op: 'wave', watches: [...this.#watches.keys()], from, to, bins: this.#width() });
        this.#asking = false;
        this.#tick = Math.max(this.#tick, res.tick);
        for (const [id, win] of Object.entries(res.waves as Record<string, Win>)) {
            const w = this.#watches.get(Number(id));
            if (w) { w.data = win; this.#draw(w); }
        }
        if (this.#again) {
            this.#again = false;
            this.#ask();
        }
    }

    #draw(w: Watch) {
        const c = w.canvas.getContext('2d')!, W = w.canvas.width, H = w.canvas.height;
        c.clearRect(0, 0, W, H);
        const ppt = this.#ppt, start = this.#start;
        const x = (t: number) => Math.min(W, Math.max(0, (t - start) * ppt));
        c.lineWidth = 0.5;
        c.strokeStyle = 'gray';
        const step = gridStep(ppt);
        for (let t = start - (start % step); t < start + W / ppt; t += step) {
            c.beginPath(); c.moveTo(x(t), 0); c.lineTo(x(t), H); c.stroke();
        }
        if (!w.data) return;
        const hy = H * 0.1, ly = H * 0.9, my = H / 2;
        // segments: [from, value, dense until]
        const segs: [number, string, number?][] = [];
        if (w.data.start !== null) segs.push([start, w.data.start]);
        for (const ch of w.data.changes) segs.push([ch[0], ch[1], ch[2]]);
        const present = this.#tick;
        c.lineWidth = 2;
        c.font = '10px sans-serif';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        segs.forEach(([t0, v, dense], i) => {
            const end = Math.min(present, i + 1 < segs.length ? segs[i + 1][0] : present);
            if (end < t0) return;
            const lv = level(v);
            let a = x(t0);
            const b = x(end);
            if (dense !== undefined) {
                // many changes: a block up to the last one
                const d = Math.max(x(dense), a + 1);
                c.fillStyle = levelColor.def;
                c.fillRect(a, hy, d - a, ly - hy);
                a = d;
            }
            c.strokeStyle = levelColor[lv];
            c.beginPath();
            if (w.bits === 1) {
                const y = v === '1' ? hy : v === '0' ? ly : my;
                const prev = i > 0 ? segs[i - 1][1] : undefined;
                if (prev !== undefined && dense === undefined) {
                    const py = prev === '1' ? hy : prev === '0' ? ly : my;
                    c.moveTo(a, py);
                }
                else c.moveTo(a, y);
                c.lineTo(a, y);
                c.lineTo(b, y);
            } else if (lv === 'undef' || lv === 'highz') {
                c.moveTo(a, my); c.lineTo(b, my);
            } else {
                const g = Math.min(3, (b - a) / 2);
                c.moveTo(a, my); c.lineTo(a + g, hy); c.lineTo(b - g, hy); c.lineTo(b, my);
                c.lineTo(b - g, ly); c.lineTo(a + g, ly); c.closePath();
                const txt = show(w.base, v);
                if (c.measureText(txt).width < b - a - 2 * g) {
                    c.fillStyle = 'black';
                    c.fillText(txt, (a + b) / 2, my);
                }
            }
            c.stroke();
        });
    }
}
