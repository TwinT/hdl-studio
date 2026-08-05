/*

LFSR (Linear Feedback Shift Register) de 8 bits

Es un registro de desplazamiento cuya entrada se calcula como el XOR de
algunos de sus bits (los "taps"). Genera una secuencia pseudoaleatoria que,
con los taps correctos, recorre los 255 estados no nulos antes de repetirse
(secuencia de longitud máxima).

Acá usamos el polinomio x^8 + x^6 + x^5 + x^4 + 1 => taps en los bits 7,5,4,3.
La semilla (valor inicial tras rst) debe ser distinta de cero: si el registro
llegara a todo ceros, quedaría atascado ahí para siempre.

*/
module lfsr(
  input  logic clk,
  input  logic rst,
  output logic [7:0] data
);

  logic feedback;
  assign feedback = data[7] ^ data[5] ^ data[4] ^ data[3];

  always_ff @(posedge clk)
    if (rst)
      data <= 8'h01;                  // semilla != 0
    else
      data <= {data[6:0], feedback};

endmodule
