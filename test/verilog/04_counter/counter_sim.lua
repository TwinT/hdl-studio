-- Resetea el contador y despues observa 20 flancos de reloj, mostrando la
-- cuenta en cada uno (deberia ir 0,1,2,...,F y volver a 0).
-- "clk" es un input de 1 bit llamado clk: HDL Studio lo detecta solo y lo
-- convierte en un reloj automatico, asi que el script no lo maneja a mano,
-- solo espera sus flancos con sim.wait(sim.posedge("clk")).

print("=== Simulacion: Contador 4 bits ===\n");

sim.setinput("rst", true);
sim.wait(sim.posedge("clk"));
sim.setinput("rst", false);

for i = 1, 20 do
    sim.wait(sim.posedge("clk"));
    print(string.format("ciclo %2d: count=%s\n", i, sim.getoutput("count"):tohex()));
end
