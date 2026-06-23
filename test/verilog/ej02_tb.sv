/*
Sugerencia: para que los tests se ejecuten más rápido, clickear en la entrada
"clk" y cambiar el valor de 100 a 10.
*/

module ej02_tb(
  input logic clk, rst,
  output logic ready, all_tests_passed,
  output logic a, b, c);
  
  logic ok, result, exp;
  logic [2:0] value;
  
  assign {a, b, c} = value;
  
  ej02 dut(a, b, c, result);
    
  always_comb
    begin
      case(value)
        3'b001: exp = 1;
        3'b010: exp = 1;
        3'b100: exp = 1;
        default: exp = 0;
      endcase
    end
  
  assign ok = exp == result;
  
  oracle_tb#(3) tb(clk, rst, ok, ready, all_tests_passed, value);
    
endmodule


