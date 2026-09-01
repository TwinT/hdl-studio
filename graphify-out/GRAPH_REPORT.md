# Graph Report - hdl_studio  (2026-09-01)

## Corpus Check
- 100 files · ~60,138 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 757 nodes · 1160 edges · 80 communities (27 shown, 40 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 18 edges (avg confidence: 0.62)
- Token cost: 43,897 input · 2,622 output

## Community Hubs (Navigation)
- REPL Line Editor
- 4VL Native-Z Integration
- Extension Manifest
- Extension Activation & DigitalJS Doc
- Build/Dev Dependencies
- Document Model (Circuit Editing)
- Waveform Monitor
- REPL History & Cursor
- Sources Management
- Webview Dialog Manager
- VS Code Contributions (UI)
- Status Panel (I/O Widgets)
- DigitalJS Circuit Lifecycle
- Extension Lifecycle & File Utils
- Webview Message Providers
- SVG/Image Utilities
- Lua Terminal History
- CPU Datapath & ALU Testbench
- Main View Engine & Touch Support
- Yosys Synthesis Requests
- Circuit View (Webview Panel)
- Files Sidebar View
- Yosys Script Builder & Pipeline Test
- Subcircuit Dialog Tracking
- ALU Testbench Runner
- Remote I/O Panel
- TS/JS Config
- Synth Options Panel
- Webpack Build Config
- Source Info & Backup
- ALU Top Module
- Tri-state Bus (bus_top fixture)
- ESLint Config
- README & Screenshots
- Lua Scripting Runner
- VS Code Test Suite Index
- Decade Counter Fixture
- VS Code Test Runner
- Extension Test Scaffold
- ALU Submodule
- ALU FSM Submodule
- ALU Register File Submodule
- SR Latch Fixture
- D Latch Fixture
- Full Adder Fixture
- Counter Fixture
- LFSR Fixture
- RAM Fixture
- ROM Fixture
- ALU Package Types
- Control Unit (CPU)
- Memory Module (CPU)
- Micro CPU ALU
- Micro CPU Branch Unit
- Micro CPU Control Unit
- Micro CPU Decoder
- Micro CPU Instruction Reg
- Micro CPU Load Unit
- Micro CPU Memory
- Micro CPU Program Counter
- Micro CPU Register File
- Micro CPU Store Unit
- Tribuf Bus2 Fixture
- Tribuf Bus3 Fixture
- Tribuf Single Fixture
- Claude Project Notes
- Yosys (External Tool)

## God Nodes (most connected - your core abstractions)
1. `REPL` - 54 edges
2. `DigitalJS` - 35 edges
3. `Document` - 33 edges
4. `Sources` - 28 edges
5. `DigitalJS` - 21 edges
6. `MonitorView` - 17 edges
7. `scripts` - 15 edges
8. `Line` - 13 edges
9. `CircuitView` - 12 edges
10. `run_yosys()` - 12 edges

## Surprising Connections (you probably didn't know these)
- `HDL Studio Logo` --references--> `README`  [EXTRACTED]
  imgs/hdl-studio.png → README.md
- `Code Highlighting Screenshot` --references--> `README`  [EXTRACTED]
  imgs/screenshots/code-highlight.png → README.md
- `Create Circuit Screenshot` --references--> `README`  [EXTRACTED]
  imgs/screenshots/create-circuit-src.png → README.md
- `Files Sidepanel Screenshot` --references--> `README`  [EXTRACTED]
  imgs/screenshots/digitaljs-files-sidepanel.png → README.md
- `Lua REPL Screenshot` --references--> `README`  [EXTRACTED]
  imgs/screenshots/lua-repl.png → README.md

## Import Cycles
- 1-file cycle: `test/verilog/alu/alu.sv -> test/verilog/alu/alu.sv`
- 1-file cycle: `test/verilog/alu/fsm.sv -> test/verilog/alu/fsm.sv`
- 1-file cycle: `test/verilog/alu/reg_file.sv -> test/verilog/alu/reg_file.sv`
- 1-file cycle: `test/verilog/alu/top_module.sv -> test/verilog/alu/top_module.sv`
- 1-file cycle: `test/verilog/alu/top_module_tb.sv -> test/verilog/alu/top_module_tb.sv`
- 1-file cycle: `test/verilog/alu/tp1_pkg.sv -> test/verilog/alu/tp1_pkg.sv`

## Communities (80 total, 40 thin omitted)

### Community 0 - "REPL Line Editor"
Cohesion: 0.10
Nodes (3): Line, REPL, wrap_line()

### Community 1 - "4VL Native-Z Integration"
Cohesion: 0.04
Nodes (46): 4VL Integration Plan, assert, backbone, base64-arraybuffer, buffer, Changelog, crypto-browserify, dequal (+38 more)

### Community 2 - "Extension Manifest"
Cohesion: 0.05
Nodes (42): allowScripts, keytar@7.9.0, @parcel/watcher@2.5.6, @vscode/vsce-sign@2.0.9, browser, categories, description, displayName (+34 more)

### Community 3 - "Extension Activation & DigitalJS Doc"
Cohesion: 0.09
Nodes (6): active_editor_uri(), DigitalJS, expandDir(), expandSources(), find_workspace_uri(), SOURCE_EXTS

### Community 4 - "Build/Dev Dependencies"
Cohesion: 0.05
Nodes (39): css-loader, eslint, expose-loader, glob, jquery, mocha, npm-run-all, devDependencies (+31 more)

### Community 6 - "Waveform Monitor"
Cohesion: 0.11
Nodes (4): getWireId(), getWireName(), Monitor, MonitorView

### Community 7 - "REPL History & Cursor"
Cohesion: 0.12
Nodes (15): array_equal(), Cursor, CursorMoveType, REPLHistory, bisearch(), getLengthAt(), getLengthBefore(), getSubStringLength() (+7 more)

### Community 9 - "Webview Dialog Manager"
Cohesion: 0.12
Nodes (5): Dialog, DialogContext, DialogManager, max_dialog_height(), max_dialog_width()

### Community 10 - "VS Code Contributions (UI)"
Cohesion: 0.10
Nodes (20): properties, title, contributes, commands, configuration, customEditors, menus, views (+12 more)

### Community 11 - "Status Panel (I/O Widgets)"
Cohesion: 0.14
Nodes (4): controlCodes20, Display4vlASCII, Status, vscode

### Community 13 - "Extension Lifecycle & File Utils"
Cohesion: 0.19
Nodes (6): UntitledTracker, file_exist(), get_dirname_uri(), read_txt_file(), rel_compat1(), write_txt_file()

### Community 14 - "Webview Message Providers"
Cohesion: 0.20
Nodes (3): StatusProvider, SynthProvider, WebviewMsgQueue

### Community 15 - "SVG/Image Utilities"
Cohesion: 0.24
Nodes (13): extension_formats, check_format(), clone_css_style(), clone_node(), clone_svg(), get_content_rect(), replace_input(), supportedExts() (+5 more)

### Community 16 - "Lua Terminal History"
Cohesion: 0.19
Nodes (6): LuaHistoryProvider, LuaTerminal, ParseResult, try_parse(), try_parse_with_return(), unexpected_eof_suffix

### Community 17 - "CPU Datapath & ALU Testbench"
Cohesion: 0.14
Nodes (11): branch_unit, control_unit, decoder, ir, load_unit, memory, pc, register_file (+3 more)

### Community 18 - "Main View Engine & Touch Support"
Cohesion: 0.15
Nodes (5): ChangeTracker, circuit_empty(), Engine, vscode, $window

### Community 19 - "Yosys Synthesis Requests"
Cohesion: 0.30
Nodes (8): default_synth_options, convert_yosys_json(), execFile, FileMap, match_regex, run_yosys(), slang_available(), yosysLog()

### Community 21 - "Files Sidebar View"
Cohesion: 0.20
Nodes (4): CircuitFile, FilesView, SourceFile, rel_compat2()

### Community 22 - "Yosys Script Builder & Pipeline Test"
Cohesion: 0.27
Nodes (6): build_yosys_script(), HDL_EXTENSIONS, isHdlFile(), __dirname, synth(), verilogDir

### Community 24 - "ALU Testbench Runner"
Cohesion: 0.20
Nodes (9): run_and_check, tp1_pkg, top_module_tb, do_reset, preload_registers, run_and_check, verify_r0, top_module (+1 more)

### Community 26 - "TS/JS Config"
Cohesion: 0.22
Nodes (8): compilerOptions, checkJs, lib, module, target, exclude, ES2020, node_modules

### Community 30 - "ALU Top Module"
Cohesion: 0.29
Nodes (6): alu_if, fsm, reg_file, alu, tp1_pkg, top_module

### Community 31 - "Tri-state Bus (bus_top fixture)"
Cohesion: 0.33
Nodes (5): drv_a, drv_b, bus_top, drv_a, drv_b

### Community 32 - "ESLint Config"
Cohesion: 0.33
Nodes (4): browserGlobals, mochaGlobals, nodeGlobals, rules

### Community 33 - "README & Screenshots"
Cohesion: 0.33
Nodes (6): HDL Studio Logo, Code Highlighting Screenshot, Create Circuit Screenshot, Files Sidepanel Screenshot, Lua REPL Screenshot, README

### Community 35 - "VS Code Test Suite Index"
Cohesion: 0.40
Nodes (3): { globSync }, Mocha, path

### Community 36 - "Decade Counter Fixture"
Cohesion: 0.50
Nodes (3): decada, contador_decadas, decada

## Knowledge Gaps
- **186 isolated node(s):** `nodeGlobals`, `browserGlobals`, `mochaGlobals`, `rules`, `module` (+181 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 328 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **40 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `REPL` connect `REPL Line Editor` to `Lua Terminal History`, `REPL History & Cursor`?**
  _High betweenness centrality (0.075) - this node is a cross-community bridge._
- **Why does `Document` connect `Document Model (Circuit Editing)` to `Extension Activation & DigitalJS Doc`, `Yosys Synthesis Requests`, `Extension Lifecycle & File Utils`?**
  _High betweenness centrality (0.054) - this node is a cross-community bridge._
- **Why does `extension_formats` connect `SVG/Image Utilities` to `Extension Lifecycle & File Utils`?**
  _High betweenness centrality (0.040) - this node is a cross-community bridge._
- **What connects `nodeGlobals`, `browserGlobals`, `mochaGlobals` to the rest of the system?**
  _186 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `REPL Line Editor` be split into smaller, more focused modules?**
  _Cohesion score 0.09814563545906829 - nodes in this community are weakly interconnected._
- **Should `4VL Native-Z Integration` be split into smaller, more focused modules?**
  _Cohesion score 0.044444444444444446 - nodes in this community are weakly interconnected._
- **Should `Extension Manifest` be split into smaller, more focused modules?**
  _Cohesion score 0.046511627906976744 - nodes in this community are weakly interconnected._