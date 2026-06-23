/*

El circuito de abajo probará usar el módulo del ej 1 con diferentes inputs
y comprobará si el resultado es el esperado. Para usarlo, pueden correr "Run"
y esperar que la salida "ready" se ponga en 1, indicando que los tests terminaron
de correr. Una vez que pasa eso, hay dos resultados posibles:
1. all_tests_passed es 1, que quiere decir que todo está bien
2. all_tests_passed es 0, que indica que algún test falla. Las salidas a y b indican
   el valor de las entradas que hacen que el test falle.
   
Nota: al cargar este archivo de testbench, "Run" va a sintetizar este módulo en vez
del módulo ej01 que crearon antes. Para ver cómo se sintetizó ej01, pueden buscar el
componente en el circuito que dice "ej01" y hacer click en la lupa.

No hace falta que vean el código de ej01_tb ni lo modiquen, ya que
usa cosas que veremos más adelante.
*/
module ej01_tb(
  input logic clk, rst,
  output logic ready, all_tests_passed,
  output logic a, b);
  
  logic ok;
  logic [1:0] value;
  logic result;
  
  assign a = value[0];
  assign b = value[1];

  ej01 dut(a, b, result);
  
  assign ok = result == (~a | ~b);
  
  oracle_tb#(2) tb(clk, rst, ok, ready, all_tests_passed, value);
    
endmodule

