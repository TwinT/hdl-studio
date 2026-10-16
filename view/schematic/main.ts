// The circuit view: the schematic of the document's circuit, simulated by
// the extension's engine (`hdlstudio serve`, through the extension host).
// Speaks the host protocol the digitaljs view (view/main.mjs) did.

import './style.css';
import * as imgutils from '../imgutils.mjs';
import { LuaRunner } from '../lua_runner';
import { CircuitData, Connector, Device, GraphData, isInput, isOutput, shape } from './cells';
import { Dialog } from './dialog';
import { fsmView } from './fsm';
import { layout } from './layout';
import { MemContents, memoryEditor } from './memory';
import { Schematic } from './schematic';
import { Monitor, WatchSpec } from './waves';
import { parseTime } from '../../src/time_units.mjs';

declare function acquireVsCodeApi(): { postMessage(msg: any): void };
const vscode = acquireVsCodeApi();

const engineChannel = (() => {
    const listeners = new Set<(ev: any) => void>();
    return {
        send: (req: any) => vscode.postMessage({ command: 'engine', req }),
        listen: (fn: (ev: any) => void) => {
            listeners.add(fn);
            return () => { listeners.delete(fn); };
        },
        dispatch: (ev: any) => { for (const fn of [...listeners]) fn(ev); },
    };
})();

const empty = (c?: CircuitData) =>
    !c || (!Object.keys(c.devices ?? {}).length && !(c.connectors ?? []).length && !Object.keys(c.subcircuits ?? {}).length);

// The circuit without its layout, to tell a moved cell from a new circuit.
const netlist = (c: CircuitData) =>
    JSON.stringify(c, (k, v) => (k === 'position' || k === 'vertices' || k === 'numbase' ? undefined : v));

const graphOf = (path: string) => path.slice(0, path.lastIndexOf('/') + 1);

interface View {
    schematic: Schematic;
    dialog?: Dialog;
    exportId?: number;
}

// A memory editor or FSM diagram.
interface Extra {
    dialog: Dialog;
    update(): void;
    close(): void;
    svg?: SVGSVGElement;
    exportId?: number;
}

class App {
    circuit?: CircuitData;
    #opts: any = {};
    #session = 0;
    #running: false | 'normal' | 'fast' = false;
    #tick = 0;
    #pending = false;
    #speed: number | null = 100;
    // open graphs by path prefix ('' is the top level)
    #views = new Map<string, View>();
    #extras = new Map<string, Extra>(); // by cell path
    #mems = new Map<string, MemContents>();
    #fsmStates = new Map<string, number>();
    #io = new Map<string, string>(); // what the control panel shows, by top-level cell
    #lua: LuaRunner;
    #reqId = 0;
    #acks = new Map<number, (result: any) => void>();
    #alarms = new Map<number, () => void>();
    #triggers = new Set<number>(); // the monitor's (they stop the simulation)
    #exportIds = 0;
    #monitor: Monitor;

    constructor() {
        this.#lua = new LuaRunner(vscode, engineChannel, this);
        this.#monitor = new Monitor(document.body, {
            send: (req) => this.#send(req),
            request: (req) => this.#request(req),
            trigger: (path, port, values) => {
                // values null: any change
                const id = ++this.#reqId;
                this.#triggers.add(id);
                this.#send({ op: 'monitor', id, path, port, triggers: values, stop: true });
                return id;
            },
            untrigger: (id) => {
                this.#triggers.delete(id);
                this.#send({ op: 'unmonitor', id });
            },
        });
        engineChannel.listen((ev) => { if (ev.session === this.#session) this.#engineEvent(ev); });
        window.addEventListener('message', (e) => this.#message(e.data));
        for (const t of ['touchstart', 'mousedown', 'click'])
            window.addEventListener(t, () => vscode.postMessage({ command: 'focus' }), { capture: true, passive: true });
        this.updateRunStates();
        vscode.postMessage({ command: 'initialized' });
        if ((window as any).getImageSupport)
            vscode.postMessage({ command: 'img-exts', exts: imgutils.supportedExts() });
    }

    get running() {
        return this.#running !== false;
    }

    #message(m: any) {
        switch (m.command) {
            case 'engine': return engineChannel.dispatch(m.ev);
            case 'iopanel:update': return this.#ioFromPanel(m.id, m.value);
            case 'showcircuit':
                if ('speed' in m.opts) this.#speed = m.opts.speed;
                this.#monitor.setTimescale(m.opts.timescale, parseTime);
                this.#monitor.setColors(m.opts.waveColors);
                return this.#show(m.circuit, m.opts);
            case 'timescale': return this.#monitor.setTimescale(m.value, parseTime);
            case 'wavecolors': return this.#monitor.setColors(m.colors);
            case 'setspeed':
                this.#speed = m.speed;
                if (this.#running) {
                    this.#send({ op: 'stop' });
                    this.#running = false;
                    this.startSim();
                }
                return;
            case 'resetsim': return this.#reset();
            case 'runfor': return this.#runFor(m.ticks);
            case 'pausesim': return this.pauseSim();
            case 'startsim': return this.startSim();
            case 'singlestepsim': return this.#step(false);
            case 'nexteventsim': return this.#step(true);
            case 'runlua': return this.#lua.run(m.name, m.script, m.isrepl, m.label);
            case 'stoplua': return this.#lua.stop(m.name, m.isrepl, m.quit);
            case 'exportimage': return this.#exportImage(m);
        }
    }

    // ---- the engine

    #send(req: any) {
        engineChannel.send(req);
    }
    #request(req: any) {
        const id = ++this.#reqId;
        return new Promise<any>((resolve) => {
            this.#acks.set(id, resolve);
            this.#send({ ...req, id });
        });
    }
    #load() {
        this.#session = Math.floor(Math.random() * 2 ** 31);
        this.#running = false;
        this.#tick = 0;
        for (const mem of this.#mems.values()) mem.reset();
        this.#fsmStates.clear();
        this.#send({ op: 'load', session: this.#session, circuit: this.circuit, defaultcomb: !!this.#opts.defaultcomb });
        for (const g of this.#views.keys()) this.#send({ op: 'observe', graph: g });
        this.#triggers.clear();
        this.#monitor.reloaded();
    }
    #engineEvent(ev: any) {
        switch (ev.ev) {
            case 'update': {
                this.#tick = ev.tick;
                const changedPending = this.#pending !== ev.pending;
                this.#pending = ev.pending;
                const byGraph = new Map<string, [string, string, string][]>();
                for (const [path, port, value] of ev.changes) {
                    const g = graphOf(path);
                    if (!byGraph.has(g)) byGraph.set(g, []);
                    byGraph.get(g)!.push([path.slice(g.length), port, value]);
                }
                for (const [g, changes] of byGraph) this.#views.get(g)?.schematic.apply(changes);
                for (const [path, addr, value] of ev.mems) this.#mem(path)?.set(addr, value);
                for (const [path, state] of ev.states) this.#fsmStates.set(path, state);
                if (byGraph.has('')) this.#ioToPanel();
                for (const x of this.#extras.values()) x.update();
                vscode.postMessage({ command: 'tick', tick: ev.tick });
                this.#monitor.tick(ev.tick);
                if (changedPending) this.updateRunStates();
                return;
            }
            case 'monitor':
                // a waveform trigger fired: the engine stopped
                if (ev.stop && this.#triggers.has(ev.id)) {
                    this.#monitor.fired(ev.id, ev.tick);
                    if (this.#running) {
                        this.#running = false;
                        this.updateRunStates();
                    }
                }
                return;
            case 'ack':
                this.#acks.get(ev.id)?.(ev.result);
                this.#acks.delete(ev.id);
                return;
            case 'alarm': {
                const fn = this.#alarms.get(ev.id);
                this.#alarms.delete(ev.id);
                if (ev.stop && fn) {
                    this.#running = false;
                    this.updateRunStates();
                }
                fn?.();
                return;
            }
            case 'error':
                console.error('hdlstudio engine:', ev.message);
                if (this.#running) {
                    this.#running = false;
                    this.updateRunStates();
                }
                return;
        }
    }

    startSim() {
        if (!this.circuit || this.#running) return;
        if (this.#speed === null) {
            this.#send({ op: 'start_fast' });
            this.#running = 'fast';
        } else {
            this.#send({ op: 'interval', ms: 1000 / this.#speed });
            this.#send({ op: 'start' });
            this.#running = 'normal';
        }
        this.updateRunStates();
    }
    pauseSim() {
        if (!this.#running) return;
        this.#send({ op: 'stop' });
        this.#running = false;
        this.updateRunStates();
    }
    async #step(next: boolean) {
        if (!this.circuit || this.#running) return;
        await this.#request({ op: 'step', next, sync: true });
        this.updateRunStates();
    }
    // `ticks` ticks flat out, then pause.
    async #runFor(ticks: number) {
        if (!this.circuit) return;
        await this.#request({ op: 'stop', sync: true });
        const id = ++this.#reqId;
        this.#alarms.set(id, () => {});
        this.#send({ op: 'alarm', id, tick: this.#tick + ticks, stop: true });
        this.#send({ op: 'start_fast' });
        this.#running = 'fast';
        this.updateRunStates();
    }
    // Back to tick 0 with the initial memory contents; keeps the layout,
    // the open windows and edited parameters (a clock's period).
    #reset() {
        if (!this.circuit) return;
        this.#lua.shutdown();
        this.#load();
        this.updateRunStates();
        for (const v of this.#views.values()) v.schematic.render();
        vscode.postMessage({ command: 'tick', tick: 0 });
    }
    updateRunStates() {
        vscode.postMessage({
            command: 'runstate', hascircuit: !!this.circuit, running: this.running,
            pendingEvents: this.#pending, luaActive: this.#lua.active,
        });
    }

    // ---- showing a circuit

    async #show(data: CircuitData, opts: any) {
        const run = opts.run ? true : opts.pause ? false : this.running;
        const old = this.circuit;
        const transforms = new Map([...this.#views].map(([g, v]) => [g, v.schematic.transform]));
        if (opts.keep && old && data && !empty(data) && netlist(old) === netlist(data)) {
            // only the layout changed (undo/redo of a move): redraw, the
            // simulation goes on
            this.circuit = data;
            for (const [g, v] of this.#views) this.#rebuild(g, v);
            return;
        }
        this.#closeAll();
        this.#mems.clear();
        // the waveforms of a new circuit start afresh, with the same signals
        // where they still exist
        const watched = this.#monitor.specs;
        this.#monitor.clear();
        this.circuit = empty(data) ? undefined : data;
        this.#opts = opts;
        const paper = document.getElementById('paper')!;
        paper.replaceChildren();
        if (!this.circuit) {
            this.#running = false;
            paper.innerHTML = '<div class="nocircuit"><h1>No active circuit.</h1><button><i class="codicon codicon-run"></i> Synthesize</button></div>';
            paper.querySelector('button')!.addEventListener('click', () => vscode.postMessage({ command: 'do-synth' }));
            this.#ioView();
            this.updateRunStates();
            return;
        }
        this.circuit.subcircuits ??= {};
        const top = this.#schematic(this.circuit, '', paper);
        this.#views.set('', { schematic: top });
        this.#load();
        for (const w of watched) if (this.#watchSpec(w.path, w.port)?.name === w.name) this.#monitor.add(w);
        await this.#layout(top);
        top.render();
        if (opts.keep && transforms.has('')) top.transform = transforms.get('')!;
        else top.home();
        this.#ioView();
        if (run) this.startSim();
        this.updateRunStates();
    }

    #schematic(graph: GraphData, prefix: string, container: HTMLElement) {
        const subcircuits = this.circuit!.subcircuits!;
        return new Schematic(container, graph, {
            top: prefix === '', subcircuits,
            hooks: {
                setInput: (id, v) => this.#setInput(prefix + id, v),
                setParam: (id, name, value) => {
                    this.#send({ op: 'set_param', path: prefix + id, name, value });
                    if (prefix === '' && graph.devices[id].type === 'Clock')
                        vscode.postMessage({ command: 'iopanel:update', id, value });
                },
                open: (id) => this.#open(prefix, id),
                marker: (item) => this.#marker(item),
                moved: () => vscode.postMessage({ command: 'updatecircuit', circuit: this.circuit, type: 'pos', ele_type: 'Device' }),
                watch: (c) => {
                    const spec = this.#watchSpec(prefix + c.from.id, c.from.port);
                    if (spec) this.#monitor.add(spec);
                },
            },
        });
    }

    // Lays out a graph that has no layout yet, and saves the layout with the
    // document as part of the last edit.
    async #layout(s: Schematic) {
        if (!s.needsLayout) return;
        const res = await layout(s.graph, s.shapes);
        for (const [id, p] of Object.entries(res.positions)) s.graph.devices[id].position = p;
        s.graph.connectors.forEach((c: Connector, i: number) => {
            if (res.vertices[i]?.length) c.vertices = res.vertices[i];
            else delete c.vertices;
        });
        vscode.postMessage({ command: 'autolayout', circuit: this.circuit });
    }

    #rebuild(g: string, v: View) {
        const graph = g === '' ? this.circuit! : this.#graphAt(g);
        if (!graph) return;
        const t = v.schematic.transform;
        const container = v.schematic.svg.parentElement as HTMLElement;
        v.schematic.destroy();
        v.schematic = this.#schematic(graph, g, container);
        v.schematic.render();
        v.schematic.transform = t;
        this.#send({ op: 'observe', graph: g });
    }

    // The graph of the subcircuit at path prefix "dev3/dev7/".
    #graphAt(prefix: string): GraphData | undefined {
        let graph: GraphData = this.circuit!;
        for (const id of prefix.split('/').slice(0, -1)) {
            const d = graph.devices[id];
            if (d?.type !== 'Subcircuit') return;
            graph = this.circuit!.subcircuits![d.celltype!];
        }
        return graph;
    }

    async #open(prefix: string, id: string) {
        const graph = prefix === '' ? this.circuit! : this.#graphAt(prefix)!;
        const d = graph.devices[id];
        const path = prefix + id;
        if (d.type === 'Subcircuit') {
            const g = path + '/';
            if (this.#views.has(g)) return;
            const dialog = new Dialog(`${d.celltype} ${d.label ?? ''}`, () => {
                this.#views.get(g)?.schematic.destroy();
                this.#views.delete(g);
                this.#send({ op: 'unobserve', graph: g });
                this.#subcircuitList();
            });
            const s = this.#schematic(this.circuit!.subcircuits![d.celltype!], g, dialog.body);
            const view: View = { schematic: s, dialog, exportId: ++this.#exportIds };
            this.#views.set(g, view);
            this.#send({ op: 'observe', graph: g });
            await this.#layout(s);
            s.render();
            const b = s.bbox();
            dialog.fit(b.width + 60, b.height + 60);
            s.home({ w: dialog.body.clientWidth, h: dialog.body.clientHeight });
            this.#subcircuitList();
            return;
        }
        if (this.#extras.has(path)) return;
        const schematic = this.#views.get(prefix)!.schematic;
        if (d.type === 'Memory') {
            const mem = this.#mem(path)!;
            const addr = (port: string) => {
                const v = schematic.value(id, port);
                return /[xz]/.test(v) ? undefined : parseInt(v, 2) - (d.offset ?? 0);
            };
            const ed = memoryEditor(d, mem, {
                reads: () => d.rdports.map((_: any, i: number) => addr(`rd${i}addr`)),
                writes: () => d.wrports.map((_: any, i: number) => addr(`wr${i}addr`)),
            }, (a, value) => this.#send({ op: 'mem_write', path, addr: a, value }));
            const dialog = new Dialog(`Memory contents: ${d.label ?? ''}`, () => { ed.close(); this.#extras.delete(path); });
            dialog.body.appendChild(ed.root);
            dialog.center();
            this.#extras.set(path, { dialog, update: ed.update, close: ed.close });
        } else if (d.type === 'FSM') {
            const fsm = await fsmView(d);
            const dialog = new Dialog(`FSM: ${d.label ?? ''}`, () => { this.#extras.delete(path); this.#subcircuitList(); });
            dialog.body.appendChild(fsm.svg);
            const update = () => fsm.update(this.#fsmStates.get(path) ?? d.init_state, schematic.value(id, 'in'));
            update();
            dialog.fit(Number(fsm.svg.getAttribute('width')) + 10, Number(fsm.svg.getAttribute('height')) + 10);
            this.#extras.set(path, { dialog, update, close: () => {}, svg: fsm.svg, exportId: ++this.#exportIds });
            this.#subcircuitList();
        }
    }

    // The waveform of the output at `path`.`port`, named like digitaljs did:
    // the subcircuit labels, then the net's name (or the cell label and port).
    #watchSpec(path: string, port: string): WatchSpec | undefined {
        const prefix = graphOf(path), id = path.slice(prefix.length);
        const graph = prefix === '' ? this.circuit : this.#graphAt(prefix);
        const d = graph?.devices[id];
        const p = d && shape(d, prefix === '', this.circuit!.subcircuits!).ports.find((q) => q.id === port && q.dir === 'out');
        if (!graph || !p) return;
        const names: string[] = [];
        let g: GraphData = this.circuit!;
        for (const sub of prefix.split('/').slice(0, -1)) {
            names.push(g.devices[sub].label ?? sub);
            g = this.circuit!.subcircuits![g.devices[sub].celltype!];
        }
        const net = graph.connectors.find((c) => c.from.id === id && c.from.port === port)?.name;
        names.push(...(net ? [net] : [graph.devices[id].label ?? id, port]));
        return { path, port, name: names.join('.'), bits: p.bits };
    }

    #mem(path: string) {
        let mem = this.#mems.get(path);
        if (!mem) {
            const prefix = graphOf(path), graph = prefix === '' ? this.circuit : this.#graphAt(prefix);
            const d = graph?.devices[path.slice(prefix.length)];
            if (d?.type !== 'Memory') return;
            this.#mems.set(path, mem = new MemContents(d));
        }
        return mem;
    }

    #closeAll() {
        for (const x of [...this.#extras.values()]) x.dialog.close();
        for (const [g, v] of [...this.#views]) {
            if (v.dialog) v.dialog.close();
            else v.schematic.destroy();
            this.#views.delete(g);
        }
        this.#lua.shutdown();
    }

    // The open subcircuit and FSM windows, for "Export Circuit As Image".
    #subcircuitList() {
        const list: Record<number, { title: string, type: string }> = {};
        for (const v of this.#views.values())
            if (v.dialog) list[v.exportId!] = { title: v.dialog.title, type: 'Subcircuit' };
        for (const x of this.#extras.values())
            if (x.exportId) list[x.exportId] = { title: x.dialog.title, type: 'FSM' };
        vscode.postMessage({ command: 'subcircuits', subcircuits: list });
    }

    #marker(item: Device | Connector | null) {
        const markers = [];
        for (const pos of item?.source_positions ?? []) {
            if (!pos.from || !pos.to) continue;
            const m = { name: pos.name, from_line: pos.from.line - 1, from_col: pos.from.column - 1,
                        to_line: pos.to.line - 1, to_col: pos.to.column - 1 };
            if (m.from_line >= 0 && m.to_line >= 0 && m.from_col >= 0 && m.to_col >= 0) markers.push(m);
        }
        vscode.postMessage(markers.length ? { command: 'showmarker', markers } : { command: 'clearmarker' });
    }

    // ---- the control panel's inputs and outputs (top level only)

    #ioRows() {
        const devices = Object.entries(this.circuit?.devices ?? {});
        return [
            ...devices.filter(([, d]) => d.type === 'Clock'),
            ...devices.filter(([, d]) => isInput(d)),
            ...devices.filter(([, d]) => isOutput(d)),
        ];
    }
    #ioValue(id: string, d: Device) {
        const s = this.#views.get('')!.schematic;
        return d.type === 'Clock' ? d.propagation ?? 100 : isInput(d) ? s.value(id, 'out') : s.value(id, 'in');
    }
    #ioView() {
        this.#io.clear();
        const view = this.#ioRows().map(([id, d]) => {
            const value = this.#ioValue(id, d);
            this.#io.set(id, String(value));
            return {
                id, label: d.net || d.label, value,
                dir: d.type === 'Clock' ? 'clock' : isInput(d) ? 'input' : 'output',
                type: d.type, bits: d.bits ?? 1,
                ...(d.type === 'LEDMatrix' ? { rows: d.rows, cols: d.cols } : {}),
            };
        });
        vscode.postMessage({ command: 'iopanel:view', view });
    }
    #ioToPanel() {
        for (const [id, d] of this.#ioRows()) {
            const value = String(this.#ioValue(id, d));
            if (this.#io.get(id) === value) continue;
            this.#io.set(id, value);
            vscode.postMessage({ command: 'iopanel:update', id, value: d.type === 'Clock' ? Number(value) : value });
        }
    }
    #ioFromPanel(id: string, value: any) {
        const d = this.circuit?.devices[id];
        if (!d) return;
        if (d.type === 'Clock') {
            d.propagation = value;
            this.#io.set(id, String(value));
            this.#send({ op: 'set_param', path: id, name: 'propagation', value });
            this.#views.get('')?.schematic.render();
        } else if (isInput(d)) {
            this.#setInput(id, value);
        }
    }
    #setInput(path: string, value: string) {
        this.#send({ op: 'set_input', path, value });
        // shown at once, the engine confirms it with its next update
        const g = graphOf(path);
        this.#views.get(g)?.schematic.apply([[path.slice(g.length), 'out', value]]);
        if (g === '') this.#ioToPanel();
    }

    // ---- export

    async #exportImage(m: any) {
        const reply = (data: string, base64: boolean) => vscode.postMessage({ command: 'saveimg', data, base64, uri: m.uri });
        const fail = (message: string) => vscode.postMessage({ command: 'saveimg-error', uri: m.uri, message });
        if (!this.circuit) return fail('No active circuit');
        let svg: SVGSVGElement | undefined;
        if (!m.subcircuit) svg = this.#views.get('')?.schematic.svg;
        else {
            for (const v of this.#views.values())
                if (v.exportId === m.subcircuit && v.dialog?.title === m.subcircuit_title) svg = v.schematic.svg;
            for (const x of this.#extras.values())
                if (x.exportId === m.subcircuit && x.dialog.title === m.subcircuit_title) svg = x.svg;
        }
        if (!svg) return fail('Unable to find subcircuit');
        // the drawing at zoom 1, without the pan
        const opts = { stripAttr: true, replaceInput: true, global_postclone: (c: SVGSVGElement) => c.querySelector(':scope > g')?.removeAttribute('transform') };
        try {
            if (m.type === 'image/svg+xml') return reply(imgutils.toSvg(svg, opts)!, false);
            const url = (await imgutils.toCanvas(svg, opts))!.toDataURL(m.type, 1);
            const prefix = `data:${m.type};base64,`;
            if (!url.startsWith(prefix)) return fail(`Unsupported image type ${m.type}`);
            return reply(url.slice(prefix.length), true);
        } catch (e) {
            console.error(e);
            return fail('Unknown error');
        }
    }
}

new App();
