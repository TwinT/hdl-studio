/*

D Latch (cerrojo tipo D, sensible a nivel)

A diferencia del SR Latch, el D Latch tiene una sola entrada de dato (d) y
una de habilitación (en). Mientras en=1, la salida q sigue ("es transparente
a") la entrada d. Cuando en=0, q queda congelada con el último valor.

Es sensible a NIVEL: importa el valor de "en", no sus flancos. Esto lo
diferencia del flip-flop D, que captura solo en el flanco de clk.

El bloque always_latch le indica al sintetizador que esperamos inferir un
latch (y no un flip-flop ni lógica combinacional).

*/
module d_latch(
  input  logic d,
  input  logic en,
  output logic q
);

  always_latch
    if (en)
      q = d;

endmodule
