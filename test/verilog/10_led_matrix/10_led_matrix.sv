/*

Matriz de LEDs NxM (por defecto 4x4) - punto que recorre

Cuenta de 0 a ROWS*COLS-1 y prende, en cada ciclo, un unico LED de la
matriz en la posicion correspondiente (codificacion one-hot de "pos").

Demuestra el widget LEDMatrix: yosys2digitaljs infiere ese widget para una
salida cuyo ancho es EXACTAMENTE filas*columnas y que lleva los atributos
led_matrix_rows/led_matrix_cols en el puerto (un ancho de bus solo no
alcanza para sacar dos dimensiones independientes: 16 bits podria ser
4x4, 2x8, etc). El tamano del widget se calcula una sola vez a partir de
filas/columnas: agregar mas LEDs aumenta la resolucion (LEDs mas chicos),
no el tamano del widget.

Mapeo bit -> LED: fila-mayor, bit 0 = arriba-izquierda, incrementando hacia
la derecha y despues hacia abajo (bit i -> fila i/COLS, columna i%COLS).

*/
module led_matrix_chase #(
    parameter int ROWS = 4,
    parameter int COLS = 4
) (
    input logic clk,
    input logic rst, (* led_matrix_rows = ROWS, led_matrix_cols = COLS *)
    output logic [ROWS*COLS-1:0] matrix
);

    localparam int BITS = ROWS * COLS;
    localparam int POSW = $clog2(BITS);
    localparam logic [BITS-1:0] ONE = {{(BITS - 1) {1'b0}}, 1'b1};

    logic [POSW-1:0] pos;

    always_ff @(posedge clk)
        if (rst) pos <= '0;
        else if (pos == BITS - 1) pos <= '0;
        else pos <= pos + 1'd1;

    assign matrix = ONE << pos;

endmodule
