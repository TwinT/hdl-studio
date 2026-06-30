/*

ROM (memoria de solo lectura, 16 x 8 bits)

A diferencia de la RAM, su contenido es fijo: se define en el diseño y no se
puede modificar en tiempo de ejecución. Dada una dirección "addr" (4 bits)
devuelve, de forma combinacional, el dato almacenado en esa posición.

Acá la inicializamos con los cuadrados de 0..15 a modo de ejemplo
(mem[i] = i*i, recortado a 8 bits).

*/
module rom(
  input  logic [3:0] addr,
  output logic [7:0] data
);

  logic [7:0] mem [0:15];

  initial begin
    mem[0]  = 8'd0;
    mem[1]  = 8'd1;
    mem[2]  = 8'd4;
    mem[3]  = 8'd9;
    mem[4]  = 8'd16;
    mem[5]  = 8'd25;
    mem[6]  = 8'd36;
    mem[7]  = 8'd49;
    mem[8]  = 8'd64;
    mem[9]  = 8'd81;
    mem[10] = 8'd100;
    mem[11] = 8'd121;
    mem[12] = 8'd144;
    mem[13] = 8'd169;
    mem[14] = 8'd196;
    mem[15] = 8'd225;
  end

  assign data = mem[addr];

endmodule
