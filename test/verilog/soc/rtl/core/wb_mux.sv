// Qué se escribe en rd según el opcode (el mux de writeback).
module wb_mux (
    input  logic [6:0]  opcode,
    input  logic [31:0] alu_result,
    input  logic [31:0] load_data,  // de load_unit
    input  logic [31:0] pc_val,     // ya es instr_pc + 4: dirección de retorno de jal/jalr
    input  logic [31:0] imm_u,
    output logic [31:0] rf_wdata
);

  localparam logic [6:0] OP_LOAD = 7'b0000011;
  localparam logic [6:0] OP_JAL  = 7'b1101111;
  localparam logic [6:0] OP_JALR = 7'b1100111;
  localparam logic [6:0] OP_LUI  = 7'b0110111;

  assign rf_wdata = (opcode == OP_LOAD)                      ? load_data :
                    (opcode == OP_JAL || opcode == OP_JALR)  ? pc_val :
                    (opcode == OP_LUI)                       ? imm_u : alu_result;

endmodule
