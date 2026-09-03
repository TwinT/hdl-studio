# Task List (TODO)

## Next Features 🚀
- [ ] Option for disabling labels on the circuit graphic view.
- [X] Native Z (high-impedance) support for shared tri-state buses — see
      `CLAUDE.md`'s "Patching digitaljs & friends" section.
- [X] Signal input widgets (Button/NumEntry): scroll wheel over the widget
      should increment/decrement its value.
- [ ] Investigate new visualization widgets — e.g. an LED matrix, an array
      of 7-segment displays.

## Improvements and Refactorization 🛠️
- [X] "Show HDL Studio Panel" button should not display when the file is not supported.
- [X] Tribuf/TriMerge symbols: replace with something more standard/nicer-looking.
- [X] Signal input widgets should start at 0, not x.

## Known Bugs 🐛
- [X] Lua scripts (digitaljs_lua) keep running after being stopped — no way
      to fully kill them. (Was the circuit simulation, not the script itself,
      staying on — stopping a script now also pauses the simulation.)