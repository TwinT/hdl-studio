-- Escribe tres valores en distintas direcciones y despues los relee, para
-- confirmar que la memoria realmente guarda el dato (dout esta registrada:
-- el valor queda disponible en el ciclo siguiente a poner la direccion).

print("=== Simulacion: RAM sincronica ===\n");

local function write(addr, data)
    sim.setinput("we", true);
    sim.setinput("addr", addr);
    sim.setinput("din", data);
    sim.wait(sim.posedge("clk"));
end

local function read(addr)
    sim.setinput("we", false);
    sim.setinput("addr", addr);
    sim.wait(sim.posedge("clk"));
    return sim.getoutput("dout");
end

write(0, 0x11);
write(1, 0x22);
write(2, 0x33);

print("mem[0] = " .. read(0):tohex() .. " (esperado 11)\n");
print("mem[1] = " .. read(1):tohex() .. " (esperado 22)\n");
print("mem[2] = " .. read(2):tohex() .. " (esperado 33)\n");
