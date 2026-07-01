//

'use strict';

import { WebviewMsgQueue } from './webview_msg_queue.mjs';

let view_id = 1;

export class SynthProvider {
    #djs
    constructor(djs) {
        this.#djs = djs;
    }
    #processCommand(message, view, context) {
        switch (message.command) {
            case 'do-synth':
                this.#djs.doSynth();
                return;
            case 'update-options':
                if (message.options._doc_id == this.#djs.doc_id) {
                    delete message.options._doc_id;
                    this.#djs.synth_options = message.options;
                }
                return;
        }
    }
    #extendedOptions() {
        return { ...this.#djs.synth_options, _doc_id: this.#djs.doc_id };
    }
    resolveWebviewView(view, context, _token) {
        const ui_uri = view.webview.asWebviewUri(this.#djs.uiToolkitPath);
        const synth_uri = view.webview.asWebviewUri(this.#djs.synthJSPath);
        const icon_uri = view.webview.asWebviewUri(this.#djs.codIconsPath);
        view.webview.options = {
            enableScripts: true
        };
        const queue = new WebviewMsgQueue(view.webview);
        const refresh_options = () => {
            queue.post({ command: "update-options", options: this.#extendedOptions() });
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
        const option_listener = this.#djs.synthOptionUpdated(refresh_options);
        view.onDidDispose(() => {
            option_listener.dispose();
        });
        view.webview.html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <script>
    window.view_id = ${view_id++}
    window.init_options = ${JSON.stringify(this.#extendedOptions())};
  </script>
  <script type="module" src="${ui_uri}"></script>
  <script type="module" src="${synth_uri}"></script>
  <link href="${icon_uri}" rel="stylesheet"/>
  <style>
    body { padding: 8px 10px 12px; }
    .group { margin-bottom: 12px; }
    .group > summary {
      cursor: pointer;
      margin-bottom: 8px;
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      opacity: 0.6;
    }
    /* No flex around the checkboxes: a vscode-checkbox inside a flex container
       blockifies and stacks its own label. Each checkbox sits in a plain block
       wrapper so the rows stack while the checkbox keeps box + label on one line. */
    .opt { margin: 5px 0; }
    .field { margin: 8px 0; }
    .field > label { display: block; font-size: 12px; opacity: 0.9; margin-bottom: 3px; }
    vscode-dropdown { width: 100%; }
    #do-synth { width: 100%; margin-top: 2px; }
  </style>
</head>
<body>
  <details class="group" open>
    <summary>Synthesis</summary>
    <div class="group-body">
      <div class="opt"><vscode-checkbox id="opt" title="Enables Yosys optimizations of the synthesized circuit. This might make the circuit differ significantly to its HDL specification. This corresponds to the 'opt -full' Yosys command.">Optimize in Yosys</vscode-checkbox></div>
      <div class="opt"><vscode-checkbox id="techmap" title="Decomposes complex cells (adders, comparators, muxes, ...) into basic logic gates. This corresponds to the 'techmap' Yosys command.">Decompose to basic gates</vscode-checkbox></div>
      <div class="field">
        <label for="fsm">FSM</label>
        <vscode-dropdown title="Enables finite state machine processing in Yosys. This corresponds to the 'fsm' and 'fsm -nomap' Yosys commands." id="fsm">
          <vscode-option value="no">No FSM transform</vscode-option>
          <vscode-option value="yes">FSM transform</vscode-option>
          <vscode-option value="nomap">FSM as circuit element</vscode-option>
        </vscode-dropdown>
      </div>
      <div class="opt"><vscode-checkbox id="fsmexpand" title="This corresponds to the 'fsm_expand' Yosys command.">Merge more logic into FSM</vscode-checkbox></div>
    </div>
  </details>

  <details class="group" open>
    <summary>Diagram</summary>
    <div class="group-body">
      <div class="opt"><vscode-checkbox id="transform" checked title="Enables post-processing of Yosys output to reduce the number of components and improve readability.">Simplify diagram</vscode-checkbox></div>
      <div class="opt"><vscode-checkbox id="defaultcomb" title="Makes combinational gates propagate with zero delay, so a combinational path settles within a single tick instead of one tick per gate. Applies when the circuit is (re)built.">Zero combinational propagation delay</vscode-checkbox></div>
      <div class="field">
        <label for="layout">Layout</label>
        <vscode-dropdown title="Auto-layout engine for the diagram. Applies to a freshly synthesized circuit (existing layouts keep their saved positions)." id="layout">
          <vscode-option value="elkjs" selected>ELK</vscode-option>
          <vscode-option value="dagre">Dagre</vscode-option>
        </vscode-dropdown>
      </div>
    </div>
  </details>

  <vscode-divider></vscode-divider>
  <vscode-button id="do-synth"><i slot="start" class="codicon codicon-run"></i> Synthesize</vscode-button>
</body>
</html>`;
    }
}
