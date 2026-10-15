/*

Contador de pulsaciones con pushbutton momentaneo

Demuestra el widget PushButton: HDL Studio infiere ese widget (en vez
del switch/toggle que usa por defecto cualquier entrada de 1 bit) para un
puerto que lleva el atributo (* momentary *). A diferencia del switch (click
para poner en alto, click de nuevo para poner en bajo), el pushbutton solo
esta en alto mientras se mantiene apretado el mouse, y vuelve a bajo al
soltarlo.

El circuito cuenta pulsaciones reales de "pushbutton" (no ciclos de clk con pushbutton en
alto): un sincronizador de 2 flip-flops (btn_sync, btn_prev) detecta el
flanco ascendente de btn y solo ahi incrementa "count", asi que mantener
apretado el boton varios ciclos de clk cuenta como una sola pulsacion.

*/
module pushbutton_counter (
    input  logic clk,
    input  logic rst,
    input logic pushbutton,
    output logic [3:0] count
);

    logic btn_sync, btn_prev;

    always_ff @(posedge clk)
        if (rst) begin
            btn_sync <= 1'b0;
            btn_prev <= 1'b0;
            count    <= 4'h0;
        end else begin
            btn_prev <= btn_sync;
            btn_sync <= pushbutton;
            if (btn_sync && !btn_prev)
                count <= count + 4'h1;
        end

endmodule
