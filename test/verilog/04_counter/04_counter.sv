/*

Contador de 0 a F (4 bits)

Incrementa en uno su salida en cada flanco ascendente de clk. Al ser de 4
bits, cuenta 0, 1, 2, ... , E, F y vuelve a 0 (la cuenta "envuelve" sola al
desbordar). La señal rst, sincrónica, fuerza la cuenta a 0.

El bloque always_ff @(posedge clk) le indica al sintetizador que cada bit de
"count" debe implementarse con un flip-flop disparado por flanco.

*/
module counter(
  input  logic clk,
  input  logic rst,
  output logic [3:0] count
);

  always_ff @(posedge clk)
    if (rst)
      count <= 4'h0;
    else
      count <= count + 4'h1;

endmodule
