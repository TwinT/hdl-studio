module pc (
    input  logic        clk,
    input  logic        rst,     // sync, active-high
    input  logic        ld,      // load bus_in
    input  logic        inc,     // val <= val + 4
    input  logic        oe,      // drive val onto bus_out
    input  logic [31:0] bus_in,
    output logic [31:0] bus_out,
    output logic [31:0] val    // dedicated non-bus tap, same pattern as ir.val
);

    always_ff @(posedge clk) begin
        if (rst) begin
            val <= 32'd0;
        end else if (ld) begin
            val <= bus_in;
        end else if (inc) begin
            val <= val + 32'd4;
        end
    end

    assign bus_out = oe ? val : 32'bZ;

endmodule
