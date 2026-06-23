module ej02(
  input logic a, b, c, // Obs: esto es una forma más corta para definir los
                       // inputs (no requiere repetir "input logic" varias veces)
  output logic out);
  
  // La siguiente señal no es de entrada ni de salida, sino que es interna al
  // circuito. Su uso es muy útil para facilitar la legibilidad del código.
  logic a_and_b;
  
  // Una forma algo rebuscada de hacer un AND de tres entradas
  assign a_and_b = a & b;
  assign out = a_and_b & c;
  
endmodule

/*
Ejercicio: cambiar el comportamiento del módulo para que devuelva 1 sí y solo sí
exactamente una entrada es 1. Ejemplos:
ej02(0,0,0) = 0
ej02(0,1,0) = 1
ej02(0,1,1) = 0
sugerencia: utilizar suma de productos y señales internas.

Comprobar el resultado corriendo ej02_tb.sv
*/

