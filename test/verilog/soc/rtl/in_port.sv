// Puerto de entrada: una palabra de 32 bits que el CPU lee con lw. Los pines se muestrean en cada
// ciclo y al bus va ese registro, no el pin: una entrada nunca llega combinacionalmente al bus.
// Ocupa una sola dirección, así que no latchea nada en addr_ld; escribirlo no hace nada.
module in_port (
    input  logic        clk,
    input  logic        rst,   // sinc, activo alto
    input  logic        oe,    // pone el valor muestreado en el bus
    output logic [31:0] bus,
    input  logic [31:0] pins   // switches, pulsadores...
);

    logic [31:0] val;

    always_ff @(posedge clk) begin
        if (rst) val <= 32'd0;
        else     val <= pins;
    end

    assign bus = oe ? val : 32'bz;

endmodule
