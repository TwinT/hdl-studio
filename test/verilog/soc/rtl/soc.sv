// Sistema: la CPU (core) con su RAM y la matriz de LEDs, unidos por el bus. Solo interconexión.
module soc #(
    parameter int ROWS     = 8,  // matriz de LEDs (ver matrix_port)
    parameter int COLS     = 8,
    parameter int SCAN_DIV = 1
) (
    input  logic                    clk,
    input  logic                    rst,        // sync, activo alto
    output logic [$clog2(ROWS)-1:0] row_idx,    // escáner de la matriz: fila, sus columnas y strobe
    output logic [COLS-1:0]         col_data,
    output logic                    row_strobe
);

  localparam int RAM_DEPTH  = 1024;                 // palabras
  localparam int VRAM_WORDS = ROWS * COLS / 32;
  localparam logic [31:0] VRAM_BASE = 32'h0001_0000;

  wire  [31:0] bus;   // bus compartido: lo manejan el core, memory y matrix_port

  // las señales con las que el core maneja la memoria
  logic        mem_addr_ld, mem_we, mem_oe;
  logic [3:0]  byte_en;

  // mem_we/mem_oe, ya repartidos por la dirección: a la RAM o a la VRAM
  logic ram_we, ram_oe, vram_we, vram_oe;

  core core_i (.clk, .rst, .bus, .mem_addr_ld, .mem_we, .mem_oe, .byte_en);

  addr_decode #(.RAM_BYTES(RAM_DEPTH * 4), .VRAM_BASE(VRAM_BASE), .VRAM_BYTES(VRAM_WORDS * 4))
      adec_i (.clk, .rst, .addr_ld(mem_addr_ld), .bus, .we(mem_we), .oe(mem_oe),
              .ram_we, .ram_oe, .vram_we, .vram_oe);

  memory #(.DEPTH(RAM_DEPTH)) mem_i (.clk, .addr_ld(mem_addr_ld), .we(ram_we), .oe(ram_oe), .bus,
                                     .byte_en);

  matrix_port #(.ROWS(ROWS), .COLS(COLS), .SCAN_DIV(SCAN_DIV))
      mx_i (.clk, .rst, .addr_ld(mem_addr_ld), .we(vram_we), .oe(vram_oe), .bus,
            .byte_en, .row_idx, .col_data, .row_strobe);

endmodule
