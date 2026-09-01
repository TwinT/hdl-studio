module memory #(
    parameter int DEPTH = 16
) (
    input  logic        clk,
    input  logic        addr_ld,  // latch bus_in into mar
    input  logic        we,       // write wdata (byte_en-masked) into mem[mar]
    input  logic        oe,       // drive mem[mar] onto bus_out
    input  logic [31:0] bus_in,
    input  logic [31:0] wdata,    // dedicated write-data path (pre-positioned by store_unit)
    input  logic [3:0]  byte_en,  // which bytes of wdata to latch when we=1
    output logic [31:0] bus_out
);

    localparam int AWIDTH = $clog2(DEPTH);

    // Real memory doesn't reset - its contents come from loading a program.
    // Bare filename by default (see control_unit.sv's identical macro for why:
    // source-relative for Icarus, CWD-relative for Verilator, override via -D).
`ifndef MEMORY_HEX
    `define MEMORY_HEX "memory.hex"
`endif
    logic [31:0] mem [DEPTH];
    initial $readmemh(`MEMORY_HEX, mem);

    logic [31:0] mar;

    always_ff @(posedge clk) begin
        if (addr_ld) mar <= bus_in;
        if (we) begin
            if (byte_en[0]) mem[mar[AWIDTH+1:2]][7:0]   <= wdata[7:0];
            if (byte_en[1]) mem[mar[AWIDTH+1:2]][15:8]  <= wdata[15:8];
            if (byte_en[2]) mem[mar[AWIDTH+1:2]][23:16] <= wdata[23:16];
            if (byte_en[3]) mem[mar[AWIDTH+1:2]][31:24] <= wdata[31:24];
        end
    end

    assign bus_out = oe ? mem[mar[AWIDTH+1:2]] : 32'bz;

endmodule
