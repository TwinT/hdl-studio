module branch_unit (
    input  logic [31:0] rs1,
    input  logic [31:0] rs2,
    input  logic [2:0]  funct3,
    output logic        taken
);

  always_comb begin
    case (funct3)
      3'h0: taken = (rs1 == rs2);                    // beq
      3'h1: taken = (rs1 != rs2);                    // bne
      3'h4: taken = ($signed(rs1) < $signed(rs2));   // blt
      3'h5: taken = ($signed(rs1) >= $signed(rs2));  // bge
      3'h6: taken = (rs1 < rs2);                     // bltu
      3'h7: taken = (rs1 >= rs2);                    // bgeu
      default: taken = 1'b0;
    endcase
  end

endmodule
