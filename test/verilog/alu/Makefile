# ============================================================================
# Archivo: Makefile
# Descripción: Automatización para simulación con Verilator, visualización
#              de formas de onda con Surfer y síntesis lógica con Yosys.
# ============================================================================

# Herramientas
VERILATOR = verilator
YOSYS     = yosys
SURFER    = surfer

# Archivos del diseño
PKG_SRC   = tp1_pkg.sv
IF_SRC    = alu_if.sv
RTL_SRCS  = alu.sv reg_file.sv fsm.sv top_module.sv
TB_SV     = top_module_tb.sv
TB_CPP    = sim_main.cpp
ALL_SV    = $(PKG_SRC) $(IF_SRC) $(RTL_SRCS) $(TB_SV)

TOP_MODULE = top_module_tb
SYNTH_TOP  = top_module

# Directorios y salida
OBJ_DIR   = obj_dir
VCD_FILE  = sim.vcd
EXEC      = $(OBJ_DIR)/V$(TOP_MODULE)

.PHONY: all sim wave surfer synth yosys clean help

all: sim

# ----------------------------------------------------------------------------
# 1. Simulación con Verilator (Compila con --trace, --timing y ejecuta)
# ----------------------------------------------------------------------------
sim: $(EXEC)
	@echo "===> Ejecutando simulación con Verilator..."
	./$(EXEC)

$(EXEC): $(ALL_SV) $(TB_CPP)
	@echo "===> Compilando con Verilator y habilitando trazado VCD (--trace)..."
	$(VERILATOR) --cc --exe --build --trace --timing -j 0 $(ALL_SV) $(TB_CPP) \
		--top-module $(TOP_MODULE) -Wall -Wno-VARHIDDEN

# ----------------------------------------------------------------------------
# 2. Visualización de formas de onda con Surfer
# ----------------------------------------------------------------------------
wave: surfer

surfer: $(VCD_FILE)
	@echo "===> Abriendo $(VCD_FILE) en Surfer..."
	$(SURFER) $(VCD_FILE) &

$(VCD_FILE):
	@echo "===> El archivo $(VCD_FILE) no existe. Ejecutando simulación primero..."
	$(MAKE) sim

# ----------------------------------------------------------------------------
# 3. Síntesis lógica con Yosys
# ----------------------------------------------------------------------------
synth: yosys

yosys:
	@echo "===> Ejecutando síntesis de $(SYNTH_TOP) con Yosys..."
	$(YOSYS) -p "design -reset; read_verilog -sv -defer $(PKG_SRC) $(IF_SRC) $(RTL_SRCS); hierarchy -top $(SYNTH_TOP); proc; opt_clean; memory -nomap; wreduce -memx; opt_clean; json -o $(SYNTH_TOP).json"

# ----------------------------------------------------------------------------
# 4. Limpieza
# ----------------------------------------------------------------------------
clean:
	@echo "===> Limpiando archivos generados..."
	rm -rf $(OBJ_DIR) $(VCD_FILE) *.log top_fsm.sv tb_top.sv $(SYNTH_TOP).json

# ----------------------------------------------------------------------------
# Ayuda
# ----------------------------------------------------------------------------
help:
	@echo "Opciones disponibles:"
	@echo "  make sim      : Compila con Verilator, ejecuta la simulación y genera sim.vcd"
	@echo "  make wave     : Abre sim.vcd en Surfer"
	@echo "  make synth    : Ejecuta la síntesis lógica con Yosys para $(SYNTH_TOP)"
	@echo "  make clean    : Elimina obj_dir, sim.vcd y archivos temporales"
