// A memory indexed by a 32-bit signal (yosys keeps the index's width:
// ABITS=32) and a constant shifted by a 32-bit amount: the previous
// simulator asserted on both even for small values. Also exercises shift amounts past
// the output width (all-fill) and out-of-range addresses (x).
module wide_idx (
    input  logic        clk,
    input  logic [31:0] a,
    input  logic [7:0]  d,
    input  logic        we,
    output logic [7:0]  q,
    output logic [31:0] one_hot
);
    logic [7:0] mem [16];
    always_ff @(posedge clk) if (we) mem[a] <= d;
    assign q = mem[a];
    assign one_hot = 32'd1 << a;
endmodule
