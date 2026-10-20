// Puerto de salida: un registro de 32 bits que el CPU escribe con sw/sh/sb (byte_en, como la RAM)
// y puede releer con lw. val sale siempre hacia los pines (LEDs, displays...).
// Ocupa una sola dirección, así que no latchea nada en addr_ld.
module out_port (
    input  logic        clk,
    input  logic        rst,      // sinc, activo alto: val vuelve a 0
    input  logic        we,       // escribe el bus (enmascarado con byte_en) en val
    input  logic        oe,       // pone val en el bus
    inout  logic [31:0] bus,
    input  logic [3:0]  byte_en,  // cuales bytes del bus latchear cuando we=1
    output logic [31:0] val
);

    always_ff @(posedge clk) begin
        if (rst) val <= 32'd0;
        else if (we) begin
            if (byte_en[0]) val[7:0]   <= bus[7:0];
            if (byte_en[1]) val[15:8]  <= bus[15:8];
            if (byte_en[2]) val[23:16] <= bus[23:16];
            if (byte_en[3]) val[31:24] <= bus[31:24];
        end
    end

    assign bus = oe ? val : 32'bz;

endmodule
