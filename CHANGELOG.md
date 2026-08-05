# Changelog

All notable changes to HDL Studio will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
