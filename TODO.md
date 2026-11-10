# Task List (TODO)

Done items leave this list; git history keeps them.

## Next Features 🚀
- [ ] Option for disabling labels on the circuit view.
- [ ] A "tidy up" button that lays the circuit out again with ELK (moved
      cells and their wires included).
- [ ] Synthesis errors and warnings in the Problems panel, underlined in the
      sources: today they go to the "HDL Studio (Yosys)" output channel and a
      notification. A `DiagnosticCollection` fed from yosys-slang's
      `file:line:col: error|warning:` lines (`FileMap.unmap_string` already
      gives the real names) and from yosys's own warnings worth teaching:
      a latch inferred (`proc_dlatch`), several drivers on a net, a wire
      nothing drives.
- [ ] A stale circuit: after a source is edited the view keeps simulating
      the old synthesis and says nothing. `sources.mjs` keeps each source's
      sha512: mark the circuit out of date (Control panel, the Synthesize
      button), and an option to synthesize on save.
- [ ] Source → schematic: a click (or the cursor) in a source highlights the
      cells whose `source_positions` cover that line; today only the other
      way (`#marker` → `showmarker`).
- [ ] Export the waveforms as VCD (GTKWave, Surfer; to hand in, or to compare
      with iverilog/Verilator): `wave.rs` has every recorded change.
- [ ] Lua tests in VS Code's Test Explorer: `*_test.lua` scripts that
      `assert`, run headless with `hdlstudio lua`, pass/fail per script (or
      per named test). The same CLI grades a whole class's projects.
- [ ] Simulation tiers, picked per circuit view: the engine as now
      ("didactic": 4 states, per-cell delays, every net live) plus fast ones
      for big, interactive runs (a game on the LED matrix). Measured on
      carpincho-V (2026-11-06): the engine 35.5k cycles/s (`bench` on
      `carpinchoV/carpincho/demos/carpincho`), Verilator 5.042 ~3.8M cycles/s
      (`program_tb`, `--binary --timing -O3`, one thread; its SoC has no LED
      panel), ~100x.
      - Shape: a fast model behind the same `hdlstudio serve` protocol, so
        the view, the Control panel, Lua, monitors/alarms and the waveforms
        of watched signals keep working. `serve` drives a backend
        (inputs, outputs/nets, step to the next clock edge, run N cycles,
        memory read/write); the engine is one. The other: a Verilator model
        built into a shared library with a small generated C ABI (ports and
        public signals by name), loaded by `serve` (`libloading`). A
        separate C++ process would have to redo Lua, waves and monitors.
      - Tiers: "fast" = every net visible (Verilator `--public-flat-rw`, or
        yosys's CXXRTL on the synthesized netlist, whose nets are the
        schematic's), the schematic stays live; "very fast" = only the top's
        ports and watched signals, `--threads`, the schematic shows the I/O
        live and the rest when paused (or not at all).
      - Verilate the sources (best model) for "very fast": the I/O widgets
        map by port name. Mapping every schematic net needs the netlist
        (yosys `write_verilog`/CXXRTL after the same passes).
      - What a fast tier loses (to show in the view): x/z (2 states; an
        unreset register is 0 or random, `--x-initial`), per-cell delays
        (cycle-accurate only: glitches, zero-delay loops), limited inout;
        the time cursor unless replay uses Verilator's `--savable`
        save/restore; ticks only advance edge to edge (the timescale and
        the clocks' periods still say when).
      - Build: Verilator and a C++ compiler as optional dependencies, like
        yosys; seconds to minutes of C++, so cache the model per sources
        hash; switching tiers reloads the circuit (like Reset).
- [ ] Detachable waveforms: the monitor in its own VS Code panel, to put
      beside the circuit, in another editor group, or in a new window on a
      second monitor ("Move into New Window"). Docked in the circuit view
      stays the default; a toolbar button detaches it and closing the panel
      docks it back.
      - A `WebviewPanel` (an editor tab: it can go to another window) with
        its own bundle around `Monitor` (`waves.ts` already takes a root and
        hooks). A `WebviewView` in VS Code's bottom panel is the other option
        (like a terminal, following the active circuit view as the Control
        panel does), but it can't move to another window.
      - The host (`src/circuit_view.mjs`) relays between the two webviews
        and the engine: the engine's events (`tick`, wave windows, a fired
        monitor) go to both; the monitor's requests (`watch`, `wave`,
        `monitor`...) to the engine; its cursor to the circuit view (the
        `inspect` is the circuit view's, `#cursor`); run state, Space,
        follow, theme, timescale both ways; `viewstate` saves `view.waves`
        as now.
      - What lives in `main.ts` and the panel needs: `#resolve` (a saved
        signal by path, else by name: needs the circuit or a request to the
        circuit view), adding a wire's waveform from the schematic (its
        button), the pause dot (`#triggers`).
      - One panel per circuit view (titled with the document), closed with it.
- [ ] Keyboard → inputs: map keys to PushButtons/Buttons (held while the key
      is down), for playing anything on the circuit. Per project, saved in
      `view`.
- [ ] A framebuffer display: a `Memory` shown as an image (width, height,
      bits per pixel, palette), drawn on a canvas from the memory writes
      `update` already carries (carpinchoV's `vram`/`pixel` examples). The
      `LEDMatrix` is 1 bit per LED and SVG, too small and slow for a game.
      Doom itself also needs the hardware: RV32IM, megabytes of RAM and ~10+
      MIPS (carpincho-V is RV32I, microcoded, 4 KiB); a raycaster
      (Wolfenstein-style) on the matrix is a nearer first demo.
- [ ] Low priority (little gain for the work):
      - `LEDMatrix` interactive resize: its size is computed once from
        rows/cols. The schematic has no resize handles for cells at all; it
        would need one (and re-running the matrix's layout on resize).
      - `sim.registerdisplay` (custom number formats) in Lua: the formats live
        in the view, so it needs a protocol between the engine and the view.

## Improvements 🛠️
- [ ] Simulator speed: the `board` runs at ~39k clock cycles/s. The cost is
      spread over evaluating and propagating; the next steps are structural:
      fold the zero-delay bus cells (BusSlice/BusGroup, a third of all
      evaluations) into their readers, and a narrow-value fast path for nets
      of up to 64 bits.
- [ ] Converter quirks kept on purpose when it was ported (output identical
      to the previous converter's); fix each in its own commit:
      - a `$mem_v2` with 2+ read ports gets the read ports' init/arst/srst
        values in reverse port order (sliced from the MSB end);
      - a ROM (`$mem_v2` with no write ports) gets `transparent`/`collision`
        `true` on its read ports;
      - with several top-level modules the top is picked by name order.
- [ ] The schematic, what it doesn't do or does differently:
      - a moved cell's wires are routed around the cells near both ends
        (`route.ts`, within 200px; farther detours fall back to an L/Z through
        cells); other wires keep their route even if a moved cell now sits on
        it (a "tidy up" button would fix both);
      - no wire editing (on purpose: an edited netlist no longer matches the
        sources);
      - a number base picked on a NumEntry/NumDisplay is only saved with the
        next edit.
- [ ] The waveform monitor: its history is capped at 1M changes per signal
      (the oldest quarter goes), which a clock fills in seconds at flat-out
      speed; groups are one level deep, coloured per group (not per signal).
- [ ] The time cursor (`inspect`): a first jump back on a long flat-out run
      replays up to a checkpoint's spacing (~1 s of running at first, more
      once they're thinned); the stimulus log grows for the whole run.
- [ ] The README's screenshots other than the first show the pre-1.0 UI.
- [ ] Windows (subcircuits, FSMs, memories): collapse one to its title bar
      (double-click on it), a button to tile the open ones over the
      schematic's area.
- [ ] The webviews set no Content-Security-Policy. Nothing from the netlist
      reaches `innerHTML` today; a CSP (scripts and styles from the extension
      only) keeps it that way.
- [ ] `.hdls` files carry no format version: a `version` field, so a later
      change of the circuit JSON can be migrated on load.

## Known Bugs 🐛
None known.

## Release
- [ ] GitHub Releases: none exist (`gh release list` is empty); the tags
      `v0.5.0`, `v0.7.0` and `v1.0.1`…`v1.3.0` are on GitHub. `make release`
      could end with `gh release create v$(VERSION) $(VSIX) --notes …` (the
      CHANGELOG section).
- [ ] The Marketplace upload is by hand (`make release` publishes to Open VSX
      only). `vsce publish --packagePath $(VSIX)` with a PAT in the keyring (as
      `ovsx_pat` is) would automate it.
- [ ] Only `linux-x64` is built (`vsce package --target linux-x64`): the vsix
      ships the native engine, so arm64/macOS/Windows need it built there or
      cross-compiled, one vsix per target. `.vscodeignore` keeps only
      `target/release/hdlstudio`: a win32 vsix needs `hdlstudio.exe` too.
- [ ] No CI (there is no `.github/`). GitHub Actions: `cargo test`, clippy,
      `npm run lint` and `test:golden` (no yosys needed) on every push;
      `test:pipeline`/`test:schematic` with yosys + yosys-slang (OSS CAD Suite)
      and Playwright's Chromium. A matrix of runners (linux x64/arm64, macOS,
      Windows) building one vsix each is the way to the item above.
- [ ] `cargo clippy` isn't part of `npm run lint`.
- [ ] Local tags never pushed: `v0.2.0`, `v0.3.0`, `v0.4.0`, `v0.4.1`,
      `v0.6.1`. Push them or delete them.
