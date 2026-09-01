module memory #(
    parameter int DEPTH = 16
) (
    input  logic        clk,
    input  logic        rst,      // sync, active-high
    input  logic        addr_ld,  // latch bus_in into mar
    input  logic        we,       // write wdata (byte_en-masked) into mem[mar]
    input  logic        oe,       // drive mem[mar] onto bus_out
    input  logic [31:0] bus_in,
    input  logic [31:0] wdata,    // dedicated write-data path (pre-positioned by store_unit)
    input  logic [3:0]  byte_en,  // which bytes of wdata to latch when we=1
    output logic [31:0] bus_out
);

    localparam int AWIDTH = $clog2(DEPTH);

    logic [31:0] mem [DEPTH];
    logic [31:0] mar;

    // Multi-cycle reset: a counter clears one word per cycle instead of the
    // whole array at once. A memory array can't express "clear every word
    // in one clock edge" as a single write port - a straight per-word reset
    // loop forces yosys to unroll DEPTH separate write ports into the
    // inferred $mem_v2 instead of 1 (confirmed: this is what was making
    // synthesis hang at DEPTH=1024). See register_file.sv for the same
    // problem at a smaller scale.
    logic resetting;
    logic [AWIDTH-1:0] reset_addr;

    always_ff @(posedge clk) begin
        if (rst) begin
            resetting  <= 1'b1;
            reset_addr <= '0;
            mar        <= 32'd0;
        end else if (resetting) begin
            mem[reset_addr] <= 32'd0;
            if (reset_addr == AWIDTH'(DEPTH - 1))
                resetting <= 1'b0;
            else
                reset_addr <= reset_addr + 1'b1;
        end else begin
            if (addr_ld) mar <= bus_in;
            if (we) begin
                if (byte_en[0]) mem[mar[AWIDTH+1:2]][7:0]   <= wdata[7:0];
                if (byte_en[1]) mem[mar[AWIDTH+1:2]][15:8]  <= wdata[15:8];
                if (byte_en[2]) mem[mar[AWIDTH+1:2]][23:16] <= wdata[23:16];
                if (byte_en[3]) mem[mar[AWIDTH+1:2]][31:24] <= wdata[31:24];
            end
        end
    end

    assign bus_out = oe ? mem[mar[AWIDTH+1:2]] : 32'bz;

endmodule
