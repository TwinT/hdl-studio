module ej03_tb(
  input logic clk, rst,
  output logic ready, all_tests_passed,
  output logic a, b);
  
  logic result, exp, ok;
  
  negador_condicional dut(a, b, result);
  
  always_comb
    begin
      if (b) exp = ~a;
      else exp = a;
    end
  
  assign ok = result == exp;
  
  oracle_tb#(2) tb(clk, rst, ok, ready, all_tests_passed, {a, b});
    
endmodule



