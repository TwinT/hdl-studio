# HDL Studio — notes for future work

VS Code extension that synthesizes SystemVerilog with the `yosys` CLI and shows
the synthesized circuit as an interactive schematic, simulated by its own engine
`hdlstudio` (Rust, `crates/`). Educational focus (examples in `test/verilog/`). Projects are `.hdls` files
(JSON); `.digitaljs` files, from before 1.0, have the same content and open too.
Third-party origins and their license notices: `NOTICE`.

## The engine (`crates/`)

Cargo workspace. `hdlstudio-logic` (4-state vectors),
`hdlstudio-netlist` (the circuit model; its serde form is the project files' circuit
JSON, field for field), `hdlstudio-yosys` (yosys JSON → circuit: the converter, `io_ui`,
the inout split, the `transform` simplifications), `hdlstudio-sim` (the event-driven
simulator), `hdlstudio` (the binary).

- `npm run compile` builds it (`compile:rust` = `cargo build --release`). The host
  runs `target/release/hdlstudio` (`src/hdlstudio_bin.mjs`, vscode-free; the root is
  set from `context.extensionPath` in `activate`). The vsix ships it at that path
  (`!target/release/hdlstudio` in `.vscodeignore`), so a vsix is per platform.
- `hdlstudio yosys2hdlstudio [--transform] [--no-io-ui] < yosys.json` prints the
  circuit. `crates/hdlstudio-yosys/tests/golden.json` freezes its output for the
  small examples plus cell-coverage netlists (`BLESS=1 cargo test` rewrites it after
  an intended change). It reproduces the original converter's quirks on purpose (device
  numbering, a Map typo that makes `$_DFF_P_` invalid...); semantic changes go in
  their own commits (`TODO.md` lists them).
- `hdlstudio-sim`: per-cell `propagation`
  delays, a per-tick event queue, end-of-tick values. It flattens the hierarchy
  (subcircuits add neither delay nor events) and copies a queued cell's inputs
  lazily. Deliberate differences from the previous (JavaScript) simulator: memory transparency compares
  addresses by value, ticks are u64, a zero-delay loop that never settles is an
  error. Speed: `cargo run --release -p hdlstudio-sim --example bench --
  circuit.json TICKS` (the `board` runs ~39k clock cycles/s); `--profile profiling`
  keeps line tables for perf (release is stripped for the vsix).
- `hdlstudio serve`: one per circuit view, JSON lines on stdio, protocol at the top
  of `crates/hdlstudio/src/serve.rs`, cells addressed by path ("dev3/dev12"). It runs
  in 10 ms slices (rate-limited or flat out), sends an `update` (changed outputs of
  the observed graphs, memory writes, FSM states) every 25 ms, checks monitors and
  alarms after each step. Interval mode works out the ticks owed since the last
  slice, processes only the events before the target tick and jumps there, so empty
  ticks cost nothing; the backlog is dropped.
- Lua runs inside the engine (`crates/hdlstudio/src/lua.rs`, mlua + Lua 5.4): the
  `vec`/`sim` API (documented in the README), scripts as coroutines;
  `sim.sleep`/`sim.wait` register an alarm/monitor and yield, and the engine resumes
  the script after the step where it fires. `hdlstudio lua [--json] circuit.json
  script.lua [MAX_TICKS]` runs one headless. Differences: `tointeger` takes up to
  63 bits, a narrow string is zero-extended, the REPL prints expression values,
  `sim.registerdisplay` isn't there.
- Waveforms: `watch`/`unwatch` record every end-of-tick change of an output
  (`crates/hdlstudio/src/wave.rs`, up to 1M changes per signal); `wave {from, to,
  bins}` returns a window with one entry per pixel column (several changes in one
  column come back as a dense block), so a flat-out run never streams its changes.

## The circuit view (`view/schematic/`, TypeScript)

SVG drawn by hand, laid out by `elkjs`, simulated by the engine through the host
(`command: 'engine'` messages carry requests and events).

- `cells.ts`: each cell's ports, size and drawing, with the geometry HDL Studio
  always had (sizes, port positions, 25px leads): a device's `position` is its
  body's top-left, so layouts saved before 1.0 still fit. `schematic.ts`: one graph as SVG, live
  values (applied once per animation frame), pan/zoom, wire tooltips and the
  waveform button, dragging cells. `layout.ts`: ELK, a node is the body plus its
  leads (ports on the border). `route.ts` (no DOM): wires through their saved
  vertices, or around cells (A*) once a moved cell dropped them. `main.ts`: the
  host protocol, sim controls, control-panel I/O, windows (`dialog.ts`), memory
  editor (`memory.ts`), FSM diagram (`fsm.ts`, the next transition is computed in
  the view), image export (`view/imgutils.mjs`), Lua (`view/lua_runner.ts`).
- Layout lives in the circuit: `devices[id].position` and `connectors[i].vertices`
  (ELK's bend points), in the top level and per subcircuit type. Missing positions
  are laid out on load and saved as part of the last edit (`autolayout`); a moved
  cell is an edit (`updatecircuit`). A `showcircuit` whose netlist (the JSON without
  position/vertices/numbase) didn't change only redraws: undo/redo of a move keeps
  simulating.
- `waves.ts`, the waveform monitor (like Surfer/VaporView): name, value (under the
  pointer, else at the view's right edge), waveform, and a ruler in the project's
  time units (`timescale` comes with `showcircuit` and on change). Colours: the
  `hdl-studio.waveform.colors` setting (sent as `wavecolors`), Surfer's dark theme by
  default. A click on a waveform toggles following the simulation, a drag scrolls
  back, Ctrl+wheel zooms. A row's menu (right-click or "…") picks the number format
  and a pause condition: an engine `monitor` with `stop` (triggers null = any
  change); when it fires the view marks the tick and says why it paused.
- Pan captures the pointer only once it drags: capturing on pointerdown sends the
  click/dblclick to the svg instead of the wire under it.
- TypeScript: `tsc` only type-checks (`tsconfig.json`, part of `npm run lint`);
  webpack transpiles with `esbuild-loader` (TypeScript 7 has no JS API for
  ts-loader). Node imports the `.ts` directly in tests, so relative imports name the
  `.ts` file, and the modules tests import (`values.ts`, `route.ts`, `cells.ts`) use
  `import type` for types and touch the DOM only when called.

## Architecture: host vs webview

Bundled separately by webpack (`webpack.config.js`):

- **Extension host** — `src/*.mjs` → `dist/local-extension.js`. Talks to yosys, owns
  the document, starts an engine per circuit view (`src/circuit_view.mjs`).
- **Webviews**: `view/schematic/main.ts` → `schematic.js` (the circuit view),
  `view/synth_view.mjs` → `synth_view.js` (Synthesis panel), `view/status_view.ts` →
  `status_view.js` (Control panel: run/step + I/O widgets).

Host and webviews talk by `postMessage`; the host providers build the HTML (e.g.
`src/synth_provider.mjs` for the Synthesis panel). There is no web (vscode.dev)
build: the engine is a native process.

## Build / reload — read this before debugging "my change didn't work"

- `npm run compile` — full build: empties `dist/`, builds the engine and every
  bundle. `npm run compile:views` only rebuilds the bundles (a change in `src/` needs
  the host bundle too, `compile` does both); `compile:rust` only the engine.
- After building, **reload the dev window** (Developer: Reload Window).
- `dist/` and `target/` are gitignored. `vsce package` runs `vscode:prepublish` →
  `npm run compile`.
- The Synthesis panel's script guards elements missing from its HTML (bundle skew
  between host and webview builds used to crash it).

## Testing & lint

- `npm test` → `test:rust` (`cargo test --workspace`), `test:pipeline`,
  `test:golden`, `test:schematic`, `test:vscode`.
- `test:pipeline` (`test/pipeline.spec.mjs`): synthesizes the examples through the
  real flow (yosys → `hdlstudio`) and checks the conversion (inout split, net
  merging, io_ui widgets, `$bmux`, data files...). Needs `yosys` on PATH (skips
  without). Named `.spec.mjs` so the electron glob (`**/**.test.js`) ignores it. It
  imports the extension's own `build_yosys_script`. Examples live one per subfolder,
  `test/verilog/<name>/<name>.sv` plus a `*_sim.lua`; only subfolders with exactly one
  `.sv` are single-file examples (`micro`, `soc`, `alu` are multi-file).
- `test:golden` (`test/golden.spec.mjs`): the engine and the schematic against
  the previous simulator's results, frozen in `test/golden/` before it went away: per example and
  mode (t: transform, nt: none, dc: zero combinational delay) the converted circuit,
  a seeded stimulus, the end-of-tick trace and every cell's ports; per Lua script
  (run as the file is now) what it printed. Needs only the engine (no yosys).
  `BLESS=1 npm run test:golden` rewrites the traces/outputs from the engine after an
  intended change — review what changed.
- `test:schematic` (`test/schematic.spec.mjs`): value formats, routes, then
  `dist/schematic.js` in Chromium (Playwright) on a real `hdlstudio serve`, the
  test acting as the extension host: the board's matrix lights up, a subcircuit
  opens, Reset, a move keeps simulating, export, waveforms and a trigger (with real
  mouse events), Lua. Needs yosys with read_slang and Playwright's Chromium (`npx
  playwright install chromium`; skips without). The same harness shape is handy for
  looking at the view by hand.
- `test:vscode` (`node test/runTest.js`) — `@vscode/test-electron` mocha suite.
- Rust tests: `crates/*/tests` (golden converter output, vector fixtures, cell
  semantics the random stimulus rarely reaches: z operands, alarms on busy ticks).
- Lint: ESLint flat config (`eslint.config.js`), all rules `warn`, plus `tsc`.

## Synthesis flow & options

`document.doSynth()` → `sources.doSynth(opts)` → `run_yosys(files, opts)`
(`src/requests.mjs`) → `build_yosys_script(files, opts)` (`src/yosys_script.mjs`,
vscode-free so tests can import it) → `yosys -s script.ys` → `convert_yosys_json`
(`src/hdlstudio_bin.mjs`) → `hdlstudio yosys2hdlstudio`: inout split, convert,
`io_ui`, and transform if `transform` is on.

Options live in `document.mjs` `default_synth_options`, edited in the Synthesis
panel (Synthesis/Diagram tabs):
- **Yosys passes** (opt, fsm, fsmexpand, techmap, top) — read in `doSynth`. Take
  effect on Synthesize.
- **transform** — a converter option, also on Synthesize.
- **defaultcomb** (zero combinational delay) — travels with `showcircuit` and is
  passed to the engine's `load`.
- **timescale** — the Control panel's (below).

Adding an option = `default_synth_options`, the panel HTML (`synth_provider.mjs`),
the arrays in `synth_view.mjs`, and `doSynth` or `#showCircuit`.

### `inout` ports (`crates/hdlstudio-yosys/src/inout.rs`)
Circuit ports are one-directional. Each inout `P` becomes an input `P` (what the
module reads) plus an output `P__out` carrying **only the module's own drivers**; a
parent's several `P__out` on one net merge through a `TriMerge`. An inout nothing
drives becomes a plain input. Don't export the resolved value as the output: the
parent merges it again and feeds it back into `P`, an `x = merge(x, z)` loop that
latches the last bus value (`test/verilog/12_inout_bus/`,
`test/golden/inout_bus.lua`). `build_yosys_script` also runs `bwmuxmap` after `proc`
(`$bwmux`, e.g. a part-select write into a wide register, has no cell).

### techmap gotcha
Bare `techmap` also lowers flip-flops/latches/memories to gate-level primitives
(`$_DFF_P_`...) the converter can't convert → `Invalid cell type`.
`build_yosys_script` excludes them (`select -del t:$dff ... t:$mem_v2`) before
`techmap`, so only combinational logic is decomposed. (`$fa`/`$alu` still break it
on `soc`, see TODO.)

### Wide indices and shift amounts
yosys keeps an index expression's width: `mem[a]` with a 32-bit `a` gives a 32-bit
address, and `a[i*W +: W] <= d` becomes a 34-bit signed `$shift` fed by a `$neg` that
no yosys pass narrows. The engine saturates shift amounts (`|amount| >= max(in, out)`
is all-fill) and treats out-of-range addresses as x (`test/golden/wide_idx/`). Sizing
indices with `$clog2(N)` still gives a smaller netlist.

## I/O widget inference (`io_ui` in `crates/hdlstudio-yosys/src/lib.rs`)

Top-module port → widget by name + width: 1-bit input `clk`/`clock` → Clock; 1-bit
input named `pushbutton*` or with `(* momentary *)` → PushButton (high only while
held); other 1-bit input → Button (toggles); multi-bit input → NumEntry; 1-bit
output → Lamp; multi-bit output → NumDisplay; 8-bit output `display7`/`display7_*` →
Display7.

**LEDMatrix** (`test/verilog/10_led_matrix/`) can't come from a width alone (16 bits
could be 4×4 or 2×8): it reads `(* led_matrix_rows = R, led_matrix_cols = C *)` on
the port, which must satisfy `R*C ==` the width. Ports have no `attributes` in
yosys's JSON, but their backing wire in `netnames` does, and custom attributes
survive this project's passes onto it (the same way a `Dff`'s `.initial` value is
read). Bit `r*cols + c` is row r, column c. The view sizes it once from rows/cols
(`cells.ts` `ledLayout`): more LEDs means smaller LEDs, not a bigger widget. The
canvas cell and the Control panel widget are separate code.

## Lua scripts

The view's `LuaRunner` (`view/lua_runner.ts`) allows one Lua execution (a script or
the REPL) at a time: running one stops every other, starts the simulation if it is
paused, and the simulation pauses when it ends; the REPL queues its inputs. While one
runs, the `runstate`'s `luaActive` disables the Control panel's run buttons. Since
scripts run inside the engine there are no cross-thread races (the JavaScript engine
had several: stale ticks lost `sim.sleep` wake-ups, two runners fought over an input).

## Simulation controls (Control panel)

The panel (`src/status_provider.mjs` HTML + `view/status_view.ts`) does all time ↔
tick conversion (`src/time_units.mjs`, vscode-free); the circuit view and the engine
only see ticks.

- **Timescale** (`1 tick = 1 ns` by default): a per-project option saved with the
  document, set via `document.setTimescale()`, which also fires `synthOptionUpdated`
  (the plain setter doesn't, and the Synthesis panel would write its stale copy back).
- **Speed** (ticks/s, `null` = max) is global (`globalState` `simSpeed`, in
  `extension.mjs`), pushed to every circuit view (`setspeed`) and sent with
  `showcircuit`. Start sends `interval {ms: 1000/speed}` + `start`, or `start_fast`.
  Lua starts the simulation the same way. The panel shows the measured speed too
  (`actual ≈ …/s`, from the `tick` messages), since a big circuit can't keep up.
- **One clock cycle**: run-for one period of the first Clock (2 × its propagation),
  so it pauses at the same phase with everything settled.
- **Run for N**: an engine alarm with `stop` + `start_fast`, like `run 100ns`.
- **Reset** (`resetsim`, runtime only): loads the circuit into the engine again —
  tick 0, registers and memories at their initial values; layout, open windows, a
  clock period edited in the panel and watched signals stay.
- **Panel styling**: native controls styled with `--vscode-*` variables
  (`src/webview_style.mjs`), light and dark. The I/O list is a CSS grid so fields
  shrink in a narrow sidebar; wide outputs end in an ellipsis with the value in the
  tooltip. To look at a panel without VS Code: call its provider's
  `resolveWebviewView` with a fake view (capture the `html` setter; `asWebviewUri: p
  => 'http://harness' + p`) and a fake `studio` (the extension object), inject `--vscode-*` variables and an
  `acquireVsCodeApi` stub, load it in Playwright with `page.route('http://harness/**',
  …)` and post sample `iopanel:view`/`tick`/`runstate` messages.

## Misc

- `$readmemh`/`$readmemb` data files: `run_yosys` writes each at its project-relative
  name **and** at its bare basename (`data_file_paths`; an alias never shadows a real
  root file). The sources are flattened into the synthesis dir, so a bare
  `"control_unit.hex"` (the `soc`/`micro` convention) only resolves through the alias.
- Examples worth knowing: `test/verilog/micro/` (RV32I datapath, `memory.hex` sums
  5..1 into x2, stores and loads it into x3); `test/verilog/soc/rtl/` (the `inout`-bus
  version; `cpu_ram.sv` = CPU + RAM; `board` = soc + `led_panel`, a capybara walking
  on a 16x32 LED matrix, ~1500 clock cycles after reset before the first LED lights:
  use max speed).
- Yosys errors: the script and yosys's output go to the "HDL Studio (Yosys)" output
  channel (`src/requests.mjs`).
