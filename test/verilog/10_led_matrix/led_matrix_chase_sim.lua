-- Resetea el contador y observa 20 flancos: deberia verse un unico LED
-- recorriendo la matriz 4x4 en orden (posiciones 0..15, y vuelve a 0).

print("=== Simulacion: Matriz de LEDs NxN (punto que recorre) ===\n");

sim.setinput("rst", true);
sim.wait(sim.posedge("clk"));
sim.setinput("rst", false);

for i = 1, 200 do
    sim.wait(sim.posedge("clk"));
    print(string.format("ciclo %2d: matrix=%s\n", i, sim.getoutput("matrix"):tobin()));
end
