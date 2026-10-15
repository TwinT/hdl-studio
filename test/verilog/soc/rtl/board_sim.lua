-- Verifica que la CPU arranca: resetea, espera que el PC recorra las primeras instrucciones
-- (0x00, 0x04, ... 0x20) y que se prenda la fila del piso (fila 15, la escribe el `sw` en 0x18).
--
-- Usa sim.wait(sim.value(...)) y no sim.getvalue(): en el webview solo se actualizan los
-- cables de los subcircuitos abiertos, pero los monitores corren en el worker y siempre andan.
-- Si solo aparece el encabezado y nada más, el reloj está congelado (no avanza ni el tick).

print("=== Simulacion: arranque del soc (board) ===\n");

sim.setinput("rst", true);
sim.wait(sim.posedge("clk"));
sim.wait(sim.posedge("clk"));
local t0 = sim.tick();
sim.wait(sim.posedge("clk"));
local period = sim.tick() - t0;   -- ticks por ciclo de reloj
sim.setinput("rst", false);
print(string.format("reloj: %d ticks por ciclo\n", period));

local ok = true;
for pc = 4, 0x20, 4 do
    local start = sim.tick();
    local timeout = 10 * period;  -- una instruccion tarda ~4-5 ciclos
    sim.wait(sim.value(vec.frominteger(pc, 32), "sys", "core_i", "pc_val"), timeout);
    if sim.tick() - start >= timeout then
        print(string.format("FALLA: el PC nunca llego a 0x%02x (colgado en la instruccion anterior)\n", pc));
        ok = false;
        break;
    end
    print(string.format("tick %7d: pc = 0x%02x\n", sim.tick(), pc));
end

if ok then
    -- el sw del piso (0x18) ya se ejecuto; dar unos ciclos para que led_panel latchee la fila
    for i = 1, 8 do sim.wait(sim.posedge("clk")); end
    local m = sim.getoutput("matrix"):tobin();
    local lit = select(2, m:gsub("1", ""));
    local floor_row = m:sub(1, 32);   -- tobin() es MSB primero: la fila 15 va adelante
    print(string.format("LEDs prendidos: %d, piso (fila 15): %s\n", lit,
        floor_row == string.rep("1", 32) and "OK" or floor_row));
    print("La CPU arranco. Para ver el carpincho caminar: Fast-forward (sin el script).\n");
end
