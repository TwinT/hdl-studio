//
'use strict';

// The digitaljs engine API on hdlstudio's engine (`hdlstudio serve`, a
// child process of the extension host; protocol in
// crates/hdlstudio/src/serve.rs), so the digitaljs UI runs on the Rust
// simulator until it is replaced. It mirrors the main-thread half of
// digitaljs's WorkerEngine (engines/worker.mjs), addressing gates by path
// ("dev3/dev12"). Goes away with digitaljs.
//
// A channel carries the messages: { send(request), listen(fn) -> unlisten }.

import { util } from '@joint/core';
import { BaseEngine } from '../node_modules/digitaljs/src/engines/base.mjs';
import * as cells from '../node_modules/digitaljs/src/cells.mjs';
import { Vector4vl } from '@twint/4vl';

const vec = (bin) => Vector4vl.fromBin(bin, bin.length);

// The circuit as digitaljs serializes it (HeadlessCircuit.toJSON(false)).
function serialize(graph) {
    const subcircuits = {};
    const fromGraph = (graph) => {
        const ret = { devices: {}, connectors: [] };
        for (const elem of graph.getElements()) {
            const args = ret.devices[elem.get('id')] = elem.getGateParams(false);
            delete args.position;
            if (elem instanceof cells.Subcircuit && !subcircuits[elem.get('celltype')])
                subcircuits[elem.get('celltype')] = fromGraph(elem.get('graph'));
        }
        for (const link of graph.getLinks())
            ret.connectors.push(link.getWireParams(false));
        return ret;
    };
    const ret = fromGraph(graph);
    ret.subcircuits = subcircuits;
    return ret;
}

export class RemoteEngine extends BaseEngine {
    constructor(graph, { channel }) {
        super(graph);
        this._channel = channel;
        // an integer: a float may not come back exactly through serde_json
        this._session = Math.floor(Math.random() * 2 ** 31);
        this._running = false;
        this._tickCache = 0;
        this._pendingEventsCache = false;
        this._observers = new Map();
        this._paths = new Map([[graph, '']]);
        this._graphs = new Map([['', graph]]);
        this._monitors = Object.create(null);
        this._alarms = Object.create(null);
        this._promises = Object.create(null);
        this._uniqueCounter = 0;
        this._loaded = false;
        this._unlisten = channel.listen((ev) => {
            if (ev.session === this._session) this._handle(ev);
        });
        this.interval = 10;
        this._addGraph(graph);
        this._load();
    }
    _send(req) {
        this._channel.send(req);
    }
    _load() {
        this._reloading = false;
        this._send({ op: 'load', session: this._session, circuit: serialize(this._graph) });
        for (const [graph, count] of this._observers)
            if (count > 0) this._send({ op: 'observe', graph: this._paths.get(graph) });
        this._loaded = true;
    }
    // ponytail: a circuit edit reloads the engine (from tick 0), where the
    // worker took gates and links one by one and kept its state
    _structureChanged() {
        if (!this._loaded || this._reloading) return;
        this._reloading = true;
        Promise.resolve().then(() => this._load());
    }
    _path(graph, gate) {
        return this._paths.get(graph) + gate.id;
    }
    _addGate(graph, gate) {
        if (gate instanceof cells.Subcircuit) {
            const sub = gate.get('graph');
            const prefix = this._path(graph, gate) + '/';
            this._paths.set(sub, prefix);
            this._graphs.set(prefix, sub);
        }
        super._addGate(graph, gate);
        if (gate instanceof cells.Input && gate.get('mode') != 0) {
            this.listenTo(gate, 'change:outputSignals', (gate, sigs) => {
                if (gate.previous('outputSignals').out.eq(sigs.out)) return;
                this._send({ op: 'set_input', path: this._path(gate.graph, gate), value: sigs.out.toBin() });
            });
        }
        if (gate instanceof cells.Memory) {
            this.listenTo(gate, 'memChange', (addr, data) => gate.memdata.set(addr, data));
            this.listenTo(gate, 'manualMemChange', (gate, addr, data) => {
                this._send({ op: 'mem_write', path: this._path(gate.graph, gate), addr, value: data.toBin() });
            });
        }
        for (const name of gate._gateParams) {
            if (gate._unsupportedPropChanges.includes(name) || gate._presentationParams.includes(name)) continue;
            this.listenTo(gate, 'change:' + name, (gate, value) => {
                this._send({ op: 'set_param', path: this._path(gate.graph, gate), name, value });
            });
        }
        this._structureChanged();
    }
    _addLink() {
        this._structureChanged();
    }
    _removeGate(graph, gate) {
        this.stopListening(gate);
        this._structureChanged();
    }
    _removeLink() {
        this._structureChanged();
    }
    _changeLinkSource() {
        this._structureChanged();
    }
    _changeLinkTarget() {
        this._structureChanged();
    }
    _changeLinkWarning() {
        this._structureChanged();
    }
    get hasPendingEvents() {
        return this._pendingEventsCache;
    }
    get tick() {
        return this._tickCache;
    }
    get running() {
        return this._running != false;
    }
    get interval() {
        return this._interval;
    }
    set interval(ms) {
        this._interval = ms;
        this._send({ op: 'interval', ms });
    }
    shutdown() {
        this._send({ op: 'stop' });
        this._unlisten();
        this.stopListening();
    }
    synchronize() {
        const [id, promise] = this._promise();
        this._send({ op: 'ping', id, sync: true });
        return promise;
    }
    _step(next, synchronous) {
        if (this._running)
            throw new Error(`${next ? 'updateGatesNext' : 'updateGates'} while running`);
        const [id, promise] = this._promise();
        this._send({ op: 'step', id, next, sync: synchronous });
        return promise;
    }
    updateGatesNext({ synchronous = false } = {}) {
        return this._step(true, synchronous);
    }
    updateGates({ synchronous = false } = {}) {
        return this._step(false, synchronous);
    }
    start() {
        if (this.running) throw new Error('start while running');
        this._send({ op: 'start' });
        this._running = true;
        this.trigger('changeRunning');
    }
    startFast() {
        if (this.running) throw new Error('startFast while running');
        this._send({ op: 'start_fast' });
        this._running = 'fast';
        this.trigger('changeRunning');
    }
    stop({ synchronous = false } = {}) {
        if (!this._running) return;
        const [id, promise] = this._promise();
        this._send({ op: 'stop', id, sync: synchronous });
        this._running = false;
        this.trigger('changeRunning');
        return promise;
    }
    observeGraph(graph) {
        const n = (this._observers.get(graph) || 0) + 1;
        this._observers.set(graph, n);
        if (n == 1) this._send({ op: 'observe', graph: this._paths.get(graph) });
    }
    unobserveGraph(graph) {
        const n = (this._observers.get(graph) || 0) - 1;
        this._observers.set(graph, n);
        if (n == 0) this._send({ op: 'unobserve', graph: this._paths.get(graph) });
    }
    monitor(gate, port, callback, { triggerValues, stopOnTrigger, oneShot } = {}) {
        const id = this._uniqueCounter++;
        this._monitors[id] = callback;
        this._send({ op: 'monitor', id, path: this._path(gate.graph, gate), port,
                     triggers: triggerValues ? triggerValues.map((v) => v.toBin()) : null,
                     stop: !!stopOnTrigger, once: !!oneShot });
        return id;
    }
    unmonitor(id) {
        if (!(id in this._monitors)) return;
        this._send({ op: 'unmonitor', id });
        delete this._monitors[id];
    }
    alarm(tick, callback, { stopOnAlarm } = {}) {
        const id = this._uniqueCounter++;
        this._alarms[id] = callback;
        this._send({ op: 'alarm', id, tick, stop: !!stopOnAlarm });
        return id;
    }
    unalarm(id) {
        if (!(id in this._alarms)) return;
        this._send({ op: 'unalarm', id });
        delete this._alarms[id];
    }
    _gate(path) {
        const i = path.lastIndexOf('/') + 1;
        return this._graphs.get(path.slice(0, i))?.getCell(path.slice(i));
    }
    _handle(ev) {
        switch (ev.ev) {
            case 'update': {
                const changeRunning = this._pendingEventsCache != ev.pending;
                this._tickCache = ev.tick;
                this._pendingEventsCache = ev.pending;
                const byGate = new Map();
                for (const [path, port, value] of ev.changes) {
                    const gate = this._gate(path);
                    if (!gate) continue;
                    if (!byGate.has(gate)) byGate.set(gate, {});
                    byGate.get(gate)[port] = vec(value);
                }
                for (const [gate, outputs] of byGate) {
                    util.defaults(outputs, gate.get('outputSignals'));
                    gate.set('outputSignals', outputs);
                }
                for (const [path, addr, value] of ev.mems)
                    this._gate(path)?.trigger('memChange', addr, vec(value));
                for (const [path, state] of ev.states)
                    this._gate(path)?.set('current_state', state);
                this.trigger('postUpdateGates', ev.tick);
                if (changeRunning) this.trigger('changeRunning');
                return;
            }
            case 'ack': {
                const resolve = this._promises[ev.id];
                delete this._promises[ev.id];
                if (resolve) resolve(ev.result ?? undefined);
                return;
            }
            case 'monitor': {
                const callback = this._monitors[ev.id];
                if (callback === undefined) return;
                if (ev.once) delete this._monitors[ev.id];
                this._resumeAfterCallback(ev.stop, callback(ev.tick, vec(ev.value)));
                return;
            }
            case 'alarm': {
                const callback = this._alarms[ev.id];
                if (callback === undefined) return;
                delete this._alarms[ev.id];
                this._resumeAfterCallback(ev.stop, callback());
                return;
            }
            case 'error':
                console.error('hdlstudio engine:', ev.message);
                this.trigger('engine:error', ev.message);
                if (this._running) {
                    this._running = false;
                    this.trigger('changeRunning');
                }
                return;
        }
    }
    // As the worker's: a monitor or alarm that stopped the run resumes it
    // unless its callback returned true (or stopped it itself).
    _resumeAfterCallback(stopped, ret) {
        if (!stopped) return;
        if (ret) {
            this._running = false;
            this.trigger('changeRunning');
            return;
        }
        if (this._running)
            this._send({ op: this._running == 'fast' ? 'start_fast' : 'start' });
    }
    _promise() {
        const id = this._uniqueCounter++;
        return [id, new Promise((resolve) => { this._promises[id] = resolve; })];
    }
}
