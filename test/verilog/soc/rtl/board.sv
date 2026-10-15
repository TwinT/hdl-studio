// Top para HDL Studio: el carpincho caminando, en una matriz de 16 filas x 32 columnas.
module board (
    input  logic clk,
    input  logic rst,
    (* led_matrix_rows = 16, led_matrix_cols = 32 *)
    output logic [511:0] matrix
);

    logic [3:0]  row_idx;
    logic [31:0] col_data;
    logic        row_strobe;

    soc #(.ROWS(16), .COLS(32), .SCAN_DIV(1)) sys (.clk, .rst, .row_idx, .col_data, .row_strobe);

    led_panel #(.ROWS(16), .COLS(32)) panel (.clk, .rst, .row_idx, .col_data, .row_strobe, .matrix);

endmodule
