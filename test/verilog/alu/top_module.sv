// ============================================================================
// Archivo: top_module.sv
// Descripción: Módulo Top-Level estructural. Conecta la FSM de control, la ALU,
//              el Banco de Registros (regA/regB) y la interfaz alu_if con los
//              registros del camino de datos (datapath).
// ============================================================================

/* verilator lint_off IMPORTSTAR */
import tp1_pkg::*;

module top_module #(
    parameter int DATA_WIDTH = 32,
    parameter int ADDR_WIDTH = 5
)(
    input  logic                  clk,
    input  logic                  rst,
    input  logic                  start,
    input  logic [ADDR_WIDTH-1:0] rs1,
    input  logic [ADDR_WIDTH-1:0] rs2,
    input  logic [ADDR_WIDTH-1:0] rd,
    input  logic [2:0]            opcode,
    output logic                  ready,
    output logic                  done,
    output tp1_pkg::alu_flags_t   alu_flags
);

    // Registros del camino de datos (Datapath Registers)
    logic [ADDR_WIDTH-1:0] rs1_q;
    logic [ADDR_WIDTH-1:0] rs2_q;
    logic [ADDR_WIDTH-1:0] rd_q;
    tp1_pkg::alu_op_e      op_q;

    // Señales de control emitidas por la FSM
    logic capture_en;
    logic rf_we;

    // Señales internas para el Banco de Registros (regA y regB)
    logic [ADDR_WIDTH-1:0] regA_idx;
    logic [DATA_WIDTH-1:0] rf_rs1_data;
    logic [DATA_WIDTH-1:0] rf_rs2_data;

    // Cable interno para desacoplar el puerto de resultado de la interfaz ALU en Yosys
    logic [DATA_WIDTH-1:0] alu_result_wire;

    // 1. Instancia de la Unidad de Control (FSM)
    fsm u_fsm (
        .clk       (clk),
        .rst       (rst),
        .start     (start),
        .ready     (ready),
        .done      (done),
        .capture_en(capture_en),
        .rf_we     (rf_we)
    );

    // 2. Captura de datos en el Datapath al iniciar una transacción
    always_ff @(posedge clk or posedge rst) begin
        if (rst) begin
            rs1_q <= {ADDR_WIDTH{1'b0}};
            rs2_q <= {ADDR_WIDTH{1'b0}};
            rd_q  <= {ADDR_WIDTH{1'b0}};
            op_q  <= tp1_pkg::OP_ADD;
        end else if (capture_en) begin
            rs1_q <= rs1;
            rs2_q <= rs2;
            rd_q  <= rd;
            op_q  <= tp1_pkg::alu_op_e'(opcode);
        end
    end

    // 3. Instancia de la Interfaz de la ALU
    alu_if #(
        .DATA_WIDTH(DATA_WIDTH)
    ) alu_io ();

    // 4. Instancia de la ALU
    alu #(
        .DATA_WIDTH(DATA_WIDTH)
    ) u_alu (
        .alu_io(alu_io)
    );

    // Conexiones de la interfaz de la ALU a cables del top
    assign alu_io.operand_a = rf_rs1_data;
    assign alu_io.operand_b = rf_rs2_data;
    assign alu_io.opcode    = op_q;

    assign alu_result_wire  = alu_io.result;
    assign alu_flags        = alu_io.flags;

    // 5. Multiplexado del índice del Puerto A para el RF
    assign regA_idx = rf_we ? rd_q : rs1_q;

    // 6. Instancia del Banco de Registros
    reg_file #(
        .DATA_WIDTH(DATA_WIDTH),
        .ADDR_WIDTH(ADDR_WIDTH)
    ) u_reg_file (
        .clk      (clk),
        .rst      (rst),
        // Puerto A (Lectura RS1 / Escritura RD)
        .regA_idx (regA_idx),
        .regA_din (alu_result_wire),
        .regA_dout(rf_rs1_data),
        .regA_we  (rf_we),
        // Puerto B (Lectura RS2, escritura explícitamente desactivada)
        .regB_idx (rs2_q),
        .regB_din ({DATA_WIDTH{1'b0}}),
        .regB_dout(rf_rs2_data),
        .regB_we  (1'b0)
    );

endmodule
