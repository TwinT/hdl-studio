module load_unit (
    input  logic [31:0] mem_word,
    input  logic [1:0]  byte_offset,
    input  logic [2:0]  funct3,
    output logic [31:0] result
);

  logic [7:0]  byte_sel;
  logic [15:0] half_sel;

  // byte_offset*8 en aritmética de 2 bits trunca -- se ensancha el índice por eso
  assign byte_sel = mem_word[{byte_offset, 3'b000} +: 8];
  assign half_sel = mem_word[{byte_offset[1], 4'b0000} +: 16];

  always_comb begin
    case (funct3)
      3'h0: result = {{24{byte_sel[7]}}, byte_sel};   // lb
      3'h1: result = {{16{half_sel[15]}}, half_sel};  // lh
      3'h2: result = mem_word;                         // lw
      3'h4: result = {24'd0, byte_sel};                // lbu
      3'h5: result = {16'd0, half_sel};                // lhu
      default: result = mem_word;
    endcase
  end

endmodule
