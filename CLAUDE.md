# HDL Studio — notes for future work

VS Code extension that synthesizes SystemVerilog (via the `yosys` CLI) and renders
an interactive circuit diagram/simulator using the `digitaljs` npm package. The
yosys netlist is converted by the native engine `hdlstudio` (Rust, `crates/`, see
"Rust engine" below). Educational focus (examples live in `test/verilog/`).

## Rust engine (`crates/`, branch `rust-migration`)

Cargo workspace (`Cargo.toml`) being grown phase by phase to replace digitaljs,
yosys2digitaljs, digitaljs_lua and `@twint/4vl` (one commit per phase; loose ends go
in `TODO.md`'s "Pending, noted during the Rust migration"). Crates: `hdlstudio-logic` (4vl port), `hdlstudio-netlist`
(circuit model; its serde form is digitaljs's circuit JSON, field for field),
`hdlstudio-yosys` (yosys JSON → circuit: port of yosys2digitaljs + our old patch,
`io_ui`, the inout split and digitaljs's `transform.mjs`), `hdlstudio-sim` (the
event-driven simulator, digitaljs's WorkerEngine semantics), `hdlstudio` (the binary).

- `npm run compile` builds it (`compile:rust` = `cargo build --release`). The host
  runs `target/release/hdlstudio` (`src/hdlstudio_bin.mjs`, vscode-free; the root is
  set from `context.extensionPath` in `activate`). The vsix ships it at that same
  path (`!target/release/hdlstudio` in `.vscodeignore`).
- `hdlstudio yosys2hdlstudio [--transform] [--no-io-ui] < yosys.json` prints the
  digitaljs circuit. Its output was checked identical to the old JS chain on every
  example × 5 option sets; `crates/hdlstudio-yosys/tests/golden.json` freezes that
  for the small examples plus cell-coverage netlists (`BLESS=1 cargo test` rewrites
  it after an intended change). It reproduces yosys2digitaljs's quirks on purpose
  (device numbering, a Map typo that makes `$_DFF_P_` invalid, transform's dead
  sparse-mux test): semantic changes go in their own commits.
- `hdlstudio-sim` flattens the hierarchy (subcircuits add neither delay nor
  events in digitaljs's worker) and copies a queued cell's inputs lazily (only
  when one changes in a later tick). `npm run test:simdiff`
  (`test/simdiff/`) is its safety net: every example × {transform, no
  transform, `defaultcomb`} runs on digitaljs's real WorkerEngine (a worker
  thread, `src/` tree loaded in Node through a module hook) and on `hdlstudio
  simtrace`, with a seeded stimulus; every cell output's end-of-tick values
  must match line for line (glitches inside a tick depend on queue order, which
  the engines don't share). Known digitaljs bugs hdlstudio fixes are patched
  into digitaljs in `worker_boot.mjs`, so they are the only allowed
  differences: today, Memory transparency compares addresses by value (JS
  compared them by object). Speed: `cargo run --release -p hdlstudio-sim
  --example bench -- circuit.json TICKS`.
- The extension simulates on the engine: each circuit view (`src/circuit_view.mjs`)
  starts a `hdlstudio serve` (JSON lines on stdio, protocol at the top of
  `crates/hdlstudio/src/serve.rs`, gates addressed by digitaljs path
  "dev3/dev12"). In the webview, `view/remote_engine.mjs`'s `RemoteEngine`
  replaces digitaljs's WorkerEngine (same API, mirrors its main-thread half; the
  circuit is sent whole on `load`, an edit reloads it from tick 0) and
  `EngineLuaRunner` replaces digitaljs_lua's LuaRunner: scripts run *inside*
  the engine (`crates/hdlstudio/src/lua.rs`, mlua + Lua 5.4) as coroutines, and
  `sim.sleep`/`sim.wait` wake them after the step their alarm/monitor fires in.
  `hdlstudio lua circuit.json script.lua` runs a script headless.
  `test:simdiff` also checks the adapter (digitaljs's model on the engine through
  `RemoteEngine`, `trace.mjs` `remote: true`) and the Lua (`luadiff.spec.mjs`:
  every `sim.lua` plus `test/simdiff/lua_api.lua` against digitaljs_lua on
  SynchEngine, same printed lines).

## The new schematic (`view/schematic/`, TypeScript, phase 5)

The circuit view without digitaljs/jointjs: SVG drawn by hand, laid out by
`elkjs`, simulated by the engine directly (no RemoteEngine adapter). It is
the default; the setting `hdl-studio.useDigitaljsView` brings back the old
view (`view/main.mjs`, which still has wire editing) until the cutover. `src/circuit_view.mjs` picks the bundle when the view opens.

- `cells.ts`: each cell's ports, size and drawing. The geometry is
  digitaljs's (sizes, port positions, 25px leads), so a device's `position`
  is its body's top-left in both UIs and saved layouts work in either.
  `schematic.ts`: one graph as SVG, live values (engine `update` changes,
  applied once per animation frame), pan/zoom, wire tooltips, dragging cells.
  `layout.ts`: ELK, a node is the body plus its leads (ports on the border).
  `route.ts` (no DOM, tested from Node): wires through their saved vertices,
  or around cells (A*) once a moved cell dropped them.
  `main.ts`: the host protocol (same messages as `view/main.mjs`), sim
  controls, control-panel I/O, dialogs (`dialog.ts`, native), memory editor
  (`memory.ts`), FSM diagram (`fsm.ts`, the next transition is computed in
  the view), image export (`view/imgutils.mjs`). `view/lua_runner.ts` is
  shared by both views.
- The waveform monitor (`waves.ts`, phase 6): double-click a wire to watch
  its driver. The engine records every end-of-tick change of a watched
  output (`watch`/`unwatch`, `crates/hdlstudio/src/wave.rs`, up to 1M changes
  per signal); after each update the view asks for the window it shows
  (`wave {from, to, bins}`, one entry per pixel column, several changes in
  one column come back as a dense block) and draws it. So a flat-out run
  never streams its changes through JSON. Triggers are plain engine
  `monitor`s with `stop`.
- The circuit stays in digitaljs's JSON (hdlstudio-netlist's serde form);
  layout lives in `devices[id].position` and `connectors[i].vertices` (ELK's
  bend points), in the top level and per subcircuit type. A `showcircuit`
  whose netlist (the JSON without position/vertices/numbase) didn't change
  only redraws: the simulation goes on (undo/redo of a move).
- TypeScript: `tsc` only type-checks (`tsconfig.json`, part of `npm run
  lint`); webpack transpiles with `esbuild-loader` (TypeScript 7 has no JS
  API for ts-loader). Node imports the `.ts` directly in tests.
- `npm run test:schematic` (`test/schematic.spec.mjs`): value formats, then
  `dist/schematic.js` in Chromium (Playwright, from `@vscode/test-web`) on a
  real `hdlstudio serve`, with the test as the extension host: the board's
  matrix lights up, a subcircuit opens, Reset, a move keeps simulating, a
  Lua script runs. The same harness shape works for poking at the view by hand.

## Architecture: host vs webview

Two worlds, bundled separately by webpack (`webpack.config.js`):

- **Extension host** — `src/*.mjs` → `dist/local-extension.js` (and `web-extension.js`).
  Runs in the VS Code extension host process. Talks to yosys, owns the document/state.
- **Webviews** — `view/*.mjs` → separate bundles:
  - `view/schematic/main.ts` → `schematic.js` (the circuit view, see above)
  - `view/main.mjs` → `view-bundle.js` (the old circuit editor: digitaljs, jointjs, elkjs)
  - `view/synth_view.mjs` → `synth_view.js` (the "Synthesis" side panel controls)
  - `view/status_view.mjs` → `status_view.js` (the "control" panel: run/step + I/O widgets)

Host and webview communicate by `postMessage`. The webview HTML is generated by the
host provider (e.g. `src/synth_provider.mjs` builds the synth panel HTML; the matching
webview logic is `view/synth_view.mjs`).

## Build / reload — READ THIS before debugging "my change didn't work"

- `npm run compile` — full build (host **and** all webview bundles). Use this.
- `npm run compile:views` — **only** rebuilds webview bundles; does NOT rebuild the
  host `local-extension.js`. A host-side change (anything in `src/`, e.g.
  `build_yosys_script`, `document.doSynth`) will NOT take effect with this.
- After building, **reload the dev window** (Developer: Reload Window) so the extension
  host loads the new bundle. Changes appear only after reload.
- `dist/` is gitignored (build artifact). The committed `.vsix` is stale — rebuild it
  (`vsce package`, runs `vscode:prepublish` → `npm run compile`) to ship changes.
- **Bundle skew** causes weird crashes: if the host HTML and the webview JS are built
  from different versions, the webview may `getElementById` an element that isn't in
  the HTML → `Cannot set properties of null`. `view/synth_view.mjs` now guards missing
  elements. Always full-rebuild + single reload to keep both in sync.

## Testing & lint

- `npm test` → `test:rust` (`cargo test --workspace`), `test:pipeline`, `test:simdiff`,
  `test:schematic`, `test:vscode`.
- `test:pipeline` (builds the engine, then `mocha test/pipeline.spec.mjs`) — synthesizes
  every single-file example through the real flow (yosys → `hdlstudio`) and asserts it
  converts. No VS Code, no DOM; needs `yosys` on PATH (skips if absent). Named
  `.spec.mjs` on purpose so the electron glob (`**/**.test.js`) ignores it. It
  imports the extension's own `build_yosys_script` so the test can't drift.
  Examples live one per subfolder, `test/verilog/<name>/<name>.sv` (plus a
  `sim.lua` demonstrating that module via the `digitaljs_lua` scripting API —
  see `node_modules/digitaljs_lua/docs/USAGE.md`); the test only picks up
  subfolders containing exactly one `.sv` file, which is what excludes
  multi-file designs like `test/verilog/alu/` (its own Makefile-based flow, see
  its README-style comments) from the single-file pipeline test.
- `test:vscode` (`node test/runTest.js`) — `@vscode/test-electron` mocha suite.
- Lint is ESLint 9+ **flat config** (`eslint.config.js`; the old `.eslintrc.json` is
  gone). All rules are `warn` so lint never blocks. `.vscode-test/` is ignored (it
  contains VS Code's own configs and breaks `eslint .` once tests download it).

## Synthesis flow & options

`document.doSynth()` → `sources.doSynth(opts)` → `run_yosys(files, opts)` (`src/requests.mjs`)
→ `build_yosys_script(files, opts)` (`src/yosys_script.mjs`, kept **free of `vscode`** so
tests can import it) → runs `yosys -s script.ys` → `convert_yosys_json(json, opts)`
(`src/hdlstudio_bin.mjs`) → `hdlstudio yosys2hdlstudio`: inout split, convert,
`io_ui`, and transform if `transform` is on.

Synth options live in `document.mjs` `default_synth_options` and are edited in the
synth panel. Two kinds:

- **Yosys passes** (opt, fsm, fsmexpand, techmap) — read in `doSynth`, added to the
  yosys script. Take effect on Synthesize.
- **Circuit-build options** (transform, defaultcomb, layout) — travel to the webview
  in the `showcircuit` message (`circuit_view.#showCircuit` adds them from
  `document.synth_options`), applied in `view/main.mjs #_mkCircuit`. Take effect when
  the circuit is (re)built.

Adding a new option = touch: `default_synth_options`, the panel HTML
(`synth_provider.mjs`), the arrays in `synth_view.mjs`, and either `doSynth` (yosys) or
`#showCircuit` + `#_mkCircuit` (circuit-build).

### `inout` ports (`crates/hdlstudio-yosys/src/inout.rs`)
digitaljs ports are one-directional (yosys2digitaljs used to fail with
`Invalid port direction: inout`, both on module ports and on `Subcircuit` cell
`port_directions`). The converter splits them first: each inout `P` becomes an input `P` (what the module
reads) plus an output `P__out` carrying **only the module's own drivers**; a parent's
multiple `P__out` on one net then merge through the existing `TriMerge`. An inout
nothing drives becomes a plain input (no `__out`). Don't export the resolved value as
the output: the parent merges it again and feeds it back into `P`, a
`x = merge(x, z)` loop that latches the last bus value (example:
`test/verilog/12_inout_bus/`, incl. a headless sim of float/contention in
`test/pipeline.spec.mjs`).
`build_yosys_script` also runs `bwmuxmap` after `proc` (`$bwmux`, e.g. a part-select
write into a wide register, has no digitaljs cell).

### techmap gotcha
Bare `techmap` also lowers flip-flops/latches/memory to gate-level primitives
(`$_DFF_P_`, `$_DLATCH_P_`) that the converter cannot convert → `Invalid cell type`.
`build_yosys_script` excludes them with `select *; select -del t:$dff ... t:$mem_v2`
before `techmap`, so only combinational logic is decomposed.

## digitaljs 0.14.2 API gotchas (all in `view/main.mjs`)

The webview code was written against an older digitaljs; 0.14.2 differs:

- `windowCallback(type, div, close_cb)` gets **3 args, no `{model}`**. Derive the
  subcircuit model from its graph via a `graph → model` map (`#graph_to_model`), or for
  Memory/FSM capture it by wrapping `MemoryView/FSMView.prototype._displayEditor`.
- `circuit.createSubcircuit()` and `model.createEditor()` are **gone**. Subcircuit
  content is rebuilt with `circuit._makePaper(pdiv, model.get('graph'))`; Memory/FSM
  editors only open via the cell view's `_displayEditor` (→ `open:memorycontent`/`open:fsm`).
- Subcircuit **elk layout runs async** after render, so a dialog auto-sized on
  `render:done` shows everything stacked at 0,0 until layout lands → re-fit/re-center
  the dialog when the layout batch completes.
- Dialog **restore** (`#restoreStates`) only runs on `keep=true` reloads (undo/redo of a
  circuit edit), never on re-synthesis (keep=false, by design — new circuit).
- Headless (`HeadlessCircuit` + `SynchEngine`): `circuit.updateGates()` advances **one
  tick**, it does not run to quiescence. Toggling a clock right after it races the
  data and shows spurious `x` that aren't in the design. Settle with
  `while (circuit.hasPendingEvents) circuit.updateGatesNext()` (see the simulation
  tests in `test/pipeline.spec.mjs`).
- **State used by `operation()`/its helpers goes in `prepare()`, never `initialize()`.**
  The WorkerEngine's worker-side `Gate` (`engines/worker-worker.mjs`) is not the cell
  model: it never runs `initialize()`, only `cell.prepare.call(gate)`, and copies the
  `_operationHelpers`. `MuxSparse` (generated by `transformCircuit`, i.e. the `transform`
  option, from a one-hot `Mux1Hot`/`$pmux`; 1 in `board`/`soc` and 1 in `micro`) used to
  compute `_inputsBigInt` in `initialize()`: its first evaluation threw in the worker,
  the worker's `setTimeout` loop died and the clock froze at tick 0 (matrix never lit,
  micro "didn't run"). Headless/`SynchEngine` runs real cells, so it never showed. The
  `MuxSparse.muxInput works on a worker-style gate` test emulates the worker's gate;
  it's the only audited `this._x =` outside `prepare()` in `src/cells/*.mjs`.
- Reading wire colours: green = all 1, salmon = all 0 (multi-bit too), blue = defined
  mix, orange = z, grey = x (`WireView.attrs.signal`). A salmon bus is zeros, not x.

## I/O widget inference (`io_ui` in `crates/hdlstudio-yosys/src/lib.rs`)

Top-module port → widget by name + width: 1-bit input `clk`/`clock` → Clock (auto);
1-bit input named `pushbutton*` or carrying `(* momentary *)` → PushButton (see
below); other 1-bit input → Button; multi-bit input → NumEntry; 1-bit output → Lamp;
multi-bit output → NumDisplay; 8-bit output `display7`/`display7_*` → 7-segment
Display7.

**PushButton** (momentary — high only while held, `test/verilog/11_pushbutton/`) is a
sibling of the default toggling Button/switch, opt-in two ways: a port named with the
`pushbutton` prefix (same technique as the `clk`/`clock` → Clock rule above), or an
explicit `(* momentary *)` attribute read off the port's backing wire in `netnames`
(same technique LEDMatrix uses below, extended to a 1-bit Input). Neither changes an
otherwise plain 1-bit input. The click-to-toggle `Button`/`Input` cell
(`node_modules/digitaljs/src/cells/io.mjs`) is untouched; `PushButton`/`PushButtonView`
are a separate model/view pair there (mousedown/mouseup/mouseleave calling
`setInput` directly, not `toggleInput()`), registered in `circuit.mjs`'s
`getCellType` map. The two UI surfaces — the canvas cell and the control-panel
widget (`view/status_view.mjs`'s `#newPushButtonWidget`) — are independent code
paths with no shared code, so both had to be touched; the control panel is not
currently keyboard-operable (`<vscode-button>` only fires `click` on Enter/Space,
not mousedown/mouseup).

**LEDMatrix** (rows × cols grid of LEDs, one bit per LED, `test/verilog/10_led_matrix/`)
is the one exception that isn't inferred from name/width alone: a single port width
can't recover two independent dimensions (16 bits could be 4×4 or 2×8). Instead it
reads a pair of Verilog attributes on the port —
`(* led_matrix_rows = R, led_matrix_cols = C *)` — required to satisfy `R*C ==` the
port's bit width, else it falls through to the ordinary NumDisplay/Display7 rules.
Ports have no `attributes` field of their own in yosys's JSON schema, but their
backing wire (same name, in `netnames`) does, and custom attributes survive this
project's synthesis pass sequence onto it (confirmed empirically) — the same
technique the converter uses for a `Dff`'s `.initial` value, applied in its
"Add inputs/outputs" step. The `LEDMatrix` cell itself
(`node_modules/digitaljs/src/cells/ledmatrix.mjs`, patched) computes its LED pitch
**once** from rows/cols at creation, clamped to a roughly-fixed footprint — more
LEDs means smaller LEDs, not a bigger widget. There's no interactive resize (see
"Misc" below).

**Gotcha for any design driving a wide bus through a variable shift** (not
LEDMatrix-specific, but this is where it first bit): digitaljs's
`Shift`/`ShiftLeft`/`ShiftRight` cells (`cells/arith.mjs`) convert the shift
*amount* operand to a plain JS number via `Vector4vl.toNumber()`, which
asserts `bits < 32` — loosening that assertion in `@twint/4vl` would risk
silently wrong results elsewhere (JS's bitwise ops truncate past 32 bits),
so don't. If a shift amount's own signal ends up as wide as the bus it's
indexing into (e.g. a `pos` register sized to match a 1024-bit `matrix`
instead of `$clog2(1024)`), yosys can't narrow it — the value could
legitimately exceed the "in range" count — and `toNumber()` throws
`"... called on a too wide vector"` at simulation time. Size any such
counter/index with `$clog2(N)`, not to match the bus it addresses (see
`test/verilog/10_led_matrix/10_led_matrix.sv`'s `POSW` for the pattern).

**Update:** the `Shift*` cells (`cells/arith.mjs`/`lib/cells/arith.js`, patched)
now *saturate* the amount instead of calling `toNumber()`: any
`|amount| >= max(in1, out)` gives the same all-fill result, so a wide amount no
longer kills the simulation. This matters because yosys itself can emit one
(`a[i*W +: W] <= d` becomes a 34-bit signed `$shift`/`$shiftx` fed by a `$neg`,
and no yosys pass narrows it — tried `opt_expr -fine`, `opt -full`, `peepopt`,
`wreduce` twice). Sizing indices with `$clog2` is still good practice (smaller
netlist); it's just no longer needed to avoid the crash. `toNumber()` has exactly
three call sites in `digitaljs/src` and all are now safe for wide values: `Shift`,
`ShiftConst` with a constant left operand (what `transform` makes of `1 << a`), and
`Memory._calcaddr` (yosys keeps the index expression's width, so `mem[a]` with a
32-bit `a` gives `ABITS=32` and used to assert even for `a=5`; it now goes through
`toBigInt()` for >= 32 bits). Mux selects were never affected (they use
`toBigInt()`). If a new `toNumber()` appears in a digitaljs upgrade, treat it the same way.

## Patching digitaljs & friends (patch-package)

`digitaljs` is patched (`patches/digitaljs+0.14.2.patch`) for native
4-valued (0/1/x/z) logic via `@twint/4vl` (replacing the stock `3vl`), the
`Tribuf`/`TriMerge` cells for tri-state bus merging, and assorted bug fixes
(e.g. the Wire per-link routing fix above). `digitaljs_lua` and
`wavecanvas` each have their own
`patches/<pkg>+<ver>.patch` too; all are applied automatically via the
`postinstall: patch-package` script (`package.json`).
patch-package only applies at install time, so after a `git pull` that changed a
patch, `node_modules` keeps the old version of it (seen as an old, already fixed
bug coming back, e.g. Reset erasing the schematic). `npm run compile` runs
`patch-package --error-on-fail` first (`precompile`) to catch that; the fix is
`rm -rf node_modules && npm install`.

- **Dual-tree gotcha**: `digitaljs`'s package `exports` map resolves the
  **`browser`** condition (`src/index.mjs`) for webpack's default browser
  target — both the main-thread bundle and the Web Worker bundle
  (`webpack.config.js`'s worker config imports `src/engines/worker-worker.mjs`
  directly by path) load the **`src/*.mjs`** tree, never `lib/*.js`. So
  `lib/*.js` is unreachable dead code for every bundle this project ships,
  but must still stay syntactically valid (other resolution conditions and
  plain `require()` still use it). **Any patch touching `digitaljs` must
  mirror the edit in both `lib/<file>.js` and `src/<file>.mjs`** — and
  `npm run compile`/`test:pipeline`/`lint` give **zero** coverage for a
  `lib/`-only break. Only `node --check node_modules/digitaljs/lib/<file>.js`,
  run right after a fresh `npm install`, catches it.
- **Trailing-newline trap**: `npx patch-package <pkg>` can silently drop a
  patched file's last line on regeneration/application if that file lacks a
  trailing newline. Rule: before regenerating a patch, confirm every file it
  touches ends in `\n` (not just the ones edited this round —
  `patch-package` re-diffs the whole package), then run `node --check` on
  the touched `lib/*.js` files after a fresh install regardless of how small
  the edit looks.
  Known instance: the stock `lib/*.js` files have no trailing newline, and the
  patch appends to the end of `lib/cells.js` (the tribuf export block).
  Applying the patch leaves that file without a final `\n`. So **before every
  `npx patch-package digitaljs`, run `echo >> node_modules/digitaljs/lib/cells.js`**.
  Otherwise the regenerated patch records "No newline at end of file" and the
  next install drops its last `});` (`node --check` fails). The reliable
  check is a round trip: copy `node_modules/digitaljs` aside, regenerate,
  `rm -rf` + `npm install`, then `diff -r`. Only the missing final newline of
  `lib/cells.js` should differ.

## Lua script execution lifecycle

(History from the fengari/digitaljs_lua era. Since the Rust migration's phase 4
scripts run inside the engine, where the async races below can't happen; the
webview's `LuaRunner` single-active-execution logic still applies.)

Root cause of the earlier "stale/wrong values in the real webview" bug (a Lua
script driving a shared tri-state bus printed the same value 5 times instead
of 5 distinct ones): **multiple Lua executions could run concurrently against
the same circuit**. `LuaRunner.run()` (`view/main.mjs`) only stopped a runner
with the *same name* before starting a new one; a different named script, or
a REPL submission, got its own `digitaljs_lua.LuaRunner` bound to the same
circuit with zero exclusion — two runners fighting over the same input is
what produced the "no se entiende si hay uno o varios scripts corriendo"
toggling.

Fixed by making `LuaRunner` (`view/main.mjs`) enforce single-active-execution
and tie the circuit clock's lifecycle to script lifecycle:
- `run()` stops *every other* runner (script or REPL) before starting a new
  one, not just a same-named one.
- Starting a script ensures the clock is running (`circuit.start()` if not
  already) — cheap "ensure ticking", not a state reset; no such reset API
  exists in `digitaljs`.
- `digitaljs_lua`'s `'thread:stop'` event (fires for natural completion *and*
  explicit stop alike) now also pauses the sim (`circuit.stop()`) and
  broadcasts an added `luaActive` flag through the existing `runstate` pipe
  (`view/main.mjs` → `src/document.mjs` → `src/status_provider.mjs` /
  `view/status_view.mjs`), which disables the control panel's
  Start/Pause/Step/Fast-forward/Next-event buttons while any Lua execution is
  active — so the user can't manually pause/step the clock a running script
  depends on.
- `_handle_alarmReached`/`_handle_monitorValue`
  (`node_modules/digitaljs/src/engines/worker.mjs` +
  `lib/engines/worker.js`, patched) were refactored into one
  `_resumeAfterCallback` helper that re-reads `_running` *after* the
  callback runs, so a script's own synchronous `stop()` (triggered by the
  `thread:stop` handler above) can't be silently overridden by the
  auto-restart-on-falsy-return behavior — this was already true of the
  pre-existing code given `digitaljs_lua`'s events are synchronous
  (`Backbone.Events`), so the patch is a documented hardening/dedup, not a
  behavior change.

**Regression caught right after the fix above**: the exclusion loop in
`LuaRunner.run()` originally read
`for (const other_name of Object.keys(this.#runners)) { if (!isrepl &&
other_name === name) continue; this.stop(other_name); }` — deliberately
*skipping* the same-named runner, on the mistaken assumption that
`#getRunner()` overwriting `this.#runners[name]` was enough. It isn't:
`#getRunner()` just creates a new `digitaljs_lua.LuaRunner` and orphans the
old one without stopping it, so re-triggering the *same* script while an
earlier run of it was still active (e.g. a stuck first attempt, or a
double-fired Run command) spun up a second runner in parallel on the same
circuit — reproducing the exact original bug (duplicate/interleaved prints,
`oe_a` toggling). Confirmed headlessly against a real `WorkerEngine` (see
below) and fixed by simply not special-casing same-name: stop *every*
tracked runner unconditionally before starting the new one.

**Headless `WorkerEngine` reproduction recipe** (useful for any future
webview-specific circuit/engine bug, not just this one): a `HeadlessCircuit`
can be constructed with the real `WorkerEngine` — `new HeadlessCircuit(data,
{engine: WorkerEngine})` — giving a fully scriptable, non-interactive
reproduction of bugs that only manifest through the actual worker-thread
tick loop (unlike the default `SynchEngine`, which sidesteps that entire
code path). Needs two things Node's plain ESM loader doesn't support out of
the box, both worked around with a small `module.register()` hook (not
checked in, was thrown away after use — regenerate if needed; run with
`node --import ./register.mjs`, worker threads inherit it): (1) the
`fengari-web` named-export issue described above, and (2) the same issue for
`@joint/core`, whose CJS bundle likewise isn't statically analyzable by
`cjs-module-lexer` (`import { mvc } from '@joint/core'` fails the same way).
A generic loader that `require()`s the CJS build and re-exports its own
enumerable keys as named ESM bindings fixes both (`resolve` maps the bare
specifier to a `shim:` URL, `load` emits `export const k = m.k` per key).
Also needed: `circuit.observeGraph([])` (the webview's `_makePaper` does it;
without it `getOutput()` stays at its initial `x`), `circuit.startFast()`, and
`circuit._engine._worker.addEventListener('error', …)` — a throw inside the
worker's timer is otherwise invisible and just looks like "tick 0 forever".
Use `src/` by `file://` URL for everything (the `lib/` worker is stale), and
`JSON.parse(JSON.stringify(data))` the circuit like the host→webview
`postMessage` does. Internal state (e.g. a register's Dff) is readable by
`observeGraph([label, …])` + `getLabelIndex(path).graph.getElements()`. Import `HeadlessCircuit`/
`WorkerEngine` by absolute `file://` path into `src/circuit.mjs` and
`src/engines/worker.mjs` (not the bare `digitaljs` specifier) to bypass the
package's `exports` map, which otherwise blocks deep imports outside of
package resolution.

**Second bug, found live after the above (headless testing never hit it):**
`sim.sleep`/`sim.wait` (`digitaljs_lua/src/index.mjs`'s `_enqueue`) schedule
their wakeup via `this.#circuit.tick + delay`, where `circuit.tick` is the
*main thread's cached* tick (`WorkerEngine`'s `_tickCache`, refreshed only
asynchronously via `update`/`stopped` postMessages from the worker thread).
`worker-worker.mjs`'s `alarm(tick, alarmId, {...})` used to silently drop
the registration (`if (tick <= this._tick) return;`, no error, callback
never fires) whenever that cached tick was stale enough that the real
worker-thread tick had already reached or passed the target by the time the
`alarm` message crossed the thread boundary — leaving the Lua coroutine
permanently suspended (the original "solo aparece el header, nada más"
hang). This never reproduced in 90+ headless `WorkerEngine` runs (varied
timing, sequential re-runs, double-click) built for the first bug above —
apparently the Node.js `web-worker` polyfill doesn't have enough real
cross-thread postMessage latency to expose the race; it only showed up live,
confirmed via a stack-trace + tick-comparison console capture. Fixed by
clamping instead of dropping — `if (tick <= this._tick) tick = this._tick +
1;` — so a stale wakeup request fires on the very next tick instead of
vanishing. Patched in both `src/engines/worker-worker.mjs` and
`lib/engines/worker-worker.js`.

**Third bug, independent of Lua entirely:** an echo loop between the
circuit's `RemoteIOPanel` (`view/iopanel.mjs`) and the control panel's input
widgets (`view/status_view.mjs`). `iopanel.mjs`'s `_addInput` both applies
incoming `iopanel:update` messages via `cell.setInput(...)` *and* relays
*any* `change:outputSignals` on that cell (including one its own `setInput`
call just caused) back out as another `iopanel:update`. `status_view.mjs`'s
`#newBitWidget` received that and called `checkbox.prop('checked', ...)` on
a `<vscode-checkbox>` (`@vscode/webview-ui-toolkit`, FAST/Lit-based) —
unlike a native checkbox, this custom element re-fires its own `change`
event on a *programmatic* property set, not just a real click, and the
widget's `change` handler posted an `iopanel:update` right back with no
value-changed guard, closing the loop. Purely message-passing (each hop is
a separate `postMessage` turn across the extension host), which is why the
symptom looks like continuous rapid toggling with the simulator unresponsive
rather than a hard freeze. `#newNumberWidget` and `#newClockWidget` in the
same file already guarded their own `change` handlers against exactly this
(`if (new_bin == bin) return;` / `if (new_value == value) return;`) —
`#newBitWidget` was just missing the same guard; fixed by adding it. Since
nothing about steps 2-4 of the loop cares what triggered the *initial*
`change:outputSignals`, this bug was reachable by a single real user click
on a control-panel checkbox too, not just by a Lua script.

**Still-unfixed, unrelated latent bug found along the way**:
`HeadlessCircuit.unobserveGraph` (`circuit.mjs:346-347`) calls `observeGraph`
instead of `unobserveGraph` — a real typo/leak. (The other one listed here,
`alarm()`'s unguarded `_pq.add(tick-1)`, is fixed — see "Simulation controls".)

## Simulation controls: speed, run-for, reset, timescale

The control panel (`src/status_provider.mjs` HTML + `view/status_view.mjs`)
does **all** time <-> tick conversion (`src/time_units.mjs`, vscode-free,
tested in `test/pipeline.spec.mjs`). The circuit webview and the worker only
ever see ticks.

- **Timescale** (`1 tick = 1 ns` default) is a per-project option,
  `synth_options.timescale`, saved with the document. It's set from the
  control panel via `document.setTimescale()`, which also fires
  `synthOptionUpdated`: the plain setter doesn't (it assumes the synthesis
  panel is the source), and the synthesis panel would otherwise write its
  stale copy of the options back.
- **Speed** (ticks/s, `null` = max) is global, in the extension's
  `globalState` (`DigitalJS.simSpeed` in `extension.mjs`), pushed to **every**
  open circuit view (`setspeed`) and sent with `showcircuit`. `view/main.mjs`
  `startSim()` maps it to `circuit.interval = 1000/speed` + `start()`, or to
  `startFast()` for max (what the removed fast-forward button did). Everything
  that starts the sim goes through `startSim()`, Lua included, so scripts run
  at slider speed (1 to 1e9 ticks/s, 4 steps per decade, then max). This
  needs the patched worker `start()` (`engines/worker-worker.mjs`): stock
  digitaljs runs exactly 1 tick per `setInterval(interval)`, capped at
  ~250 ticks/s. The patch uses a fixed 10 ms timer, works out how many ticks
  are owed (fractional `interval` is fine), processes only the *events* before
  that target tick and then jumps `_tick` there. That's the same as N
  `_updateGates()` calls, but empty ticks cost nothing, so a quiet circuit
  isn't capped by a per-tick loop. Alarms (`tick-1` in the pq) still stop it.
  It has a 10 ms work budget per call and drops the backlog.
- **Speed limits** (measured, `startFast`, Node + WorkerEngine): `04_counter`
  ~26M ticks/s; `board` (CPU + RAM + LED matrix) ~870k ticks/s, which is
  ~4.3k clock cycles/s, or ~0.87 ms of simulated time per second at
  1 tick = 1 ns. The ceiling is gate events per second in JS, not the UI. The
  panel shows the *measured* speed (`actual ≈ …/s`, from the `tick` updates the
  worker's 25 ms `_sender` produces) under the requested one, so a user can see
  that their circuit, not the slider, is the limit.
- **Run for N** = `circuit.alarm(tick+N, () => true, {stopOnAlarm: true})` +
  `startFast()`. The callback returning `true` keeps it stopped
  (`_resumeAfterCallback`). It always runs flat out, like `run 100ns` in an
  HDL simulator. This exposed the `alarm()` bug, now fixed in `worker-worker`
  and `synch` (src+lib): `_pq.add(tick-1)` ran even when `tick-1` already had
  queued events, so the duplicate entry was polled twice and the second
  `_updateGatesNext()` threw on `_queue.get(k) === undefined`. That killed the
  worker, and it was reachable from Lua's `sim.sleep` too. Covered by a test in
  `test/pipeline.spec.mjs`.
- **toJSON() round-trip rule**: every cell attribute needed to rebuild a
  cell must be listed in that cell's `_gateParams`. `toJSON()` serializes only
  those, and its output is what the document stores after every edit or
  autolayout (`updatecircuit`), what undo/redo reloads and what Reset
  rebuilds from. Our patched cells broke this: `TriMerge` dropped `bits` (it
  came back 1-bit, so the 32-bit bus wires got width warnings) and
  `LEDMatrix` dropped `rows`/`cols` (it came back 1×1). Separately,
  `_makeGraph` read `this.running` for a cell with a warning before
  `_engine` existed, so the rebuild threw half-way and left an **empty
  schematic** (the "Reset erases the circuit" bug). Both are fixed (the
  `running` getter tolerates a missing engine). `test/pipeline.spec.mjs` "circuit.toJSON()
  round-trip" rebuilds every example from its own `toJSON()` and compares
  every cell's port widths and rows/cols: run it for any new or patched cell.
- **Reset** (`resetsim`, runtime only, no document edit) rebuilds the circuit
  from `circuit.toJSON()` with `{keep: true, reset: true}`. `keep` restores the
  dialogs/zoom, `reset` drops `signals`/`initTick`, so it restarts at tick 0
  with registers at their initial values. `toJSON()` serializes a Memory's
  *current* contents (`Memory.getGateParams`, e.g. the board's VRAM), so
  `#initialMem` (captured on every non-`keep` build, keyed
  `subcircuit-type|device-id`) is written back first. A Clock period edited
  in the panel survives (it's a parameter); waveforms don't. Lua scripts are
  stopped (`#destroyCircuit`).
- **Panel layout/styling** lives in `status_provider.mjs`'s `<style>` and uses
  only `--vscode-*` variables (light and dark themes). The I/O table is laid out
  as a CSS grid (`tr`/`tbody` `display: contents`) so fields can shrink in a
  narrow sidebar. That also needs `--input-min-width: 0px`: the toolkit's
  design token defaults to 100px and pushes the 3rd column out. An `LEDMatrix`
  output is drawn as a small canvas grid (`#newLedMatrixWidget`; `iopanel.mjs`
  `_addOutput` sends `type`/`rows`/`cols`). Outputs wider than the field are cut
  off with an ellipsis, with the full value in the tooltip.
- **Looking at the panel without VS Code**: call
  `StatusProvider.resolveWebviewView` with a fake view (capture the `html`
  setter; `asWebviewUri: p => 'http://harness' + p`) and a fake `djs` (paths,
  `runStates`, `synth_options`, `simSpeed`, events returning `{dispose(){}}`).
  Inject `--vscode-*` theme variables on `<html>`, VS Code's default
  `body { padding: 0 20px; … }` and an `acquireVsCodeApi` stub. Then load it
  with Playwright (installed, Chromium included) using
  `page.route('http://harness/**', r => r.fulfill({path}))` (module scripts
  don't load from `file://`), `window.postMessage` sample
  `iopanel:view`/`tick`/`runstate` messages, and take screenshots at 240 and
  320 px wide.

## Misc

- `$readmemh`/`$readmemb` data files (`.hex`/`.mem`): `run_yosys` writes each one at its
  project-relative name **and** at its bare basename (`data_file_paths`, applied after all
  exact names so an alias never shadows a real root file). The `.sv` sources are flattened
  into the synthesis dir root, so a bare `"control_unit.hex"` (the convention in the
  `soc`/`micro` sources, written relative to the source file) only resolves through the
  alias. Without it a nested file fails loudly: `failed to open file 'control_unit.hex'`.
- Examples worth knowing: `test/verilog/micro/` is the RV32I datapath with plain `output`
  bus ports; its `memory.hex` holds a tiny program (sum 5..1 into x2, store/load into x3,
  spin on `jal x0,0`) and `test/pipeline.spec.mjs` simulates it. `test/verilog/soc/rtl/`
  is the `inout`-bus version (`cpu_ram.sv` = CPU + RAM without the LED matrix, to check
  that both `.hex` files loaded: the bus should alternate `0x0 -> 0x00010437 -> 0x4 ...`).
  `board` (soc + `led_panel`, a capybara walking on a 16x32 LED matrix) needs ~1500 clock cycles (~300k ticks,
  Clock `propagation` 100 = 200 ticks/cycle) after reset before the first LED lights:
  use Fast-forward (plain Start does one tick per `interval`, 10 ms by default).
- Yosys errors: on failure the script + yosys stdout/stderr are dumped to the
  "HDL Studio (Yosys)" OutputChannel and revealed (`src/requests.mjs`).
- Known cosmetic limitation: `<vscode-checkbox>` with slotted text stacks its label
  under the box in this toolkit version; not fixable from outside CSS. Left as-is.
- digitaljs has **no interactive resize tool at all** for cell boxes on the paper
  today — confirmed by checking both digitaljs's own `Box`/`BoxView`
  (`cells/base.mjs`, only ever auto-sizes width once from content, never the other
  way) and this project's `@joint/core` fork's `elementTools/` (only ships
  `HoverConnect`, no `Control`/`Boundary`-style resize handles). Relevant if
  `LEDMatrix` ever grows manual resize (see `TODO.md`) — would need a resize tool
  built from scratch, not just a flag to flip.
