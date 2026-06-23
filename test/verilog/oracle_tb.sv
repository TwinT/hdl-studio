module oracle_tb#(parameter n=4)(
  input logic clk, rst, result_ok,
  output logic ready, all_tests_passed,
  output logic [n-1:0] value
);
  
  logic tests_are_passing;
  
  assign all_tests_passed = ready ? tests_are_passing : bx;
  
  initial begin
    ready = 0;
    value = -1; // En el primer ciclo alto se incrementa y pasa a 0
    tests_are_passing = 1;
  end
  
  always_ff @(posedge clk) begin
    if (~ready) value <= value + 1;
  end
  
  always_ff @(negedge clk) begin
    if (~result_ok) begin
      ready <= 1;
      tests_are_passing <= 0;
    end else if (&value) begin
      ready <= 1;
    end
  end
  
endmodule
