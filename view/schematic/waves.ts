// The waveform monitor under the schematic, laid out like Surfer and
// VaporView: names, the value under the pointer, the waveform, and a time
// ruler. The engine records the watched outputs (`watch`); after each
// update this asks for the window it shows (`wave`, one entry per pixel
// column) and draws it. Rows can be dragged into another order and into
// groups (one level, coloured, collapsible); the whole arrangement is the
// `config` saved with the project or in a file.

import { formatTimeAt } from '../../src/time_units.mjs';
import { read, show } from './values.ts';
import { popupMenu } from './dialog.ts';

export interface WatchSpec {
    path: string; port: string; // the output driving the wire
    name: string; bits: number;
    base?: string; pause?: Pause; // the row's number format and pause condition
}

// Colours, from the `hdl-studio.waveform.colors` setting.
export interface WaveColors {
    background: string; altBackground: string; foreground: string; grid: string;
    signal: string; undefined: string; highImpedance: string; cursor: string; fillOpacity: number;
}
// Surfer's default (dark) theme.
export const defaultColors: WaveColors = {
    background: '#0b151d', altBackground: '#1b252d', foreground: '#d4d4d4', grid: '#222222',
    signal: '#56c126', undefined: '#f44747', highImpedance: '#c9e124', cursor: '#b63935', fillOpacity: 0.2,
};

// When a watched signal pauses the simulation: the engine's trigger values
// (null: any change).
export interface Pause { label: string; values: string[] | null }

export interface GroupSpec { group: string; color: string; collapsed?: boolean; items: WatchSpec[] }
export type WaveItem = WatchSpec | GroupSpec;
// What the project (`view.waves`, `view.waveColumns`) and a layout file keep.
export interface WaveConfig { waves: WaveItem[]; columns?: number[] }

interface Watch extends WatchSpec {
    id: number;
    base: string;
    pause?: Pause;
    triggerId?: number;
    group?: Group;
    row: HTMLDivElement; name_: HTMLDivElement; value_: HTMLDivElement; canvas: HTMLCanvasElement;
    data?: Win;
}

interface Group { group: string; color: string; collapsed: boolean; items: Watch[]; row: HTMLDivElement; name_: HTMLDivElement }
type Item = Watch | Group;
const isGroup = (i: Item): i is Group => 'items' in i;

// Where a dragged row goes: into `parent` (a group, or the top level), before `before` (or last).
interface Drop { parent?: Group; before?: Item; y: number }

// Group colours, readable on light and dark backgrounds.
const groupColors = ['#3794ff', '#4ec9b0', '#e5c07b', '#ff8c42', '#c586c0', '#ff79c6', '#56c126', '#a0a0a0'];

const div = (className: string) => Object.assign(document.createElement('div'), { className });

// What the engine returns for one watch (crates/hdlstudio/src/wave.rs).
interface Win { start: string | null; first: number | null; changes: ([number, string] | [number, string, number])[] }

export interface MonitorHooks {
    send(req: any): void;
    request(req: any): Promise<any>;
    // a trigger pauses the simulation; returns its id
    trigger(path: string, port: string, values: string[] | null): number;
    untrigger(id: number): void;
    // the user changed a row (format, pause, order, group, removed it) or a column
    changed(): void;
    // the toolbar's buttons: the layout to a file, or from one
    exportLayout(): void;
    importLayout(): void;
}

const ROW = 24;
const PPT = 5; // the zoom a run starts with, in pixels per tick

// Ticks between labelled ruler lines: 1, 2, 5, 10, 20... at least `px` apart.
function step(ppt: number, px: number) {
    for (let e = 1; ; e *= 10)
        for (const m of [1, 2, 5]) if (m * e * ppt >= px) return m * e;
}

const bitPauses: Pause[] = [
    { label: 'rises (↑)', values: ['1'] }, { label: 'falls (↓)', values: ['0'] },
    { label: 'changes', values: null }, { label: 'is x', values: ['x'] },
];

export class Monitor {
    readonly root: HTMLDivElement;
    #hooks: MonitorHooks;
    #grid: HTMLDivElement;
    #ruler: HTMLCanvasElement;
    #range: HTMLSpanElement;
    #status: HTMLSpanElement;
    #followBtn: HTMLButtonElement;
    #badge: HTMLButtonElement; // PAUSED or RUNNING
    #running = false; // the simulation
    #watches = new Map<number, Watch>();
    #items: Item[] = []; // in order, groups holding theirs
    #cols = [180, 90]; // the name and value columns' widths
    #dropLine: HTMLDivElement;
    #ids = 0;
    #start = 0;
    #ppt = PPT; // pixels per tick
    #follow = true; // the view's right edge is the present
    #tick = 0;
    #tickSec = 1e-9;
    #hover?: number; // tick under the pointer
    #marker?: number; // tick where a trigger paused the simulation
    #colors = defaultColors;
    #asking = false;
    #again = false;

    constructor(parent: HTMLElement, hooks: MonitorHooks) {
        this.#hooks = hooks;
        this.root = document.createElement('div');
        this.root.id = 'monitor';
        this.root.innerHTML = `<div class="gutter"></div><div class="toolbar">
            <button name="in" class="codicon codicon-zoom-in" title="Zoom in (Ctrl+wheel)"></button>
            <button name="out" class="codicon codicon-zoom-out" title="Zoom out (Ctrl+wheel)"></button>
            <button name="fit" class="codicon codicon-screen-full" title="Show everything recorded"></button>
            <button name="follow" class="codicon codicon-debug-continue" title=""></button>
            <button name="badge" class="badge"></button>
            <span class="range"></span><span class="status"></span>
            <button name="export" class="codicon codicon-save" title="Save the waveform layout to a file…"></button>
            <button name="import" class="codicon codicon-folder-opened" title="Open a waveform layout file…"></button></div>
            <div class="grid"><div class="head">Signal<div class="colsize"></div></div><div class="head">Value<div class="colsize"></div></div>
            <canvas class="ruler"></canvas><div class="dropline" hidden></div></div>`;
        parent.appendChild(this.root);
        const $ = <T extends Element>(q: string) => this.root.querySelector(q) as T;
        this.#grid = $('.grid');
        this.#ruler = $('.ruler');
        this.#range = $('.range');
        this.#status = $('.status');
        this.#followBtn = $('[name=follow]');
        $('[name=in]').addEventListener('click', () => this.#zoom(2));
        $('[name=out]').addEventListener('click', () => this.#zoom(0.5));
        $('[name=fit]').addEventListener('click', () => this.#fit());
        this.#followBtn.addEventListener('click', () => this.#setFollow(!this.#follow));
        this.#badge = $('[name=badge]');
        this.#badge.addEventListener('click', () => this.#setFollow(!this.#follow));
        $('[name=export]').addEventListener('click', () => this.#hooks.exportLayout());
        $('[name=import]').addEventListener('click', () => this.#hooks.importLayout());
        this.#dropLine = $('.dropline');
        this.root.querySelectorAll<HTMLElement>('.colsize').forEach((h, i) => h.addEventListener('pointerdown', (e) => {
            h.setPointerCapture(e.pointerId);
            const x0 = e.clientX, w0 = this.#cols[i];
            const move = (ev: PointerEvent) => {
                this.#cols[i] = Math.max(40, Math.round(w0 + ev.clientX - x0));
                this.#applyCols();
            };
            h.addEventListener('pointermove', move);
            h.addEventListener('pointerup', () => { h.removeEventListener('pointermove', move); this.#hooks.changed(); }, { once: true });
        }));
        this.#applyCols();
        const gutter = $<HTMLElement>('.gutter');
        gutter.addEventListener('pointerdown', (e) => {
            gutter.setPointerCapture(e.pointerId);
            const y0 = e.clientY, h0 = this.root.offsetHeight;
            const move = (ev: PointerEvent) => { this.root.style.height = `${Math.max(60, h0 - (ev.clientY - y0))}px`; };
            gutter.addEventListener('pointermove', move);
            gutter.addEventListener('pointerup', () => gutter.removeEventListener('pointermove', move), { once: true });
        });
        // the waveform column's width (the view's, or a column resized)
        new ResizeObserver(() => this.#resize()).observe(this.#ruler);
        this.#waveEvents();
        this.#setFollow(true);
        this.#show();
    }

    get config(): WaveConfig {
        const spec = ({ path, port, name, bits, base, pause }: Watch): WatchSpec => ({ path, port, name, bits, base, pause });
        return {
            waves: this.#items.map((i) => isGroup(i) ? { group: i.group, color: i.color, collapsed: i.collapsed, items: i.items.map(spec) } : spec(i)),
            columns: [...this.#cols],
        };
    }

    // Replaces what the monitor shows with `config`; `resolve` finds each
    // signal in this circuit. Returns how many it didn't find.
    load(config: WaveConfig, resolve: (s: WatchSpec) => WatchSpec | undefined) {
        this.clear();
        if (config.columns?.length === 2) this.#cols = config.columns.map((c) => Math.max(40, Number(c) || 0));
        this.#applyCols();
        let missing = 0;
        const add = (s: WatchSpec, g?: Group) => {
            const r = resolve(s);
            if (r) this.add(r, g);
            else missing++;
        };
        for (const i of config.waves ?? []) {
            if (!('items' in i)) add(i);
            else {
                const g = this.#newGroup(i.group, i.color, !!i.collapsed);
                this.#items.push(g);
                for (const s of i.items) add(s, g);
            }
        }
        this.#render();
        return missing;
    }

    say(text: string) {
        this.#status.textContent = text;
    }

    setColors(c: Partial<WaveColors> | undefined) {
        this.#colors = { ...defaultColors, ...c };
        const s = this.root.style;
        s.setProperty('--wave-bg', this.#colors.background);
        s.setProperty('--wave-alt', this.#colors.altBackground);
        s.setProperty('--wave-fg', this.#colors.foreground);
        this.#drawAll();
    }
    setTimescale(t: string | undefined, parse: (s: string) => number | undefined) {
        this.#tickSec = (t && parse(t)) || 1e-9;
        this.#drawAll();
    }

    // A signal, last (in `group`, if given).
    add(spec: WatchSpec, group?: Group) {
        if ([...this.#watches.values()].some((w) => w.path === spec.path && w.port === spec.port)) return;
        const id = ++this.#ids;
        const name_ = div('name'), value_ = div('value'), canvas = document.createElement('canvas');
        const row = div('row');
        row.append(name_, value_, canvas);
        const w: Watch = { ...spec, id, base: spec.base ?? 'hex', pause: undefined, group, row, name_, value_, canvas };
        this.#watches.set(id, w);
        (group?.items ?? this.#items).push(w);
        this.#label(w);
        row.addEventListener('contextmenu', (ev) => { ev.preventDefault(); this.#openMenu(w, ev.clientX, ev.clientY); });
        this.#dragRow(w);
        this.#hooks.send({ op: 'watch', id, path: spec.path, port: spec.port });
        if (spec.pause) this.#setPause(w, spec.pause);
        this.#render();
        this.#resize();
    }

    remove(id: number) {
        const w = this.#watches.get(id);
        if (!w) return;
        this.#setPause(w, undefined);
        this.#hooks.send({ op: 'unwatch', id });
        w.row.remove();
        const list = w.group?.items ?? this.#items;
        list.splice(list.indexOf(w), 1);
        this.#watches.delete(id);
        this.#render();
    }

    clear() {
        for (const id of [...this.#watches.keys()]) this.remove(id);
        for (const g of this.#items) g.row.remove(); // the groups left
        this.#items = [];
        this.#show();
    }

    // After the engine loaded the circuit again (a reset): watch again, from
    // tick 0, following the new run at the starting zoom (a "show everything"
    // would leave it a sliver).
    reloaded() {
        this.#tick = 0;
        this.#start = 0;
        this.#ppt = PPT;
        for (const w of this.#watches.values()) {
            w.data = undefined;
            this.#hooks.send({ op: 'watch', id: w.id, path: w.path, port: w.port });
            if (w.pause) w.triggerId = this.#hooks.trigger(w.path, w.port, w.pause.values);
        }
        this.#setFollow(true); // clears the trigger's marker, asks for the window
    }

    // The engine's tick, after an update.
    tick(tick: number) {
        this.#tick = tick;
        if (this.#follow) this.#start = Math.max(0, tick - this.#span());
        this.#ask();
    }

    // A trigger of this monitor paused the simulation at `tick`: show where.
    fired(triggerId: number, tick: number) {
        const w = [...this.#watches.values()].find((x) => x.triggerId === triggerId);
        if (!w) return false;
        this.#marker = tick;
        this.#setFollow(false);
        this.#start = Math.max(0, tick - this.#span() * 0.7);
        this.#status.textContent = `Paused: ${w.name} ${w.pause!.label} at ${formatTimeAt(tick * this.#tickSec, this.#tickSec)}`;
        this.#ask();
        return true;
    }

    #show() {
        this.root.style.display = this.#watches.size || this.#items.length ? '' : 'none';
    }

    // The rows in the order of the items; a collapsed group's are hidden.
    // Surfer's banding: three signals on, three off.
    #render() {
        let n = 0;
        for (const i of this.#items) {
            const ws = isGroup(i) ? i.items : [i];
            if (isGroup(i)) {
                this.#grid.append(i.row);
                this.#labelGroup(i);
            }
            for (const w of ws) {
                w.row.hidden = !!w.group?.collapsed;
                w.row.classList.toggle('member', !!w.group);
                w.row.style.setProperty('--group-color', w.group?.color ?? 'transparent');
                if (!w.row.hidden) w.row.classList.toggle('alt', Math.floor(n++ / 3) % 2 === 1);
                this.#grid.append(w.row);
            }
        }
        this.#show();
        this.#drawAll();
    }

    #newGroup(name: string, color: string, collapsed = false): Group {
        const name_ = div('name'), row = div('row group');
        row.append(name_, div('value'), div(''));
        const g: Group = { group: name, color, collapsed, items: [], row, name_ };
        row.addEventListener('contextmenu', (ev) => { ev.preventDefault(); this.#groupMenu(g, ev.clientX, ev.clientY); });
        this.#dragRow(g);
        return g;
    }
    #labelGroup(g: Group) {
        g.row.style.setProperty('--group-color', g.color);
        const caret = document.createElement('button');
        caret.className = `caret codicon codicon-chevron-${g.collapsed ? 'right' : 'down'}`;
        caret.title = g.collapsed ? 'Expand' : 'Collapse';
        caret.addEventListener('click', () => this.#collapse(g, !g.collapsed));
        const text = document.createElement('span');
        text.textContent = g.group + (g.collapsed ? ` (${g.items.length})` : '');
        text.addEventListener('dblclick', () => this.#rename(g));
        const more = document.createElement('button');
        more.className = 'codicon codicon-ellipsis';
        more.title = 'Colour, rename, ungroup…';
        more.addEventListener('click', (e) => { const r = more.getBoundingClientRect(); e.stopPropagation(); this.#groupMenu(g, r.left, r.bottom); });
        g.name_.replaceChildren(caret, text, more);
        g.name_.title = g.group;
    }
    #collapse(g: Group, on: boolean) {
        g.collapsed = on;
        this.#render();
        this.#hooks.changed();
    }
    // The group's name becomes a text field: Enter (or leaving it) renames, Escape doesn't.
    #rename(g: Group) {
        const input = document.createElement('input');
        input.value = g.group;
        let done = false;
        const end = (ok: boolean) => {
            if (done) return;
            done = true;
            if (ok && input.value.trim()) g.group = input.value.trim();
            this.#labelGroup(g);
            if (ok) this.#hooks.changed();
        };
        input.addEventListener('keydown', (e) => {
            e.stopPropagation();
            if (e.key === 'Enter' || e.key === 'Escape') end(e.key === 'Enter');
        });
        input.addEventListener('blur', () => end(true));
        input.addEventListener('pointerdown', (e) => e.stopPropagation()); // not a drag
        g.name_.querySelector('span')!.replaceWith(input);
        input.focus();
        input.select();
    }
    // A new group in `w`'s place, holding it; its name is edited at once.
    #group(w: Watch) {
        const n = this.#items.filter(isGroup).length;
        const g = this.#newGroup(`Group ${n + 1}`, groupColors[n % groupColors.length]);
        const at = this.#items.indexOf(w.group ?? w);
        this.#items.splice(w.group ? at + 1 : at, 0, g);
        this.#move(w, { parent: g, y: 0 });
        this.#hooks.changed();
        this.#rename(g);
    }
    #groupMenu(g: Group, x: number, y: number) {
        popupMenu(x, y, ({ menu, item, head, close }) => {
            head('Colour');
            const swatches = div('swatches');
            for (const c of groupColors) {
                const b = document.createElement('button');
                b.style.background = c;
                b.title = c;
                b.classList.toggle('on', c === g.color);
                b.addEventListener('click', () => { g.color = c; this.#render(); this.#hooks.changed(); close(); });
                swatches.append(b);
            }
            menu.append(swatches);
            item('Rename', false, () => this.#rename(g));
            item(g.collapsed ? 'Expand' : 'Collapse', false, () => this.#collapse(g, !g.collapsed));
            menu.append(document.createElement('hr'));
            item('Ungroup', false, () => {
                for (const w of g.items) w.group = undefined;
                this.#items.splice(this.#items.indexOf(g), 1, ...g.items);
                g.row.remove();
                this.#render();
                this.#hooks.changed();
            });
            item('Remove the group and its signals', false, () => {
                for (const w of [...g.items]) this.remove(w.id);
                this.#items.splice(this.#items.indexOf(g), 1);
                g.row.remove();
                this.#render();
                this.#hooks.changed();
            });
        });
    }

    // A row dragged by its name goes where it's dropped: among others, or
    // into a group (onto its header). A group only moves among the top level.
    #dragRow(item: Item) {
        const name = item.name_;
        name.addEventListener('pointerdown', (e) => {
            if (e.button !== 0 || (e.target as Element).closest('button, input')) return;
            const y0 = e.clientY;
            let drop: Drop | undefined;
            const move = (ev: PointerEvent) => {
                if (!drop && Math.abs(ev.clientY - y0) < 4) return;
                item.row.classList.add('dragging');
                drop = this.#dropAt(ev.clientY, item);
                const g = this.#grid.getBoundingClientRect();
                this.#dropLine.style.top = `${drop.y - g.top + this.#grid.scrollTop - 1}px`;
                this.#dropLine.hidden = false;
            };
            const up = () => {
                window.removeEventListener('pointermove', move);
                window.removeEventListener('pointerup', up);
                window.removeEventListener('pointercancel', up);
                item.row.classList.remove('dragging');
                this.#dropLine.hidden = true;
                if (drop) {
                    this.#move(item, drop);
                    this.#hooks.changed();
                }
            };
            window.addEventListener('pointermove', move);
            window.addEventListener('pointerup', up);
            window.addEventListener('pointercancel', up);
        });
    }
    #dropAt(y: number, item: Item): Drop {
        const rows: { item: Item, parent?: Group, r: DOMRect }[] = [];
        for (const i of this.#items) {
            if (i === item) continue;
            rows.push({ item: i, r: i.row.getBoundingClientRect() });
            if (isGroup(i) && !i.collapsed)
                for (const w of i.items) if (w !== item) rows.push({ item: w, parent: i, r: w.row.getBoundingClientRect() });
        }
        for (const { item: i, parent, r } of rows) {
            if (isGroup(i) && !isGroup(item) && y >= r.top + r.height / 4 && y < r.bottom)
                return { parent: i, before: i.items.find((w) => w !== item), y: r.bottom };
            if (y < r.top + r.height / 2) {
                if (isGroup(item) && parent) return { before: parent, y: parent.row.getBoundingClientRect().top };
                return { parent, before: i, y: r.top };
            }
        }
        const last = rows.at(-1)?.r;
        return { y: last ? last.bottom : this.#ruler.getBoundingClientRect().bottom };
    }
    #move(item: Item, { parent, before }: Drop) {
        const from = isGroup(item) ? this.#items : item.group?.items ?? this.#items;
        from.splice(from.indexOf(item), 1);
        const to = parent?.items ?? this.#items;
        const at = before ? to.indexOf(before as Watch) : -1;
        to.splice(at < 0 ? to.length : at, 0, item as Watch);
        if (!isGroup(item)) item.group = parent;
        this.#render();
    }

    #applyCols() {
        this.#grid.style.setProperty('--name-w', `${this.#cols[0]}px`);
        this.#grid.style.setProperty('--value-w', `${this.#cols[1]}px`);
    }

    #label(w: Watch) {
        w.name_.replaceChildren();
        if (w.pause) {
            const dot = document.createElement('span');
            dot.className = 'pause';
            dot.textContent = '●';
            dot.title = `Pauses the simulation when it ${w.pause.label}`;
            w.name_.append(dot);
        }
        const text = document.createElement('span');
        text.textContent = w.name;
        const more = document.createElement('button');
        more.className = 'codicon codicon-ellipsis';
        more.title = 'Format, pause the simulation on…, remove';
        more.addEventListener('click', (e) => { const r = more.getBoundingClientRect(); e.stopPropagation(); this.#openMenu(w, r.left, r.bottom); });
        w.name_.append(text, more);
        w.name_.title = w.name;
    }
    #width() {
        return Math.max(50, this.#ruler.clientWidth);
    }
    #span() {
        return this.#width() / this.#ppt;
    }
    #resize() {
        const dpr = window.devicePixelRatio || 1, W = this.#width();
        for (const c of [this.#ruler, ...[...this.#watches.values()].map((w) => w.canvas)]) {
            c.width = W * dpr;
            c.height = (c === this.#ruler ? 20 : ROW) * dpr;
        }
        if (this.#follow) this.#start = Math.max(0, this.#tick - this.#span());
        this.#ask();
    }
    #zoom(f: number, x = this.#width() / 2) {
        const t = this.#start + x / this.#ppt;
        this.#ppt = Math.min(100, Math.max(1e-9, this.#ppt * f));
        this.#start = this.#follow ? Math.max(0, this.#tick - this.#span()) : Math.max(0, t - x / this.#ppt);
        this.#ask();
    }
    #fit() {
        const first = Math.min(...[...this.#watches.values()].map((w) => w.data?.first ?? 0));
        this.#ppt = this.#width() / Math.max(1, this.#tick - first);
        this.#start = first;
        this.#ask();
    }
    // The simulation started or stopped.
    setRunning(on: boolean) {
        this.#running = on;
        this.#showBadge();
    }
    // PAUSED: the waveforms don't follow the simulation (which may still
    // run); RUNNING: they follow it while it runs; nothing while it's stopped.
    #showBadge() {
        const b = this.#badge, paused = !this.#follow;
        b.hidden = !paused && !this.#running;
        b.className = `badge ${paused ? 'paused' : 'running'}`;
        b.textContent = paused ? 'PAUSED' : 'RUNNING';
        b.title = paused ? 'The waveforms stopped following the simulation (it may still be running): click here or on a waveform to follow it again'
            : 'The waveforms follow the running simulation: click here or on a waveform to stop and look back';
    }

    #setFollow(on: boolean) {
        this.#follow = on;
        this.#followBtn.classList.toggle('on', on);
        this.#showBadge();
        this.#followBtn.title = on ? 'Following the simulation: click the waveform (or here) to stop'
            : 'Paused view: click the waveform (or here) to follow the simulation again';
        if (on) {
            this.#marker = undefined;
            this.#status.textContent = '';
            this.tick(this.#tick);
        }
    }

    // On a waveform: a click toggles following, a drag scrolls (and stops
    // following), Ctrl+wheel zooms, Shift+wheel scrolls; the pointer's time
    // shows the values there.
    #waveEvents() {
        const over = (e: Event) => e.target instanceof HTMLCanvasElement;
        const x = (e: MouseEvent) => e.clientX - this.#ruler.getBoundingClientRect().left;
        this.#grid.addEventListener('pointerdown', (e) => {
            if (!over(e) || e.button !== 0) return;
            const c = e.target as HTMLCanvasElement, x0 = e.clientX, s0 = this.#start;
            let dragged = false;
            const move = (ev: PointerEvent) => {
                if (!dragged && Math.abs(ev.clientX - x0) < 4) return;
                if (!dragged) {
                    dragged = true;
                    c.setPointerCapture(e.pointerId);
                    this.#setFollow(false);
                }
                this.#start = Math.max(0, s0 - (ev.clientX - x0) / this.#ppt);
                this.#ask();
            };
            const up = () => {
                c.removeEventListener('pointermove', move);
                if (!dragged) this.#setFollow(!this.#follow);
            };
            c.addEventListener('pointermove', move);
            c.addEventListener('pointerup', up, { once: true });
        });
        this.#grid.addEventListener('pointermove', (e) => {
            this.#hover = over(e) ? this.#start + x(e) / this.#ppt : undefined;
            this.#drawAll();
        });
        this.#grid.addEventListener('pointerleave', () => { this.#hover = undefined; this.#drawAll(); });
        this.#grid.addEventListener('wheel', (e) => {
            if (!over(e)) return;
            if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
                this.#zoom(Math.exp(-e.deltaY * 0.004), x(e));
            } else if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
                e.preventDefault();
                this.#setFollow(false);
                this.#start = Math.max(0, this.#start + (e.shiftKey ? e.deltaY : e.deltaX) / this.#ppt);
                this.#ask();
            }
        }, { passive: false });
    }

    #openMenu(w: Watch, x: number, y: number) {
        popupMenu(x, y, ({ menu, item, head, close }) => {
            if (w.bits > 1) {
                head('Format');
                for (const [b, l] of [['hex', 'hexadecimal'], ['dec', 'decimal'], ['dec2c', 'signed decimal'], ['oct', 'octal'], ['bin', 'binary']])
                    item(l, w.base === b, () => { w.base = b; this.#drawAll(); this.#hooks.changed(); });
            }
            head('Pause the simulation when it…');
            const pauses: Pause[] = w.bits === 1 ? bitPauses : [{ label: 'changes', values: null }];
            for (const p of pauses) item(p.label, w.pause?.label === p.label, () => { this.#setPause(w, p); this.#hooks.changed(); });
            if (w.bits > 1) {
                const input = document.createElement('input');
                input.placeholder = `equals… (${w.base}), Enter`;
                if (w.pause?.values) input.value = show(w.base, w.pause.values[0]);
                input.addEventListener('keydown', (e) => {
                    if (e.key !== 'Enter') return;
                    const v = read(w.base, input.value, w.bits);
                    input.classList.toggle('invalid', v === undefined);
                    if (v === undefined) return;
                    this.#setPause(w, { label: `equals ${show(w.base, v)}`, values: [v] });
                    this.#hooks.changed();
                    close();
                });
                menu.append(input);
            }
            item('never', !w.pause, () => { this.#setPause(w, undefined); this.#hooks.changed(); });
            head('Group');
            item('New group', false, () => this.#group(w));
            const moved = (d: Drop) => () => { this.#move(w, d); this.#hooks.changed(); };
            for (const g of this.#items.filter(isGroup)) if (g !== w.group) item(`Move to ${g.group}`, false, moved({ parent: g, y: 0 }));
            if (w.group) item('Out of the group', false, moved({ before: this.#items[this.#items.indexOf(w.group) + 1], y: 0 }));
            menu.append(document.createElement('hr'));
            item('Remove', false, () => { this.remove(w.id); this.#hooks.changed(); });
        });
    }

    #setPause(w: Watch, p: Pause | undefined) {
        if (w.triggerId !== undefined) this.#hooks.untrigger(w.triggerId);
        w.triggerId = undefined;
        w.pause = p;
        if (p) w.triggerId = this.#hooks.trigger(w.path, w.port, p.values);
        this.#label(w);
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
        const res = await this.#hooks.request({ op: 'wave', watches: [...this.#watches.keys()], from, to, bins: this.#width() });
        this.#asking = false;
        if (res) { // none: the engine reloaded meanwhile (a reset)
            this.#tick = Math.max(this.#tick, res.tick);
            for (const [id, win] of Object.entries(res.waves as Record<string, Win>)) {
                const w = this.#watches.get(Number(id));
                if (w) w.data = win;
            }
            this.#drawAll();
        }
        if (this.#again) {
            this.#again = false;
            this.#ask();
        }
    }

    // The value at `t`, '…' inside a column of several changes.
    #valueAt(w: Watch, t: number) {
        const d = w.data;
        if (!d) return '';
        let v = d.start ?? '';
        for (const [tick, value, last] of d.changes) {
            if (tick > t) break;
            if (last !== undefined && t < last) return '…';
            v = value;
        }
        return v;
    }

    #drawAll() {
        const t = this.#time(this.#span() / 10);
        const end = Math.min(this.#tick, this.#start + this.#span());
        this.#range.textContent = `${t(this.#start)} – ${t(this.#start + this.#span())}`;
        this.#drawRuler();
        for (const w of this.#watches.values()) {
            this.#draw(w);
            const v = this.#valueAt(w, this.#hover ?? end);
            w.value_.textContent = v && v !== '…' ? show(w.base, v) : v;
            w.value_.style.color = /^z+$/.test(v) ? this.#colors.highImpedance : /[xz]/.test(v) ? this.#colors.undefined : '';
        }
    }

    // Labels for times `res` ticks apart.
    #time(res: number) {
        return (tick: number) => formatTimeAt(Math.max(0, tick) * this.#tickSec, res * this.#tickSec);
    }

    #drawRuler() {
        const c = this.#ruler.getContext('2d')!, dpr = window.devicePixelRatio || 1, W = this.#width();
        c.setTransform(dpr, 0, 0, dpr, 0, 0);
        c.fillStyle = this.#colors.background;
        c.fillRect(0, 0, W, 20);
        const st = step(this.#ppt, 90), t = this.#time(st);
        c.font = '10px sans-serif';
        c.textBaseline = 'middle';
        c.fillStyle = this.#colors.foreground;
        c.strokeStyle = this.#colors.foreground;
        c.lineWidth = 1;
        for (let k = Math.ceil(this.#start / st) * st; k <= this.#start + this.#span(); k += st) {
            const x = Math.round((k - this.#start) * this.#ppt) + 0.5;
            c.beginPath(); c.moveTo(x, 14); c.lineTo(x, 20); c.stroke();
            c.fillText(t(k), x + 3, 8);
        }
        this.#lines(c, 20);
    }

    // The hover line and the trigger marker.
    #lines(c: CanvasRenderingContext2D, H: number) {
        const at = (tick: number, color: string, width: number) => {
            const x = (tick - this.#start) * this.#ppt;
            if (x < 0 || x > this.#width()) return;
            c.strokeStyle = color;
            c.lineWidth = width;
            c.beginPath(); c.moveTo(x, 0); c.lineTo(x, H); c.stroke();
        };
        if (this.#marker !== undefined) at(this.#marker, this.#colors.cursor, 2);
        if (this.#hover !== undefined) {
            c.globalAlpha = 0.5;
            at(this.#hover, this.#colors.foreground, 1);
            c.globalAlpha = 1;
        }
    }

    #draw(w: Watch) {
        const c = w.canvas.getContext('2d')!, dpr = window.devicePixelRatio || 1, W = this.#width(), H = ROW;
        const col = this.#colors;
        c.setTransform(dpr, 0, 0, dpr, 0, 0);
        c.clearRect(0, 0, W, H);
        // grid on the ruler's lines
        const st = step(this.#ppt, 90);
        c.strokeStyle = col.grid;
        c.lineWidth = 1;
        for (let k = Math.ceil(this.#start / st) * st; k <= this.#start + this.#span(); k += st) {
            const x = Math.round((k - this.#start) * this.#ppt) + 0.5;
            c.beginPath(); c.moveTo(x, 0); c.lineTo(x, H); c.stroke();
        }
        const d = w.data;
        const signal = w.group?.color ?? col.signal;
        if (d) {
            const x = (t: number) => Math.min(W, Math.max(0, (t - this.#start) * this.#ppt));
            const hy = 4, ly = H - 4, my = H / 2;
            const segs: [number, string, number?][] = [];
            if (d.start !== null) segs.push([this.#start, d.start]);
            for (const ch of d.changes) segs.push([ch[0], ch[1], ch[2]]);
            c.lineWidth = 2;
            c.font = '11px sans-serif';
            c.textAlign = 'center';
            c.textBaseline = 'middle';
            segs.forEach(([t0, v, dense], i) => {
                const end = Math.min(this.#tick, i + 1 < segs.length ? segs[i + 1][0] : this.#tick);
                if (end < t0) return;
                let a = x(t0);
                const b = x(end);
                const undef = /[xz]/.test(v), highz = /^z+$/.test(v);
                const color = highz ? col.highImpedance : undef ? col.undefined : signal;
                if (dense !== undefined) {
                    // several changes in one pixel column
                    const e = Math.max(x(dense), a + 1);
                    c.fillStyle = signal;
                    c.globalAlpha = 0.6;
                    c.fillRect(a, hy, e - a, ly - hy);
                    c.globalAlpha = 1;
                    a = e;
                }
                c.strokeStyle = color;
                c.fillStyle = color;
                if (w.bits === 1) {
                    const y = v === '1' ? hy : v === '0' ? ly : my;
                    if (v === '1' || (undef && !highz)) {
                        c.globalAlpha = col.fillOpacity;
                        c.fillRect(a, hy, b - a, ly - hy);
                        c.globalAlpha = 1;
                    }
                    c.beginPath();
                    if (i > 0 && dense === undefined) c.moveTo(a, hy), c.lineTo(a, ly); // the edge
                    c.moveTo(a, y);
                    c.lineTo(b, y);
                    c.stroke();
                } else if (highz) {
                    c.beginPath(); c.moveTo(a, my); c.lineTo(b, my); c.stroke();
                } else {
                    // a hexagon, crossing at each change
                    const g = Math.min(3, (b - a) / 2);
                    c.beginPath();
                    c.moveTo(a, my); c.lineTo(a + g, hy); c.lineTo(b - g, hy); c.lineTo(b, my);
                    c.lineTo(b - g, ly); c.lineTo(a + g, ly); c.closePath();
                    if (undef) {
                        c.globalAlpha = col.fillOpacity;
                        c.fill();
                        c.globalAlpha = 1;
                    }
                    c.stroke();
                    // as much of the value as fits, like Surfer
                    let txt = undef ? 'x' : show(w.base, v);
                    const room = b - a - 2 * g - 4;
                    if (c.measureText(txt).width > room) {
                        let n = txt.length;
                        while (n > 0 && c.measureText(txt.slice(0, n) + '…').width > room) n--;
                        txt = n > 0 ? txt.slice(0, n) + '…' : '';
                    }
                    if (txt) {
                        c.fillStyle = col.foreground;
                        c.fillText(txt, (a + b) / 2, my + 1);
                    }
                }
            });
        }
        this.#lines(c, H);
    }
}
