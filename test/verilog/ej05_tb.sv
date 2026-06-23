/*

Este testbench prueba más casos que los anteriores, por lo tanto tarda más en terminar.

Sugerencia: es posible hacer que corra más rápido cambiando el valor de clk de 100 a 1.
Sin embargo, para que esto funcione también va a haber que tildar la opción:
"Zero combinational propagation delay" dentro de la pestaña de "Setup". De lo contrario,
el delay de propagación va a hacer que los tests fallen cuando los inputs cambian tan
rápidamente.

*/

module int_et05_tb(
  input logic clk, rst,
  input logic result,
  output logic ready, all_tests_passed,
  output logic [3:0] a, b);
  
  logic ok;
  assign ok = result == (a == b);
  
  oracle_tb#(8) tb(clk, rst, ok, ready, all_tests_passed, {a, b});
  
endmodule

module ej05_tb(
  input logic clk, rst,
  output logic ready, all_tests_passed,
  output logic [3:0] a, b);
  
  logic result;
  comparador comparador(a, b, result);
  
  int_et05_tb interno(clk, rst, result, ready, all_tests_passed, a, b);
  
endmodule


