module ir (
    input  logic        clk,
    input  logic        rst,   // sync, active-high
    input  logic        ld,    // load bus_in
    input  logic        oe,    // drive val onto bus_out
    input  logic [31:0] bus_in,
    output logic [31:0] bus_out,
    output logic [31:0] val    // dedicated non-bus tap for decoder: bus_out is 'z
                                // whenever oe=0, but decoded fields must stay stable
                                // for the whole instruction, not just while oe=1
);

  always_ff @(posedge clk) begin
    if (rst) begin
      val <= 32'd0;
    end else if (ld) begin
      val <= bus_in;
    end
  end

  assign bus_out = oe ? val : 32'bz;

endmodule
