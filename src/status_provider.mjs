//

'use strict';

import { WebviewMsgQueue } from './webview_msg_queue.mjs';
import { nativeControls } from './webview_style.mjs';

export class StatusProvider {
    #studio
    constructor(studio) {
        this.#studio = studio;
    }
    resolveWebviewView(view, context, _token) {
        const status_uri = view.webview.asWebviewUri(this.#studio.statusJSPath);
        const icon_uri = view.webview.asWebviewUri(this.#studio.codIconsPath);
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
                    this.#studio.postPanelMessage({ command: 'iopanel:update',
                                                 id: msg.id, value: msg.value });
                    return;
                case 'panel-cmd':
                    // extra fields (e.g. runfor's `ticks`) travel with the command
                    this.#studio.postPanelMessage({ ...msg, command: msg.panel_cmd });
                    return;
                case 'settimescale':
                    this.#studio.setTimescale(msg.value);
                    return;
                case 'setspeed':
                    this.#studio.simSpeed = msg.speed;
                    return;
            }
        });
        const listeners = [];
        listeners.push(this.#studio.tickUpdated(async (tick) => {
            queue.post({ command: 'tick', tick });
        }));
        listeners.push(this.#studio.iopanelMessage(async (message) => {
            queue.post(message);
        }));
        listeners.push(this.#studio.runStatesUpdated(async (state) => {
            queue.post({ command: 'runstate', state });
        }));
        // also fires on document switch
        listeners.push(this.#studio.synthOptionUpdated(async () => {
            queue.post({ command: 'timescale', value: this.#studio.synth_options.timescale || '1ns' });
        }));
        view.onDidDispose(() => {
            for (const listener of listeners) {
                listener.dispose();
            }
        });
        const rs = this.#studio.runStates;
        const enabled = b => b ? '' : 'disabled';
        view.webview.html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <script>
    window.init_view = ${JSON.stringify(this.#studio.iopanelViews)};
    window.init_timescale = ${JSON.stringify(this.#studio.synth_options.timescale || '1ns')};
    window.init_speed = ${JSON.stringify(this.#studio.simSpeed)};
    window.init_tick = ${JSON.stringify(this.#studio.tick || 0)};
    window.init_runstate = ${JSON.stringify(rs)};
  </script>
  <script type="module" src="${status_uri}"></script>
  <link href="${icon_uri}" rel="stylesheet"/>
  <style>
    /* Only --vscode-* theme variables, so it follows light and dark themes. */
    body {
      display: flex; flex-direction: column; height: 100vh; box-sizing: border-box;
      padding-top: 6px; padding-bottom: 6px;
    }
${nativeControls}
    .muted { color: var(--vscode-descriptionForeground); }
    .mono { font-family: var(--vscode-editor-font-family); font-variant-numeric: tabular-nums; }
    .toolbar { display: flex; align-items: center; gap: 2px; flex: none; }
    .toolbar .sep { width: 1px; height: 16px; margin: 0 4px; background: var(--vscode-panel-border); }
    /* start and pause take turns in the same place */
    .start-stop:disabled { display: none; }

    .time { flex: none; margin: 8px 0 2px; line-height: 1.2; }
    .time-main { font-size: 20px; letter-spacing: -0.02em; }
    .time-sub { font-size: 11px; }

    .section { flex: none; }
    .section-header {
      display: flex; justify-content: space-between; align-items: baseline;
      margin: 12px 0 6px; padding-top: 8px;
      border-top: 1px solid var(--vscode-sideBarSectionHeader-border, var(--vscode-panel-border));
      font-size: 11px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase;
      color: var(--vscode-sideBarSectionHeader-foreground, var(--vscode-foreground));
    }
    .section-header .value { text-transform: none; letter-spacing: 0; font-weight: normal; }

    /* Speed slider: thin track, filled up to the thumb (--fill, set by JS). */
    input.slider {
      -webkit-appearance: none; appearance: none; display: block;
      width: 100%; height: 16px; margin: 0; background: transparent; cursor: pointer;
      --fill: 50%;
    }
    input.slider::-webkit-slider-runnable-track {
      height: 4px; border-radius: 2px;
      background: linear-gradient(to right,
        var(--vscode-button-background) var(--fill),
        var(--vscode-scrollbarSlider-background) var(--fill));
    }
    input.slider::-webkit-slider-thumb {
      -webkit-appearance: none; appearance: none;
      width: 12px; height: 12px; margin-top: -4px; border-radius: 50%;
      background: var(--vscode-button-background);
      box-shadow: 0 0 0 2px var(--vscode-sideBar-background, var(--vscode-editor-background));
      transition: transform 0.1s;
    }
    input.slider:hover::-webkit-slider-thumb { transform: scale(1.2); }
    input.slider:focus { outline: none; }
    input.slider:focus-visible::-webkit-slider-thumb {
      box-shadow: 0 0 0 2px var(--vscode-sideBar-background, var(--vscode-editor-background)),
                  0 0 0 3px var(--vscode-focusBorder);
    }
    .scale { display: flex; justify-content: space-between; gap: 8px; margin-top: 2px; font-size: 11px; }

    .fields { display: grid; grid-template-columns: auto 1fr auto; gap: 6px 8px; align-items: center; }
    .fields input { width: 100%; }

    .io { flex: 1 1 auto; min-height: 0; overflow-y: auto; }
    /* a grid so the fields can shrink in a narrow sidebar: names capped
       (ellipsis), the value column flexible */
    #iopanel {
      display: grid; grid-template-columns: fit-content(35%) minmax(0, 1fr) auto;
      align-items: center; gap: 6px 8px; width: 100%;
    }
    #iopanel > div { min-width: 0; }
    #iopanel .io-wide { grid-column: 1 / -1; }
    #iopanel .io-wide > div { display: flex; gap: 6px; }
    #iopanel .io-name { font-family: var(--vscode-editor-font-family); font-size: 12px;
                        white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    #iopanel .io-extra { white-space: nowrap; }
    #iopanel .dims { font-size: 11px; }
    #iopanel .io-value input[type=text] { width: 100%; text-overflow: ellipsis; }
    #iopanel canvas.ledmatrix { display: block; margin-top: 4px; border-radius: 3px; }
  </style>
</head>
<body>
  <div class="toolbar">
    <button id="start-sim" class="icon start-stop codicon codicon-run" title="Start" ${enabled(!rs.running && !rs.luaActive)}></button>
    <button id="pause-sim" class="icon start-stop codicon codicon-debug-pause" title="Pause" ${enabled(rs.running && !rs.luaActive)}></button>
    <button id="single-step-sim" class="icon codicon codicon-debug-step-over" title="Single step" ${enabled(!rs.running && !rs.luaActive)}></button>
    <button id="cycle-sim" class="icon codicon codicon-debug-continue" title="One clock cycle: run one period of the clock, then pause" disabled></button>
    <span class="sep"></span>
    <button id="reset-sim" class="icon codicon codicon-debug-restart" title="Reset: back to tick 0, registers and memories at their initial values"
            ${enabled(rs.hascircuit)}></button>
  </div>

  <div class="time" title="Simulated time">
    <div id="time-main" class="time-main mono"></div>
    <div id="time-ticks" class="time-sub muted mono"></div>
  </div>

  <div class="section">
    <div class="section-header">
      <span>Speed</span><span id="speed-label" class="value mono"></span>
    </div>
    <input id="speed" class="slider" type="range" min="0" max="37" step="1">
    <div class="scale muted">
      <span id="speed-min"></span><span id="speed-actual" class="mono"></span><span>max</span>
    </div>
  </div>

  <div class="section">
    <div class="section-header"><span>Time</span></div>
    <div class="fields">
      <label for="runfor">Run for</label>
      <input id="runfor" type="text" value="100 ns" title="Simulated time to run, then pause (e.g. 100ns, 2us)">
      <button id="runfor-sim" class="icon codicon codicon-debug-continue-small" title="Run for this time, then pause"
              ${enabled(!rs.running && !rs.luaActive)}></button>
      <label for="timescale">1 tick =</label>
      <input id="timescale" type="text" title="Duration of one simulation tick, saved with the project (e.g. 1ns, 10 ps, 1us)">
      <span></span>
    </div>
  </div>

  <div class="section-header" style="flex:none"><span>Inputs / Outputs</span></div>
  <div class="io">
    <div id="iopanel"></div>
  </div>
</body>
</html>`;
    }
}
