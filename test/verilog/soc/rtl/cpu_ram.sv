// La CPU con su RAM, sin la matriz de LEDs ni el panel: sirve para comprobar que
// control_unit.hex y memory.hex cargaron bien, sin el resto del soc de por medio.
//
// Es el soc.sv sin matrix_port: el addr_decode sigue ahí (los stores a la VRAM se pierden en
// vez de pisar el programa de la RAM) y el bus compartido sale como `bus_dbg`.
//
// Qué mirar: en cada fetch `bus_dbg` lleva primero la dirección (mem_addr_ld) y después la
// instrucción (mem_oe), empezando por
//   0x00000000 -> 0x00010437 -> 0x00000004 -> 0x40000493 -> 0x00000008 -> 0x50000913 ...
// que son las palabras de memory.hex. En los ciclos de dispatch/ejecución en que nadie maneja
// el bus flota (zzzz). Si memory.hex no cargó, la instrucción sale toda x; si control_unit.hex
// no cargó, mem_addr_ld/mem_oe nunca se activan.
module cpu_ram (
    input  logic        clk,
    input  logic        rst,          // sync, activo alto
    output logic [31:0] bus_dbg,      // el bus compartido, ya resuelto
    output logic        mem_addr_ld,  // el core pone una dirección en el bus (fetch / load / store)
    output logic        mem_we,       // store
    output logic        mem_oe        // load / fetch: la memoria maneja el bus
);

  localparam int RAM_DEPTH = 1024;  // palabras

  wire  [31:0] bus;
  logic [3:0]  byte_en;
  logic        ram_we, ram_oe;

  core core_i (.clk, .rst, .bus, .mem_addr_ld, .mem_we, .mem_oe, .byte_en);

  addr_decode #(.RAM_BYTES(RAM_DEPTH * 4), .VRAM_BYTES(32'd128))
      adec_i (.clk, .rst, .addr_ld(mem_addr_ld), .bus, .we(mem_we), .oe(mem_oe),
              .ram_we, .ram_oe, .vram_we(), .vram_oe());

  memory #(.DEPTH(RAM_DEPTH)) mem_i (.clk, .addr_ld(mem_addr_ld), .we(ram_we), .oe(ram_oe), .bus,
                                     .byte_en);

  assign bus_dbg = bus;

endmodule
