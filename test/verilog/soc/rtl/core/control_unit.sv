module control_unit (
    input logic clk,
    input logic rst,  // sinc, activo alto

    input logic [6:0] opcode,       // del decoder; solo se usa en MODE_MAP
    input logic       branch_taken, // del branch_unit; solo se usa en MODE_COND

    output logic pc_ld,
    pc_inc,
    pc_oe,
    output logic mem_addr_ld,
    mem_we,
    mem_oe,
    output logic ir_ld,
    output logic rf_we,
    output logic alu_oe,
    output logic store_oe
);

    localparam int DEPTH = 16;
    localparam int AWIDTH = $clog2(DEPTH);

    localparam logic [1:0] MODE_SEQ = 2'b00, MODE_JMP = 2'b01, MODE_MAP = 2'b10, MODE_COND = 2'b11;

    localparam logic [AWIDTH-1:0]
      ADDR_FETCH_ADDR     = 4'd0,
      ADDR_FETCH_DATA     = 4'd1,
      ADDR_DISPATCH       = 4'd2,
      ADDR_EXEC_WRITEBACK = 4'd3,
      ADDR_EXEC_LOAD_ADDR = 4'd4,
      ADDR_EXEC_LOAD_DATA = 4'd5,
      ADDR_EXEC_STORE_ADDR    = 4'd6,
      ADDR_EXEC_STORE_WRITE   = 4'd7,
      ADDR_EXEC_BRANCH        = 4'd8,
      ADDR_EXEC_BRANCH_NOT_TAKEN = 4'd9,
      ADDR_EXEC_BRANCH_TAKEN     = 4'd10,
      ADDR_EXEC_JUMP             = 4'd11;

    // Microinstrucción, MSB a LSB. Tiene que coincidir con .signals en control_unit.uc.
    typedef struct packed {
        logic alu_oe, store_oe;
        logic pc_ld, pc_inc, pc_oe;
        logic mem_addr_ld, mem_we, mem_oe;
        logic ir_ld;
        logic rf_we;
        logic [1:0] mode;  // MODE_SEQ / MODE_JMP / MODE_MAP / MODE_COND
        logic [AWIDTH-1:0] next_addr;  // solo en MODE_JMP y MODE_COND
    } microword_t;

    // El Makefile lo redefine con -D (Verilator resuelve $readmemh contra el CWD).
`ifndef CONTROL_UNIT_HEX
    `define CONTROL_UNIT_HEX "control_unit.hex"
`endif
    // rom es logic plano, no microword_t[], porque yosys no acepta $readmemh sobre structs.
    microword_t mw;
    logic [$bits(mw)-1:0] rom[0:DEPTH-1];
    initial $readmemh(`CONTROL_UNIT_HEX, rom);

    logic [AWIDTH-1:0] upc, next_upc;
    assign {mw.alu_oe, mw.store_oe, mw.pc_ld, mw.pc_inc, mw.pc_oe,
          mw.mem_addr_ld, mw.mem_we, mw.mem_oe,
          mw.ir_ld,
          mw.rf_we,
          mw.mode,
          mw.next_addr} = rom[upc];

    always_comb begin
        case (mw.mode)
            MODE_SEQ:  next_upc = upc + 1'b1;
            MODE_JMP:  next_upc = mw.next_addr;
            MODE_COND: next_upc = branch_taken ? mw.next_addr : (upc + 1'b1);
            MODE_MAP: begin
                case (opcode)
                    7'b0110011:
                    next_upc = ADDR_EXEC_WRITEBACK; // R-type OP (add/sub/xor/or/and/sll/srl/sra/slt/sltu)
                    7'b0010011:
                    next_upc = ADDR_EXEC_WRITEBACK; // I-type OP-IMM (addi/xori/ori/andi/slli/srli/srai/slti/sltiu)
                    7'b0000011: next_upc = ADDR_EXEC_LOAD_ADDR;  // I-type load (lb/lh/lw/lbu/lhu)
                    7'b0100011: next_upc = ADDR_EXEC_STORE_ADDR;  // S-type store (sb/sh/sw)
                    7'b1100011:
                    next_upc = ADDR_EXEC_BRANCH;  // B-type branch (beq/bne/blt/bge/bltu/bgeu)
                    7'b1101111: next_upc = ADDR_EXEC_JUMP;  // J-type jal
                    7'b1100111: next_upc = ADDR_EXEC_JUMP;  // I-type jalr
                    7'b0110111: next_upc = ADDR_EXEC_WRITEBACK;  // U-type lui
                    7'b0010111: next_upc = ADDR_EXEC_WRITEBACK;  // U-type auipc
                    default: begin
                        next_upc = ADDR_FETCH_ADDR;
                        // opcode sin rutina
`ifdef VERILATOR
                        $fatal(1, "control_unit: no dispatch entry for opcode 0x%02h", opcode);
`endif
                    end
                endcase
            end
        endcase
    end

    always_ff @(posedge clk) begin
        if (rst) upc <= ADDR_FETCH_ADDR;
        else upc <= next_upc;
    end

    assign pc_ld       = mw.pc_ld;
    assign pc_inc      = mw.pc_inc;
    assign pc_oe       = mw.pc_oe;
    assign mem_addr_ld = mw.mem_addr_ld;
    assign mem_we      = mw.mem_we;
    assign mem_oe      = mw.mem_oe;
    assign ir_ld       = mw.ir_ld;
    assign rf_we       = mw.rf_we;
    assign alu_oe      = mw.alu_oe;
    assign store_oe    = mw.store_oe;

    // Guarda de contención: nunca dos oe a la vez (Verilator no modela Z).
    always_comb begin
        if ((pc_oe & mem_oe) | (pc_oe & alu_oe) | (pc_oe & store_oe) |
            (mem_oe & alu_oe) | (mem_oe & store_oe) | (alu_oe & store_oe)) begin
`ifdef VERILATOR
            $fatal(1, "control_unit: bus contention - multiple oe asserted (pc_oe=%b mem_oe=%b alu_oe=%b store_oe=%b)",
                   pc_oe, mem_oe, alu_oe, store_oe);
`endif
        end
    end

endmodule
