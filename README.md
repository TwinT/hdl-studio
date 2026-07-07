# HDL Studio

[![vscode marketplace](https://img.shields.io/badge/VS%20Code-HDL%20Studio-blue)](https://marketplace.visualstudio.com/items?itemName=TwinT.hdl-studio)

HDL Studio is a VS Code extension for simulating and synthesizing digital circuits written in Verilog/SystemVerilog. It brings the [DigitalJS](https://github.com/tilk/digitaljs) digital logic simulator and the [yosys2digitaljs](https://github.com/tilk/yosys2digitaljs) netlist format converter directly into your editor, with synthesis delegated to a native [Yosys](https://yosyshq.net/yosys/) binary running in the associated dev-container.

It provides similar functionalities as the [online version](https://digitaljs.tilk.eu/) while allowing you to work directly with local source files and saving your progress, including source information and the synthesized circuit, for future use. It also includes other additional features like undo-redo, exporting the circuit to images and more.

> **Fork notice:** HDL Studio is a fork of [digitaljs_code](https://github.com/yuyichao/digitaljs_code) by [Yichao Yu](https://github.com/yuyichao), maintained here with a focus on classroom use and native Yosys integration. The original work was made possible by [DigitalJS](https://github.com/tilk/digitaljs), [yosys2digitaljs](https://github.com/tilk/yosys2digitaljs) and many other related projects by [Marek Materzok](http://www.tilk.eu/) at the [University of Wrocław](http://www.ii.uni.wroc.pl/), as well as the [Yosys](https://yosyshq.net/yosys/) open-source hardware synthesis framework. Ideas and code are also borrowed from [DigitalJS Online](https://github.com/tilk/digitaljs_online).

Contributions are welcome!

![screenshot](./imgs/screenshots/code-highlight.png)

## Features

* Simulation of circuit (using [DigitalJS](https://github.com/tilk/digitaljs)) including support for

    * Continuous simulation
    * Single step
    * Trigger
    * Signal monitor and plotting.

* __Saving/backing up__ the circuit including the source file information in a portable format

  (The relative paths of the source files are saved and so that the project can be fully
   restored on another machine as long as the source files are also packaged/copied with
   the project/circuit file)

  The saved file can be loaded again using this extension,
  or in the [online version](https://digitaljs.tilk.eu/) for simulation.

* Open the JSON circuit saved by the [online version](https://digitaljs.tilk.eu/)
  for simulation. Accepted extensions are either `.json` or `.digitaljs`.
  `.digitaljs` will be opened by default using this extension.

* __Exporting the synthesized circuit as vector (SVG) or raster images (PNG or JPEG)__.

* __Undo and redo__ all the changes on the circuit including but not limited to
  resynthesize of the circuit and edits done from the graphic view of the circuit.

* __Highlighting the source code__ that matches certain circuit element in the graphic view.

    This can be seen in the screenshot above.

* Using `Lua` scripts to customize/seed the simulation
  (using [`digitaljs_lua`](https://github.com/tilk/digitaljs_lua))

* Lua command line

* Viewing and simulation of multiple circuits simultaneously

* Zoom and pan support with both mouse and touch screen.

## Requirements

This extension is designed to run inside the provided dev-container [sd](https://hub.docker.com/r/twint/sd), which includes a native [Yosys](https://yosyshq.net/yosys/) binary. Synthesis will not work without it. Check the [hdl_studio_test](https://github.com/TwinT/hdl_studio_test) repo for a working example of the dev-container setup.

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

    ![files sidepanel](./imgs/screenshots/digitaljs-files-sidepanel.png)

    Files with extension `.digitaljs` will automatically be opened by HDL Studio.
    Opening files with `.json` is also supported using either the explorer context menu
    or the `Open With` VS Code command. One can also open JSON files saved from
    [DigitalJS Online](https://digitaljs.tilk.eu/). However, since DigitalJS Online
    does not save any source info, only simulation and the graphic editor are supported
    on such files. Synthesis is only supported once new source files have been added.

    Note that the circuit file contains relative paths to the source files.
    If the circuit is to be copied to a different machine, the source files
    also need to be copied with the same relative paths.

* The main UI for HDL Studio includes the main circuit view/editor and three side panels.

    The main circuit view shows the synthesized circuit (if one exists).
    It includes interactive tools to view the circuit, edit connections,
    view and plot signals, and set up triggers.
    The circuit view supports zooming and panning using touch/drag, two-finger drag/pinch
    as well as Ctrl + scroll wheel.
    For complex circuits, the submodules can be opened in a popup window.

    The three side panels show the files in the circuit, the synthesis options
    and the simulation control respectively.

* Synthesis

    Once the source files are added, the circuit can be synthesized
    using the synthesis side panel. The synthesis options can be set on the same panel
    and will be saved along with the circuit.

    If the source file for the circuit is visible in a text editor,
    hovering the wires and devices on the main circuit view will highlight
    the corresponding lines of code in the source editor.

* Simulation

    The wires in the main circuit view are highlighted according to the simulation status
    and one can also hover on the wires to see the signal values.
    The input values for the top-level module can be changed interactively in the circuit.
    The input and output ports can also be seen/controlled in the control side panel.

    To start/pause the simulation, use the play/pause icon next to the editor title.
    For more complex simulation control including fast-forward, single-step,
    or wait for event, a more complete set of buttons is available in the control panel.
    The simulation time tick is also shown in the control panel.

    The magnifying glass icon on the wires allows you to monitor a signal
    and create a plot for it. Clicking the icon brings up the monitor view
    as part of the main circuit view. Triggering conditions can also be set up
    in the monitor view.

* Saving progress

    The main circuit view is implemented as a custom editor and all the normal saving/restoring
    operations on an editor are supported using the corresponding hotkey or menu from VS Code.
    This includes saving, saving as, reverting, undo and redo.
    Note that changes to the circuit layout from the graphic interface are saved
    and will be part of the undo/redo history.
    However, the signals in the circuit are not saved.
    Note that due to VS Code limitations, saving the circuit under a different name
    will close the circuit and open it under the new name, and the simulation status will be lost.

* Exporting image

    The circuit, including the signal levels, can be exported as either vector or raster images.
    SVG, PNG and JPEG formats are supported and additional formats may also be available
    depending on the host browser.

    The exported image is for a single circuit view.
    Images for subcircuits need to be exported individually.
    Note that export of a subcircuit image requires the corresponding subcircuit to be open.

* Lua scripting

    For more complex control of the simulation, you can use `Lua` scripts.

    To run a script, add it as a source file to the circuit and use the
    run button in the HDL Studio files view to start it. The run button will change
    into a stop button to abort the script while it is running.
    In addition to the API at https://github.com/tilk/digitaljs_lua/blob/master/docs/USAGE.md,
    two additional functions `sim.start()` and `sim.stop(synchronize=false)` are also supported
    to start and stop the simulation.

    By default, the output of the script will be shown as notification messages in VS Code.
    Alternatively, you can open a Lua terminal for the circuit using the `Lua Terminal` button
    in the HDL Studio files panel. When the terminal is visible, the output of the script
    will be printed to the terminal instead. You can also use the terminal to interactively
    run Lua scripts, similar to the normal Lua command-line interface. Command-line editing
    and command history are supported. Pressing `Ctrl-C` aborts the execution of commands
    from the command line (it does not stop the execution of other Lua scripts).

    Starting and stopping the simulation from the Lua terminal, setting inputs and getting outputs
    from the circuit:

    ![Lua REPL](./imgs/screenshots/lua-repl.png)

## License

BSD 2-Clause. See [LICENSE](./LICENSE) for details.
