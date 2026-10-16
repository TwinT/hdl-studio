-- Simula 5 pulsaciones del pushbutton, cada una sostenida por 2 flancos de
-- clk (mas de lo que necesita el sincronizador) para mostrar que se cuenta
-- una sola vez por pulsacion, no una vez por ciclo con btn en alto.

print("=== Simulacion: contador de pulsaciones (pushbutton momentaneo) ===\n");

sim.setinput("rst", true);
sim.wait(sim.posedge("clk"));
sim.setinput("rst", false);
sim.wait(sim.posedge("clk"));

for i = 1, 5 do
    sim.setinput("pushbutton", true);
    sim.wait(sim.posedge("clk"));
    sim.wait(sim.posedge("clk"));
    sim.setinput("pushbutton", false);
    sim.wait(sim.posedge("clk"));
    print(string.format("pulsacion %d: count=%s\n", i, sim.getoutput("count"):tohex()));
end
