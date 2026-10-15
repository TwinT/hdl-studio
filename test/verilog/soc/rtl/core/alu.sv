module alu (
    input  logic [31:0] a,
    input  logic [31:0] b,
    input  logic [6:0]  opcode,
    input  logic [2:0]  funct3,
    input  logic [6:0]  funct7,
    input  logic        oe,      // pone result en el bus
    output logic [31:0] bus,     // solo output
    output logic [31:0] result   // siempre válido, aunque oe=0
);

  localparam logic [6:0] OP_RTYPE = 7'b0110011;
  localparam logic [6:0] OP_IMM   = 7'b0010011;
  localparam logic [6:0] OP_JALR  = 7'b1100111;

  // funct3 es el selector primario. funct7 solo se consulta para add/sub y srl/sra, donde es significativo.
  // Este case aplica unicamente a OP_RTYPE y OP_IMM. El resto de los opcodes defaultean a un add para computar direcciones/targets.

  always_comb begin
    if (opcode == OP_RTYPE || opcode == OP_IMM) begin
      unique case (funct3)
        3'h0: result = (opcode == OP_RTYPE && funct7[5]) ? (a - b) : (a + b);  // add / addi / sub
        3'h4: result = a ^ b;                                                  // xor / xori
        3'h6: result = a | b;                                                  // or / ori
        3'h7: result = a & b;                                                  // and / andi
        3'h1: result = a << b[4:0];                                            // sll / slli
        3'h5: result = funct7[5] ? unsigned'($signed(a) >>> b[4:0])            // sra / srai
                                  : (a >> b[4:0]);                             // srl / srli
        3'h2: result = {31'd0, $signed(a) < $signed(b)};                       // slt / slti
        3'h3: result = {31'd0, a < b};                                        // sltu / sltiu
      endcase
    end else if (opcode == OP_JALR) begin
      result = (a + b) & ~32'd1;  // RV32I §2.5.1: el destino de jalr tiene el bit 0 en 0
    end else begin
      result = a + b;  // calculo de dirección/target
    end
  end

  assign bus = oe ? result : 32'bz;

endmodule
