# Native Z (high-impedance) support via a `4vl` package — integration plan

Status: **all 7 punch-list items (0-6) done — the plan is complete.**
`@twint/4vl@1.0.1` is published on npm, every `3vl` import in the dependency
tree that's actually reachable at runtime has been swapped for it,
`yosys2digitaljs` accepts multiple drivers per net (merged via `TriMerge`),
`$tribuf` converts to a real `Tribuf` digitaljs device instead of being
collapsed by `tribuf -formal`, a full per-cell audit found zero
simulation-logic gaps, wire/port/lamp/waveform coloring has a 4th visual
state for Z, and the full `npm test` (`test:pipeline` + `test:vscode`) is
green (see the completion notes below for all six steps). A real `.sv`
design (`test/verilog/bus_top/`) exercises the whole native-Z path end to
end through actual synthesis — the cross-module case the project originally
built this whole feature to handle. **Not yet verified by anything in this
plan: the interactive simulation itself (F5)** — every check across all six
steps has been conversion-time, unit-level, or (for step 6) a scaffolding
extension test, never an actual rendered circuit in a running VS Code
window. That remains the one thing to do before calling this feature
genuinely done, not just correctly built.

## Why

HDL Studio's CPU example project (`test/verilog/control_unit`,
`test/verilog/memory`, and a planned `datapath.sv` that doesn't exist yet)
uses a classic shared-bus architecture: multiple modules each drive a bus
through a tri-state output-enable (`assign bus = oe ? val : 'z;`). Real
simulation of that architecture — including bus contention (two drivers
active at once) and "nobody's driving" as genuinely distinct from "driven
to 0" or "conflict" — needs a true 4th logic value. `digitaljs`'s value
system (`3vl`, vendored at `node_modules/3vl`) is purely 3-valued (0/1/x,
2 bits per bit: value + xmask, confirmed by reading `3vl/src/index.ts` —
no z/tristate concept anywhere in it).

A cheaper alternative was explored and rejected: representing a bus merge
as a `Mux1Hot` device (`digitaljs/src/cells/mux.mjs:152-157`) — its
existing `muxInput` already resolves "exactly one enable active → pass
through; zero or 2+ active → x" using only the existing 0/1/x system, and
`yosys2digitaljs` already converts yosys's `$pmux` cell to `Mux1Hot`
end-to-end. This works cleanly ONLY when all the tri-state drivers sharing
a net live in the same yosys module scope (e.g. one shared `wire` with
several sibling `assign ... : 'z'` statements). It does NOT work across
module boundaries: `read_slang --best-effort-hierarchy` (used to keep
subcircuits visible instead of flattening) hides a submodule's internal
tri-state enable from the parent scope entirely — by the time a shared bus
net's conflict is visible at the top level, the enable signal that would
be needed to build the `$pmux`/`Mux1Hot` selector no longer exists in the
JSON. Rejected because the real architecture needs cross-module sharing.
Decision: build native Z support instead, via a separate `4vl` package.

## What's already true today (found during investigation, still valid)

- `3vl` (`node_modules/3vl`): 0/1/x only, no Z. Used via
  `import { Vector3vl, Display3vl } from '3vl'`.
- **`yosys2digitaljs`'s single-driver-per-net rule is NOT a 3vl limitation**
  — it's the library's own design choice, independent of the value system,
  and must be redesigned regardless of what `4vl` looks like.
  `add_net_source()` (`node_modules/yosys2digitaljs/dist/core.js:310-324`)
  throws `Error('Multiple sources driving net: ...')` the instant a second
  cell registers as the driver of the exact same net-bit-array (nets are
  keyed by bit-id-array content+order, a `HashMap` from the `hashmap` pkg).
- `$tribuf` has **no conversion path at all** in `yosys2digitaljs` (no
  portmap entry, no special-cased `else if` like `$pmux`/`$mem`/`$lut` get
  — falls through to `throw Error('Invalid cell type: $tribuf')`,
  `core.js:1026`). Today's stopgap (commit `955aea7`,
  `src/yosys_script.mjs`) runs `tribuf -formal` right after `proc`, which
  collapses every tri-state buffer to plain 0-default logic *before* it
  ever reaches the JSON — fine for a single driver in one module scope,
  but it destroys the enable information a real multi-driver merge would
  need, and doesn't handle genuine bus sharing at all.
- Cell simulation contract: every `digitaljs` cell implements
  `operation(data)` where `data` is `{portId: Vector3vl, ...}` for each
  input port, returning the same shape for outputs (see e.g.
  `digitaljs/src/cells/mux.mjs:69-73`, `gates.mjs` `OrReduce`). Whatever
  `Vector4vl` becomes, this is the interface every cell keeps using.
- Cell type registration: `HeadlessCircuit` (`digitaljs/src/circuit.mjs:72-80`)
  resolves a JSON device's `type` string via `this._cells[dev.type]` (namespace
  built from `cells.mjs` + optional `cellsNamespace` ctor option); the view
  side uses `paperOptions.cellViewNamespace` (`digitaljs/src/index.mjs`).
  New cell types are addable without forking, in principle — **caveat,
  untested**: `cells.mjs`'s `import * as cells` is a real ESM namespace
  object, which may be non-extensible for `Object.assign` when *adding* a
  new key (vs. overwriting an existing one); would need to pass a fresh
  plain object instead of mutating the shared namespace if that's the case.

## `3vl` usage inventory (every site that needs touching)

`digitaljs/src/` (15 files): `cells/base.mjs`, `cells/io.mjs`,
`cells/bus.mjs`, `cells/dff.mjs`, `cells/mux.mjs`, `cells/arith.mjs`,
`cells/fsm.mjs`, `cells/memory.mjs`, `circuit.mjs`, `monitor.mjs`,
`help.mjs`, `iopanel.mjs`, `transform.mjs`, `engines/worker.mjs`,
`engines/worker-worker.mjs` — all `import { Vector3vl, Display3vl } from '3vl'`.

`yosys2digitaljs/dist/core.js`: 4 call sites — `Vector3vl.fromBin(...).toBin()`
(FSM transition table decode, ~line 844) and `Mem3vl`/`Vector3vl.fromBin`
(memory init-data packing, ~lines 918-923). Narrow surface, unrelated to
the net-merge logic.

## Punch list, once `4vl` exists

0. ✅ **Receive the package.** `@twint/4vl@1.0.0` is on npm, pinned in
   `package.json` (`"@twint/4vl": "^1.0.0"`), replacing the `"3vl"` entry
   there. `digitaljs`'s, `yosys2digitaljs`'s, `digitaljs_lua`'s and
   `wavecanvas`'s own `package.json` files still nominally list `3vl` as a
   dependency (left alone — harmless, unused transitive install, not worth
   patching their manifests to drop it).
1. ✅ **Swap imports. Done — see "Step 1 completion notes" below for the
   real (larger than expected) file list and the two things that weren't
   obvious going in.**
2. ✅ **Allow multiple drivers per net. Done — see "Step 2 completion
   notes" below.**
3. ✅ **Real `$tribuf` conversion. Done — see "Step 3 completion notes"
   below.**
4. ✅ **Audit every cell's `operation()`. Done — see "Step 4 completion
   notes" below.**
5. ✅ **UI: 4th visual state for Z. Done — see "Step 5 completion notes"
   below.**
6. ✅ **Regression + new coverage. Done — see "Step 6 completion notes"
   below. This was the last punch-list item — the whole plan is now done.**

## Step 1 completion notes

The real file inventory turned out to be bigger than the "`3vl` usage
inventory" section above (kept as-is for history) because `digitaljs` is
loaded through **two separate, parallel copies of its own cell logic**, and
two more packages beyond `digitaljs`/`yosys2digitaljs` turned out to touch
value objects directly:

- **Correction (found during step 2, supersedes what this bullet originally
  said):** `digitaljs`'s `package.json` `main` is `./lib/circuit.js`, but
  it also has an `exports` map that takes priority for any exports-aware
  resolver (webpack included): `"browser": "./src/index.mjs"`,
  `"node": {"import": "./src/circuit.mjs", "require": "./lib/circuit.js"}`,
  `"default": "./lib/circuit.js"`. `main_view_config` in `webpack.config.js`
  has no explicit `target`, so webpack defaults to a browser target and
  resolves `import * as digitaljs from 'digitaljs'` via the **`browser`**
  condition — **`src/index.mjs`, not `lib/circuit.js`**. Proven two ways:
  `src/index.mjs` exports a `Circuit` class (`view/main.mjs:1159` does
  `new digitaljs.Circuit(...)`) that **does not exist in `lib/circuit.js`
  at all** (it only exports `HeadlessCircuit`) — that line would throw if
  `lib/` were actually resolved; and `dist/view-bundle.js` contains
  `_makePaper`/`_windowCallback`, methods that only exist on `src/index.mjs`'s
  `Circuit` class. So **both** the main thread (`src/index.mjs` →
  `src/circuit.mjs` → `src/cells.mjs`) **and** the Web Worker
  (`webpack.config.js`'s `digitaljs_worker_config` bundles
  `src/engines/worker-worker.mjs` **directly by path**, bypassing
  `exports`/`main` entirely, also landing in `src/cells.mjs` via its own
  `import * as cells from '../cells.mjs'`) run off the **`src/*.mjs`** tree.
  `lib/*.js` is patched too (for `"node"`/`"default"` condition consumers
  and general consistency) but is **unreachable dead code for every bundle
  this project actually ships** — confirmed by intentionally leaving a
  syntax error in a `lib/` file (a dropped closing brace from a botched
  `patch-package` regen) and finding `npm run compile` still succeeded and
  produced a byte-identical `dist/view-bundle.js`; only `node --check
  node_modules/digitaljs/lib/<file>.js` catches a `lib/`-only defect, `npm
  run compile` will not. **Lesson: after a value-library swap or new cell
  type here, grep the built `dist/*.js` bundles for the thing you changed —
  that's still right and is what caught the `Vector3vl` gap in step 1 — but
  it validates `src/` only. `lib/`'s only working check is `node --check`
  (or `require()`) on the specific files you touched, and only meaningful
  right after a fresh `npm install` (patch application is a separate step
  that can itself introduce breakage — it did, once, on this file, see step
  2's completion notes).**
- `digitaljs_lua` (imported directly by `view/main.mjs` for the Lua
  scripting API) has its own `Vector3vl` usage (`src/index.mjs`, exposed to
  Lua scripts as bitwise operators on wire values) — not part of the
  original inventory, found the same way (stale content in
  `dist/view-bundle.js`).
- `wavecanvas` (imported by `view/monitor.mjs` for waveform drawing) also
  has its own `Vector3vl`/`Display3vl` usage (`dist/index.js`) — same
  discovery method.
- `digitaljs_lua` declares `"digitaljs": "^0.13.1"` as its own dependency,
  which npm nests as a second, separate `digitaljs_lua/node_modules/digitaljs`
  copy (older major version) since it doesn't overlap with the top-level
  `^0.14.2`. Confirmed dead weight for this project — `digitaljs_lua/src/index.mjs`
  doesn't import `digitaljs` at all, only `digitaljs_lua`'s own *tests* do —
  so it was left unpatched.

Final patch set (all via `patch-package`, `npm install` auto-applies them):
`patches/digitaljs+0.14.2.patch` (29 files: the original BigInt fix plus 15
`lib/*.js` + 14 `src/*.mjs`), `patches/yosys2digitaljs+0.10.3.patch` (new,
`dist/core.js`), `patches/digitaljs_lua+0.0.9.patch` (new, `src/index.mjs`),
`patches/wavecanvas+1.1.1.patch` (new, `dist/index.js`). Plus direct edits
(no patch needed — hdl-studio's own source) to `view/iopanel.mjs`,
`view/monitor.mjs`, `view/status_view.mjs`.

Verified via `npm run test:pipeline` (21/21 pass), `npm run compile` (all 6
webpack targets compile clean) followed by grepping every `dist/*.js` for
`Vector3vl`/`require("3vl")`/`from '3vl'` (all clean), and `npm run lint`
(no new warnings). Not yet verified: an actual interactive simulation run in
the dev extension host (F5) — worth doing before relying on this further,
per this project's `CLAUDE.md` build/reload notes.

## Step 2 completion notes

`yosys2digitaljs`'s `NetInfo.source` (single `Port|undefined`) became
`NetInfo.sources` (array); `add_net_source` (`dist/core.js`) no longer
throws on a second call, and a new "Resolve multi-driver nets" pass, run
right before final connection generation, folds any net with 2+ sources
into a synthesized `TriMerge` device (same "device manufactured purely
during JSON conversion" pattern `add_busgroup` already uses for `BusGroup`)
whose `in0..in{N-1}` take the original drivers and whose `out` becomes the
net's sole effective source from that point on — so the unmodified
single-source code path handles everything downstream unchanged. New
`digitaljs` cell `TriMerge` (`src/cells/trimerge.mjs` + `lib/cells/trimerge.js`,
registered in both `cells.mjs`/`cells.js`): N same-width inputs, 1 output,
modeled on `GateX1`'s pairwise-fold shape but built on `Box` like
`BusRegroup`/`BusGroup` (no custom SVG art). Per-bit resolution (`z` → pass
the other operand; equal real values → that value; disagreeing real values
→ `x`) is hand-rolled against `@twint/4vl`'s public API
(`Vector4vl.get(i)`/`Vector4vl.fromArray()`) since `4vl` has no built-in
resolve primitive; it's associative/commutative (all-`z` is the identity,
contention is sticky) so driver fold order doesn't matter. `_gateKind: 'bus'`
(not `'combinational'`) so the cell doesn't pick up
`defaultCombinationalPropagation`'s nonzero delay — it's synthesized glue,
not user-placed logic, same reasoning as `BusRegroup`/`BusGroup`.

Two real mistakes happened and got caught before landing, both worth
recording:

- **A `patch-package` regen silently dropped the last line of a new file.**
  After adding `TriMerge`'s registration block to `lib/cells.js` (which,
  per the step 1 correction above, is genuinely unreachable dead code for
  this project — but still gets patched, and still needs to not be
  *broken*), `npx patch-package digitaljs` + a fresh `npm install` produced
  a `lib/cells.js` missing its final closing `});` — a hard syntax error
  (`node --check` / `acorn.parse` both fail immediately; confirmed the
  *patch file itself* was correct — full content, `\ No newline at end of
  file` marker — so the bug is in patch **application**, not generation).
  Nothing in this project's own build (`npm run compile`, `npm run
  test:pipeline`, `npm run lint`) caught it, because none of them actually
  load `lib/`: webpack resolved everything via `src/` (see the step 1
  correction), `test:pipeline` never touches `digitaljs` internals directly,
  and `eslint` doesn't scan `node_modules`. Only `node --check
  node_modules/digitaljs/lib/cells.js`, run *after* a fresh install, caught
  it. **Whenever a change touches `lib/*.js`, run `node --check` on those
  exact files post-install — this project's own checks provide zero
  coverage for `lib/`-only breakage.**
- **The worker's cell-instantiation pattern needs checking, not assuming.**
  `engines/worker-worker.mjs` doesn't build real `Box`/model instances — it
  copies `.operation` and each name in `._operationHelpers` onto a plain
  object whose `.get(name)` reads `this._params[name]` (`Gate` class,
  `worker-worker.mjs:15-51`). A new cell's `operation()` calling
  `this.get(...)` or a helper not listed in `_operationHelpers` will work
  fine via a real Backbone instance (main-thread/`SynchEngine` path) and
  silently break inside the actual simulation worker. Verified by
  reconstructing that exact plain-object pattern by hand against
  `TriMerge.prototype` and running it — full ESM import of
  `src/cells/trimerge.mjs` in bare Node isn't possible (`base.mjs` pulls in
  `@joint/core` + `tools.mjs`, which need a real DOM/`jsdom`, not present
  here), so this was done through the (textually identical, hand-verified
  line-for-line against the `.mjs`) compiled `lib/` copy instead, which
  `require()`s cleanly in plain Node.

New test: `test/pipeline.spec.mjs`'s "yosys2digitaljs net merging" describe
block. A net with 2+ sources can only arise via `$tribuf`, which has no
conversion path until step 3, and plain multi-driven wires are rejected by
yosys itself before JSON export (empirically confirmed: `wire`-level
tri-state via ternary → `proc` alone errors
`Y port signal ... already driven by ...`; `tribuf` (without `-formal`)
is what turns it into two real `$tribuf` cells sharing one output net —
worth remembering verbatim for step 3, it's the exact incantation needed).
So this test calls `yosys2digitaljs()` directly against a hand-built netlist
(2 real `$not` cells — structurally identical in shape to genuine yosys
output, just retyped from `$tribuf` — both driving one net-bit-array),
entirely bypassing yosys, and asserts the merge happens correctly. Also
reverified end-to-end from a **fresh `npm install`** (not just the working
tree): `npm run test:pipeline` (22/22), `npm run compile` (all 6 targets),
`grep TriMerge dist/view-bundle.js dist/digitaljs-sym-worker.js` (1 each),
`node --check` on the touched `lib/*.js` files, `npm run lint` (62
warnings, unchanged baseline).

## Step 3 completion notes

`$tribuf` (ports `A`/`EN`/`Y`, per `simlib.v`'s own model:
`assign Y = EN ? A : 'bz;`) now converts end to end. `src/yosys_script.mjs`:
`tribuf -formal` → `tribuf` (keeps real `$tribuf` cells instead of
collapsing them pre-JSON), and `t:$tribuf` added to the `techmap` branch's
`select -del` exclusion list — empirically confirmed necessary: bare
`techmap` lowers a 4-bit `$tribuf` into four 1-bit `$_TBUF_` primitives,
exactly the existing `$dff`/`$dlatch`/`$mem` "techmap gotcha" this file
already documents. `yosys2digitaljs` (`dist/core.js`): three small,
independent additions — `gate_subst` gets `['$tribuf', 'Tribuf']`,
`order_ports()`'s static table gets `'$tribuf': { A: 'in', EN: 'en', Y: 'out' }`
(sufficient for the *generic* `connect_device` helper to wire it, no bespoke
connector needed — unlike `$pmux`/`$mem`, nothing here needs bit-slicing),
and one `case '$tribuf': dev.bits = cell.connections.Y.length; break;` in
the bits-computing switch (`$not`'s exact shortcut; skipped `$not`'s
`match_port` call since `$tribuf` has no `A_SIGNED` parameter and yosys
never emits `A.length != Y.length` for it — both come from one shared
`WIDTH`). New digitaljs cell `Tribuf` (`src/cells/tribuf.mjs` +
`lib/cells/tribuf.js`, same two-tree registration as `TriMerge`): ports
`in`/`en`/`out`, `_gateKind` left unset (inherits `Gate`'s `'combinational'`
default — this **is** a real converted yosys cell, unlike `TriMerge`, so it
should respect `defaultCombinationalPropagation` like any other gate).
`operation()` matches `EN ? A : 'bz'` bit-for-bit including the
genuinely-unknown-`EN` case (Verilog's 4-valued ternary against a constant-
`z` false branch reduces to "keep `z` where `A` is already `z`, `x`
elsewhere") — verified directly: `EN=1`→passthrough, `EN=0`→all-`z`,
`EN=x`/`EN=z`→all-`x` except positions where `A` itself was already `z`
(those stay `z`).

Initially copied a `change:bits` listener from `BitExtend`/`GateX1` (calling
`this._setPortsBits(...)`, a `Gate.prototype` method reached only via the
Backbone prototype chain — inert on the actual simulation worker, which
never calls `initialize()` at all). Caught before landing: `Tribuf`'s `bits`
comes fixed from the synthesized JSON device, never user-edited, so unlike
those two (real toolbox-placeable gates) it doesn't need the listener at
all — dropped it, matching `TriMerge`'s own precedent (no listener, no
`_unsupportedPropChanges`) more closely than the two I'd copied from.

**The `lib/`-truncation bug from step 2 recurred, twice, with the root
cause now confirmed**: `npx patch-package <pkg>` reliably drops a patched
file's final line if that file's *working-tree* content (the one being
diffed against a clean install) has no trailing newline at EOF — the
resulting `\ No newline at end of file` marker in the generated patch
causes the apply step to lose the line, not just the newline. Confirmed
deterministic by reproducing it twice in this session, in the same file
(`lib/cells.js`), for the same reason (a hand-appended registration block
left without a final `\n`), and confirming a byte-level fix (append a
trailing newline, verify with `tail -c | xxd` before regenerating) stops it.
**Rule going forward: before running `patch-package` on any hand-edited
`node_modules` file, confirm it ends in a newline — then still `node --check`
the touched `lib/*.js` files after a fresh `npm install`, since generation
succeeding proves nothing about application.**

New coverage: `test/verilog/bus_top/` (`bus_top.sv` + `bus_top_sim.lua`) —
a real `.sv` fixture, not a hand-built JSON netlist like step 2's test:
`drv_a`/`drv_b` submodules each doing `assign bus = oe ? val : 'z;`,
instantiated twice in `bus_top` onto one shared bus. Picked up automatically
by `test:pipeline`'s existing single-`.sv`-per-subfolder discovery (both
plain and `techmap` variants). A new assertion in the same describe block
synthesizes it for real and checks the actual shape: one `Tribuf` device
per subcircuit (`drv_a`, `drv_b` — confirmed these are the real subcircuit
keys via the actual non-`useSlang` path `test:pipeline` exercises, *not*
the `drv_a$bus_top.a`-style keys `read_slang --best-effort-hierarchy`
produces, which is what this session's manual investigation used — first
attempt at this assertion used the wrong keys and failed, fixed by checking
the real path's output directly rather than assuming they'd match). The
`sim.lua`'s expected values (in its comments) come from directly testing
`Tribuf.operation()`/`TriMerge`'s merge logic and the real yosys→JSON
conversion shape, **not from actually running the script** — the LuaRunner
harness needs the DOM-bound `Circuit` class (per step 2's finding), so full
interactive verification is still the outstanding F5 check, same as every
step so far.

Verified end-to-end from a **fresh `npm install`**: `npm run test:pipeline`
(25/25, including the 2 new `bus_top` cases and the new device-shape
assertion), `npm run compile` (all 6 targets), `grep -c "Tribuf\|TriMerge"
dist/view-bundle.js dist/digitaljs-sym-worker.js` (1 each), `node --check`
on all 4 touched `lib/*.js`/`dist/core.js` files, `npm run lint` (62
warnings, unchanged baseline).

## Step 4 completion notes

Audited every `operation()` (and adjacent state-update/rendering code) in
`digitaljs/src/cells/*.mjs` — `arith.mjs`, `mux.mjs`, `memory.mjs`,
`dff.mjs`, `fsm.mjs`, `io.mjs`, `bus.mjs`, `base.mjs`, `gates.mjs` — via
direct source reading with exact file:line citations. **No simulation-logic
changes needed anywhere.** Every bespoke (non-`4vl`-primitive) code path
already handles `z` safely, via one of three pre-existing patterns that
extend to `z` for free (they were already written for `x`-safety):

1. **Numeric conversion is always guarded.** Every `operation()` calling
   `.toBigInt()`/`.toNumber()`/`.toBigIntSigned()`/`.toNumberSigned()`
   (which `assert(isFullyDefined)` and throw on any `x` **or** `z` bit)
   checks `.isFullyDefined` first and falls back to `Vector4vl.xes(...)`
   otherwise — confirmed in `Arith11`/`Arith21`/`ArithConst`,
   `Compare`/`CompareConst`, `Shift`/`ShiftConst` (guards only the port
   that's actually converted), every `muxInput()` (`Mux`, `Mux1Hot`,
   `MuxSparse`), and `Memory._calcaddr`. `EqCompare`/`EqCompareConst` do no
   numeric conversion at all (`bincomp` is pure `xnor`/`reduceAnd` or
   `xor`/`reduceOr`), so they're `z`-safe with no guard needed. Nowhere does
   an `operation()` call a numeric-conversion method unguarded.
2. **Clock/reset/enable edges compare raw `.get(0)` against an exact
   polarity (`1`/`-1`).** `z` reads as `2`, never equal to either, so a `z`
   clock/reset/enable is inert — identically to how `x` (reads `0`) already
   is. Confirmed in `Dff`, `Fsm`, `Memory` (same `pol(...)` idiom in all
   three).
3. **`FSM`'s transition lookup masks undefined bits before comparing**:
   `data.in.or(xmask).eq(ctrlIn.or(xmask))`. Per `@twint/4vl`'s encoding
   (`A:0,B:1` = x; `A:1,B:0` = z), `xmask()` is `a ^ b` — both `x` and `z`
   have `a` and `b` differing, so both mask to 1 and get forced equal on
   both sides by `.or()` before `.eq()`. A `z` in a transition-relevant
   signal is masked out exactly like `x` — a permissive degradation, not a
   distinct failure mode. Current-state lookup is a plain JS number
   (`Map.get(this.get('current_state'))`), never derived from a `Vector4vl`,
   so it can't be affected by `z` at all.

Worth recording because it explains *why* the audit came back clean, not
because it's a gap: `SignExtend._extBit` passes `Vector4vl.get()`'s raw
return value (`-1`/`0`/`1`/`2`) straight into `Vector4vl.make(n, init)` —
`make()`'s `init` switch accepts `2`/`'z'` as a first-class case (z-fill),
same encoding `.get()` reports, no translation needed. `4vl`'s public API is
internally consistent (`.get()`'s output domain and `.make()`'s `init`
domain are the same four values), which is why it's hard to write an
accidentally-`z`-unsafe cell using only its public methods.

**One real gap found, and it's display-only** — none of it touches
simulation correctness, and it's already punch-list step 5's job:
- `OutputView._updateLamp` (`io.mjs`) and `WireView._updateSignal`
  (`base.mjs`): both `x` and `z` fall into the same `undef` (grey) bucket.
- `Display4vlDec`/`Display4vlDec2c.show()` — inside **`@twint/4vl` itself,
  not `digitaljs`** (a different patch target than everything steps 1-3
  touched, worth flagging for whoever does step 5): any non-fully-defined
  vector collapses to the single character `'x'` in decimal display; hex/
  bin/oct already show a literal `'z'` character per digit.
- `InputView._updateButton` (`io.mjs`) has no `undef` branch at all — a
  pre-existing gap, not new to `z`, low-risk since a `Button`'s signal is
  user-toggled 0/1 in the stock UI flow, never externally driven.

**Verification**: added two regression tests to `test/pipeline.spec.mjs`
(`digitaljs cell operation() z-input safety` describe block), reusing the
`lib/` (compiled CJS) tree loaded via `createRequire` — proven in step 2 to
construct real cell instances and call `.operation()` directly in plain
Node without a DOM (the ESM `src/` tree pulls in `@joint/core` + `tools.mjs`
via `base.mjs`, which need a real browser DOM). Each test asserts the
*paired* behavior, not just "doesn't throw", so it actually discriminates
the z-guard from a cell that always returns x: `Addition` computes the real
sum on fully-defined operands (`1 + 3 = 4`) and only degrades to
`Vector4vl.xes(4)` when one operand has a `z` bit; `Mux1Hot` actually routes
the selected input through on a clean one-hot `sel` and only degrades to
all-x when `sel` has a `z` bit. No `memory`/`dff`/`fsm` tests added — they
share the same `.get(0) == pol(...)` idiom the two new tests' sibling
pattern already covers, and the audit established that by direct reading;
two discriminating tests beat several redundant ones.

No source changes to any cell — nothing in `patches/` or `node_modules/`
changed this step, only the new test file content. Verified via `npm run
test:pipeline` (27/27, including the 2 new tests) and `npm run lint` (62
warnings, unchanged baseline). No fresh-install/`node --check`/`compile`
pass needed (nothing shipped that those checks would catch).

## Step 5 completion notes

Added a 4th visual bucket (`'highz'`, color `#f39c12` amber) alongside the
existing `high`/`low`/`def`/`undef` states, wherever a wire/port/lamp/wave
value gets colored. Semantics: only a **fully** high-Z value (every bit is
`z`) gets the new bucket — a mix of `z` with `x` or with defined bits keeps
falling into today's existing bucket (`undef` grey if no bit is defined,
`def` blue if some are), matching the punch-list ask ("a 4th visual state
for Z") rather than redesigning the whole bucket scheme.

Added a pure, no-DOM helper `isAllZ(vec)` to `digitaljs`'s
`base.mjs`/`base.js` (exported, reused by `io.mjs`/`io.js` — confirmed it
loads fine in plain Node without a DOM, unlike the View classes themselves,
so it's directly unit-testable). Wired into three ternaries:
- `GateView._updatePortSignals` / `WireView._updateSignal` (`base.mjs`) —
  both gated behind the existing `!signal.isDefined` check (so `isAllZ` only
  ever runs on already-not-fully-defined signals, matching the plan).
- `OutputView._updateLamp` (`io.mjs`) — this one has **no** `isDefined`
  guard in front of `isAllZ`, unlike the other two. Verified this doesn't
  create a semantics gap: `_updateLamp` only ever runs in mode 1
  (`IOView._updateView`'s switch), and `IO._checkMode` (`io.mjs:130`) only
  sets mode 1 when `bits == 1` — so every call to `_updateLamp` has a
  strictly 1-bit signal, where "not fully high, not fully low, all bits z"
  and "single bit is z" are the same test. No guard needed; would be
  needed if `Lamp` ever became multi-bit.

While fixing `wavecanvas/dist/index.js`'s `drawWaveform` (the file behind
the waveform view, confirmed live the same way as step 1: `"main":
"dist/index"`, no `exports`/`module` field, `dist/index.mjs` dead), found
and fixed two **pre-existing** bugs in the single-bit color/position
lookups, both of which only became visible while working this step:
- `b2c = (b) => s.bitColors[b + 1]` indexed `bitColors` (`[low, undef,
  high, def]`) with `.get(0)`'s raw `-1/0/1/2`; for `z` (`b=2`) that landed
  on `bitColors[3]`, the `def`/blue slot, purely by arithmetic accident —
  so single-bit `z` wires already rendered differently from single-bit `x`
  wires before this step, just not on purpose. Fixed by special-casing
  `b === 2` to a real 5th slot (`bitColors[4]`, the new amber) instead of
  colliding with `def`.
- `b2y = (b) => [ly, xy, hy][b + 1]` has the identical `b + 1` indexing
  bug, but on a 3-element array — `b=2` (z) always resolved to `undefined`,
  so a single-bit `z` waveform segment's y-coordinate was `undefined`
  (silently broken geometry, canvas no-ops/NaNs the path). Not something
  this step introduced, but the `b2c` fix would have made a `z` segment
  paint amber at a broken position instead of blue at a broken position —
  worse, not better — so fixed alongside: extended to `[ly, xy, hy, xy]`,
  putting `z` at the same mid-line height as `x` (both "no defined level"),
  distinguished only by color.
- `w2c` (multi-bit path) and `defaultSettings.bitColors` (now 5 entries)
  got the same `isAllZ`-gated 4th bucket as the wire/lamp ternaries.

Deliberately left alone:
- `InputView._updateButton` (`io.mjs`) — still only 2 buckets (`high`/
  `low`), per step 4's finding: pre-existing gap, not new to `z`, low-risk
  since a `Button`'s signal is user-toggled 0/1 in the stock flow, never
  externally driven.
- The waveform's undefined-text-gating (`ad = av.isDefined`) — a fully-`z`
  multi-bit value still renders as a colored (now amber) span with no text,
  same as `undef` today. Showing literal `zzzz` there needs `disp.show()`
  to run for `isAllZ` segments too, which is the same territory as the
  `@twint/4vl` decimal-display fix below — not bundled into this step.
- The "bus junction" visual (multiple physical wires converging into one
  net) — punch-list doc already scoped this as phaseable-later, its own
  small rendering feature, not a value-system concern.

**`@twint/4vl`'s own gap, handed off externally, not applied in this
repo:** `Display4vlDec`/`Display4vlDec2c.show()` collapse any
not-fully-defined vector to `'x'`, losing the `z` distinction that bin/hex/
oct already show per-digit — asymmetric with `read()`, which already
accepts a literal `'z'` input. Fixed in the user's own `4vl` source (not
checked out in this repo, only the compiled npm copy in `node_modules`) via
a diff adding an `isZ` getter (mirrors `isHigh`/`isLow`'s exact pattern)
and using it in both `show()` methods before the `isFullyDefined` fallback.
The user applies/publishes this independently; this step's own work is
deliberately decoupled from it — computes "fully-z" locally (`isAllZ`)
rather than depending on a `.isZ` predicate that may not exist in whatever
`4vl` version is currently installed.

**`patch-package` rule, generalized (this bit a third time, differently):**
previously (steps 2, 3) the rule was "check trailing newlines on the files
*you* edited before regenerating their patch." This step's `npx patch-package
digitaljs` run — triggered only by edits to `base.mjs`/`io.mjs` — silently
truncated `lib/cells.js`, a file **not touched this step**, because
`patch-package` re-diffs the *entire* package against a clean reference
install, and `lib/cells.js` had *already* lost its trailing newline at some
point in an earlier step without being caught (no check at the time
touched it, since it wasn't the file being edited). Only surfaced via `npm
run test:pipeline`'s `SyntaxError: Unexpected end of input` — again, not
caught by `compile`/`lint`, only by something that actually loads the file.
Fixed the same way as before (restore the newline, regenerate), but the
rule now reads: **before regenerating a package's patch, check trailing
newlines on every file the patch touches — not just the ones edited this
step** — and re-verify with a fresh install + whole-touched-file `node
--check` sweep every time, regardless of how small the edit looked.

**Verification:** two new tests in `test/pipeline.spec.mjs` — `isAllZ`
against `Vector4vl.zes/ones/xes(4)` and a mixed `'z0z1'` vector (true only
for the fully-z case), and `wavecanvas`'s `defaultSettings.bitColors` has
grown to 5 valid-looking color entries. Full chain re-run after every fix
in this step: fresh `npm install`, `node --check` on every `lib/*.js`/
`dist/*.js` file the four patches touch (not just the ones edited),
`npm run compile` (all 6 targets), `grep -c "highz\|f39c12"
dist/view-bundle.js dist/digitaljs-sym-worker.js` (1 each — confirms the
new bucket/color reached *both* the main-thread and Web Worker bundles,
the whole point of the step 1 "dual tree" lesson), `npm run test:pipeline`
(29/29), `npm run lint` (62 warnings, unchanged baseline).

**This step is more visual than any prior one, and none of the above
proves the colors actually look right on screen or that the ternary is
wired to the correct DOM node.** The `isAllZ` test proves the helper; the
bundle grep proves the string shipped. Neither proves the View class
actually applies it correctly at render time — that needs the interactive
F5 check, more so here than for any previous step: build a circuit with a
`bus_top`-style floating net (both `oe_a`/`oe_b` off) and visually confirm
the wire/port/lamp/waveform render amber instead of grey. Still outstanding,
same as every step so far, but the stakes for actually doing it are higher
this time.

## Step 6 completion notes

**Part 1: bumped `@twint/4vl` to 1.0.1.** The user applied and published the
`isZ` diff handed off during step 5. Confirmed on the published tarball
before touching the repo (`npm pack @twint/4vl@1.0.1`, grepped
`dist/index.js`): `isZ` getter present, both `Display4vlDec`/
`Display4vlDec2c.show()` check it before falling back to `'x'`. Bumped
`package.json`'s range to `"^1.0.1"` (an explicit floor now — `^1.0.0`
would already resolve 1.0.1, but this makes "1.0.1+ required" a real
constraint instead of an accident of caret semantics), `npm install`. No
patch involved — `@twint/4vl` was never patched (step 5 deliberately
computed "fully-z" locally instead of depending on this landing upstream
first), so this is a pure version-range change, nothing to regenerate.

Added 2 new tests (not busywork — this is the first point anything could
verify the actual fix, since it didn't exist until this step): `new
Display4vl().show('dec'/'dec2c', Vector4vl.zes(4))` returns `'z'`, and a
non-all-z undefined vector (`xes(4)`, a mixed `'z0z1'`) still returns
`'x'` — confirming the fix is properly scoped to *fully* z-valued vectors,
not a blanket change. `test:pipeline`: 31/31. `npm run compile`: all 6
targets, `@twint/4vl`'s bundled size ticked up slightly (48.2 KiB → 48.8
KiB) consistent with the small addition, nothing else changed shape.
`npm run lint`: 62 warnings, unchanged baseline.

**Part 2: ran `npm run test:vscode` for the first time in this project.**
No `.vscode-test` cache existed and no CI workflow references it — this had
never actually executed before. Downloaded VS Code 1.135.0 + Electron,
loaded the extension, ran `test/suite/extension.test.js`: 1/1 passing, exit
code 0. (The console noise about `AgentHost`/GitHub tokens and
`agentHostClientByokLm`/`agentHostClientProxy` channels is VS Code's own
built-in AI-agent-host plumbing initializing in a fresh test profile,
unrelated to this extension — harmless.) `npm test` (→ `test:pipeline` then
`test:vscode`) is green end to end: 31 passing + 1 passing, exit code 0.

**Named, not hidden, gap**: `test/suite/extension.test.js` is still the
scaffolding default (`assert.strictEqual(-1, [1,2,3].indexOf(5))`) — it
asserts nothing about this extension, let alone the 4vl work. Running it
establishes a real "the extension loads and the harness works" baseline
where none existed, which is what the punch list actually asked for
("the full `npm test`... not just `test:pipeline`"), but it is **not**
extension-level regression coverage of anything built across steps 0-5.
Building that (opening `bus_top.sv`, driving the extension's synthesize
command, asserting on results) is blocked on the same wall step 2 already
hit: circuit/webview content lives in a sandboxed iframe not
introspectable from the extension-host test API without new postMessage
plumbing this project doesn't have. That's a real, separate feature (a
first genuine extension-level test), not something implied by "run the
test suite" — left undone here rather than quietly declared covered.

**Part 3: no new fixtures added.** Reviewed what steps 2-5 already built:
net-merge unit test, `bus_top` real-synthesis fixture (+ its techmap
variant, already run by the generic per-example loop), the z-input-safety
pair, the z-visual-helper pair — 29 cases before this step, 31 after (the
2 `Display4vlDec` tests above). Deliberately did not add a 3rd-driver
`TriMerge` fixture: its merge logic is a plain `reduce` over `inputs`,
already proven generic by the existing 2-driver case — a 3rd driver
exercises the same loop body again, not a new code path. Same judgment
step 4 already made explicitly ("two discriminating tests beat several
redundant ones").

**This closes the punch list.** All 7 items (0-6) are done. The one thing
no step in this plan has ever verified is the interactive F5 simulation —
every check across all six steps has been conversion-time, unit-level, or
(this step) a scaffolding extension-host smoke test. That remains open,
flagged consistently since step 1, and is the natural next thing to
actually do now that the plan itself is finished: open the extension,
build or load a `bus_top`-style circuit, toggle `oe_a`/`oe_b`, and visually
confirm the whole native-Z path — contention, floating nets, the new amber
color — behaves and looks right end to end.

## Open questions to revisit once `4vl`'s shape is known

- ~~Does the real `datapath.sv` bus end up as one `wire` with sibling
  `assign ... : 'z'` statements in one module scope, or does each submodule
  get its own tri-state (`inout`?) port wired together at a higher level?~~
  **Resolved during step 3, empirically, with real yosys**: doesn't matter,
  both shapes work with no `flatten` needed. Tested the cross-module case
  directly (`bus_top`/`drv_a`/`drv_b`, the same fixture now in
  `test/verilog/`): hierarchy stays fully intact under both
  `read_slang --best-effort-hierarchy` and plain
  `read_verilog -defer; hierarchy -auto-top`, each submodule's `$tribuf`
  lives entirely within its own module scope, and the parent module just
  sees two ordinary output ports driving the same net — exactly step 2's
  "2 sources on 1 net" shape, no special enable-signal visibility needed
  across the module boundary. This is *why* native Z support solves what
  the rejected `Mux1Hot` approach couldn't (see "Why" above): the Z-ness
  travels as ordinary port data, not as a structural signal that has to be
  routed to a merge point.
- ~~Whether step 3's real `$tribuf` device needs a dedicated new cell type
  ... or can still ride on `Mux1Hot`-shaped semantics extended to be
  Z-aware.~~ **Resolved during step 2/3**: needs a dedicated cell type
  (`Tribuf`, alongside step 2's `TriMerge`) — not a `cells.mjs`
  extensibility question at all, it turned out. The real constraint is the
  Web Worker simulation engine (`engines/worker-worker.mjs`): it resolves
  `cells[gateParams.type].prototype` directly against digitaljs's own
  `cells.mjs`, with no plugin/extension hook, so any new cell type must be a
  real member of that module — confirmed by reading the worker's code
  directly (step 2), not by testing `cellsNamespace` extensibility (which
  turned out to be moot: even if it worked for the main thread, the worker
  wouldn't see it).

## Post-plan: first F5 pass (2026-08-31)

The user ran the actual interactive F5 check for the first time since this
plan started — the one thing every step above flagged as never verified.
Hit a real crash on hover (`Cannot read properties of undefined (reading
'line')`, `view/main.mjs`'s `#registerPaper`'s hover-marker feature reading
`pos.from.line`/`pos.to.line` off a malformed `source_positions` entry).
Traced it to `yosys2digitaljs`'s `parse_source_positions` assuming every
`src` attribute is a well-formed `from-to` range — couldn't reproduce a
malformed entry from any existing fixture's real synthesis output, and
ruled out every `TriMerge`/`Tribuf`-related connector/transform path this
plan built as the direct cause, but fixed it at both ends regardless:
`parse_source_positions` now skips a non-range entry instead of emitting a
half-populated one, and `show_marker` skips a malformed entry instead of
crashing (defense in depth — whichever path was the actual trigger, both
fixes close it). Added three new minimal fixtures
(`test/verilog/tribuf_single/`, `tribuf_bus2/`, `tribuf_bus3/`) to help
isolate the trigger by hand if it recurs, and to exercise `TriMerge` with
`inputs > 2` for the first time (confirmed correct via direct
`TriMerge.operation()` calls: 3-driver agree/disagree/floating
combinations all resolve as expected). `test:pipeline`: 37/37 (up from 31,
new fixtures × plain/techmap). Still unverified: whether the fix actually
resolves the crash in the real webview — that needs the user to retest F5.

## Post-plan: TriMerge not letting the enabled driver win (2026-09-01)

The user re-ran F5 on the new `tribuf_single`/`tribuf_bus2` fixtures. First
crash (a device with `type: 'Tribuf'` had no matching cell in `digitaljs`'s
`_cells`, so `getCellType` fell through to `Subcircuit` and recursed into
`subcircuits[undefined]`) turned out to be a `node_modules` install-state
problem, not a code bug: `patch-package`'s postinstall step had silently
failed for `digitaljs` (a stale/partial `node_modules/digitaljs` left over
from an earlier interrupted `npm install`, same root cause as an unrelated
`@twint/4vl` resolution error hit the same day). Fixed by `rm -rf
node_modules && npm install`, no source change needed.

The real bug came next, on `tribuf_bus2.sv`: with one driver disabled (z) and
the other enabled and driving a real value, the merged bus should show the
enabled driver's value — it didn't. `Tribuf.operation()` and
`TriMerge._mergeTwo()` were re-verified correct (again) via `SynchEngine`/
`HeadlessCircuit` against the exact generated JSON — every scenario resolved
correctly there, same as step 2/3's original verification. The divergence
was exactly the risk step 2's completion notes flagged and then didn't fully
check: **`Tribuf` had no `_gateParams` override**, so it inherited the base
`['label', 'type', 'propagation', 'source_positions']` — missing `bits`.
Under `SynchEngine`, `operation()`'s `this.get('bits')` reads the live
Backbone model and always works, masking the gap. Under the real webview's
`WorkerEngine`, cells are reconstructed inside the worker from
`getGateParams()`'s `pick(attributes, _gateParams)` — `bits` was dropped,
so `this.get('bits')` was `undefined` there. `Vector4vl.zes(undefined)`
(`bits = undefined | 0 = 0`) turned a disabled driver's output into a 0-bit
vector instead of an N-bit all-z one; `TriMerge._mergeTwo` then read
out-of-range `Uint32Array` entries off that vector as `0` (logic-0, not z),
either collapsing the whole merge to 0 bits (disabled driver as `in0`) or
forcing spurious contention (`x`) on bits where the real driver held a `1`.

Fix: added `_gateParams: Box.prototype._gateParams.concat(['bits'])` (and
the matching `_unsupportedPropChanges` entry, following every other
`bits`-bearing cell's convention — `TriMerge`, `Memory`, `Fsm`, `Mux`,
`Dff`, `io.mjs`'s `NumBase`) to `Tribuf` in both `src/cells/tribuf.mjs` and
`lib/cells/tribuf.js`, then regenerated `patches/digitaljs+0.14.2.patch`.
Regenerating it hit the *exact* `lib/cells.js` truncation bug this doc
already names twice (steps 2 and 5) — a third recurrence, for the same
reason: the working-tree `lib/cells.js` that a fresh `npm install` had
produced was missing its final `});` (not just a trailing newline this
time), because `patch-package`'s own patch-application step is what drops
it, independent of anything this step edited. Fixed by hand-restoring the
missing line, then regenerating from that corrected state — the doc's
existing rule already covers this ("check trailing newlines on every file
the patch touches before regenerating, not just the ones edited this
step"); worth restating as **also check the file actually parses
(`node --check`), not just that it ends in `\n`**, since a missing line can
still leave a spurious trailing newline of its own.

New regression test (`test/pipeline.spec.mjs`, `digitaljs cell operation()
z-input safety` describe block): asserts `new
cells.Tribuf({...}).getGateParams().bits === 4` directly, targeting the
`_gateParams`/`getGateParams()` mechanism itself rather than re-testing
`operation()`'s already-covered logic — confirmed it fails with the
pre-fix code and passes with the fix. This is the check step 2's own
completion notes said was needed ("the worker's cell-instantiation pattern
needs checking, not assuming") but wasn't actually done for `Tribuf` at the
time.

Verified from a fresh `npm install`: `npx patch-package` shows
`digitaljs@0.14.2 ✔` with no `.rej` files, `node --check` on both touched
`lib/*.js` files, `npm run compile` (all 6 targets), `grep -c "'Tribuf'"
dist/view-bundle.js dist/digitaljs-sym-worker.js` (1 each), a hand-built
worker-side reconstruction (`getGateParams()` → plain object → `operation()`
→ `TriMerge.operation()`) confirming `1010` merges correctly with a `zzzz`
disabled driver, `npm run test:pipeline` (38/38), `npm run lint` (62
warnings, unchanged baseline). Still outstanding: the user retesting F5 on
`tribuf_bus2.sv` itself — every check here is headless, same caveat as
every other step in this plan.
