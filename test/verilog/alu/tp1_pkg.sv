// ============================================================================
// Archivo: tp1_pkg.sv
// Descripción: Paquete de definiciones globales para el TP1. Contiene el ancho
//              de datos, ancho de direcciones, tipos enumerados de la ALU
//              y la estructura de banderas (flags).
// ============================================================================

/* verilator lint_off VARHIDDEN */
package tp1_pkg;

    /* verilator lint_off UNUSEDPARAM */
    // Ancho de datos por defecto (32 bits)
    parameter int DATA_WIDTH = 32;

    // Ancho de direcciones del Register File (5 bits = 32 registros)
    parameter int ADDR_WIDTH = 5;
    /* verilator lint_on UNUSEDPARAM */

    // Operaciones soportadas por la ALU
    typedef enum logic [2:0] {
        OP_ADD = 3'b000,
        OP_SUB = 3'b001,
        OP_AND = 3'b010,
        OP_OR  = 3'b011
    } alu_op_e;

    // Estructura de flags de la ALU: z (zero), n (negative), c (carry), v (overflow)
    typedef struct packed {
        logic z;
        logic n;
        logic c;
        logic v;
    } alu_flags_t;

endpackage

/* verilator lint_off IMPORTSTAR */
import tp1_pkg::*;
