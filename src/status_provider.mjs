//

'use strict';

import { WebviewMsgQueue } from './webview_msg_queue.mjs';

export class StatusProvider {
    #djs
    constructor(djs) {
        this.#djs = djs;
    }
    resolveWebviewView(view, context, _token) {
        const ui_uri = view.webview.asWebviewUri(this.#djs.uiToolkitPath);
        const status_uri = view.webview.asWebviewUri(this.#djs.statusJSPath);
        const icon_uri = view.webview.asWebviewUri(this.#djs.codIconsPath);
        view.webview.options = {
            enableScripts: true
        };
        const queue = new WebviewMsgQueue(view.webview);
        view.webview.onDidReceiveMessage((msg) => {
            // we don't really care what message it is but if we've got a message
            // then the initialization has finished...
            queue.release();
            switch (msg.command) {
                case 'iopanel:update':
                    this.#djs.postPanelMessage({ command: 'iopanel:update',
                                                 id: msg.id, value: msg.value });
                    return;
                case 'panel-cmd':
                    // extra fields (e.g. runfor's `ticks`) travel with the command
                    this.#djs.postPanelMessage({ ...msg, command: msg.panel_cmd });
                    return;
                case 'settimescale':
                    this.#djs.setTimescale(msg.value);
                    return;
                case 'setspeed':
                    this.#djs.simSpeed = msg.speed;
                    return;
            }
        });
        const listeners = [];
        listeners.push(this.#djs.tickUpdated(async (tick) => {
            queue.post({ command: 'tick', tick });
        }));
        listeners.push(this.#djs.iopanelMessage(async (message) => {
            queue.post(message);
        }));
        listeners.push(this.#djs.runStatesUpdated(async (state) => {
            queue.post({ command: 'runstate', state });
        }));
        // also fires on document switch
        listeners.push(this.#djs.synthOptionUpdated(async () => {
            queue.post({ command: 'timescale', value: this.#djs.synth_options.timescale || '1ns' });
        }));
        view.onDidDispose(() => {
            for (const listener of listeners) {
                listener.dispose();
            }
        });
        const rs = this.#djs.runStates;
        const enabled = b => b ? '' : 'disabled';
        view.webview.html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <script>
    window.init_view = ${JSON.stringify(this.#djs.iopanelViews)};
    window.init_timescale = ${JSON.stringify(this.#djs.synth_options.timescale || '1ns')};
    window.init_speed = ${JSON.stringify(this.#djs.simSpeed)};
    window.init_tick = ${JSON.stringify(this.#djs.tick || 0)};
  </script>
  <script type="module" src="${ui_uri}"></script>
  <script type="module" src="${status_uri}"></script>
  <link href="${icon_uri}" rel="stylesheet"/>
  <style>
    /* Only --vscode-* theme variables, so it follows light and dark themes. */
    body {
      display: flex; flex-direction: column; height: 100vh; box-sizing: border-box;
      padding-top: 6px; padding-bottom: 6px;
    }
    .djs-muted { color: var(--vscode-descriptionForeground); }
    .djs-mono { font-family: var(--vscode-editor-font-family); font-variant-numeric: tabular-nums; }
    .djs-toolbar { display: flex; align-items: center; gap: 2px; flex: none; }
    .djs-toolbar .djs-sep {
      width: 1px; height: 16px; margin: 0 4px; background: var(--vscode-panel-border);
    }
    vscode-button[disabled].djs-start-stop-button { display: none !important; }
    vscode-button[disabled] { opacity: 0.35; }

    .djs-time { flex: none; margin: 8px 0 2px; line-height: 1.2; }
    .djs-time-main { font-size: 20px; letter-spacing: -0.02em; }
    .djs-time-sub { font-size: 11px; }

    .djs-section { flex: none; }
    .djs-section-header {
      display: flex; justify-content: space-between; align-items: baseline;
      margin: 12px 0 6px; padding-top: 8px;
      border-top: 1px solid var(--vscode-sideBarSectionHeader-border, var(--vscode-panel-border));
      font-size: 11px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase;
      color: var(--vscode-sideBarSectionHeader-foreground, var(--vscode-foreground));
    }
    .djs-section-header .djs-value { text-transform: none; letter-spacing: 0; font-weight: normal; }

    /* Speed slider: thin track, filled up to the thumb (--fill, set by JS). */
    input.djs-slider {
      -webkit-appearance: none; appearance: none; display: block;
      width: 100%; height: 16px; margin: 0; background: transparent; cursor: pointer;
      --fill: 50%;
    }
    input.djs-slider::-webkit-slider-runnable-track {
      height: 4px; border-radius: 2px;
      background: linear-gradient(to right,
        var(--vscode-button-background) var(--fill),
        var(--vscode-scrollbarSlider-background) var(--fill));
    }
    input.djs-slider::-webkit-slider-thumb {
      -webkit-appearance: none; appearance: none;
      width: 12px; height: 12px; margin-top: -4px; border-radius: 50%;
      background: var(--vscode-button-background);
      box-shadow: 0 0 0 2px var(--vscode-sideBar-background, var(--vscode-editor-background));
      transition: transform 0.1s;
    }
    input.djs-slider:hover::-webkit-slider-thumb { transform: scale(1.2); }
    input.djs-slider:focus { outline: none; }
    input.djs-slider:focus-visible::-webkit-slider-thumb {
      box-shadow: 0 0 0 2px var(--vscode-sideBar-background, var(--vscode-editor-background)),
                  0 0 0 3px var(--vscode-focusBorder);
    }
    .djs-scale { display: flex; justify-content: space-between; gap: 8px; margin-top: 2px; font-size: 11px; }

    .djs-fields { display: grid; grid-template-columns: auto 1fr auto; gap: 6px 8px; align-items: center; }
    .djs-fields vscode-text-field { width: 100%; min-width: 0; }

    .djs-io { flex: 1 1 auto; min-height: 0; overflow-y: auto; }
    /* The I/O "table" is laid out as a grid so the fields can shrink in a
       narrow sidebar: names capped at 40% (ellipsis), value column flexible. */
    #iopanel {
      display: grid; grid-template-columns: fit-content(35%) minmax(0, 1fr) auto;
      align-items: center; gap: 6px 8px; width: 100%;
    }
    #iopanel tbody, #iopanel tr { display: contents; }
    #iopanel td { display: block; padding: 0; min-width: 0; }
    #iopanel td[colspan] { grid-column: 1 / -1; }
    #iopanel .djs-io-name { font-family: var(--vscode-editor-font-family); font-size: 12px; }
    #iopanel td.djs-io-name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    #iopanel td.djs-io-extra { white-space: nowrap; }
    #iopanel .djs-io-dims { font-size: 11px; }
    /* the toolkit's --input-min-width (100px) would push the 3rd column out */
    #iopanel vscode-text-field, #iopanel vscode-dropdown { --input-min-width: 0px; }
    #iopanel vscode-text-field { width: 100%; min-width: 0; }
    #iopanel vscode-text-field::part(control) {
      min-width: 0; width: 100%;
      font-family: var(--vscode-editor-font-family); text-overflow: ellipsis;
    }
    #iopanel vscode-dropdown { width: auto; }
    #iopanel canvas.djs-ledmatrix { display: block; margin-top: 4px; border-radius: 3px; }
  </style>
</head>
<body>
  <div class="djs-toolbar">
    <vscode-button id="start-sim" appearance="icon" title="Start"
                   class="djs-start-stop-button" ${enabled(!rs.running && !rs.luaActive)}>
      <i class="codicon codicon-run"></i>
    </vscode-button>
    <vscode-button id="pause-sim" appearance="icon" title="Pause"
                   class="djs-start-stop-button" ${enabled(rs.running && !rs.luaActive)}>
      <i class="codicon codicon-debug-pause"></i>
    </vscode-button>
    <vscode-button id="single-step-sim" appearance="icon"
                   title="Single step" ${enabled(!rs.running && !rs.luaActive)}>
      <i class="codicon codicon-debug-step-over"></i>
    </vscode-button>
    <vscode-button id="next-event-sim" appearance="icon" title="Run until next event"
                   ${enabled(!rs.running && !rs.luaActive && rs.pendingEvents)}>
      <i class="codicon codicon-debug-continue"></i>
    </vscode-button>
    <span class="djs-sep"></span>
    <vscode-button id="reset-sim" appearance="icon" title="Reset: back to tick 0, registers and memories at their initial values"
                   ${enabled(rs.hascircuit)}>
      <i class="codicon codicon-debug-restart"></i>
    </vscode-button>
  </div>

  <div class="djs-time" title="Simulated time">
    <div id="time-main" class="djs-time-main djs-mono"></div>
    <div id="time-ticks" class="djs-time-sub djs-muted djs-mono"></div>
  </div>

  <div class="djs-section">
    <div class="djs-section-header">
      <span>Speed</span><span id="speed-label" class="djs-value djs-mono"></span>
    </div>
    <input id="speed" class="djs-slider" type="range" min="0" max="37" step="1">
    <div class="djs-scale djs-muted">
      <span id="speed-min"></span><span id="speed-actual" class="djs-mono"></span><span>max</span>
    </div>
  </div>

  <div class="djs-section">
    <div class="djs-section-header"><span>Time</span></div>
    <div class="djs-fields">
      <span>Run for</span>
      <vscode-text-field id="runfor" value="100 ns" title="Simulated time to run, then pause (e.g. 100ns, 2us)"></vscode-text-field>
      <vscode-button id="runfor-sim" appearance="icon" title="Run for this time, then pause"
                     ${enabled(!rs.running && !rs.luaActive)}>
        <i class="codicon codicon-debug-continue-small"></i>
      </vscode-button>
      <span>1 tick =</span>
      <vscode-text-field id="timescale" title="Duration of one simulation tick, saved with the project (e.g. 1ns, 10 ps, 1us)"></vscode-text-field>
      <span></span>
    </div>
  </div>

  <div class="djs-section-header" style="flex:none"><span>Inputs / Outputs</span></div>
  <div class="djs-io">
    <table id="iopanel"></table>
  </div>
</body>
</html>`;
    }
}
