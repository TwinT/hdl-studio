/*

Contador de décadas (00 a 99) — ejemplo de instanciación de módulos

Hasta ahora cada ejemplo fue un único módulo. Acá vemos cómo un módulo puede
INSTANCIAR a otro, construyendo una jerarquía. El diseño se arma en dos partes:

  1. "decada": un contador que cuenta de 0 a 9 (una década) y, al llegar a 9,
     emite un pulso "carry" para avisarle al siguiente dígito que debe avanzar.

  2. "contador_decadas": el módulo TOP, que instancia DOS "decada":
       - "unidades", que cuenta siempre (en = 1)
       - "decenas",  que solo avanza cuando "unidades" desborda (en = carry)

El resultado es un contador 00, 01, ... , 09, 10, 11, ... , 99 y vuelve a 00.

Al sintetizar, "decada" aparece en el diagrama como un subcircuito (una caja
que se puede abrir). Para que esto funcione, la definición del submódulo debe
estar disponible: por eso ambos módulos viven en este mismo archivo.

*/

// Cuenta una década: 0..9 con habilitación y acarreo de salida.
module decada(
  input  logic       clk,
  input  logic       rst,
  input  logic       en,      // solo cuenta cuando en = 1
  output logic [3:0] count,   // valor actual, 0..9
  output logic       carry    // 1 cuando count == 9 y en = 1 (el próximo flanco envuelve)
);

  always_ff @(posedge clk)
    if (rst)
      count <= 4'd0;
    else if (en)
      count <= (count == 4'd9) ? 4'd0 : count + 4'd1;

  assign carry = en && (count == 4'd9);

endmodule


// Módulo top: encadena dos décadas para contar de 00 a 99.
module contador_decadas(
  input  logic       clk,
  input  logic       rst,
  output logic [3:0] unidades,
  output logic [3:0] decenas
);

  logic carry_u;

  decada u_unidades(
    .clk   (clk),
    .rst   (rst),
    .en    (1'b1),
    .count (unidades),
    .carry (carry_u)
  );

  decada u_decenas(
    .clk   (clk),
    .rst   (rst),
    .en    (carry_u),
    .count (decenas),
    .carry ()            // acarreo de las decenas: no se usa
  );

endmodule
