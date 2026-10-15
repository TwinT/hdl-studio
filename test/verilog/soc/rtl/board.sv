// Top para HDL Studio: el Juego de la Vida en una matriz de 32x32.
module board (
    input  logic clk,
    input  logic rst,
    (* led_matrix_rows = 32, led_matrix_cols = 32 *)
    output logic [1023:0] matrix
);

    logic [4:0]  row_idx;
    logic [31:0] col_data;
    logic        row_strobe;

    soc #(.ROWS(32), .COLS(32), .SCAN_DIV(1)) sys (.clk, .rst, .row_idx, .col_data, .row_strobe);

    led_panel #(.ROWS(32), .COLS(32)) panel (.clk, .rst, .row_idx, .col_data, .row_strobe, .matrix);

endmodule
