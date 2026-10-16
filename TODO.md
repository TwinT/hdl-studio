# Task List (TODO)

## Next Features 🚀
- [ ] Option for disabling labels on the circuit graphic view.
- [X] Native Z (high-impedance) support for shared tri-state buses — see
      `CLAUDE.md`'s "Patching digitaljs & friends" section.
- [X] Signal input widgets (Button/NumEntry): scroll wheel over the widget
      should increment/decrement its value.
- [X] Investigate new visualization widgets — e.g. an LED matrix, an array
      of 7-segment displays. (The existing single Display7 widget also has a
      worked example now — `test/verilog/09_bcd_to_7seg/` — and was restyled
      as red LEDs.) Added `LEDMatrix`: a rows × cols grid of LEDs configured
      via `led_matrix_rows`/`led_matrix_cols` Verilog attributes on the
      output port (a port's bit width alone can't express two independent
      dimensions) — see `CLAUDE.md`'s "I/O widget inference" and
      `test/verilog/10_led_matrix/`. Its LED pitch is computed once from
      rows/cols so more LEDs means higher resolution, not a bigger widget.
- [ ] `LEDMatrix` interactive resize: it ships v1 with size computed once
      from rows/cols (no manual resize) since digitaljs has **no** drag-resize
      tool for cell boxes at all today — confirmed nothing in `Box`/`BoxView`
      (`node_modules/digitaljs/src/cells/base.mjs`) or this project's
      `@joint/core` fork's `elementTools/` provides one. Would need a
      resize-handle tool built from scratch (on `change:size`, re-run
      `LEDMatrix`'s layout/markup-rebuild logic), not just a flag to flip.

## Improvements and Refactorization 🛠️
- [X] "Show HDL Studio Panel" button should not display when the file is not supported.
- [X] Tribuf/TriMerge symbols: replace with something more standard/nicer-looking.
- [X] Signal input widgets should start at 0, not x.

## Known Bugs 🐛
- [X] Lua scripts (digitaljs_lua) keep running after being stopped — no way
      to fully kill them. (Was the circuit simulation, not the script itself,
      staying on — stopping a script now also pauses the simulation.)
- [X] Lua-driven simulation gave stale/wrong values or hung/toggled forever
      in the real webview — three independent bugs, see `CLAUDE.md`'s "Lua
      script execution lifecycle":
      1. `LuaRunner.run()` only stopped a same-named runner before starting
         a new one, so re-triggering a script (or starting a different one)
         while an earlier run was still active spun up a second runner
         fighting over the same inputs. Fixed: stop every tracked runner
         first.
      2. `WorkerEngine`'s `alarm()` (`node_modules/digitaljs`) silently
         dropped a `sim.sleep`/`sim.wait` wakeup whenever the main thread's
         cached tick was stale by the time the registration reached the
         worker thread, permanently hanging the script. Fixed: clamp to the
         next tick instead of dropping.
      3. `RemoteIOPanel` ↔ control panel echo loop: a `<vscode-checkbox>`
         re-fires its own `change` event on a programmatic update, and the
         checkbox handler had no value-changed guard (unlike the number/clock
         widgets), so any input change could bounce forever between the
         circuit and the control panel. Fixed: added the same guard.
- [X] `alarm()`'s `this._pq.add(tick-1)` (`node_modules/digitaljs`
      `engines/worker-worker.mjs` and `engines/synch.mjs`) is unguarded
      against a duplicate entry at the same tick, unlike `_enqueue()`'s own
      guarded version — a collision could silently freeze all future
      combinational recomputation. (Fixed, see `CLAUDE.md`'s "Simulation
      controls".)
- [ ] `HeadlessCircuit.unobserveGraph` (`node_modules/digitaljs`
      `circuit.mjs`) calls `observeGraph` instead of `unobserveGraph` — a
      real typo/leak.

## Pending, noted during the Rust migration 📌
- [ ] `@twint/4vl` 1.0.2: `isHigh`/`isZ` are false for an all-ones/all-z
      vector whose width is a multiple of 32 (`_lastmask` is `4294967295`,
      but `word & _lastmask` is `-1` in JS). Fix in 4vl 1.0.3:
      `_lastmask` returns `(~0 >>> -this.bits) | 0`. Visible today: a 32-bit
      all-ones bus isn't drawn green, `transform` skips all-x 32-bit
      constants, Lua's `ishigh` is wrong. `hdlstudio-logic` doesn't copy the
      bug (documented in `crates/hdlstudio-logic/tests/4vl.rs`).
- [ ] Release 0.7.0: publish to the Marketplace (`vsce login TwinT`, then
      `vsce publish --packagePath hdl-studio-0.7.0.vsix`) and create the
      GitHub Release (`gh auth login`). The `v0.6.1` tag was never pushed.
- [ ] Check whether `@vscode/webview-ui-toolkit` is really deprecated
      (phase 6 drops it either way).
- [ ] Converter quirks copied from yosys2digitaljs / digitaljs's transform on
      purpose (phase 2 ports faithfully); fix each in its own commit:
      - gate-level `$_DFF_P_`/`$_DFFE_PP_` are "Invalid cell type" (the kinds
        Map lists `$_DFF_`/`$_DFFE_` twice and the async-reset entries win);
      - `makeBinaryMuxes` never goes sparse below 7 select bits (its
        `mapping.size < 2**(dev.bits-1)` test uses `dev.bits`, an object);
      - `makeBinaryMuxes` checks `groups` on the OrReduce instead of its
        BusGroup, so that check always passes;
      - a `$mem_v2` with 2+ read ports gets the read ports' init/arst/srst
        values in reverse port order (sliced from the MSB end);
      - a ROM (`$mem_v2` with no write ports) gets `transparent`/`collision`
        `true` on its read ports (`[].every()` is true);
      - with several top-level modules the top is picked by name order.
- [ ] The techmap option fails on `soc`'s `board`: yosys leaves `$fa`/`$alu`
      cells the converter has no cell for ("Invalid cell type: $fa").
- [ ] `test/pipeline.spec.mjs`'s wide-index test runs `digitaljs/lib/transform.js`,
      which (unlike the patched `src/` the extension uses) still makes
      MuxSparse `inputs` BigInts. Gone with digitaljs in the cutover.
- [ ] Opening a raw yosys netlist on vscode.dev no longer works (conversion
      needs the native `hdlstudio`). Expected: the web build goes away.
- [ ] Simulator divergences from digitaljs, on purpose: Memory transparency and
      collision compare read/write addresses by value (digitaljs's JS `==`
      compares objects, so it depended on whether a Mux or Dff happened to pass
      the same object along); ticks are u64 (digitaljs's are int32: they wrap
      after 2^31, ~2.1 s at 1 tick = 1 ns); a zero-delay loop that never
      settles is an error ("combinational loop did not settle in tick N")
      where digitaljs hangs.
- [ ] Simulator speed: the board runs at ~39k cycles/s, 9x digitaljs (the goal
      was 10x). The cost is spread over evaluating and propagating; the next
      steps are structural: fold the zero-delay bus cells (BusSlice/BusGroup,
      a third of all evaluations) into their readers, and a narrow-value fast
      path for nets of up to 64 bits.
- [ ] Simulator features still to port for phase 4: monitors and alarms,
      `memChange`/manual memory edits, parameter changes while running (a
      Clock's period), FSM `current_state`/`next_trans` for the editor.
- [ ] digitaljs_lua bugs the engine's Lua (crates/hdlstudio/src/lua.rs) fixes:
      a string narrower than the input/operand it is converted for crashed
      ("Cannot read properties of null (reading 'v')": now zero-extended);
      `sim.setinput` of an unknown input threw a JS TypeError that `pcall`
      couldn't catch (now a Lua error); the REPL's `printResult`/
      `prependReturn` options were ignored, so typing an expression printed
      nothing (now it prints its values); `tointeger` refused 32 bits or more
      (now up to 63); error messages now say `file:line`.
- [ ] `sim.registerdisplay` (custom number displays) isn't in the engine's Lua
      yet: the display runs in the UI, so it needs a protocol for it.
- [X] Example scripts that never worked: `11_pushbutton/pushbutton_sim.lua`
      set an input `btn` (the port is `pushbutton`); `02_d_latch` and
      `03_full_adder` read their outputs 2 ticks after changing the inputs,
      before the gates settled (x, so `tointeger()` failed). Fixed (found by
      the Lua diff test).
- [ ] Temporary regressions of the engine adapter (phase 4), until the new UI:
      editing the circuit (and undo/redo of an edit) restarts the simulation
      at tick 0 (the worker kept the signals); vscode.dev can't simulate at all
      now (the engine is a native process); the FSM editor gets the current
      state but not `next_trans` (the highlighted transition).
      The new schematic (phase 5) fixes the first and the last: moving cells
      (and undo/redo of a move) keeps simulating, and it works out the next
      transition itself. They remain in the digitaljs view only.
- [ ] Unused since phase 4, remove in the cutover: the digitaljs worker bundle
      (`dist/digitaljs-sym-worker.js`, `simWorkerUri` in the circuit view HTML,
      `djs.simWorker`), and `digitaljs_lua`/`fengari-web` (only the Lua diff test
      uses them).
- [X] `view/monitor.mjs` called `_.extend` without importing lodash: it only
      worked because digitaljs_lua loaded lodash, which left a global `_`.
      Removing digitaljs_lua from the webview broke the whole view at load.
      Fixed with `Object.assign` (found by the webview test on the engine).
- [ ] The new schematic (phase 5, `view/schematic/`), what it doesn't do yet
      or does differently:
      - a moved cell's wires lose their route and go straight (an L/Z shape
        through other cells); route them around cells, or re-run ELK on
        demand ("tidy up" button);
      - no wire editing (on purpose for v1: an edited netlist no longer
        matches the SystemVerilog), no waveform monitor yet (phase 6); the
        digitaljs view (setting `hdl-studio.useDigitaljsView`) still has both;
      - the synthesis panel's layout option (elkjs/dagre) does nothing in it:
        it only lays out with ELK. Remove the option with the digitaljs view;
      - a number base picked on a NumEntry/NumDisplay is kept in the circuit
        but, as in digitaljs, only saved with the next edit;
      - the paper is white in dark themes too, as in digitaljs;
      - cells moved inside a subcircuit are saved (per subcircuit type, like
        its layout); digitaljs never saved those.
- [ ] If the engine process dies, the host starts a new one on the next
      request, but the webview doesn't load the circuit into it again
      ("no circuit loaded" until the circuit is shown again). Since phase 4.
- [ ] Remove at the cutover, with the digitaljs view: `view/main.mjs`,
      `view/remote_engine.mjs`, `view/iopanel.mjs`, `view/monitor.mjs` (after
      phase 6), `view/scss/`, `view/touch-punch.mjs`, the `main-view` webpack
      config, `djs.mainJSPath`, the `hdl-studio.useDigitaljsView` setting, and
      the npm deps only they use (jquery-ui, hammerjs, svg-pan-zoom,
      split-grid, resize-observer-polyfill, backbone, @joint/*; jquery goes
      when phase 6 rewrites the control panel).
