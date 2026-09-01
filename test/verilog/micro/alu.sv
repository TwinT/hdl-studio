module alu (
    input  logic [31:0] a,
    input  logic [31:0] b,
    input  logic [6:0]  opcode,
    input  logic [2:0]  funct3,
    input  logic [6:0]  funct7,
    output logic [31:0] result
);

  localparam logic [6:0] OP_RTYPE = 7'b0110011;
  localparam logic [6:0] OP_IMM   = 7'b0010011;

  // funct3 is the primary selector, not {funct7, funct3}: I-type OP-IMM has no real funct7
  // field (those bits are top-of-immediate), except for slli/srli/srai where RV32I
  // constrains imm[11:5] to 0x00/0x20 exactly like R-type shifts. So funct7[5] is only
  // consulted where it's actually meaningful: add/sub (and only for R-type -- addi is
  // always add), and srl/sra (meaningful in both formats).
  //
  // This case only applies to R-type and I-type OP-IMM. Every other opcode (loads today,
  // stores/branches/jalr later) reuses funct3 for something that isn't an ALU op selector
  // (load width, branch condition, ...) and always wants a straight add for address/target
  // computation -- so the case is the exception, gated on opcode, not the default.
  always_comb begin
    if (opcode == OP_RTYPE || opcode == OP_IMM) begin
      case (funct3)
        3'h0: result = (opcode == OP_RTYPE && funct7[5]) ? (a - b) : (a + b);  // add / addi / sub
        3'h4: result = a ^ b;                                                  // xor / xori
        3'h6: result = a | b;                                                  // or / ori
        3'h7: result = a & b;                                                  // and / andi
        3'h1: result = a << b[4:0];                                            // sll / slli
        3'h5: result = funct7[5] ? unsigned'($signed(a) >>> b[4:0])            // sra / srai
                                  : (a >> b[4:0]);                             // srl / srli
        3'h2: result = {31'd0, $signed(a) < $signed(b)};                       // slt / slti
        3'h3: result = {31'd0, a < b};                                        // sltu / sltiu
        default: result = a + b;  // unrecognized encoding: harmless fallback --
                                   // the control unit's opcode dispatch is the
                                   // real gatekeeper, not this case
      endcase
    end else begin
      result = a + b;  // address/target computation
    end
  end

endmodule
