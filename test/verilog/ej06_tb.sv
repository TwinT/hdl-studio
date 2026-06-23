module int_ej06_tb(
  input logic clk, rst,
  input logic [7:0] result,
  output logic ready, all_tests_passed,
  output logic [3:0] value);
  
  logic [7:0] extended;
  assign extended = 8'(signed'(value));  
  
  logic ok;
  assign ok = result == extended;
  
  oracle_tb#(4) tb(clk, rst, ok, ready, all_tests_passed, value);
  
endmodule

module ej06_tb(
  input logic clk, rst,
  output logic ready, all_tests_passed,
  output logic [3:0] value);
  
  logic [7:0] result;
  extensor extensor(value, result);
  
  int_ej06_tb interno(clk, rst, result, ready, all_tests_passed, value);
  
endmodule



