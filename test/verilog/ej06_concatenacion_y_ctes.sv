/* Más operaciones con vectores

Vamos a ver dos operaciones adicionales que podemos realizar con vectores:
1. Uso de constantes binarias
2. Concatenación de vectores

Como ejemplo, observemos el siguiente circuito, donde la salida "out" invierte
el orden de los bits, y la salida "cte" siempre produce un valor fijo.
*/
module ej06_demo(
  input logic [3:0] in,
  output logic [3:0] out,
  output logic [3:0] cte
);
  
  // La expresión n'bxxxx representa un vector de n bits, donde cada x puede ser
  // 1 o 0 según el valor deseado de cada bit.
  // Obs: al igual que en Python, podemos poner guiones bajos entre numerales para
  // facilitar la legibilidad del número (ej: 16'b0000_1100_1010_1111)
  assign cte = 4'b1010;
  
  // Podemos poner varios vectores entre llaves {} para representar un vector de
  // bits más grande, que concatena todos los vectores que le pasamos. En este caso,
  // concatenaremos 4 vectores de longitud 1 para formar un vector de longitud 4:
  assign out = {in[0], in[1], in[2], in[3]};
  
endmodule


/*

Ejercicio: implementen un circuito con entrada de 4 bits y salida de 8 bits que
cumpla los siguientes requisitos:
- Los 4 bits más a la derecha de la salida se toman de la entrada
- Cuando el bit más significativo de la entrada es 1 (es decir, in[3] == 1), los
  4 bits más a la izquierda de la salida son todos unos
- Cuando el bit más significativo de la entrada es 0, los 4 bits más a la izquierda
  son ceros
  
Más adelante en la materia veremos por qué esto se llama un circuito extensor de
signo y la importancia que tienen.
  
Ejemplo:
extensor(0011) = 0000 0011
extensor(1010) = 1111 1010

Una vez implementado el circuito, testear usando ej06_tb.sv.

module extensor(
  input logic [3:0] in,
  output logic [7:0] out
);
  
  // COMPLETAR
  
endmodule
*/


