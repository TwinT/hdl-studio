module int_et04_tb(
  input logic clk, rst,
  input logic [5:0] result,
  output logic ready, all_tests_passed,
  output logic [5:0] value);
  
  logic ok;
  assign ok = result == value << 1;
  
  oracle_tb#(6) tb(clk, rst, ok, ready, all_tests_passed, value);
  
endmodule

module ej04_tb(
  input logic clk, rst,
  output logic ready, all_tests_passed,
  output logic [5:0] value);
  
  logic [5:0] result;
  ej04 shifer(value, result);
  
  int_et03_tb interno(clk, rst, result, ready, all_tests_passed, value);
  
endmodule

