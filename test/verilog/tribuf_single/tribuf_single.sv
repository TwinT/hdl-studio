// One tri-state buffer, one driver, no bus merge at all (no TriMerge
// device gets synthesized - `bus` has exactly one source). Isolates
// whether a bug needs a multi-driver bus to trigger, or shows up from a
// lone Tribuf already.
module tribuf_single(input oe, input [3:0] val, output [3:0] bus);
    assign bus = oe ? val : 4'bz;
endmodule
