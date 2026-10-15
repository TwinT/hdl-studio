module ir (
    input logic        clk,
    input logic        rst,  // sinc, activo alto
    input logic        ld,   // load bus en val
    input logic [31:0] bus,  // solo input
    output logic [31:0] val
);

  always_ff @(posedge clk) begin
    if (rst) begin
      val <= 32'd0;
    end else if (ld) begin
      val <= bus;
    end
  end

endmodule
