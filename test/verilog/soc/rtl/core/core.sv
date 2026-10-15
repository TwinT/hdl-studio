// La CPU: solo interconexión; toda la lógica vive en los módulos instanciados. No incluye la
// memoria: su único contacto con el mundo es el bus compartido y las señales con que lo maneja
// (soc.sv le conecta la RAM y la matriz de LEDs).
module core (
    input  logic        clk,
    input  logic        rst,          // sync, activo alto; compartido por pc/ir/register_file/control_unit
    inout  logic [31:0] bus,          // bus compartido: pc, alu, store_unit y los dispositivos de afuera lo manejan; ir y load_unit lo leen
    output logic        mem_addr_ld,  // los dispositivos latchean el bus como dirección
    output logic        mem_we,       // escribe el bus en el dispositivo direccionado (store)
    output logic        mem_oe,       // el dispositivo direccionado maneja el bus (fetch, load)
    output logic [3:0]  byte_en       // qué bytes de la palabra escribe un store
);

  logic [31:0] ir_val, pc_val, instr_pc;
  logic [6:0]  opcode, funct7;
  logic [4:0]  rd, rs1, rs2;
  logic [2:0]  funct3;
  logic [31:0] imm_i, imm_s, imm_b, imm_u, imm_j;
  logic [31:0] rf_rdata1, rf_rdata2, rf_wdata;
  logic [31:0] alu_a, alu_b, alu_result, load_data;
  logic        branch_taken;

  // Las 10 señales de control, generadas por la unidad de control microprogramada. mem_addr_ld,
  // mem_we y mem_oe salen del core como puertos; las otras 7 son internas.
  logic pc_ld;       // carga el valor del bus en el PC
  logic pc_inc;      // incrementa el PC en 4
  logic pc_oe;       // el PC maneja el bus
  logic ir_ld;       // carga el valor del bus en el IR
  logic rf_we;       // escribe en el register file
  logic alu_oe;      // la ALU maneja el bus
  logic store_oe;    // store_unit maneja el bus (dato de un store)

  control_unit cu_i (
      .clk, .rst,
      .opcode,        // del decoder, selecciona la rutina de ejecución
      .branch_taken,  // del branch_unit, resuelve MODE_COND
      .pc_ld, .pc_inc, .pc_oe, .mem_addr_ld, .mem_we, .mem_oe, .ir_ld, .rf_we, .alu_oe, .store_oe);

  // --- dispositivos del bus (la memoria y la matriz están afuera, en soc.sv) ---
  pc pc_i (.clk, .rst, .ld(pc_ld), .inc(pc_inc), .oe(pc_oe), .bus, .val(pc_val), .instr_pc);

  ir ir_i (.clk, .rst, .ld(ir_ld), .bus, .val(ir_val));

  // --- decodificación y registros ---
  decoder dec_i (.instr(ir_val), .opcode, .rd, .funct3, .rs1, .rs2, .funct7,
                 .imm_i, .imm_s, .imm_b, .imm_u, .imm_j);

  register_file rf_i (.clk, .rst, .raddr1(rs1), .raddr2(rs2), .rdata1(rf_rdata1),
                      .rdata2(rf_rdata2), .waddr(rd), .wdata(rf_wdata), .we(rf_we));

  // --- ejecución ---
  alu_src src_i (.opcode, .rs1_val(rf_rdata1), .rs2_val(rf_rdata2), .instr_pc,
                 .imm_i, .imm_s, .imm_b, .imm_u, .imm_j, .a(alu_a), .b(alu_b));

  alu alu_i (.a(alu_a), .b(alu_b), .opcode, .funct3, .funct7, .oe(alu_oe), .bus,
             .result(alu_result));

  branch_unit bu_i (.rs1(rf_rdata1), .rs2(rf_rdata2), .funct3, .taken(branch_taken));

  // alu_result[1:0] sigue siendo el offset de rs1+imm en el ciclo de datos del load/store
  load_unit lu_i (.mem_word(bus), .byte_offset(alu_result[1:0]), .funct3, .result(load_data));

  store_unit su_i (.rs2(rf_rdata2), .byte_offset(alu_result[1:0]), .funct3, .oe(store_oe), .bus,
                   .byte_en);

  wb_mux wb_i (.opcode, .alu_result, .load_data, .pc_val, .imm_u, .rf_wdata);

endmodule
