-- Recorre las 16 direcciones y muestra los valores almacenados (i^2, segun
-- el contenido fijo definido en el modulo). Es combinacional: no hay clk.

print("=== Simulacion: ROM ===\n");

for addr = 0, 15 do
    sim.setinput("addr", addr);
    sim.sleep(2);
    print(string.format("addr=%2d -> data=%3d\n", addr, sim.getoutput("data"):tointeger()));
end
