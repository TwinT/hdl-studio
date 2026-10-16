//

'use strict';

import { WebviewMsgQueue } from './webview_msg_queue.mjs';
import { nativeControls } from './webview_style.mjs';

let view_id = 1;

export class SynthProvider {
    #studio
    constructor(studio) {
        this.#studio = studio;
    }
    #processCommand(message, view, context) {
        switch (message.command) {
            case 'do-synth':
                this.#studio.doSynth();
                return;
            case 'update-options':
                if (message.options._doc_id == this.#studio.doc_id) {
                    delete message.options._doc_id;
                    this.#studio.synth_options = message.options;
                }
                return;
        }
    }
    #extendedOptions() {
        return { ...this.#studio.synth_options, _doc_id: this.#studio.doc_id };
    }
    async #extendedState() {
        return { options: this.#extendedOptions(),
                topModules: await this.#studio.topModuleCandidates() };
    }
    async resolveWebviewView(view, context, _token) {
        const synth_uri = view.webview.asWebviewUri(this.#studio.synthJSPath);
        const icon_uri = view.webview.asWebviewUri(this.#studio.codIconsPath);
        view.webview.options = {
            enableScripts: true
        };
        const queue = new WebviewMsgQueue(view.webview);
        const refresh_options = async () => {
            queue.post({ command: "update-options", ...await this.#extendedState() });
        };
        let first_init = true;
        view.webview.onDidReceiveMessage((msg) => {
            // we don't really care what message it is but if we've got a message
            // then the initialization has finished...
            queue.release();
            if (msg.command == 'init') {
                if (first_init) {
                    first_init = false;
                }
                else {
                    // If the view is reinited, it might have missed many update events.
                    // Send an update to make sure the view catches up with the changes...
                    refresh_options();
                }
                return;
            }
            this.#processCommand(msg, view.webview, context);
        });
        const option_listener = this.#studio.synthOptionUpdated(refresh_options);
        const sources_listener = this.#studio.sourcesUpdated(refresh_options);
        view.onDidDispose(() => {
            option_listener.dispose();
            sources_listener.dispose();
        });
        const init_state = await this.#extendedState();
        view.webview.html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <script>
    window.view_id = ${view_id++}
    window.init_state = ${JSON.stringify(init_state)};
  </script>
  <script type="module" src="${synth_uri}"></script>
  <link href="${icon_uri}" rel="stylesheet"/>
  <style>
    body { padding: 8px 10px 12px; }
${nativeControls}
    #do-synth { padding: 2px 10px; font-size: 12px; }
    /* tabs like VS Code's panel titles */
    .tabs { display: flex; gap: 14px; margin: 10px 0 4px; border-bottom: 1px solid var(--vscode-panel-border); }
    .tabs button {
      background: none; border: none; padding: 4px 0; cursor: pointer; font: inherit;
      font-size: 11px; letter-spacing: 0.04em; text-transform: uppercase;
      color: var(--vscode-panelTitle-inactiveForeground, var(--vscode-descriptionForeground));
      border-bottom: 1px solid transparent; margin-bottom: -1px;
    }
    .tabs button.active {
      color: var(--vscode-panelTitle-activeForeground, var(--vscode-foreground));
      border-bottom-color: var(--vscode-panelTitle-activeBorder, var(--vscode-focusBorder));
    }
    .tabs button:focus-visible { outline: 1px solid var(--vscode-focusBorder); }
    .tab[hidden] { display: none; }
    .opt { margin: 6px 0; }
    .field { margin: 8px 0; }
    .field > label { display: block; font-size: 12px; opacity: 0.9; margin-bottom: 3px; }
    select { width: 100%; }
  </style>
</head>
<body>
  <button id="do-synth" class="primary" title="Synthesize the circuit's sources with Yosys"><i class="codicon codicon-run"></i> Synthesize</button>
  <div class="tabs" role="tablist">
    <button role="tab" class="active" data-tab="synthesis">Synthesis</button>
    <button role="tab" data-tab="diagram">Diagram</button>
  </div>
  <div class="tab" id="synthesis">
    <div class="field">
      <label for="top">Top module</label>
      <select title="Module to treat as the top of the design. 'Auto' lets Yosys figure it out (or, when the slang frontend is used, lets it auto-detect the same way)." id="top">
        <option value="">Auto</option>
      </select>
    </div>
    <label class="check opt" title="Enables Yosys optimizations of the synthesized circuit. This might make the circuit differ significantly to its HDL specification. This corresponds to the 'opt -full' Yosys command."><input type="checkbox" id="opt"> Optimize in Yosys</label>
    <label class="check opt" title="Decomposes complex cells (adders, comparators, muxes, ...) into basic logic gates. This corresponds to the 'techmap' Yosys command."><input type="checkbox" id="techmap"> Decompose to basic gates</label>
    <div class="field">
      <label for="fsm">FSM</label>
      <select title="Enables finite state machine processing in Yosys. This corresponds to the 'fsm' and 'fsm -nomap' Yosys commands." id="fsm">
        <option value="no">No FSM transform</option>
        <option value="yes">FSM transform</option>
        <option value="nomap">FSM as circuit element</option>
      </select>
    </div>
    <label class="check opt" title="This corresponds to the 'fsm_expand' Yosys command."><input type="checkbox" id="fsmexpand"> Merge more logic into FSM</label>
  </div>
  <div class="tab" id="diagram" hidden>
    <label class="check opt" title="Enables post-processing of Yosys output to reduce the number of components and improve readability."><input type="checkbox" id="transform" checked> Simplify diagram</label>
    <label class="check opt" title="Makes combinational gates propagate with zero delay, so a combinational path settles within a single tick instead of one tick per gate. Applies when the circuit is (re)built."><input type="checkbox" id="defaultcomb"> Zero combinational propagation delay</label>
  </div>
</body>
</html>`;
    }
}
