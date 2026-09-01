module store_unit (
    input  logic [31:0] rs2,
    input  logic [1:0]  byte_offset,
    input  logic [2:0]  funct3,
    output logic [31:0] wdata,
    output logic [3:0]  byte_en
);

  always_comb begin
    case (funct3)
      3'h0: begin  // sb
        wdata   = {24'd0, rs2[7:0]} << {byte_offset, 3'b000};  // widened index -- same
        byte_en = 4'b0001 << byte_offset;                       // fix as load_unit
      end
      3'h1: begin  // sh -- offset 0/1 goes to the low half, 2/3 to the high half
                   // (0-/2-aligned per RV32I; a misaligned sh writes whatever the offset
                   // selects, no check -- same stance as loads, but here a wrong guess
                   // corrupts memory instead of just misreading, so it's spelled out)
        wdata   = {16'd0, rs2[15:0]} << {byte_offset[1], 4'b0000};
        byte_en = byte_offset[1] ? 4'b1100 : 4'b0011;
      end
      default: begin  // sw
        wdata   = rs2;
        byte_en = 4'b1111;
      end
    endcase
  end

endmodule
