// Decodificador de direcciones: la dirección que el CPU latchea en mem_addr_ld elige a qué
// dispositivo le llegan mem_we y mem_oe. Fuera de todos los rangos no responde nadie: la
// escritura se pierde y en la lectura nadie maneja el bus.
//
//   RAM   0x0000_0000 .. RAM_BYTES-1
//   VRAM  VRAM_BASE   .. VRAM_BASE+VRAM_BYTES-1
module addr_decode #(
    parameter logic [31:0] RAM_BYTES  = 32'd4096,
    parameter logic [31:0] VRAM_BASE  = 32'h0001_0000,
    parameter logic [31:0] VRAM_BYTES = 32'd8
) (
    input  logic        clk,
    input  logic        rst,      // sinc, activo alto
    input  logic        addr_ld,  // mem_addr_ld: mismo flanco en que los dispositivos latchean
    input  logic [31:0] bus,
    input  logic        we,       // mem_we del control
    input  logic        oe,       // mem_oe del control
    output logic        ram_we,
    output logic        ram_oe,
    output logic        vram_we,
    output logic        vram_oe
);

    logic ram_hit, vram_hit;

    always_ff @(posedge clk) begin
        if (rst) begin
            ram_hit  <= 1'b0;
            vram_hit <= 1'b0;
        end else if (addr_ld) begin
            ram_hit  <= (bus < RAM_BYTES);
            vram_hit <= (bus >= VRAM_BASE) && (bus - VRAM_BASE < VRAM_BYTES);
        end
    end

    assign ram_we  = we & ram_hit;
    assign ram_oe  = oe & ram_hit;
    assign vram_we = we & vram_hit;
    assign vram_oe = oe & vram_hit;

endmodule
