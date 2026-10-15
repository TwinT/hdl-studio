module store_unit (
    input  logic [31:0] rs2,
    input  logic [1:0]  byte_offset,
    input  logic [2:0]  funct3,
    input  logic        oe,       // pone wdata en el bus
    output logic [31:0] bus,      // solo output
    output logic [3:0]  byte_en   // máscara de bytes para la memoria (línea dedicada)
);

  logic [31:0] wdata;

  always_comb begin
    case (funct3)
      3'h0: begin  // sb
        wdata   = {24'd0, rs2[7:0]} << {byte_offset, 3'b000};
        byte_en = 4'b0001 << byte_offset;
      end
      3'h1: begin  // sh -- offset 0/1 va a la mitad baja, 2/3 a la mitad alta
                   // un sh desalineado escribe a donde el offset le diga: 
                   // no se chequea, tampoco los loads
        wdata   = {16'd0, rs2[15:0]} << {byte_offset[1], 4'b0000};
        byte_en = byte_offset[1] ? 4'b1100 : 4'b0011;
      end
      default: begin  // sw
        wdata   = rs2;
        byte_en = 4'b1111;
      end
    endcase
  end

  assign bus = oe ? wdata : 32'bz;

endmodule
