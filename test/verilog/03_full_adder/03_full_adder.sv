/*

Full Adder (sumador completo de 1 bit)

Suma tres bits: dos operandos (a, b) y un acarreo de entrada (cin). Produce
un bit de suma (sum) y un acarreo de salida (cout).

  sum  = a XOR b XOR cin
  cout = 1 cuando al menos dos de las tres entradas valen 1

Encadenando N full adders (conectando cout -> cin) se arma un sumador de N
bits (ripple-carry adder).

*/
module full_adder(
  input  logic a,
  input  logic b,
  input  logic cin,
  output logic sum,
  output logic cout
);

  assign sum  = a ^ b ^ cin;
  assign cout = (a & b) | (cin & (a ^ b));

endmodule
