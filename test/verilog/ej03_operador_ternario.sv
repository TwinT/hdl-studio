// Vamos a aprender a usar el operador ternario de lógica, que tiene el formato:
// cond ? a : b
// El valor de la expresión anterior cuando cond es 1 será a, sino será b
// Como ejemplo, veamos cómo se implementa un multiplexor básico:
module multiplexor(input a, b, sel, output out);
  assign out = sel ? b : a; // sel=0 selecciona a. sel=1 selecciona b.
endmodule

/*
Ejercicio:

a) Implementar un negador condicional, que niega un bit de entrada
   si negar=1. Cuando negar=0, la salida es el bit de entrada sin modificar.
b) Observar el circuito sintetizado
c) Comprobar si el circuito es correcto usando ej03_tb.sv
d) Calcular la tabla de verdad del circuito
e) ¿Es posible simplificar el circuito, de forma que tenga menos compuertas?
   En caso de que lo sea, simplificarlo, observar el circuito sintetizado
   y volver a correr el testbench.
   
module negador_condicional(
  input bit_a_negar, negar,
  output out);
  
  // COMPLETAR
  assign out = 0;
  
endmodule
*/
