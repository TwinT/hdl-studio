# protheanV control-store firmware -- the source of truth for control_unit.hex.
#
# Regenerate with `make rtl/control_unit.hex` (or `python3 tools/ucasm.py rtl/control_unit.uc
# -o rtl/control_unit.hex`). Do NOT hand-edit the .hex: the next make overwrites it from here.
#
# One line per microinstruction, emitted in file order starting at address 0:
#
#   [label:]  (signal... | -)  -> next              # MODE_SEQ,  upc + 1
#                              -> map               # MODE_MAP,  dispatch on opcode
#                              -> label             # MODE_JMP
#                              -> label if taken    # MODE_COND, branch_taken decides

# microword layout, MSB -> LSB: must match the struct packed in rtl/control_unit.sv
.signals alu_oe pc_ld pc_inc pc_oe mem_addr_ld mem_we mem_oe ir_ld ir_oe rf_we
.depth   16

# --- fetch: the same two cycles for every instruction ---
fetch_addr:            pc_oe mem_addr_ld    -> next  # pc -> bus -> mem.mar
fetch_data:            pc_inc mem_oe ir_ld  -> next  # mem -> bus -> ir; pc += 4 rides along
dispatch:              -                    -> map   # opcode has settled: jump to the routine

# --- execute routines, one per group of opcodes sharing a control sequence ---
# which opcode lands here is the case (opcode) in control_unit.sv, not this file

exec_writeback:        rf_we                -> fetch_addr  # op, op-imm, lui, auipc

exec_load_addr:        alu_oe mem_addr_ld   -> next        # load
exec_load_data:        mem_oe rf_we         -> fetch_addr

exec_store_addr:       alu_oe mem_addr_ld   -> next        # store
exec_store_write:      mem_we               -> fetch_addr

exec_branch:           -                    -> exec_branch_taken if taken  # branch
exec_branch_not_taken: -                    -> fetch_addr
exec_branch_taken:     alu_oe pc_ld         -> fetch_addr

exec_jump:             alu_oe pc_ld rf_we   -> fetch_addr  # jal, jalr
