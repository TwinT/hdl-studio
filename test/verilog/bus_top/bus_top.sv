// Two drivers sharing one bus through their own tri-state output, each in
// its own module scope (drv_a/drv_b), wired together only at bus_top. This
// is the minimal repro for native Z/multi-driver-net support: yosys2digitaljs
// converts each `assign bus = oe ? val : 'z;` to a $tribuf device, and
// merges the two drivers of the shared `bus` net into a TriMerge device.
module drv_a(input oe, input [3:0] val, output [3:0] bus);
    assign bus = oe ? val : 4'bz;
endmodule

module drv_b(input oe, input [3:0] val, output [3:0] bus);
    assign bus = oe ? val : 4'bz;
endmodule

module bus_top(input oe_a, input [3:0] val_a, input oe_b, input [3:0] val_b, output [3:0] bus);
    drv_a a(.oe(oe_a), .val(val_a), .bus(bus));
    drv_b b(.oe(oe_b), .val(val_b), .bus(bus));
endmodule
