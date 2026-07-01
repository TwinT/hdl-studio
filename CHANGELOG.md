# Changelog

All notable changes to HDL Studio will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
