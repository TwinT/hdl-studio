module register_file (
    input  logic        clk,
    input  logic        rst,      // sync, active-high
    input  logic [4:0]  raddr1,
    input  logic [4:0]  raddr2,
    output logic [31:0] rdata1,
    output logic [31:0] rdata2,
    input  logic [4:0]  waddr,
    input  logic [31:0] wdata,
    input  logic        we
);

  logic [31:0] regs [1:31];

  assign rdata1 = (raddr1 == 5'd0) ? 32'd0 : regs[raddr1];
  assign rdata2 = (raddr2 == 5'd0) ? 32'd0 : regs[raddr2];

  // One always_ff per register (not a single loop over the array) so each
  // register is a real, individually-resettable flip-flop: a memory array
  // can't express "clear every word in one clock edge" as a single write
  // port, so yosys would otherwise unroll a reset loop into one write port
  // per register PLUS the real dynamic write, blowing up the inferred
  // memory's WR_PORTS/ABITS. Per-branch i is a compile-time constant, so
  // yosys synthesizes 31 plain $dff cells instead of one $mem_v2. The
  // waddr == i comparison (i always in 1..31) already never matches
  // waddr == 0, so no separate guard against writing register 0 is needed.
  genvar i;
  generate
    for (i = 1; i < 32; i++) begin : g_regs
      always_ff @(posedge clk) begin
        if (rst) regs[i] <= 32'd0;
        else if (we && waddr == i[4:0]) regs[i] <= wdata;
      end
    end
  endgenerate

endmodule
