# Task List (TODO)

Done items leave this list; git history keeps them.

## Next Features 🚀
- [ ] Option for disabling labels on the circuit view.
- [ ] `LEDMatrix` interactive resize: its size is computed once from rows/cols.
      The schematic has no resize handles for cells at all; it would need one
      (and re-running the matrix's layout on resize).
- [ ] A "tidy up" button that lays the circuit out again with ELK (moved
      cells and their wires included).
- [ ] `sim.registerdisplay` (custom number formats) in Lua: the formats live
      in the view, so it needs a protocol between the engine and the view.

## Improvements 🛠️
- [ ] Simulator speed: the `board` runs at ~39k clock cycles/s. The cost is
      spread over evaluating and propagating; the next steps are structural:
      fold the zero-delay bus cells (BusSlice/BusGroup, a third of all
      evaluations) into their readers, and a narrow-value fast path for nets
      of up to 64 bits.
- [ ] Converter quirks kept on purpose when it was ported (output identical
      to the previous converter's); fix each in its own commit:
      - gate-level `$_DFF_P_`/`$_DFFE_PP_` are "Invalid cell type" (the table
        lists `$_DFF_`/`$_DFFE_` twice and the async-reset entries win);
      - binary muxes never go sparse below 7 select bits (the
        `mapping.size < 2**(bits-1)` test compares with an object);
      - the sparse-mux pass checks `groups` on the OrReduce instead of its
        BusGroup, so that check always passes;
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
        next edit;
      - the paper is white in dark themes too.
- [ ] The waveform monitor: its history is capped at 1M changes per signal
      (the oldest quarter goes), which a clock fills in seconds at flat-out
      speed; watched signals survive a re-synthesis only if the same cell id
      and name still exist; dragging a waveform scrolls back and so stops
      following the simulation (a click follows again) — Marcos found that
      odd, to discuss; a light theme, or one following VS Code's, is a matter
      of the colours setting.
- [ ] The README's screenshots other than the first show the pre-1.0 UI.

## Known Bugs 🐛
- [ ] The techmap option fails on `soc`'s `board`: yosys leaves `$fa`/`$alu`
      cells the converter has no cell for ("Invalid cell type: $fa").
- [ ] If the engine process dies, the host starts a new one on the next
      request, but the view doesn't load the circuit into it again ("no
      circuit loaded" until the circuit is shown again).

## Release
- [ ] Publish 1.0.0 to the Marketplace (`vsce login TwinT`, then `vsce publish
      --packagePath <the linux-x64 vsix>`) and create the GitHub Release (`gh auth
      login`). The vsix is per platform (`vsce package --target linux-x64`; arm64
      needs the engine built there or cross-compiled). The `v0.6.1` tag was never
      pushed.
