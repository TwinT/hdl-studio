// ============================================================================
// Archivo: reg_file.sv
// Descripción: Banco de registros sincronizado por reloj con estructura estilo
//              Dual-Port Block RAM (Read-First) de 2 puertos genéricos (regA y regB).
//              Cada puerto comparte la dirección (idx) entre lectura y escritura.
//              El registro R0 se encuentra fijado a cero (hardwired to 0).
//              Reset activo en alto (rst).
// ============================================================================

/* verilator lint_off IMPORTSTAR */
import tp1_pkg::*;

module reg_file #(
    parameter int DATA_WIDTH = 32,
    parameter int ADDR_WIDTH = 5
)(
    input  logic                  clk,
    input  logic                  rst,
    // Puerto A (Read/Write con índice compartido regA_idx)
    input  logic [ADDR_WIDTH-1:0] regA_idx,
    input  logic [DATA_WIDTH-1:0] regA_din,
    output logic [DATA_WIDTH-1:0] regA_dout,
    input  logic                  regA_we,
    // Puerto B (Read/Write con índice compartido regB_idx)
    input  logic [ADDR_WIDTH-1:0] regB_idx,
    input  logic [DATA_WIDTH-1:0] regB_din,
    output logic [DATA_WIDTH-1:0] regB_dout,
    input  logic                  regB_we
);

    localparam int NUM_REGS = 1 << ADDR_WIDTH;

    // Arreglo de registros
    logic [DATA_WIDTH-1:0] rf [0:NUM_REGS-1];

    // Lectura sincrónica Read-First: se lee el contenido previo en regA_idx y regB_idx
    // antes de que cualquier escritura modifique la posición de memoria en el flanco.
    always_ff @(posedge clk or posedge rst) begin
        if (rst) begin
            regA_dout <= '0;
            regB_dout <= '0;
        end else begin
            regA_dout <= (regA_idx == '0) ? '0 : rf[regA_idx];
            regB_dout <= (regB_idx == '0) ? '0 : rf[regB_idx];
        end
    end

    // Escritura sincrónica en Puerto A y Puerto B (descarta escrituras en el registro 0)
    always_ff @(posedge clk) begin
        if (regA_we && (regA_idx != '0)) begin
            rf[regA_idx] <= regA_din;
        end
        if (regB_we && (regB_idx != '0)) begin
            rf[regB_idx] <= regB_din;
        end
    end

endmodule
