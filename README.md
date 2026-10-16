# HDL Studio

[![vscode marketplace](https://img.shields.io/badge/VS%20Code-HDL%20Studio-blue)](https://marketplace.visualstudio.com/items?itemName=TwinT.hdl-studio)

HDL Studio is a VS Code extension for synthesizing and simulating digital circuits written in Verilog/SystemVerilog. A native [Yosys](https://yosyshq.net/yosys/) synthesizes your sources, and HDL Studio shows the resulting circuit as an interactive schematic and simulates that same circuit, gate by gate, with 4-valued logic (0, 1, x, z), tri-state buses and per-cell delays. Its simulator, `hdlstudio`, is written in Rust and runs as a native process next to the editor.

You work on your own source files and save your progress, sources and synthesized circuit included, in a project file. The extension adds undo/redo, a waveform monitor with triggers, Lua scripting, image export and more.

> **Origins:** HDL Studio is a fork of [digitaljs_code](https://github.com/yuyichao/digitaljs_code) by [Yichao Yu](https://github.com/yuyichao), maintained here with a focus on classroom use. It was built on [DigitalJS](https://github.com/tilk/digitaljs), [yosys2digitaljs](https://github.com/tilk/yosys2digitaljs) and [digitaljs_lua](https://github.com/tilk/digitaljs_lua) by [Marek Materzok](http://www.tilk.eu/) at the [University of Wrocław](http://www.ii.uni.wroc.pl/). Version 1.0 replaces them with its own simulator, converter and Lua engine, which follow their semantics and file format: projects saved by earlier versions, and circuits saved by [DigitalJS Online](https://digitaljs.tilk.eu/), open as they are.

Contributions are welcome!

![screenshot](./imgs/screenshots/schematic-waveform.png)

## Requirements

- A native [Yosys](https://yosyshq.net/yosys/) for synthesis, ideally with the [slang](https://github.com/povik/yosys-slang) frontend for SystemVerilog. The extension is designed to run inside the dev-container [sd](https://hub.docker.com/r/twint/sd), which includes both; check the [hdl_studio_test](https://github.com/TwinT/hdl_studio_test) repo for a working setup. Set `hdl-studio.yosysPath` if `yosys` is not on the PATH.
- Linux x64 (the simulator is a native binary shipped with the extension). The extension doesn't run in the browser (vscode.dev).

## Features

* Simulation of the synthesized circuit: continuous (at an adjustable speed, up to as fast as possible), one tick, one clock cycle, or a given time (`Run for 2 us`), and Reset back to tick 0.
* Waveform monitor: watch any wire, read values under the pointer, pause the simulation when a signal rises, falls, changes or takes a value.
* Inputs and outputs of the top module as switches, push buttons, number fields, lamps, number displays, 7-segment displays and LED matrices, on the schematic and in the control panel.
* Subcircuits, memories (with an editor) and FSMs (as a state diagram) open in their own windows.
* __Saving/backing up__ the circuit, including the source files' relative paths, so the project can be restored on another machine together with its sources.
* __Undo and redo__ of every change, from re-synthesis to moving cells around.
* __Highlighting the source code__ that matches the element under the pointer.
* __Exporting the circuit as SVG, PNG or JPEG__, with its signal levels.
* `Lua` scripts and a Lua command line to drive and check the simulation.
* Several circuits open and simulating at once.
* Zoom and pan with mouse, trackpad or touch screen.

## Basic workflow

* Creating and opening circuit

    New circuits can be created from an empty circuit or from existing source files.

    * To create a new circuit, use the `HDL Studio: New Circuit` command
      or click the HDL Studio icon next to the editor title when the current source file
      isn't one recognized by HDL Studio.
    * To create a circuit from an existing source file (`.v`, `.sv`, `.vh` and `.lua` supported),
      use the HDL Studio icon when the source file is open or click `Create circuit in HDL Studio`
      in the context menu for the file in the explorer view.
      The source file will be added to the new circuit and the new circuit will by default
      inherit the name from the source file.

      ![screenshot](./imgs/screenshots/create-circuit-src.png)

    After the circuit is created, new files can be added to it either using the HDL Studio icon
    and the explorer context menu, or using the `Add Files` button from the `Files` view
    in the HDL Studio side panel.

    ![files sidepanel](./imgs/screenshots/files-sidepanel.png)

    Circuits are saved as `.hdls` files, which HDL Studio opens automatically.
    Projects saved by versions before 1.0 (`.digitaljs`) open too; use `Save As`
    to give one the new extension. Opening `.json` files is also supported using
    either the explorer context menu or the `Open With` VS Code command, including
    circuits saved by [DigitalJS Online](https://digitaljs.tilk.eu/) or a raw Yosys
    JSON netlist. Without source files only simulation is available; synthesis
    needs sources.

    Note that the circuit file contains relative paths to the source files.
    If the circuit is to be copied to a different machine, the source files
    also need to be copied with the same relative paths.

* The main UI for HDL Studio includes the circuit view and three side panels:
  the files in the circuit, the synthesis options and the simulation control.

    The circuit view shows the synthesized circuit. Drag the background (or use the
    mouse wheel) to pan, Ctrl + wheel or a pinch to zoom, double-click the background
    to zoom in. Cells can be dragged around; the layout is saved with the circuit.
    Subcircuits, memories and FSMs show a magnifying glass when the pointer is over
    them: click it (or double-click the cell) to open them in a window.

* Synthesis

    Once the source files are added, the circuit is synthesized from the Synthesis
    side panel. Its options (top module, Yosys optimization, decomposition into basic
    gates, FSM extraction, diagram simplification, zero combinational delay) are saved
    with the circuit.

    If the source file for the circuit is visible in a text editor,
    hovering the wires and devices on the circuit view highlights
    the corresponding lines of code in the source editor.

    ![screenshot](./imgs/screenshots/code-highlight.png)

* Simulation

    Wires are coloured by their value: green all ones, salmon all zeros, blue a
    defined mix, orange high impedance (z), grey undefined (x). Hover a wire to see
    its value. The top module's inputs can be changed on the schematic (click a
    switch, hold a push button, type a number or use the wheel on it) or in the
    control panel, which also shows the outputs.

    Start and pause the simulation with the play/pause icon next to the editor title
    or in the control panel. The control panel also has single step (one tick), one
    clock cycle, Reset (back to tick 0 with registers and memories at their initial
    values) and a speed slider, which sets how fast Start runs (and Lua scripts with
    it); its rightmost position, "max", runs as fast as possible. While running, the
    panel shows the speed actually reached, since a large circuit can't keep up with
    a high setting.

    The control panel shows the simulation time in ticks and in time units. How long
    one tick is (`1 tick = 1 ns` by default) is set per project in the same panel;
    "Run for" advances a given time (e.g. `2 us`) and pauses, and the clock widgets
    show and edit the clock period in time units.

* Waveforms

    Hover a wire and click the waveform button next to it (or double-click the wire)
    to add it to the waveform monitor under the schematic. The monitor shows each
    signal's value under the pointer and a ruler in time units. A click on the
    waveforms stops following the simulation, so you can look around; another click
    follows it again. Drag to scroll back, Ctrl + wheel to zoom.

    Right-click a signal (or use its `…` button) to choose its number format, to
    remove it, or to pause the simulation when it rises, falls, changes, becomes x or
    equals a value. Then press Start: the simulation runs until that happens, and the
    monitor marks the moment and says why it paused.

    The colours are the `hdl-studio.waveform.colors` setting; the default is
    [Surfer](https://surfer-project.org)'s dark theme.

* Saving progress

    The circuit view is a custom editor and all the normal saving/restoring
    operations on an editor are supported using the corresponding hotkey or menu from VS Code.
    This includes saving, saving as, reverting, undo and redo.
    Changes to the layout from the circuit view are saved and are part of the
    undo/redo history. The signals in the circuit are not saved.
    Note that due to VS Code limitations, saving the circuit under a different name
    will close the circuit and open it under the new name, and the simulation status will be lost.

* Exporting image

    The circuit, including the signal levels, can be exported as either vector or raster images.
    SVG, PNG and JPEG formats are supported and additional formats may also be available.

    The exported image is for a single circuit view.
    Images for subcircuits need to be exported individually, while they are open.

* Lua scripting

    For more complex control of the simulation, you can use `Lua` (5.4) scripts.

    To run a script, add it as a source file to the circuit and use the
    run button in the HDL Studio files view to start it. The run button will change
    into a stop button to abort the script while it is running. Running a script
    starts the simulation, and the simulation pauses when the script ends.

    The `sim` library talks to the circuit. Inputs, outputs and wires are named
    as in the sources (a wire inside a subcircuit by the subcircuit labels first:
    `sim.getvalue("core_i", "pc")`).
    * `sim.setinput(name, value)`, `sim.getoutput(name)`: the top module's ports.
    * `sim.getvalue(..., wire)`: any named wire.
    * `sim.tick()`: the current tick.
    * `sim.sleep(n)`: wait `n` ticks.
    * `sim.wait(event[, n])`: wait for an event, at most `n` ticks. Events are
      `sim.posedge(..., wire)`, `sim.negedge(..., wire)` and
      `sim.value(v, ..., wire)` (the wire takes value `v`), and `e1 | e2`
      waits for either.

    The `vec` library is 4-valued vectors:
    * Making one: `vec(5)`, `vec(-3, 8)`, `vec(true)`, `vec("8ha5")`,
      `vec("4b1x0z")`, `vec.frombin("1x0z")`, `vec.fromhex("f0", 12)`,
      `vec.fromoct(s[, bits])`, `vec.frombool(b[, bits])`,
      `vec.frominteger(n[, bits])`.
    * Reading one: `v:tobin()`, `v:tohex()`, `v:tooct()`, `v:tointeger()`,
      `v:tointegersigned()`, `#v` (its width), `v(i)` (bit `i`, negative from the
      top) and `v(i, n)` (`n` bits from `i`).
    * Operators: `& | ~` (xor), `~v` (not), `..` (concatenation, `a .. b` puts `a`
      on top as in `{a, b}`) and `==`.
    * Bitwise methods: `band bor bxor bnand bnor bxnor bnot`. Reductions:
      `rand ror rxor rnand rnor rxnor`.
    * Tests: `ishigh islow isdefined isfullydefined`, and `xmask`.

    Values given to `sim` can be vecs, booleans, integers or strings like
    `"8hff"`. `print` shows its arguments.

    By default, the output of the script will be shown as notification messages in VS Code.
    Alternatively, you can open a Lua terminal for the circuit using the `Lua Terminal` button
    in the HDL Studio files panel. When the terminal is visible, the output of the script
    will be printed to the terminal instead. You can also use the terminal to interactively
    run Lua code, similar to the normal Lua command-line interface; it prints the value
    of an expression. Command-line editing and command history are supported. Pressing
    `Ctrl-C` aborts the execution of commands from the command line (it does not stop
    the execution of other Lua scripts).

    ![Lua REPL](./imgs/screenshots/lua-repl.png)

## License

BSD 2-Clause. See [LICENSE](./LICENSE) for details.
