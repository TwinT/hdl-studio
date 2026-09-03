/*

BCD a siete segmentos — instanciación del widget Display7

yosys2digitaljs infiere widgets de E/S por nombre y ancho del puerto del
módulo top (ver CLAUDE.md, "I/O widget inference"): una salida de
EXACTAMENTE 8 bits llamada "display7" (o que empiece con "display7_") se
renderiza como un display de siete segmentos en vez de un NumDisplay
genérico.

El cell Display7 de digitaljs NO decodifica BCD internamente: espera el
patrón de segmentos ya armado, un bit por segmento, bit 7 = punto decimal y
bits 6..0 = segmentos a,b,c,d,e,f,g (en ese orden, de más a menos
significativo). Por eso este módulo arma ese patrón a mano con un case.

Para dígitos inválidos (10 a 15) el display queda apagado.

*/
module bcd_to_7seg(
  input  logic [3:0] digit,
  output logic [7:0] display7
);

  // display7 = { dp, a, b, c, d, e, f, g }
  always_comb begin
    case (digit)
      4'd0: display7 = 8'b0_1111110;
      4'd1: display7 = 8'b0_0110000;
      4'd2: display7 = 8'b0_1101101;
      4'd3: display7 = 8'b0_1111001;
      4'd4: display7 = 8'b0_0110011;
      4'd5: display7 = 8'b0_1011011;
      4'd6: display7 = 8'b0_1011111;
      4'd7: display7 = 8'b0_1110000;
      4'd8: display7 = 8'b0_1111111;
      4'd9: display7 = 8'b0_1111011;
      default: display7 = 8'b0_0000000; // BCD invalido -> display apagado
    endcase
  end

endmodule
