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

    logic [31:0] rdata_reg[1:31];
    logic wen_reg[1:31];

    generate
        for (genvar i = 1; i < 32; i++) begin : gen_regs
            register register (
                .clk  (clk),
                .rst  (rst),
                .rdata(rdata_reg[i]),
                .wdata(wdata),
                .we   (wen_reg[i])
            );
        end
    endgenerate

    always_comb begin
        for (int unsigned i = 1; i < 32; i++) begin
            wen_reg[i] = (we && (waddr == i));
        end
    end

    assign rdata1 = (raddr1 == 5'd0) ? 32'd0 : rdata_reg[raddr1];
    assign rdata2 = (raddr2 == 5'd0) ? 32'd0 : rdata_reg[raddr2];
endmodule
