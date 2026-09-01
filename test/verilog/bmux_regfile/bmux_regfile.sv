// Minimal reproduction of the $bmux conversion path. q[] is populated by 4
// separate instances of bmux_regfile_cell (not a single memory-inferring
// write within one module) - the instance boundary keeps yosys from
// re-collecting q[] into a $mem_v2, so reading q[raddr] dynamically compiles
// to a $bmux cell (word-wide binary-select) instead. Only the read_slang
// frontend produces $bmux here - see the test that exercises this with
// useSlang:true.
module bmux_regfile_cell (
    input  logic       clk,
    input  logic       we,
    input  logic [7:0] wdata,
    output logic [7:0] q
);
    always_ff @(posedge clk)
        if (we) q <= wdata;
endmodule

module bmux_regfile (
    input  logic       clk,
    input  logic [1:0] raddr,
    input  logic [1:0] waddr,
    input  logic [7:0] wdata,
    input  logic       we,
    output logic [7:0] rdata
);

    logic [7:0] q [0:3];

    genvar i;
    generate
        for (i = 0; i < 4; i++) begin : g_regs
            bmux_regfile_cell u_cell (
                .clk  (clk),
                .we   (we && waddr == i[1:0]),
                .wdata(wdata),
                .q    (q[i])
            );
        end
    endgenerate

    assign rdata = q[raddr];

endmodule
