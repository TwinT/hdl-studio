# Microprograma de carpincho-V. make genera control_unit.hex a partir de este archivo;
# no editar el .hex a mano.
#
# Una línea por microinstrucción, en orden desde la dirección 0:
#
#   [label:]  (señal... | -)   -> next              # MODE_SEQ,  upc + 1
#                              -> map               # MODE_MAP,  despacho por opcode
#                              -> label             # MODE_JMP
#                              -> label if taken    # MODE_COND, decide branch_taken

# microinstrucción, MSB -> LSB: tiene que coincidir con el struct de rtl/core/control_unit.sv
.signals alu_oe store_oe pc_ld pc_inc pc_oe mem_addr_ld mem_we mem_oe ir_ld rf_we
.depth   16

# --- fetch: los mismos dos ciclos para toda instrucción ---
fetch_addr:            pc_oe mem_addr_ld    -> next  # pc -> bus -> dirección de memoria
fetch_data:            pc_inc mem_oe ir_ld  -> next  # mem -> bus -> ir; de paso pc += 4
dispatch:              -                    -> map   # opcode ya estable: salta a la rutina

# --- rutinas de ejecución, una por grupo de opcodes con la misma secuencia ---
# qué opcode va a cada una lo decide el case (opcode) de control_unit.sv

exec_writeback:        rf_we                -> fetch_addr  # op, op-imm, lui, auipc

exec_load_addr:        alu_oe mem_addr_ld   -> next        # load
exec_load_data:        mem_oe rf_we         -> fetch_addr

exec_store_addr:       alu_oe mem_addr_ld   -> next        # store
exec_store_write:      store_oe mem_we      -> fetch_addr

exec_branch:           -                    -> exec_branch_taken if taken  # branch
exec_branch_not_taken: -                    -> fetch_addr
exec_branch_taken:     alu_oe pc_ld         -> fetch_addr

exec_jump:             alu_oe pc_ld rf_we   -> fetch_addr  # jal, jalr
