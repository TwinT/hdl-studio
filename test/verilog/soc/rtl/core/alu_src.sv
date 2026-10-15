// Operandos de la ALU según el opcode (el mux "ALUSrc").
module alu_src (
    input  logic [6:0]  opcode,
    input  logic [31:0] rs1_val,
    input  logic [31:0] rs2_val,
    input  logic [31:0] instr_pc,  // dirección de la instrucción actual
    input  logic [31:0] imm_i,
    input  logic [31:0] imm_s,
    input  logic [31:0] imm_b,
    input  logic [31:0] imm_u,
    input  logic [31:0] imm_j,
    output logic [31:0] a,
    output logic [31:0] b
);

  localparam logic [6:0] OP_RTYPE  = 7'b0110011;
  localparam logic [6:0] OP_STORE  = 7'b0100011;
  localparam logic [6:0] OP_BRANCH = 7'b1100011;
  localparam logic [6:0] OP_JAL    = 7'b1101111;
  localparam logic [6:0] OP_AUIPC  = 7'b0010111;

  // branch/jal/auipc son relativos al PC de la instrucción; el resto usa rs1
  assign a = (opcode == OP_BRANCH || opcode == OP_JAL || opcode == OP_AUIPC) ? instr_pc : rs1_val;

  // rs2 solo en R-type; si no, el inmediato del formato (I-type por defecto: op-imm, load, jalr)
  assign b = (opcode == OP_RTYPE)  ? rs2_val :
             (opcode == OP_STORE)  ? imm_s :
             (opcode == OP_BRANCH) ? imm_b :
             (opcode == OP_JAL)    ? imm_j :
             (opcode == OP_AUIPC)  ? imm_u : imm_i;

endmodule
