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

  always_ff @(posedge clk) begin
    if (rst) begin
      for (int i = 1; i < 32; i++) regs[i] <= 32'd0;
    end else if (we && waddr != 5'd0) begin
      regs[waddr] <= wdata;
    end
  end

endmodule
