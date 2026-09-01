module datapath (
    input logic clk,
    input logic rst   // sync, active-high; shared by pc/memory/ir/register_file/control_unit
);

  localparam logic [6:0] OP_RTYPE  = 7'b0110011;
  localparam logic [6:0] OP_LOAD   = 7'b0000011;
  localparam logic [6:0] OP_STORE  = 7'b0100011;
  localparam logic [6:0] OP_BRANCH = 7'b1100011;
  localparam logic [6:0] OP_JAL    = 7'b1101111;
  localparam logic [6:0] OP_JALR   = 7'b1100111;
  localparam logic [6:0] OP_LUI    = 7'b0110111;
  localparam logic [6:0] OP_AUIPC  = 7'b0010111;

  wire [31:0] bus, ir_val;
  logic [6:0] opcode, funct7;
  logic [4:0] rd, rs1, rs2;
  logic [2:0] funct3;
  logic [31:0] imm_i, imm_s, imm_b, imm_u, imm_j;
  logic [31:0] rf_rdata1, rf_rdata2, alu_result, alu_a, alu_b, alu_bus_val, load_data, rf_wdata;
  logic [31:0] store_wdata, pc_val;
  logic [3:0]  store_byte_en;
  logic        branch_taken;

  // the 10 datapath control signals: driven by the microprogrammed control unit, one
  // microinstruction per cycle, instead of by a testbench by hand
  logic pc_ld, pc_inc, pc_oe;
  logic mem_addr_ld, mem_we, mem_oe;
  logic ir_ld, ir_oe;
  logic rf_we;
  logic alu_oe;

  // opcode (from the decoder, valid one cycle after ir_ld) picks the execute routine;
  // branch_taken (from branch_unit) resolves MODE_COND. Both are combinational, and both
  // are meaningless outside the one microinstruction that consults them.
  control_unit cu_i (.clk, .rst, .opcode, .branch_taken,
                     .pc_ld, .pc_inc, .pc_oe, .mem_addr_ld, .mem_we, .mem_oe,
                     .ir_ld, .ir_oe, .rf_we, .alu_oe);

  pc pc_i (.clk, .rst, .ld(pc_ld), .inc(pc_inc), .oe(pc_oe), .bus_in(bus), .bus_out(bus), .val(pc_val));
  memory #(.DEPTH(1024)) mem_i (.clk, .addr_ld(mem_addr_ld), .we(mem_we), .oe(mem_oe), .bus_in(bus),
                .wdata(store_wdata), .byte_en(store_byte_en), .bus_out(bus));
  ir ir_i (.clk, .rst, .ld(ir_ld), .oe(ir_oe), .bus_in(bus), .bus_out(bus), .val(ir_val));

  // address of the instruction currently executing: PC as it stood at fetch, before pc_inc
  // advanced it. Captured on ir_ld so the snapshot and the instruction it belongs to are
  // always latched together (same edge, both read pc_val's pre-edge value -- no race). RV32I
  // branch targets are relative to the branch's own address, not PC+4 -- see the alu_a mux.
  logic [31:0] instr_pc;
  always_ff @(posedge clk) begin
    if (rst)        instr_pc <= 32'd0;
    else if (ir_ld) instr_pc <= pc_val;
  end

  // jalr forces the target's least-significant bit to 0 (RV32I S2.5.1) -- no other
  // bus-driven address in this project gets truncated like this (a store to an odd offset
  // is perfectly legal), so this stays a named, opcode-gated signal rather than living
  // inside the bus driver itself, which should only answer "who's talking."
  assign alu_bus_val = (opcode == OP_JALR) ? {alu_result[31:1], 1'b0} : alu_result;

  // the ALU driving the bus (for a load's computed address to reach memory.addr_ld) --
  // unlike pc/memory/ir this isn't a bus-native device (no clk/rst of its own), so the
  // tri-state driver lives here instead of inside alu.sv
  assign bus = alu_oe ? alu_bus_val : 32'bz;

  decoder dec_i (.instr(ir_val), .opcode, .rd, .funct3, .rs1, .rs2, .funct7,
                 .imm_i, .imm_s, .imm_b, .imm_u, .imm_j);

  register_file rf_i (.clk, .rst, .raddr1(rs1), .raddr2(rs2), .rdata1(rf_rdata1),
                       .rdata2(rf_rdata2), .waddr(rd), .wdata(rf_wdata), .we(rf_we));

  // first ALU operand: the current instruction's own address for branches and jal (target =
  // instr_pc + imm, per the RV32I spec) -- jalr's target is register-relative (rs1 + imm_i),
  // so it falls through to the rf_rdata1 default like everything else. alu.a stays instr_pc
  // even into the next instruction's fetch cycles until opcode updates -- harmless, same
  // argument as always: nothing consumes alu_result outside the cycle the control unit
  // actually needs it.
  // auipc joins branches/jal here: its target is also instr_pc-relative (RV32I "add upper
  // immediate to pc"), computed through the same adder for the same reason jal's is.
  assign alu_a = (opcode == OP_BRANCH || opcode == OP_JAL || opcode == OP_AUIPC)
                 ? instr_pc : rf_rdata1;

  // second ALU operand: register only for R-type; loads/jalr want the I-type immediate
  // (jalr falls through to the default -- it IS I-type), stores want the S-type immediate,
  // branches want the B-type immediate, jal/auipc want the U/J-type immediate -- routing
  // decision, not an ALU operation, so the mux lives here rather than in alu.sv. lui never
  // reaches this mux's result (see rf_wdata) -- it's the first instruction that bypasses the
  // ALU entirely, so alu_a/alu_b are left at their rf_rdata1/imm_i defaults for OP_LUI,
  // computing a harmless, unread value.
  assign alu_b = (opcode == OP_RTYPE)  ? rf_rdata2 :
                 (opcode == OP_STORE)  ? imm_s :
                 (opcode == OP_BRANCH) ? imm_b :
                 (opcode == OP_JAL)    ? imm_j :
                 (opcode == OP_AUIPC)  ? imm_u : imm_i;
  alu alu_i (.a(alu_a), .b(alu_b), .opcode, .funct3, .funct7, .result(alu_result));

  // branch condition: independent of the ALU (branch funct3 is a third, incompatible meaning
  // space -- 0x4 is xor for R/I-type, lbu for loads, blt here). taken isn't a top-level port:
  // it goes straight to control_unit above, the only consumer.
  branch_unit bu_i (.rs1(rf_rdata1), .rs2(rf_rdata2), .funct3, .taken(branch_taken));

  // load formatting: byte/half/word extraction + sign/zero extension off whatever's on the
  // bus during a load's data cycle (mem_oe asserted). alu_result[1:0] is still rs1+imm's low
  // bits at that point -- ir.val/decoder outputs haven't changed since the address cycle, so
  // the ALU (combinational) keeps recomputing the same address, no dedicated latch needed.
  load_unit lu_i (.mem_word(bus), .byte_offset(alu_result[1:0]), .funct3, .result(load_data));

  // link value for jal/jalr (rd = PC+4): pc_val already holds it, with no ALU work needed --
  // pc_inc fired back in FETCH_DATA, so the live PC register is already "address of the next
  // sequential instruction" throughout this instruction's execute cycle (same fact instr_pc
  // is built on, from the other side).
  // lui = imm_u directly, no addition -- the only instruction in this design that bypasses
  // the ALU completely (auipc still needs one, for the +instr_pc; lui doesn't even have an
  // rs1). auipc falls through to the alu_result default like every other ALU-computed write.
  assign rf_wdata = (opcode == OP_LOAD) ? load_data :
                     (opcode == OP_JAL || opcode == OP_JALR) ? pc_val :
                     (opcode == OP_LUI) ? imm_u : alu_result;

  // store positioning: rs2 shifted into the target byte lane + a byte-enable mask, fed to
  // memory's dedicated write-data path (not the bus -- there's no spare microword bit for a
  // register-file bus driver, and byte-enables mean memory never needs to read the old word,
  // so nothing needs to occupy the bus during the write cycle anyway)
  store_unit su_i (.rs2(rf_rdata2), .byte_offset(alu_result[1:0]), .funct3,
                    .wdata(store_wdata), .byte_en(store_byte_en));

  // Note: Verilator 5.042 doesn't model real Z-net resolution (see CLAUDE.md), so this is
  // the only thing that will catch two devices driving the bus at the same time. $fatal is a
  // simulation-only system task (not synthesizable, e.g. yosys rejects it outright) -- guarded
  // by `VERILATOR, which Verilator defines automatically with no extra flags, so this fires
  // exactly as before under simulation and disappears cleanly under any other tool.
  always_comb begin
    if ((pc_oe & mem_oe) | (pc_oe & ir_oe) | (pc_oe & alu_oe) |
        (mem_oe & ir_oe) | (mem_oe & alu_oe) | (ir_oe & alu_oe)) begin
`ifdef VERILATOR
      $fatal(1, "datapath: bus contention - multiple oe asserted (pc_oe=%b mem_oe=%b ir_oe=%b alu_oe=%b)",
             pc_oe, mem_oe, ir_oe, alu_oe);
`endif
    end
  end

endmodule
