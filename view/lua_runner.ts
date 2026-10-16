// Lua scripts and the REPL, run inside the engine (crates/hdlstudio/src/lua.rs).

export interface Channel {
    send(req: any): void;
    listen(fn: (ev: any) => void): () => void;
}

interface Vscode { postMessage(msg: any): void }

// What the circuit view gives the runner.
export interface Sim {
    readonly running: boolean;
    startSim(): void;
    pauseSim(): void;
    updateRunStates(): void;
}

type Handler = (...args: any[]) => void;

// One script (or the REPL) in the engine, with the interface digitaljs_lua's
// LuaRunner had. Events come back asynchronously, except that stopping a
// script reports it at once, as digitaljs_lua did.
export class EngineLuaRunner {
    #channel: Channel;
    #repl: boolean;
    #unlisten: () => void;
    #handlers: Record<string, Handler[]> = {};
    #pid = 0;
    #running: { pid: number, name: string } | null = null;
    djs_name = '';
    djs_label = '';
    running_pid?: number;
    constructor(channel: Channel, repl: boolean) {
        this.#channel = channel;
        this.#repl = repl;
        this.#unlisten = channel.listen((ev) => this.#handle(ev));
    }
    on(event: string, fn: Handler) {
        (this.#handlers[event] ??= []).push(fn);
    }
    #trigger(event: string, ...args: any[]) {
        for (const fn of this.#handlers[event] || []) fn(...args);
    }
    #handle(ev: any) {
        const r = this.#running;
        if (!r || ev.name !== r.name) return;
        switch (ev.ev) {
            case 'lua_print':
                this.#trigger('print', ev.messages);
                return;
            case 'lua_error':
                this.#trigger('thread:error', r.pid, { luaMessage: ev.message });
                return;
            case 'lua_stopped':
                this.#running = null;
                this.#trigger('thread:stop', r.pid);
                return;
        }
    }
    runThread(script: string) {
        const pid = ++this.#pid;
        this.#running = { pid, name: this.djs_name };
        this.#channel.send({ op: 'lua_run', name: this.djs_name, script, repl: this.#repl, label: this.djs_label });
        return pid;
    }
    isThreadRunning(pid: number) {
        return this.#running?.pid === pid;
    }
    stopThread(pid: number) {
        if (!this.isThreadRunning(pid)) return;
        this.#channel.send({ op: 'lua_stop', name: this.#running!.name, repl: this.#repl });
        this.#running = null;
        this.#trigger('thread:stop', pid);
    }
    shutdown() {
        this.#unlisten();
    }
}

// Only one Lua execution (a script or the REPL) drives the circuit at a
// time; the REPL queues its inputs. Running one starts the simulation, and
// the simulation pauses when it ends.
export class LuaRunner {
    #vscode: Vscode;
    #channel: Channel;
    #sim: Sim;
    #runners: Record<string, EngineLuaRunner> = {};
    #repl_runner?: EngineLuaRunner;
    #repl_queue: { name: string, script: string, label: string }[] = [];
    #switching = false;
    constructor(vscode: Vscode, channel: Channel, sim: Sim) {
        this.#vscode = vscode;
        this.#channel = channel;
        this.#sim = sim;
    }
    #getRunner(name: string, isrepl: boolean, label: string) {
        if (isrepl && this.#repl_runner) {
            this.#repl_runner.djs_name = name;
            this.#repl_runner.djs_label = label;
            return this.#repl_runner;
        }
        const runner = new EngineLuaRunner(this.#channel, isrepl);
        runner.djs_name = name;
        runner.djs_label = label;
        runner.on('thread:stop', () => {
            this.#vscode.postMessage({ command: 'luastop', name: runner.djs_name, isrepl });
            if (!this.#switching) {
                if (!(isrepl && this.#repl_queue.length > 0))
                    this.#sim.pauseSim();
                this.#sim.updateRunStates();
            }
            if (!isrepl || this.#repl_queue.length <= 0)
                return;
            const next = this.#repl_queue.shift()!;
            this.#run(next.name, next.script, true, next.label);
        });
        runner.on('thread:error', (_pid, e) => {
            this.#vscode.postMessage({ command: 'luaerror', name: runner.djs_name, message: e.luaMessage, isrepl, label: runner.djs_label });
        });
        runner.on('print', (msgs) => {
            this.#vscode.postMessage({ command: 'luaprint', name: runner.djs_name, messages: msgs, isrepl, label: runner.djs_label });
        });
        if (isrepl) this.#repl_runner = runner;
        else this.#runners[name] = runner;
        return runner;
    }
    run(name: string, script: string, isrepl: boolean, label: string) {
        const busy = (r?: EngineLuaRunner) => r && r.running_pid !== undefined && r.isThreadRunning(r.running_pid);
        if (isrepl && busy(this.#repl_runner)) {
            this.#repl_queue.push({ name, script, label });
            return;
        }
        // #switching keeps the stops below from pausing the simulation
        this.#switching = true;
        try {
            for (const other of Object.keys(this.#runners))
                this.stop(other, false, false);
            if (!isrepl)
                this.stop('', true, false);
        } finally {
            this.#switching = false;
        }
        this.#run(name, script, isrepl, label);
    }
    get active() {
        const busy = (r?: EngineLuaRunner) => !!r && r.running_pid !== undefined && r.isThreadRunning(r.running_pid);
        return this.#repl_queue.length > 0 || busy(this.#repl_runner) || Object.values(this.#runners).some(busy);
    }
    #run(name: string, script: string, isrepl: boolean, label: string) {
        label = label || name;
        const runner = this.#getRunner(name, isrepl, label);
        // sim.sleep/sim.wait wake up only while the circuit runs
        if (!this.#sim.running)
            this.#sim.startSim();
        runner.running_pid = runner.runThread(script);
        this.#vscode.postMessage({ command: 'luastarted', name, isrepl });
    }
    stop(name: string, isrepl: boolean, quit: boolean) {
        const runner = isrepl ? this.#repl_runner : this.#runners[name];
        if (!runner) return;
        if (!isrepl) {
            delete this.#runners[name];
        } else {
            if (quit) this.#repl_runner = undefined;
            this.#repl_queue.length = 0;
        }
        const pid = runner.running_pid;
        if (pid !== undefined && runner.isThreadRunning(pid)) {
            runner.stopThread(pid);
            delete runner.running_pid;
        }
    }
    shutdown() {
        for (const r of Object.values(this.#runners)) r.shutdown();
        this.#runners = {};
    }
}
