// Top para HDL Studio: una ruleta de 4 dígitos en displays de 7 segmentos.
//
// Cada byte del puerto de salida es un patrón {dp,a,b,c,d,e,f,g}: display7_0 es el dígito de la
// izquierda. pushbutton_frenar (un pulsador: HDL Studio lo reconoce por el prefijo) es el bit 0
// del puerto de entrada. La matriz no se usa.
module board (
    input  logic       clk,
    input  logic       rst,
    input  logic       pushbutton_frenar,
    output logic [7:0] display7_0,
    output logic [7:0] display7_1,
    output logic [7:0] display7_2,
    output logic [7:0] display7_3
);

    logic [31:0] port_out;

    soc sys (.clk, .rst, .row_idx(), .col_data(), .row_strobe(),
             .port_in({31'd0, pushbutton_frenar}), .port_out);

    assign display7_0 = port_out[7:0];
    assign display7_1 = port_out[15:8];
    assign display7_2 = port_out[23:16];
    assign display7_3 = port_out[31:24];

endmodule
