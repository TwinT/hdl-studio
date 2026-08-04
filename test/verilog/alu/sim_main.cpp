// ============================================================================
// Archivo: sim_main.cpp
// Descripción: Driver C++ minimalista para Verilator con trazado VCD.
//              Genera el reloj y evalúa la simulación hasta que SystemVerilog
//              emite un $finish.
// ============================================================================

#include <iostream>
#include <memory>
#include "Vtop_module_tb.h"
#include "verilated.h"

#if VM_TRACE
#include "verilated_vcd_c.h"
#endif

int main(int argc, char** argv) {
    Verilated::commandArgs(argc, argv);
    auto top = std::make_unique<Vtop_module_tb>();

#if VM_TRACE
    Verilated::traceEverOn(true);
    auto tfp = std::make_unique<VerilatedVcdC>();
    top->trace(tfp.get(), 99);
    tfp->open("sim.vcd");
    std::cout << "[SIM C++] Trazado de ondas VCD activado (sim.vcd)" << std::endl;
#endif

    vluint64_t main_time = 0;
    top->clk = 0;

    // Bucle principal de reloj hasta que $finish sea invocado desde SystemVerilog
    while (!Verilated::gotFinish()) {
        top->clk = !top->clk;
        top->eval();

#if VM_TRACE
        if (tfp) {
            tfp->dump(main_time);
        }
#endif
        main_time += 5;
    }

#if VM_TRACE
    if (tfp) {
        tfp->close();
    }
#endif

    std::cout << "[SIM C++] Simulación finalizada." << std::endl;
    return 0;
}
