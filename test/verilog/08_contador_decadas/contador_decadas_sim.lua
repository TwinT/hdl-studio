-- Resetea el contador de decadas y observa 25 flancos, mostrando
-- "decenas-unidades" en cada uno: deberia ir 00,01,...,09,10,11,...,24
-- (se ve el acarreo de "unidades" hacia "decenas" cada 10 ciclos).

print("=== Simulacion: Contador de decadas ===\n");

sim.setinput("rst", true);
sim.wait(sim.posedge("clk"));
sim.setinput("rst", false);

for i = 1, 25 do
    sim.wait(sim.posedge("clk"));
    local decenas  = sim.getoutput("decenas"):tointeger();
    local unidades = sim.getoutput("unidades"):tointeger();
    print(string.format("ciclo %2d: %d%d\n", i, decenas, unidades));
end
