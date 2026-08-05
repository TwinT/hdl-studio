-- Resetea el LFSR (semilla 0x01) y observa 20 flancos: la secuencia debe
-- verse pseudoaleatoria y nunca pasar por 0x00 (si eso pasara, quedaria
-- atascado ahi para siempre).

print("=== Simulacion: LFSR 8 bits ===\n");

sim.setinput("rst", true);
sim.wait(sim.posedge("clk"));
sim.setinput("rst", false);

for i = 1, 20 do
    sim.wait(sim.posedge("clk"));
    print(string.format("ciclo %2d: data=%s\n", i, sim.getoutput("data"):tobin()));
end
