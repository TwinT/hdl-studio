//

'use strict';

import * as vscode from 'vscode';
import * as child_process from 'child_process';
import * as readline from 'readline';
import * as base64 from 'base64-arraybuffer';
import { hdlstudio_bin } from './hdlstudio_bin.mjs';
import { WebviewMsgQueue } from './webview_msg_queue.mjs';
import { write_txt_file } from './utils.mjs';

const waveColors = () => vscode.workspace.getConfiguration('hdl-studio').get('waveform.colors');

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
        // the waveform monitor shows time in the project's units, in the user's colours
        const timescale_listener = this.#document.synthOptionUpdated(() =>
            this.post({ command: 'timescale', value: this.#document.synth_options.timescale }));
        const colors_listener = vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration('hdl-studio.waveform'))
                this.post({ command: 'wavecolors', colors: waveColors() });
        });
        this.onDidDispose(() => {
            circuit_listener.dispose();
            timescale_listener.dispose();
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
            const ev = JSON.parse(line);
            if (ev.ev === 'error')
                vscode.window.showErrorMessage(`Simulation: ${ev.message}`);
            this.post({ command: 'engine', ev });
        });
        proc.stderr.on('data', (d) => console.error(`hdlstudio: ${d}`));
        proc.stdin.on('error', () => {}); // a dead engine is reported by 'exit'
        proc.on('error', (e) => fail(e.code === 'ENOENT' ?
            `the engine is missing (${hdlstudio_bin()}). Run "npm run compile".` : e.message));
        proc.on('exit', (code, signal) => fail(`the engine stopped (${signal || code})`));
    }
    #processCommand(studio, msg) {
        switch (msg.command) {
            case 'engine':
                this.#engineSend(msg.req);
                return;
            case 'subcircuits':
                this.#subcircuits = msg.subcircuits;
                return;
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
    #showCircuit(opts) {
        this.post({
            command: 'showcircuit',
            circuit: this.#document.circuit,
            // defaultcomb is applied when the circuit is (re)built, so it
            // travels with the circuit, not yosys
            opts: { ...opts,
                    defaultcomb: this.#document.synth_options.defaultcomb,
                    timescale: this.#document.synth_options.timescale,
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
