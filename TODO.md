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
- [ ] `alarm()`'s `this._pq.add(tick-1)` (`node_modules/digitaljs`
      `engines/worker-worker.mjs` and `engines/synch.mjs`) is unguarded
      against a duplicate entry at the same tick, unlike `_enqueue()`'s own
      guarded version — a collision could silently freeze all future
      combinational recomputation.
- [ ] `HeadlessCircuit.unobserveGraph` (`node_modules/digitaljs`
      `circuit.mjs`) calls `observeGraph` instead of `unobserveGraph` — a
      real typo/leak.