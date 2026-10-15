// Modelo del panel de LEDs, solo para simulación: en un tablero real estas señales son los pines
// del panel. Cada LED conserva su estado hasta que el escáner vuelve a pasar por su fila (la
// persistencia que en hardware pone el ojo). Existe porque el widget LEDMatrix de HDL Studio
// pide los ROWS*COLS bits juntos.
module led_panel #(
    parameter int ROWS = 8,
    parameter int COLS = 8
) (
    input  logic                    clk,
    input  logic                    rst,        // sinc, activo alto: apaga todo
    input  logic [$clog2(ROWS)-1:0] row_idx,
    input  logic [COLS-1:0]         col_data,
    input  logic                    row_strobe,
    output logic [ROWS*COLS-1:0]    matrix      // bit y*COLS + x
);

    always_ff @(posedge clk) begin
        if (rst) matrix <= '0;
        else if (row_strobe) matrix[row_idx*COLS+:COLS] <= col_data;
    end

endmodule
