`ifndef MEMORY_HEX
    `define MEMORY_HEX "memory.hex"
`endif
module memory #(
    parameter int    DEPTH     = 16,
    parameter string INIT_FILE = `MEMORY_HEX  // contenido inicial ($readmemh)
) (
    input  logic        clk,
    input  logic        addr_ld,  // latch bus en maddr
    input  logic        we,       // escribe el bus (enmascarado con byte_en) en mem[maddr]
    input  logic        oe,       // pone mem[maddr] en el bus
    inout  logic [31:0] bus,
    input  logic [3:0]  byte_en   // cuales bytes del bus latchear cuando we=1 (lo genera store_unit)
);

    localparam int AWIDTH = $clog2(DEPTH);

    logic [31:0] mem [DEPTH];
    initial $readmemh(INIT_FILE, mem);

    logic [31:0] maddr;

    always_ff @(posedge clk) begin
        if (addr_ld) maddr <= bus;
        if (we) begin
            if (byte_en[0]) mem[maddr[AWIDTH+1:2]][7:0]   <= bus[7:0];
            if (byte_en[1]) mem[maddr[AWIDTH+1:2]][15:8]  <= bus[15:8];
            if (byte_en[2]) mem[maddr[AWIDTH+1:2]][23:16] <= bus[23:16];
            if (byte_en[3]) mem[maddr[AWIDTH+1:2]][31:24] <= bus[31:24];
        end
    end

    assign bus = oe ? mem[maddr[AWIDTH+1:2]] : 32'bz;

endmodule
