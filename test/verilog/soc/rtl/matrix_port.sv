// Puerto de matriz de LEDs: una VRAM que el CPU escribe como cualquier memoria y un escáner que
// la recorre fila a fila. Hacia el panel no hay un cable por LED: salen la fila, sus columnas y
// un strobe
//
// Formato: 1 bit por píxel, fila-mayor, LSB primero. El píxel (x, y) es el bit i = y*COLS + x,
// o sea la palabra i/32, bit i%32.
//
// El escáner da un paso cada SCAN_DIV ciclos: una palabra por paso si COLS >= 32 (arma la fila
// con COLS/32 pasos), una fila por paso si COLS < 32. Un cuadro tarda max(ROWS, WORDS)*SCAN_DIV.
module matrix_port #(
    parameter int ROWS     = 8,  // potencia de 2
    parameter int COLS     = 8,  // potencia de 2, y ROWS*COLS >= 64
    parameter int SCAN_DIV = 1   // ciclos de reloj por paso del escáner
) (
    input  logic                    clk,
    input  logic                    rst,        // sinc, activo alto: reinicia el escáner, no la VRAM
    input  logic                    addr_ld,    // latch bus en el índice de palabra
    input  logic                    we,         // escribe el bus (enmascarado con byte_en) en la VRAM
    input  logic                    oe,         // pone la palabra en el bus
    inout  logic [31:0]             bus,
    input  logic [3:0]              byte_en,    // cuales bytes del bus latchear cuando we=1
    output logic [$clog2(ROWS)-1:0] row_idx,    // fila que se presenta
    output logic [COLS-1:0]         col_data,   // sus píxeles
    output logic                    row_strobe  // 1 en el ciclo en que row_idx/col_data son válidos
);

    localparam int WORDS = ROWS * COLS / 32;
    localparam int AW    = $clog2(WORDS);
    localparam int RW    = $clog2(ROWS);

`ifdef VERILATOR
    initial begin
        if ((ROWS & (ROWS - 1)) != 0 || (COLS & (COLS - 1)) != 0 || COLS < 2 || ROWS * COLS < 64) begin
            $fatal(1, "matrix_port: ROWS y COLS tienen que ser potencias de 2 y ROWS*COLS >= 64");
        end
    end
`endif

    // --- VRAM y puerto del CPU: igual que memory ---
    logic [31:0] vram [WORDS];
    initial for (int i = 0; i < WORDS; i++) vram[i] = 32'd0;

    logic [AW-1:0] idx;

    always_ff @(posedge clk) begin
        if (addr_ld) idx <= bus[AW+1:2];
        if (we) begin
            if (byte_en[0]) vram[idx][7:0]   <= bus[7:0];
            if (byte_en[1]) vram[idx][15:8]  <= bus[15:8];
            if (byte_en[2]) vram[idx][23:16] <= bus[23:16];
            if (byte_en[3]) vram[idx][31:24] <= bus[31:24];
        end
    end

    assign bus = oe ? vram[idx] : 32'bz;

    // --- escáner: un paso cada SCAN_DIV ciclos ---
    logic step;

    if (SCAN_DIV == 1) begin : g_nodiv
        assign step = 1'b1;
    end else begin : g_div
        logic [$clog2(SCAN_DIV)-1:0] div;
        always_ff @(posedge clk) begin
            if (rst || div == SCAN_DIV - 1) div <= '0;
            else div <= div + 1'b1;
        end
        assign step = (div == SCAN_DIV - 1);
    end

    logic [31:0] word;  // la palabra que el escáner lee en este paso

    if (COLS >= 32) begin : g_wide
        localparam int KW = $clog2(COLS / 32);  // bits de "palabra dentro de la fila"
        logic [AW-1:0] wcnt;                    // {fila, palabra dentro de la fila}

        always_ff @(posedge clk) begin
            if (rst) wcnt <= '0;
            else if (step) wcnt <= wcnt + 1'b1;
        end

        assign word    = vram[wcnt];
        assign row_idx = wcnt[AW-1 -: RW];

        if (COLS == 32) begin : g_one
            assign col_data   = word;
            assign row_strobe = step;
        end else begin : g_many
            logic [COLS-1:0] acc;  // la fila, armada de a una palabra (la última entra por arriba)
            always_ff @(posedge clk) begin
                if (rst) acc <= '0;
                else if (step) acc <= {word, acc[COLS-1:32]};
            end
            assign col_data   = {word, acc[COLS-1:32]};
            assign row_strobe = step & (&wcnt[KW-1:0]);
        end
    end else begin : g_narrow
        localparam int LC  = $clog2(COLS);  // bits de columna
        localparam int LPW = 5 - LC;        // log2(filas por palabra)
        logic [RW-1:0] rcnt;

        always_ff @(posedge clk) begin
            if (rst) rcnt <= '0;
            else if (step) rcnt <= rcnt + 1'b1;
        end

        // {rcnt[LPW-1:0], LC'b0} es 5 bits: se concatena para que no se trunque el desplazamiento
        logic [31:0] shifted;
        assign word       = vram[rcnt[RW-1:LPW]];
        assign shifted    = word >> {rcnt[LPW-1:0], {LC{1'b0}}};
        assign col_data   = shifted[COLS-1:0];
        assign row_idx    = rcnt;
        assign row_strobe = step;
    end

endmodule
