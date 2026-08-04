// ============================================================================
// Archivo: alu.sv
// Descripción: Unidad Aritmético Lógica combinacional pura.
//              Recibe únicamente una instancia de alu_if con modport 'alu'.
// ============================================================================

/* verilator lint_off IMPORTSTAR */
import tp1_pkg::*;

module alu #(
    parameter int DATA_WIDTH = 32
)(
    alu_if.alu alu_io
);

    localparam int MSB = DATA_WIDTH - 1;

    // Esto es necesario debido a limitaciones de Yosys con interfaces y modports. Se crean señales locales para desacoplar la interfaz de la ALU y evitar errores de síntesis.
    logic [DATA_WIDTH-1:0] operand_a;
    logic [DATA_WIDTH-1:0] operand_b;
    logic [2:0]            opcode;
    logic [DATA_WIDTH:0]   ext_res;
    tp1_pkg::alu_flags_t   flags_d;

    assign operand_a    = alu_io.operand_a;
    assign operand_b    = alu_io.operand_b;
    assign opcode       = alu_io.opcode;
    assign alu_io.flags = flags_d;

    always_comb begin
        ext_res       = '0;
        alu_io.result = '0;
        flags_d       = '0;

        case (opcode)
            OP_ADD: begin
                ext_res       = {1'b0, operand_a} + {1'b0, operand_b};
                alu_io.result = ext_res[MSB:0];
                flags_d.z     = (alu_io.result == '0);
                flags_d.n     = alu_io.result[MSB];
                flags_d.c     = ext_res[DATA_WIDTH];
                flags_d.v     = (operand_a[MSB] == operand_b[MSB]) && 
                                (alu_io.result[MSB] != operand_a[MSB]);
            end

            OP_SUB: begin
                ext_res       = {1'b0, operand_a} - {1'b0, operand_b};
                alu_io.result = ext_res[MSB:0];
                flags_d.z     = (alu_io.result == '0);
                flags_d.n     = alu_io.result[MSB];
                flags_d.c     = ext_res[DATA_WIDTH];
                flags_d.v     = (operand_a[MSB] != operand_b[MSB]) && 
                                (alu_io.result[MSB] != operand_a[MSB]);
            end

            OP_AND: begin
                alu_io.result = operand_a & operand_b;
                flags_d.z     = (alu_io.result == '0);
                flags_d.n     = alu_io.result[MSB];
                flags_d.c     = 1'b0;
                flags_d.v     = 1'b0;
            end

            OP_OR: begin
                alu_io.result = operand_a | operand_b;
                flags_d.z     = (alu_io.result == '0);
                flags_d.n     = alu_io.result[MSB];
                flags_d.c     = 1'b0;
                flags_d.v     = 1'b0;
            end

            default: begin
                // Para opcode no soportado o inválido:
                // Resultado en todo 0s, únicamente flag N en 1 (Z=0, C=0, V=0).
                alu_io.result = '0;
                flags_d.z     = 1'b0;
                flags_d.n     = 1'b1;
                flags_d.c     = 1'b0;
                flags_d.v     = 1'b0;
            end
        endcase
    end

endmodule
