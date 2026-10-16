# Graph Report - hdl_studio  (2026-10-16)

## Corpus Check
- 167 files · ~108,653 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1672 nodes · 3447 edges · 154 communities (72 shown, 58 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 62 edges (avg confidence: 0.84)
- Token cost: 266,554 input · 0 output

## Community Hubs (Navigation)
- 4-State Vector Logic
- Sim Tests & Bench
- Lua REPL Terminal
- Netlist Model & Sim Build
- Time Units & Memory Editor
- Simulator Cell Semantics
- Yosys Converter & Inout Split
- Memory Contents (LogicMem)
- Extension Entry (HdlStudio)
- Schematic Cell Geometry
- Transform Simplifications
- Document & Undo Edits
- Files Panel Screenshot
- Schematic App & Protocol
- Dev Dependencies
- Cell Views & Tristate Shot
- Waveform Monitor
- Host Modules Wiring
- Source Files Tracking
- Yosys Run & Requests
- Schematic SVG Rendering
- Engine Binary & Test Designs
- npm Scripts
- TypeScript Config
- Dialog Windows
- Docs: Engine Serve & History
- Docs: Engine Crates
- Image Export
- Circuit View Host
- Lua Terminal History
- SoC RISC-V Core
- Vector Fixture Tests
- Unicode Width Utils
- Micro RV32I Datapath
- Runtime Dependencies
- Package Manifest
- Docs: Pre-1.0 Releases
- Docs: Schematic Layout
- Board Waveform Screenshot
- Waveform Colour Schema
- Extension Settings
- Waveform Colour Defaults
- ALU Testbench
- Docs: v0.5 Release
- Docs: Converter & Synthesis
- Docs: Control Panel & Inout
- JS Config
- Synthesis Panel View
- Inout Bus Example
- Sim Smoke Tests
- Engine CLI Main
- Package Keywords
- Source Info
- ALU Top Module
- Docs: 1.0 Release
- Contributed Commands & Views
- Webpack Config
- Converter Golden Test
- Tri-state Bus Example
- ESLint Config
- SoC Top Module
- Package Categories
- Menus
- Fill Opacity Setting
- Cargo Crates
- VS Code Test Index
- CPU + RAM
- Docs: Waveform Recording
- Decade Counter Example
- Extension Icons
- Board (SoC + LED Panel)
- npm allowScripts
- VS Code Test Runner
- Cursor Colour Setting
- Grid Colour Setting
- High-Z Colour Setting
- Signal Colour Setting
- Undefined Colour Setting
- Repository Info
- Extension Test
- ALU Module
- ALU FSM
- ALU Register File
- Bmux Regfile Example
- Golden Wide Idx
- 01 Sr Latch
- 02 D Latch
- 03 Full Adder
- 04 Counter
- 05 Lfsr
- 06 Ram
- 07 Rom
- 09 Bcd To 7Seg
- 10 Led Matrix
- 11 Pushbutton
- Alu Tp1 Pkg
- Control Unit Rtl
- Memory
- Micro Alu
- Micro Branch Unit
- Micro Control Unit
- Micro Decoder
- Micro Ir
- Micro Load Unit
- Micro Memory
- Micro Pc
- Micro Register
- Micro Store Unit
- Soc Rtl Addr Decode
- Soc Rtl Core Alu
- Soc Rtl Core Alu
- Soc Rtl Core Branch
- Soc Rtl Core Control
- Soc Rtl Core Decoder
- Soc Rtl Core Ir
- Soc Rtl Core Load
- Soc Rtl Core Pc
- Soc Rtl Core Register
- Soc Rtl Core Store
- Soc Rtl Core Wb
- Soc Rtl Led Panel
- Soc Rtl Memory
- Tribuf Bus2
- Tribuf Bus3
- Tribuf Single
- View Env D
- Claude Test Vscode
- Screenshot Code Highlight
- Screenshot Create Circuit Src
- Screenshot Lua Repl

## God Nodes (most connected - your core abstractions)
1. `LogicVec` - 125 edges
2. `REPL` - 55 edges
3. `Sim` - 46 edges
4. `HdlStudio` - 38 edges
5. `App` - 35 edges
6. `Document` - 34 edges
7. `Monitor` - 33 edges
8. `Cell` - 30 edges
9. `Model` - 30 edges
10. `Sources` - 29 edges

## Surprising Connections (you probably didn't know these)
- `Open Lua REPL Action` --conceptually_related_to--> `LuaRunner`  [INFERRED]
  imgs/screenshots/files-sidepanel.png → view/lua_runner.ts
- `@twint/4vl (4-valued logic library)` --semantically_similar_to--> `hdlstudio-logic (4-state vectors)`  [INFERRED] [semantically similar]
  CHANGELOG.md → CLAUDE.md
- `Lua engine in hdlstudio (mlua, Lua 5.4)` --conceptually_related_to--> `Lua script race/echo-loop fixes`  [INFERRED]
  CLAUDE.md → CHANGELOG.md
- `Lua vec library (4-valued vectors)` --shares_data_with--> `hdlstudio-logic (4-state vectors)`  [INFERRED]
  README.md → CLAUDE.md
- `Wire colouring by value` --conceptually_related_to--> `hdlstudio-logic (4-state vectors)`  [INFERRED]
  README.md → CLAUDE.md

## Import Cycles
- 1-file cycle: `test/verilog/alu/alu.sv -> test/verilog/alu/alu.sv`
- 1-file cycle: `test/verilog/alu/fsm.sv -> test/verilog/alu/fsm.sv`
- 1-file cycle: `test/verilog/alu/reg_file.sv -> test/verilog/alu/reg_file.sv`
- 1-file cycle: `test/verilog/alu/top_module.sv -> test/verilog/alu/top_module.sv`
- 1-file cycle: `test/verilog/alu/top_module_tb.sv -> test/verilog/alu/top_module_tb.sv`
- 1-file cycle: `test/verilog/alu/tp1_pkg.sv -> test/verilog/alu/tp1_pkg.sv`

## Hyperedges (group relationships)
- **hdlstudio Cargo workspace crates** — claude_hdlstudio_logic, claude_hdlstudio_netlist, claude_hdlstudio_yosys, claude_hdlstudio_sim, claude_hdlstudio_engine [EXTRACTED 1.00]
- **Synthesis to circuit pipeline** — claude_synthesis_flow, claude_build_yosys_script, claude_yosys, claude_hdlstudio_yosys, claude_inout_split, claude_io_ui_inference [EXTRACTED 1.00]
- **1.0 replacement of DigitalJS libraries** — changelog_v1_0_0, readme_digitaljs, readme_yosys2digitaljs, readme_digitaljs_lua, claude_hdlstudio_sim, claude_hdlstudio_yosys, claude_lua_engine [EXTRACTED 1.00]
- **HDL Studio icon set (marketplace, commands, activity bar)** — imgs_hdl_studio_png, imgs_hdl_studio_svg, imgs_hdl_studio_mono_svg [INFERRED 0.95]
- **Files view toolbar actions** — imgs_screenshots_files_sidepanel_new_circuit_action, imgs_screenshots_files_sidepanel_add_source_action, imgs_screenshots_files_sidepanel_export_image_action, imgs_screenshots_files_sidepanel_open_lua_repl_action [EXTRACTED 1.00]
- **Board dataflow: clk/rst -> soc sys -> led_panel -> LED matrix** — imgs_screenshots_schematic_waveform_clock_and_button_widgets, imgs_screenshots_schematic_waveform_soc_board_sys, imgs_screenshots_schematic_waveform_led_panel_board_panel, imgs_screenshots_schematic_waveform_led_matrix_widget [EXTRACTED 1.00]

## Communities (154 total, 58 thin omitted)

### Community 0 - "4-State Vector Logic"
Cohesion: 0.05
Nodes (26): Clone, Bit, field(), fill_ones(), last_mask(), LogicVec, nwords(), Fn (+18 more)

### Community 1 - "Sim Tests & Bench"
Cohesion: 0.06
Nodes (55): BufWriter, a_one_hot_mux_with_a_z_select_is_all_x(), arithmetic_with_a_z_operand_is_all_x(), out(), String, Value, settle(), sim() (+47 more)

### Community 2 - "Lua REPL Terminal"
Cohesion: 0.07
Nodes (7): array_equal(), Cursor, CursorMoveType, REPLHistory, Line, REPL, wrap_line()

### Community 3 - "Netlist Model & Sim Build"
Cohesion: 0.08
Nodes (32): CellId, Circuit, Connector, Device, IndexMap, build(), Builder, Builder<'a> (+24 more)

### Community 4 - "Time Units & Memory Editor"
Cohesion: 0.07
Nodes (37): formatFreq(), formatTime(), parseTime(), units, MemContents, memoryEditor(), MemPorts, Base (+29 more)

### Community 5 - "Simulator Cell Semantics"
Cohesion: 0.08
Nodes (50): BigInt, Box, arith_op(), bin(), BinGate, bit0(), cmp_op(), Dff (+42 more)

### Community 6 - "Yosys Converter & Inout Split"
Cohesion: 0.13
Nodes (43): split_inout_ports(), visit(), Bit, bit_at(), BitInfo, bits_lsb(), constant(), Conv (+35 more)

### Community 7 - "Memory Contents (LogicMem)"
Cohesion: 0.07
Nodes (46): LogicMem, MemItem, Bit, Option, String, Vec, BinBits, BinOp (+38 more)

### Community 8 - "Extension Entry (HdlStudio)"
Cohesion: 0.06
Nodes (8): active_editor_uri(), find_workspace_uri(), HdlStudio, UntitledTracker, StatusProvider, SynthProvider, WebviewMsgQueue, nativeControls

### Community 9 - "Schematic Cell Geometry"
Cohesion: 0.10
Nodes (34): arithSymbols, autoWidth(), baseSelect(), CellHooks, draw(), el(), End, FONT (+26 more)

### Community 10 - "Transform Simplifications"
Cohesion: 0.16
Nodes (23): BTreeSet, input_number(), integrate_arith_constant(), integrate_negation(), make_binary_muxes(), make_dff_with_enable(), make_nary_gates(), Model (+15 more)

### Community 12 - "Files Panel Screenshot"
Cohesion: 0.08
Nodes (14): Files Side Panel Screenshot, Add Source Action, add.sv (source file), Export Image Action, Files Tree View (sidebar), New Circuit Action, Open Lua REPL Action, Project File (untitled:add.digitaljs) (+6 more)

### Community 13 - "Schematic App & Protocol"
Cohesion: 0.19
Nodes (4): isInput(), App, graphOf(), postMessage()

### Community 14 - "Dev Dependencies"
Cohesion: 0.06
Nodes (33): css-loader, esbuild-loader, eslint, glob, mocha, npm-run-all, devDependencies, css-loader (+25 more)

### Community 15 - "Cell Views & Tristate Shot"
Cohesion: 0.09
Nodes (20): Tristate buffer schematic screenshot, Enable wire curling into a loop at the Tribuf en port (routing bug), Tribuf cell (tristate buffer: in, out, enable on bottom), CellView, Connector, Device, Side, astar() (+12 more)

### Community 16 - "Waveform Monitor"
Cohesion: 0.18
Nodes (3): formatTimeAt(), Monitor, step()

### Community 17 - "Host Modules Wiring"
Cohesion: 0.12
Nodes (16): default_synth_options, activate(), expandDir(), expandSources(), SOURCE_EXTS, CircuitFile, FilesView, SourceFile (+8 more)

### Community 19 - "Yosys Run & Requests"
Cohesion: 0.18
Nodes (15): convert_yosys_json(), execFile, FileMap, match_regex, run_yosys(), slang_available(), yosysLog(), build_yosys_script() (+7 more)

### Community 20 - "Schematic SVG Rendering"
Cohesion: 0.17
Nodes (4): View, nearest(), Schematic, xes()

### Community 21 - "Engine Binary & Test Designs"
Cohesion: 0.14
Nodes (12): hdlstudio_bin(), convert(), designs, __dirname, root, slangAvailable(), synthesize(), verilog (+4 more)

### Community 22 - "npm Scripts"
Cohesion: 0.11
Nodes (18): scripts, compile, compile:rust, compile:views, lint, precompile, pretest, test (+10 more)

### Community 23 - "TypeScript Config"
Cohesion: 0.11
Nodes (17): DOM, DOM.Iterable, ES2022, view/**/*.ts, compilerOptions, allowImportingTsExtensions, allowJs, checkJs (+9 more)

### Community 24 - "Dialog Windows"
Cohesion: 0.17
Nodes (8): CircuitData, GraphData, Dialog, empty(), engineChannel, Extra, netlist(), vscode

### Community 25 - "Docs: Engine Serve & History"
Cohesion: 0.16
Nodes (15): Interface port flattening, Top module selector, Release 0.3.0: read_slang frontend, Release 0.6.1: interface port fix, Extension host (src/*.mjs), HDL Studio (VS Code extension), hdlstudio serve (JSON-lines engine protocol), Interval mode (skip empty ticks) (+7 more)

### Community 26 - "Docs: Engine Crates"
Cohesion: 0.15
Nodes (15): @twint/4vl (4-valued logic library), hdlstudio engine (Rust binary), hdlstudio-logic (4-state vectors), hdlstudio-sim (event-driven simulator), Lua engine in hdlstudio (mlua, Lua 5.4), LuaRunner (view/lua_runner.ts), test:golden (previous simulator's frozen results), Wide index and shift-amount saturation (+7 more)

### Community 27 - "Image Export"
Cohesion: 0.24
Nodes (13): extension_formats, check_format(), clone_css_style(), clone_node(), clone_svg(), get_content_rect(), replace_input(), supportedExts() (+5 more)

### Community 29 - "Lua Terminal History"
Cohesion: 0.20
Nodes (6): LuaHistoryProvider, LuaTerminal, ParseResult, try_parse(), try_parse_with_return(), unexpected_eof_suffix

### Community 30 - "SoC RISC-V Core"
Cohesion: 0.15
Nodes (12): alu_src, core, alu, branch_unit, control_unit, decoder, ir, load_unit (+4 more)

### Community 31 - "Vector Fixture Tests"
Cohesion: 0.29
Nodes (10): bin(), bit_num(), check(), matches_the_fixtures(), nbits(), Bit, Option, String (+2 more)

### Community 32 - "Unicode Width Utils"
Cohesion: 0.32
Nodes (11): bisearch(), getLengthAt(), getLengthBefore(), getSubStringLength(), HIGH_COMBINING, HIGH_WIDE, isHighSurrogate(), isLowSurrogate() (+3 more)

### Community 33 - "Micro RV32I Datapath"
Cohesion: 0.17
Nodes (11): datapath, alu, branch_unit, control_unit, decoder, ir, load_unit, memory (+3 more)

### Community 34 - "Runtime Dependencies"
Cohesion: 0.18
Nodes (11): base64-arraybuffer, dequal, elkjs, luaparse, dependencies, base64-arraybuffer, dequal, elkjs (+3 more)

### Community 35 - "Package Manifest"
Cohesion: 0.18
Nodes (10): description, displayName, engines, vscode, icon, license, main, name (+2 more)

### Community 36 - "Docs: Pre-1.0 Releases"
Cohesion: 0.22
Nodes (10): patch-package digitaljs patch, $readmemh/$readmemb data file support, Sparse mux BigInt serialization bug, Tribuf cell, Release 0.0.1: fork of digitaljs_code, Release 0.4.0: readmem data files, Release 0.4.1: $tribuf to plain logic, DigitalJS (Marek Materzok) (+2 more)

### Community 37 - "Docs: Schematic Layout"
Cohesion: 0.27
Nodes (10): cells.ts (cell geometry and drawing), Circuit view (view/schematic, TypeScript), elkjs, Layout stored in circuit (position/vertices), layout.ts (ELK layout), route.ts (wire routing, A*), Image export (SVG/PNG/JPEG), Source code highlighting on hover (+2 more)

### Community 38 - "Board Waveform Screenshot"
Cohesion: 0.29
Nodes (10): Schematic + Waveform Screenshot, Board Top-Level Schematic (clk/rst -> sys -> panel -> matrix), Clock (clk) and Button (rst) Input Widgets, LEDMatrix Widget (16x32, capybara), led_panel$board.panel Subcircuit (512-bit matrix out), Live Wire Value Colouring (green=1, red=0, blue=bus), soc$board.sys Subcircuit (row_idx, col_data, row_strobe), Watched Signals: clk, rst, matrix, col_data (+2 more)

### Community 39 - "Waveform Colour Schema"
Cohesion: 0.20
Nodes (10): description, type, description, type, description, type, properties, altBackground (+2 more)

### Community 40 - "Extension Settings"
Cohesion: 0.20
Nodes (10): properties, title, configuration, markdownDescription, type, default, description, type (+2 more)

### Community 41 - "Waveform Colour Defaults"
Cohesion: 0.20
Nodes (10): altBackground, background, cursor, fillOpacity, foreground, grid, highImpedance, signal (+2 more)

### Community 42 - "ALU Testbench"
Cohesion: 0.20
Nodes (9): run_and_check, tp1_pkg, top_module_tb, do_reset, preload_registers, run_and_check, verify_r0, top_module (+1 more)

### Community 43 - "Docs: v0.5 Release"
Cohesion: 0.22
Nodes (9): $bmux cell support, Lua script race/echo-loop fixes, PushButton momentary widget, Release 0.5.0: tri-state buses, LED matrix, Release 0.6.0: momentary pushbutton, I/O widget inference (io_ui), LEDMatrix widget, TriMerge cell (+1 more)

### Community 44 - "Docs: Converter & Synthesis"
Cohesion: 0.28
Nodes (9): Release 0.2.0: yosys diagnostics, synthesis options, build_yosys_script (src/yosys_script.mjs), Converter golden test (golden.json), hdlstudio-yosys (yosys JSON to circuit converter), techmap excludes flip-flops/latches/memories, test:pipeline (pipeline.spec.mjs), Converter quirks kept on purpose, $_DFF_P_/$_DFFE_PP_ Invalid cell type quirk (+1 more)

### Community 45 - "Docs: Control Panel & Inout"
Cohesion: 0.36
Nodes (9): Release 0.7.0: inout ports, control panel, Control panel, inout port split (inout.rs), micro example (RV32I datapath), readmem data file basename alias (data_file_paths), Reset (resetsim), Simulation speed setting, soc example (RV32I, inout bus, board) (+1 more)

### Community 46 - "JS Config"
Cohesion: 0.22
Nodes (8): compilerOptions, checkJs, lib, module, target, exclude, ES2020, node_modules

### Community 48 - "Inout Bus Example"
Cohesion: 0.25
Nodes (7): bus_pair, bus_probe, bus_reg, bus_pair, bus_probe, bus_reg, inout_bus

### Community 49 - "Sim Smoke Tests"
Cohesion: 0.36
Nodes (6): an_alarm_on_a_tick_that_has_events_fires_once(), counter_counts(), every_golden_circuit_runs(), golden(), String, Vec

### Community 50 - "Engine CLI Main"
Cohesion: 0.54
Nodes (7): lua_headless(), main(), Result, String, simtrace(), yosys2hdlstudio(), ExitCode

### Community 51 - "Package Keywords"
Cohesion: 0.25
Nodes (8): keywords, digital logic, schematic, simulation, systemverilog, verilog, waveform, yosys

### Community 53 - "ALU Top Module"
Cohesion: 0.29
Nodes (6): alu_if, reg_file, alu, fsm, tp1_pkg, top_module

### Community 54 - "Docs: 1.0 Release"
Cohesion: 0.33
Nodes (7): One clock cycle control, Run until next event (removed), Release 1.0.0: own Rust engine replaces DigitalJS, .hdls project file, hdlstudio-netlist (circuit model), DigitalJS Online, Publish 1.0.0 release

### Community 55 - "Contributed Commands & Views"
Cohesion: 0.29
Nodes (7): contributes, commands, customEditors, views, viewsContainers, hdl-studio-container, activitybar

### Community 57 - "Converter Golden Test"
Cohesion: 0.40
Nodes (5): convert(), matches_the_js_chain(), Result, String, Value

### Community 58 - "Tri-state Bus Example"
Cohesion: 0.33
Nodes (5): drv_a, drv_b, bus_top, drv_a, drv_b

### Community 59 - "ESLint Config"
Cohesion: 0.33
Nodes (4): browserGlobals, mochaGlobals, nodeGlobals, rules

### Community 60 - "SoC Top Module"
Cohesion: 0.33
Nodes (5): matrix_port, soc, addr_decode, core, memory

### Community 61 - "Package Categories"
Cohesion: 0.33
Nodes (6): categories, Debuggers, Education, Other, Programming Languages, Visualization

### Community 62 - "Menus"
Cohesion: 0.33
Nodes (6): menus, commandPalette, editor/title, explorer/context, view/item/context, view/title

### Community 63 - "Fill Opacity Setting"
Cohesion: 0.40
Nodes (5): description, maximum, minimum, type, fillOpacity

### Community 64 - "Cargo Crates"
Cohesion: 0.90
Nodes (5): hdlstudio, hdlstudio-logic, hdlstudio-netlist, hdlstudio-sim, hdlstudio-yosys

### Community 65 - "VS Code Test Index"
Cohesion: 0.50
Nodes (4): { globSync }, Mocha, path, run()

### Community 66 - "CPU + RAM"
Cohesion: 0.40
Nodes (4): cpu_ram, addr_decode, core, memory

### Community 67 - "Docs: Waveform Recording"
Cohesion: 0.67
Nodes (4): Waveform recording (wave.rs, watch/unwatch/wave), waves.ts (waveform monitor), Surfer waveform viewer, Waveform history cap (1M changes)

### Community 68 - "Decade Counter Example"
Cohesion: 0.50
Nodes (3): decada, contador_decadas, decada

### Community 69 - "Extension Icons"
Cohesion: 0.83
Nodes (4): Integrated-circuit chip icon motif, HDL Studio activity bar icon (monochrome SVG wrapping 513px PNG raster), HDL Studio extension icon (PNG, 256px chip), HDL Studio command/view icon (SVG wrapping 512px PNG raster)

### Community 70 - "Board (SoC + LED Panel)"
Cohesion: 0.50
Nodes (3): led_panel, soc, board

### Community 71 - "npm allowScripts"
Cohesion: 0.50
Nodes (4): allowScripts, keytar@7.9.0, @parcel/watcher@2.5.6, @vscode/vsce-sign@2.0.9

### Community 73 - "Cursor Colour Setting"
Cohesion: 0.67
Nodes (3): description, type, cursor

### Community 74 - "Grid Colour Setting"
Cohesion: 0.67
Nodes (3): description, type, grid

### Community 75 - "High-Z Colour Setting"
Cohesion: 0.67
Nodes (3): description, type, highImpedance

### Community 76 - "Signal Colour Setting"
Cohesion: 0.67
Nodes (3): signal, description, type

### Community 77 - "Undefined Colour Setting"
Cohesion: 0.67
Nodes (3): undefined, description, type

### Community 78 - "Repository Info"
Cohesion: 0.67
Nodes (3): repository, type, url

## Knowledge Gaps
- **313 isolated node(s):** `nodeGlobals`, `browserGlobals`, `mochaGlobals`, `rules`, `module` (+308 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 579 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **58 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `LogicVec` connect `4-State Vector Logic` to `Sim Tests & Bench`, `Netlist Model & Sim Build`, `Simulator Cell Semantics`, `Memory Contents (LogicMem)`, `Transform Simplifications`, `Vector Fixture Tests`?**
  _High betweenness centrality (0.065) - this node is a cross-community bridge._
- **Why does `REPL` connect `Lua REPL Terminal` to `Lua Terminal History`?**
  _High betweenness centrality (0.024) - this node is a cross-community bridge._
- **Why does `Spec` connect `Simulator Cell Semantics` to `4-State Vector Logic`, `Yosys Converter & Inout Split`, `Memory Contents (LogicMem)`?**
  _High betweenness centrality (0.023) - this node is a cross-community bridge._
- **What connects `nodeGlobals`, `browserGlobals`, `mochaGlobals` to the rest of the system?**
  _313 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `4-State Vector Logic` be split into smaller, more focused modules?**
  _Cohesion score 0.05350877192982456 - nodes in this community are weakly interconnected._
- **Should `Sim Tests & Bench` be split into smaller, more focused modules?**
  _Cohesion score 0.059921710328214396 - nodes in this community are weakly interconnected._
- **Should `Lua REPL Terminal` be split into smaller, more focused modules?**
  _Cohesion score 0.075 - nodes in this community are weakly interconnected._