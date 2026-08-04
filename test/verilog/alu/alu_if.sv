// ============================================================================
// Archivo: alu_if.sv
// Descripción: Interfaz SystemVerilog parametrizada para conectar la ALU
//              con la FSM / Controlador.
// ============================================================================

interface alu_if #(
    parameter int DATA_WIDTH = 32
);

    logic [DATA_WIDTH-1:0] operand_a;
    logic [DATA_WIDTH-1:0] operand_b;
    tp1_pkg::alu_op_e      opcode;
    logic [DATA_WIDTH-1:0] result;
    tp1_pkg::alu_flags_t   flags;

    // Modport para el bloque ALU
    modport alu (
        input  operand_a,
        input  operand_b,
        input  opcode,
        output result,
        output flags
    );

    // Modport para el Controlador / FSM
    modport controller (
        output operand_a,
        output operand_b,
        output opcode,
        input  result,
        input  flags
    );

endinterface
