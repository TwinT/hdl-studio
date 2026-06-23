// Introducción a System Verilog para Sistemas Digitales
// Obs: Esto es un comentario de única línea

// Definamos nuestro primer módulo, con dos entradas (a y b) y una salida (c):
module ej01(
  input logic a,
  input logic b,
  output logic c);
  
  /* Vamos a usar assign para asignarle un valor a una ¿señal?.
  Podemos usar las siguientes operaciones de la lógica relacional:
  - ~a (NOT a)
  - a & b (AND)
  - a | b (OR)
  - a ^ b (XOR)
  Obs: esto es un comentario multilínea */
  
  assign c = (~a | ~b);
  
endmodule

/* Prueban clickar el botón "Run" para simular el circuito. Cambien los valores
de a y b, y observen como cambia c. ¿Cuántas compuertas lógicas usa el circuito
sintetizado?

Ejercicio: usen la ley de DeMorgan para reesecribir la expresión de c usando
solamente NOTs y ANDs. Vean el circuito sintetizado. ¿Cambió la cantidad de
compuertas lógicas?

Para probar que el cambio que hicieron en el ejercicio es equivalente a la
expresión original, carguen el circuito de testbench ej01_tb.sv que hace
una prueba exhaustiva de todas las entradas posibles del circuito.

*/
