# Changelog

All notable changes to HDL Studio will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.5.0] - 2026-09-04

### Added
- Native tri-state (high-impedance) bus support: a shared bus with multiple
  drivers (e.g. `assign x = en ? val : 'z;`), including across submodule
  boundaries, now synthesizes and simulates correctly instead of failing or
  silently misbehaving. Backed by a new 4-valued-logic dependency
  (`@twint/4vl`, replacing `3vl`) and two new circuit cells: `Tribuf` (a
  tri-state buffer, rendered as the standard schematic triangle glyph) and
  `TriMerge` (resolves multiple drivers sharing one net, rendered as a plain
  merge bar). Wires, ports, lamps, and the waveform monitor gained a 4th
  visual state (amber) for a fully floating signal, distinct from ordinary
  "undefined".
- New **LED matrix** widget: a configurable rows × cols grid of individually
  addressable LEDs, set via `led_matrix_rows`/`led_matrix_cols` attributes on
  a Verilog output port. Sized once from rows/cols so adding more LEDs means
  finer resolution, not a bigger widget.
- The 7-segment display widget is now styled as red LEDs (previously green),
  with a lighter, less prominent off state.
- Synthesis now supports the `$bmux` yosys cell (dynamically-indexed reads),
  letting a design build e.g. a register file from real per-register module
  instances instead of forcing one large multi-port Memory device.
- Signal input widgets (NumEntry) gain scroll-wheel increment/decrement,
  matching Button's existing click-to-toggle convenience.
- New example circuits: a BCD-to-7-segment decoder, a configurable LED-matrix
  chase pattern, a `$bmux`-based register file, four tri-state bus fixtures,
  and a full multi-module educational CPU (ALU, control unit, datapath,
  decoder, register file, memory, program counter, and load/store/branch
  units) demonstrating hierarchical module instantiation at a larger scale.

### Fixed
- Three independent bugs that could leave a Lua script's driven inputs
  toggling forever with the simulation unresponsive: overlapping script/REPL
  runs fighting over the same circuit, a timing race that could silently
  drop a script's wakeup and hang it forever, and an echo loop between the
  control panel and the circuit view (this last one could also be triggered
  by a plain user click, independent of any script).
- Stopping a Lua script now also pauses the circuit simulation, instead of
  leaving the clock running with nothing left to drive it.
- NumEntry input widgets now default to 0 instead of x, matching Button's
  existing behavior.
- A tri-state enable wire (or a mux select wire) entering a cell from a
  non-default side no longer renders with a spurious curved elbow.
- A synthesized circuit with a wide `case`/dispatch ("sparse mux") no longer
  crashes when saved, auto-laid-out, or edited - a second, independent
  source of the BigInt-serialization crash whose initial-render case was
  fixed in 0.4.0.
- Hovering a cell whose source-position data is malformed no longer crashes
  the whole webview.
- Adding a wire to the Waveform Monitor, or opening a Memory cell's contents
  editor, no longer crashes (a leftover stale property name from the
  tri-state migration).
- A top module with no output ports (e.g. a CPU datapath whose only effect
  is internal register/memory state) no longer renders an unrelated,
  arbitrary submodule in its place.
- Clicking Synthesize with no active circuit now shows an error instead of
  silently doing nothing.
- A memory array whose reset loop yosys unrolled into thousands of discrete
  write ports at large depths no longer hangs synthesis indefinitely.

### Changed
- Extension logo colors updated.

## [0.4.1] - 2026-08-31

### Fixed
- A tri-state output (`assign x = en ? val : 'z;`, e.g. a module driving a
  shared bus) no longer fails synthesis with "Invalid cell type: $tribuf" -
  `yosys2digitaljs` has no `$tribuf` cell type, so tristate buffers are now
  converted to plain logic (0 when disabled) during synthesis.

## [0.4.0] - 2026-08-31

### Added
- Synthesis now supports `$readmemh`/`$readmemb` auxiliary data files
  (e.g. a ROM `.hex` image): add the `.hex`/`.mem` file to the circuit like
  any other source (now accepted by "Add to HDL Studio" / "Create circuit in
  HDL Studio" and the "Add Files" dialog, previously restricted to
  `.sv`/`.v`/`.vh`/`.lua`) and it's written to the synthesis temp directory
  under its path relative to the saved project so yosys/`$readmemh` finds it.

### Fixed
- Synthesized circuits with a wide `case`/dispatch (compiled by yosys into a
  "sparse mux") no longer silently fail to display: patched a `digitaljs`
  0.14.2 bug where such muxes embedded raw `BigInt` values in the circuit
  data, which crashed `JSON.stringify` when posting the circuit to the
  webview (via `patch-package`, see `patches/`).
- Fixed a `Sources` bug where directory-relative source naming silently
  never triggered due to a typo'd property access.

### Changed
- Updated devDependencies to their latest semver-compatible versions
  (`webpack` pinned at `5.107.2`: `5.110.2`'s new native TypeScript
  resolution breaks on a transitive dependency's `.ts` syntax).

## [0.3.0] - 2026-08-05

### Added
- `read_slang` synthesis frontend, used automatically when the configured
  `yosys` supports it: elaborates the whole design order-independently
  (packages/interfaces no longer need to be read before the files that use
  them) while keeping module hierarchy as subcircuits. Falls back to the
  existing `read_verilog`-based flow when unavailable.
- **Top module** selector in the Synthesis panel — dropdown populated from
  `module` declarations found in the added sources, with an "Auto" default.
- Opening a `.json` file as a circuit now also accepts a raw yosys netlist (as
  produced by `write_json`/`json -o` from an external synthesis run),
  converting it automatically instead of requiring an already-saved digitaljs
  circuit.
- "Add to HDL Studio" / "Create circuit in HDL Studio" now accept whole
  folders, with a "(Recursive)" variant to include subfolders.
- Running a Lua script now opens (or reuses) and focuses that circuit's Lua
  terminal automatically, and each printed line is prefixed with the script's
  name so output from multiple scripts stays distinguishable.
- `test/verilog/` examples reorganized one per folder, each with a companion
  `*_sim.lua` script demonstrating that circuit via the Lua scripting API.

### Fixed
- `read_verilog` now reads every file with `-defer`, fixing synthesis of
  multi-file SystemVerilog designs where a package/interface must be visible
  to a file read after it (the fallback path used when `read_slang` isn't
  available).
- Adding multiple selected files/folders to a circuit no longer pulls in
  non-Verilog/Lua files (e.g. a `Makefile`) as sources.

### Changed
- "Project Files" panel now lists every open circuit at once instead of only
  the active one; each circuit's own commands (remove source, start/stop Lua
  script) act on the circuit it belongs to rather than always the active one.

## [0.2.0] - 2026-07-01

### Added
- Yosys diagnostics: on a synthesis failure the yosys script and full output are
  shown in the "HDL Studio (Yosys)" output panel, and the real error message is
  surfaced instead of "Unknown yosys2digitaljs error".
- New example circuits in `test/verilog/`: SR latch, D latch, full adder, 0–F
  counter, LFSR, RAM, ROM, and a decade counter demonstrating module instantiation.
- Synthesis panel options:
  - **Decompose to basic gates** (`techmap`) — breaks complex cells (adders,
    comparators, muxes, …) into basic logic gates while keeping flip-flops,
    latches and memories intact.
  - **Zero combinational propagation delay** — combinational gates settle within a
    single tick instead of one tick per gate.
  - **Layout** — choose the auto-layout engine (ELK or Dagre).
- Synthesis pipeline test (`npm run test:pipeline`) that synthesizes every example
  and checks it converts.

### Fixed
- Subcircuit dialogs (the magnifying-glass view) for digitaljs 0.14.2: they no
  longer crash on open, are laid out and sized correctly (no more stacked view),
  and are restored on undo/redo instead of silently closing.
- Synthesis panel no longer crashes when the host and webview bundles are briefly
  out of sync.

### Changed
- Reorganized the Synthesis side panel: collapsible "Synthesis" and "Diagram"
  groups with the Synthesize button separated at the bottom.
- Extracted the yosys script builder into a standalone module and migrated linting
  to the ESLint flat config.

## [0.0.1] - 2026-06-20

### Added
- Initial release of HDL Studio, forked from [digitaljs_code](https://github.com/yuyichao/digitaljs_code) v0.7.3 by Yichao Yu.
- Renamed extension and all internal identifiers from `digitaljs` to `hdl-studio`.
- Replaced GitHub-sourced dependencies (`digitaljs`, `digitaljs_lua`, `svg-pan-zoom`, `yosysjs`) with stable npm registry versions.
- Removed `yosysjs` (WebAssembly Yosys) in favour of native Yosys binary running in the associated dev-container.
- New icon and branding (HDL Studio chip icon).
- Updated `publisher`, `repository` and `version` fields in `package.json`.
