// Three tri-state drivers sharing one bus, single module. Exercises
// TriMerge with inputs > 2 - a shape nothing (real or synthetic) has
// tested before this fixture.
module tribuf_bus3(
    input oe_a, input [3:0] val_a,
    input oe_b, input [3:0] val_b,
    input oe_c, input [3:0] val_c,
    output [3:0] bus
);
    assign bus = oe_a ? val_a : 4'bz;
    assign bus = oe_b ? val_b : 4'bz;
    assign bus = oe_c ? val_c : 4'bz;
endmodule
