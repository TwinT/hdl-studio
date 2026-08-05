/*

SR Latch (cerrojo Set-Reset)

Es el elemento de memoria más básico: guarda un bit. Se construye con dos
compuertas NOR cruzadas, donde la salida de cada una realimenta la entrada
de la otra. Esa realimentación es lo que le da la capacidad de "recordar".

- S=1, R=0 => Set:   q=1
- S=0, R=1 => Reset: q=0
- S=0, R=0 => Hold:  mantiene el último valor
- S=1, R=1 => estado prohibido (q y q_n quedan ambos en 0)

q_n es la salida complementaria (normalmente el inverso de q).

*/
module sr_latch(
  input  logic s,
  input  logic r,
  output logic q,
  output logic q_n
);

  assign q   = ~(r | q_n);
  assign q_n = ~(s | q);

endmodule
