/*

RAM sincrónica (16 x 8 bits)

Memoria de lectura/escritura: 16 posiciones de 8 bits, direccionadas por
"addr" (4 bits).

- Escritura: en el flanco de clk, si we=1, se guarda din en mem[addr].
- Lectura:   en el flanco de clk, dout toma el valor de mem[addr] (lectura
             sincrónica, registrada: el dato aparece un ciclo después).

El sintetizador infiere un bloque de memoria a partir del arreglo "mem".

*/
module ram(
  input  logic       clk,
  input  logic       we,
  input  logic [3:0] addr,
  input  logic [7:0] din,
  output logic [7:0] dout
);

  logic [7:0] mem [0:15];

  always_ff @(posedge clk) begin
    if (we)
      mem[addr] <= din;
    dout <= mem[addr];
  end

endmodule
