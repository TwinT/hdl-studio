/*

Dado un vector a de n bits, podemos usar algunas operaciones lógicas aparte de
las que ya vimos:
- &a, que es equivalente a un AND de todos los bits, es decir,
  a[n-1] & a[n-2] & ... & a[0]
- |a, lo mismo pero haciendo un OR de todos los bits
- ^a para XORear todos los bits

Como ejemplo, veamos cómo hacer un comparador con 0 de 8 bits, que devuelve
1 solamente cuando la entrada es 00000000:
*/

module comparador0(
  input logic [7:0] in,
  output logic out);
  
  logic algun_bit_en_uno;
  
  assign algun_bit_en_uno = |in;
  assign out = ~algun_bit_en_uno; // Es cero cuando no hay ningún bit en uno
  
endmodule

/*
Ejercicio, hacer un comparador de dos valores de 4 bits, que devuelva 1 cuando
los dos valores tienen todos los bits iguales. Usar el código a continuación
y testear usando ej05_tb.sv:

module comparador(
  input logic [3:0] a, b,
  output logic out);
  
  // COMPLETAR
  
endmodule
*/

