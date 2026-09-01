module register (
    input  logic        clk,
    input  logic        rst,    // sync, active-high
    output logic [31:0] rdata,
    input  logic [31:0] wdata,
    input  logic        we
);

    logic [31:0] data;

    assign rdata = data;

    always_ff @(posedge clk) begin
        if (rst) begin
            data <= 32'd0;
        end else if (we) begin
            data <= wdata;
        end
    end

endmodule
