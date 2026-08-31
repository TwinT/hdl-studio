# Native Z (high-impedance) support via a `4vl` package — integration plan

Status: **blocked** on an external `4vl` package (4-valued logic: 0/1/x/z),
designed and built separately by the project owner, with its own API
(not a drop-in-compatible superset of `3vl`'s `Vector3vl`). This doc is
the punch list to resume once that package exists.

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

0. **Receive the package** (local path or published npm), pin as a
   dependency alongside `3vl` (or replacing it — TBD whether `3vl` stays
   for anything).
1. **Swap imports.** Patch (via `patch-package`, same mechanism already
   set up for the digitaljs BigInt fix — see `patches/digitaljs+0.14.2.patch`
   and the `postinstall` script in `package.json`) all ~15 `digitaljs/src/*`
   files + the 4 `yosys2digitaljs/dist/core.js` call sites to use the new
   API instead of `Vector3vl`/`Display3vl`/`Mem3vl`. Since `4vl` has its own
   naming (not a drop-in superset), this is a real per-file edit, not a
   webpack `resolve.alias` trick. **Acceptance bar for this step**: existing
   examples in `test/verilog/` still synthesize and simulate correctly
   (`npm run test:pipeline` + manually load a few in the dev extension host)
   — no behavior change yet, just the value-library swap.
2. **Allow multiple drivers per net.** Redesign `add_net_source`
   (`yosys2digitaljs/dist/core.js:310-324`) to accept N sources for the same
   net instead of throwing on the 2nd, and combine them via whatever
   resolution primitive `4vl` exposes (or build the resolution ourselves on
   top of its primitives): one real (non-Z) driver active → pass it through;
   2+ active with disagreeing values → contention; all-Z → Z out.
3. **Real `$tribuf` conversion.** Replace today's `tribuf -formal` collapse
   (`src/yosys_script.mjs`) with a path that preserves genuine Z/enable
   semantics into the JSON, and teach `yosys2digitaljs` an actual `$tribuf`
   → digitaljs device conversion (building on step 2's multi-driver net
   support) instead of resolving it away before JSON export.
4. **Audit every cell's `operation()`** (`digitaljs/src/cells/*.mjs`) for
   Z-input handling. Depends entirely on `4vl`'s own bitwise-op semantics
   (does `and`/`or`/`xor`/etc. already do something sane when an operand is
   Z?) — likely most gates need zero changes if so; verify pass by pass.
5. **UI.** `Display3vl`-equivalent value formatting + waveform rendering
   (`digitaljs/src/monitor.mjs`) needs a 4th visual state for Z; wire
   coloring in the circuit view needs the same. Separately (can be phased
   later): an actual visual "bus junction" showing multiple physical wires
   converging into one net — JointJS links are point-to-point by default,
   this is its own small rendering feature, not a value-system concern.
6. **Regression + new coverage.** Full `npm test`. Add a pipeline test case
   for a genuine multi-driver tri-state design (the `bus_top`/`drv_a`/`drv_b`
   repro built during this investigation — two sibling modules each driving
   a shared bus through their own tri-state output — is a ready-made
   fixture) confirming it now converts and simulates instead of throwing
   `Multiple sources driving net`.

## Open questions to revisit once `4vl`'s shape is known

- Does the real `datapath.sv` bus end up as one `wire` with sibling
  `assign ... : 'z'` statements in one module scope, or does each submodule
  get its own tri-state (`inout`?) port wired together at a higher level?
  The latter needs `flatten` (at least locally) to make the multi-driver
  structure visible to `yosys2digitaljs` at all, which trades away
  subcircuit-hierarchy display for that part of the design — worth
  deciding deliberately once real RTL exists, not by accident.
- Whether step 3's real `$tribuf` device needs a dedicated new cell type
  (hitting the untested `cells.mjs` namespace-extensibility question above)
  or can still ride on `Mux1Hot`-shaped semantics extended to be Z-aware.
