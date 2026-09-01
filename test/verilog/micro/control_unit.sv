module control_unit (
    input logic clk,
    input logic rst,  // sync, active-high

    input logic [6:0] opcode,       // from decoder; only consulted during MODE_MAP
    input logic       branch_taken, // from branch_unit; only consulted during MODE_COND

    output logic pc_ld,
    pc_inc,
    pc_oe,
    output logic mem_addr_ld,
    mem_we,
    mem_oe,
    output logic ir_ld,
    ir_oe,
    output logic rf_we,
    output logic alu_oe
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

    // Firmware word layout, MSB to LSB (16 bits, loaded from rtl/control_unit.hex,
    // one 4-hex-digit value per line, line N = rom[N]):
    //   alu_oe(1) pc_ld(1) pc_inc(1) pc_oe(1) mem_addr_ld(1) mem_we(1) mem_oe(1)
    //   ir_ld(1) ir_oe(1) rf_we(1) mode(2) next_addr(4)
    typedef struct packed {
        logic alu_oe;
        logic pc_ld, pc_inc, pc_oe;
        logic mem_addr_ld, mem_we, mem_oe;
        logic ir_ld, ir_oe;
        logic rf_we;
        logic [1:0] mode;  // MODE_SEQ / MODE_JMP / MODE_MAP / MODE_COND
        logic [AWIDTH-1:0] next_addr;  // only used when mode == MODE_JMP
    } microword_t;

    // Bare filename by default, so a tool that resolves $readmemh relative to the source
    // file (e.g. Icarus) finds rtl/control_unit.hex without help. Verilator only resolves
    // $readmemh relative to the invoking CWD (verified empirically, no source-relative
    // fallback) -- the Makefile overrides this macro with the prothean/-relative path it
    // actually needs via -D.
`ifndef CONTROL_UNIT_HEX
    `define CONTROL_UNIT_HEX "control_unit.hex"
`endif
    // rom is a plain logic array, not microword_t[...], and mw is rebuilt below field-by-field
    // because yosys's $readmemh frontend rejects a struct-packed array target ("non-memory 2nd
    // argument"). $bits(mw) (applied to the variable, declared first) sizes rom instead of
    // $bits(microword_t) (the type name) -- yosys rejects that form too.
    microword_t mw;
    logic [$bits(mw)-1:0] rom[0:DEPTH-1];
    initial $readmemh(`CONTROL_UNIT_HEX, rom);

    logic [AWIDTH-1:0] upc, next_upc;
    assign {mw.alu_oe, mw.pc_ld, mw.pc_inc, mw.pc_oe,
          mw.mem_addr_ld, mw.mem_we, mw.mem_oe,
          mw.ir_ld, mw.ir_oe,
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
                        // $fatal is simulation-only (not synthesizable); guarded by `VERILATOR (defined
                        // automatically by the tool, no extra flags) same as the bus-contention guard in
                        // datapath.sv.
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
    assign ir_oe       = mw.ir_oe;
    assign rf_we       = mw.rf_we;
    assign alu_oe      = mw.alu_oe;

endmodule
