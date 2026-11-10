//

'use strict';

import * as vscode from 'vscode';
import * as child_process from 'child_process';
import * as readline from 'readline';
import * as base64 from 'base64-arraybuffer';
import { hdlstudio_bin } from './hdlstudio_bin.mjs';
import { WebviewMsgQueue } from './webview_msg_queue.mjs';
import { get_dirname_uri, read_txt_file, write_txt_file } from './utils.mjs';

const config = () => vscode.workspace.getConfiguration('hdl-studio');
const waveColors = () => config().get('waveform.colors');

export class CircuitView {
    #panel
    #document
    #queue
    #init
    #studio
    #subcircuits = {}
    // the simulation engine of this view (`hdlstudio serve`), started on
    // the webview's first request
    #engine
    #engineSession
    #disposed = false
    constructor(studio, panel, document) {
        this.#studio = studio;
        this.#panel = panel;
        this.#document = document;
        this.#queue = new WebviewMsgQueue(this.#panel.webview);
        this.#panel.iconPath = studio.iconPath; // currently no effect for custom editor
        this.onDidDispose = this.#panel.onDidDispose;
        this.onDidChangeViewState = this.#panel.onDidChangeViewState;
        this.#panel.webview.onDidReceiveMessage((msg) => {
            this.#queue.release();
            this.#processCommand(studio, msg);
        });
        let circuit_listener = this.#document.circuitUpdated(opts => {
            this.#showCircuit({ ...opts, pause: false });
            this.reveal();
        });
        // the waveform monitor shows time in the project's units; the colours are the user's
        const timescale_listener = this.#document.synthOptionUpdated(() =>
            this.post({ command: 'timescale', value: this.#document.synth_options.timescale }));
        // the sources changed since the synthesis (Document#checkStale); back
        // in front, check again: a file edited outside VS Code says nothing
        const stale_listener = this.#document.staleChanged((value) => this.post({ command: 'stale', value }));
        const front_listener = this.#panel.onDidChangeViewState(() => {
            if (this.#panel.active)
                this.#document.checkStale(0);
        });
        // the editor's cursor in one of this circuit's sources: its line's cells
        let line_timer;
        const cursor_listener = vscode.window.onDidChangeTextEditorSelection((e) => {
            clearTimeout(line_timer);
            line_timer = setTimeout(() => this.showSourceLine(e.textEditor), 100);
        });
        const colors_listener = vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration('hdl-studio.theme') || e.affectsConfiguration('hdl-studio.waveform'))
                this.post({ command: 'theme', theme: config().get('theme'), waveColors: waveColors() });
            if (e.affectsConfiguration('hdl-studio.labels'))
                this.post({ command: 'labels', value: config().get('labels') });
        });
        this.onDidDispose(() => {
            circuit_listener.dispose();
            timescale_listener.dispose();
            stale_listener.dispose();
            front_listener.dispose();
            cursor_listener.dispose();
            clearTimeout(line_timer);
            colors_listener.dispose();
            this.#disposed = true;
            this.#engine?.kill();
        });
        this.#panel.webview.html = this.#getViewContent(studio, this.#panel.webview);
        this.#init = Promise.resolve();
        this.#showCircuit({ run: false, pause: true }); // force pause
    }
    get panel() {
        return this.#panel;
    }
    get document() {
        return this.#document;
    }
    get subcircuits() {
        return this.#subcircuits;
    }
    init() {
        return this.#init;
    }
    #engineSend(req) {
        if (req.op === 'load')
            this.#engineSession = req.session;
        if (!this.#engine)
            this.#startEngine();
        this.#engine.stdin.write(JSON.stringify(req) + '\n');
    }
    #startEngine() {
        const proc = child_process.spawn(hdlstudio_bin(), ['serve'], { stdio: ['pipe', 'pipe', 'pipe'] });
        this.#engine = proc;
        const fail = (message) => {
            if (this.#engine === proc)
                this.#engine = undefined;
            if (this.#disposed)
                return;
            vscode.window.showErrorMessage(`Simulation: ${message}`);
            this.post({ command: 'engine', ev: { ev: 'error', session: this.#engineSession, message } });
        };
        readline.createInterface({ input: proc.stdout }).on('line', (line) => {
            let ev;
            try {
                ev = JSON.parse(line);
            } catch {
                console.error(`hdlstudio: not an event: ${line}`);
                return;
            }
            if (ev.ev === 'error')
                vscode.window.showErrorMessage(`Simulation: ${ev.message}`);
            this.post({ command: 'engine', ev });
        });
        proc.stderr.on('data', (d) => console.error(`hdlstudio: ${d}`));
        proc.stdin.on('error', () => {}); // a dead engine is reported by 'exit'
        proc.on('error', (e) => fail(e.code === 'ENOENT' ?
            `the engine is missing (${hdlstudio_bin()}). Run "npm run compile".` : e.message));
        proc.on('exit', (code, signal) => {
            const live = this.#engine === proc; // not one that failed to start
            fail(`the engine stopped (${signal || code})`);
            // the view loads the circuit again, which starts another engine
            if (live && !this.#disposed)
                this.post({ command: 'engine', ev: { ev: 'exit', session: this.#engineSession } });
        });
    }
    // Lights the cells the line under `editor`'s cursor made (`reveal`: and
    // centres them). Nothing for a file that isn't a source of this circuit;
    // none lit for one edited since the synthesis (its lines moved). False if
    // nothing could be lit.
    showSourceLine(editor, reveal = false) {
        const info = this.#document.sources.findByURI(editor.document.uri);
        if (!info?.name)
            return false;
        const synced = info.findEditor()?.document === editor.document;
        this.post({ command: 'srcline', reveal,
                    ...(synced ? { file: info.name, line: editor.selection.active.line + 1 } : {}) });
        return synced;
    }
    #processCommand(studio, msg) {
        switch (msg.command) {
            case 'engine':
                this.#engineSend(msg.req);
                return;
            case 'subcircuits':
                this.#subcircuits = msg.subcircuits;
                return;
            case 'settheme':
                return config().update('theme', msg.theme, vscode.ConfigurationTarget.Global);
            case 'setlabels':
                return config().update('labels', msg.value, vscode.ConfigurationTarget.Global);
            case 'savewaves':
                return this.#saveWaves(msg.config);
            case 'loadwaves':
                return this.#loadWaves();
            case 'saveimg-error':
                return vscode.window.showErrorMessage(
                    `Unable to save image ${msg.uri}: ${msg.message}`);
            case 'saveimg': {
                const uri = vscode.Uri.parse(msg.uri);
                if (msg.base64) {
                    const data = base64.decode(msg.data);
                    return vscode.workspace.fs.writeFile(uri, new Uint8Array(data));
                }
                else {
                    return write_txt_file(uri, msg.data);
                }
            }
            case 'img-exts':
                studio.image_exts = msg.exts;
                return;
            case 'focus':
                this.reveal();
                return;
        }
        this.#document.processCommand(msg);
    }
    // The waveform monitor's layout (signals, groups, columns) as a file.
    async #saveWaves(config) {
        const name = this.#document.uri.path.split('/').pop().replace(/\.[^.]*$/, '');
        const dir = get_dirname_uri(this.#document.uri);
        const uri = await vscode.window.showSaveDialog({
            defaultUri: dir && vscode.Uri.joinPath(dir, `${name}.waves.json`),
            filters: { 'Waveform layout': ['json'] },
        });
        if (uri)
            await write_txt_file(uri, JSON.stringify({ hdlstudio: 'waves', ...config }, null, 2) + '\n');
    }
    async #loadWaves() {
        const [uri] = await vscode.window.showOpenDialog({
            defaultUri: get_dirname_uri(this.#document.uri),
            filters: { 'Waveform layout': ['json'] },
        }) ?? [];
        if (!uri)
            return;
        let config;
        try {
            config = JSON.parse(await read_txt_file(uri));
        }
        catch (e) {
            return vscode.window.showErrorMessage(`Unable to read ${uri.fsPath}: ${e.message}`);
        }
        if (!Array.isArray(config?.waves))
            return vscode.window.showErrorMessage(`${uri.fsPath} isn't a waveform layout`);
        this.post({ command: 'wavesconfig', config });
    }
    #showCircuit(opts) {
        this.post({
            command: 'showcircuit',
            circuit: this.#document.circuit,
            // defaultcomb is applied when the circuit is (re)built, so it
            // travels with the circuit, not yosys
            opts: { ...opts,
                    defaultcomb: this.#document.synth_options.defaultcomb,
                    timescale: this.#document.synth_options.timescale,
                    theme: config().get('theme'),
                    labels: config().get('labels'),
                    stale: this.#document.stale,
                    waveColors: waveColors(),
                    view: this.#document.viewState,
                    speed: this.#studio.speedOf(this.#document) }
        });
    }
    #getViewContent(studio, webview) {
        return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <script>window.getImageSupport = ${!studio.image_exts_set};</script>
  <script type="module" src="${webview.asWebviewUri(studio.schematicJSPath)}"></script>
  <link href="${webview.asWebviewUri(studio.codIconsPath)}" rel="stylesheet"/>
  <title>HDL Studio</title>
</head>
<body><div id="paper"></div></body>
</html>`;
    }
    reveal() {
        const col = this.#panel.viewColumn;
        // If viewColumn doesn't contain a valid column number,
        // vscode will attempt to show the view in the current column
        // which will create a new view for the editor and messes everything up...
        if (!col || col < 0)
            return;
        // Ignore focusing request if already active.
        if (this.#panel.active)
            return;
        this.#panel.reveal(col);
    }
    post(msg) {
        this.#queue.post(msg);
    }
}
