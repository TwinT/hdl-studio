// Two tri-state drivers sharing one bus, all in a single module (no
// submodules/subcircuits, unlike bus_top). Isolates whether a bug needs
// cross-module hierarchy to trigger, or happens in the flat case too.
module tribuf_bus2(
    input oe_a, input [3:0] val_a,
    input oe_b, input [3:0] val_b,
    output [3:0] bus
);
    assign bus = oe_a ? val_a : 4'bz;
    assign bus = oe_b ? val_b : 4'bz;
endmodule
