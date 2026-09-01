-- Bus compartido con 3 drivers tri-state - ejercita TriMerge con
-- inputs > 2, una forma que ningun fixture (real o sintetico) probaba
-- antes de este.
--
-- Los valores esperados en los comentarios salen de probar TriMerge.operation()
-- directamente con 3 entradas (no de correr este script): la simulacion
-- interactiva real (F5, extension host) todavia no se corrio.

print("=== Simulacion: tribuf_bus3 (bus compartido, 3 drivers) ===\n");

local function drive(oe_a, val_a, oe_b, val_b, oe_c, val_c)
    sim.setinput("oe_a", oe_a);
    sim.setinput("val_a", val_a);
    sim.setinput("oe_b", oe_b);
    sim.setinput("val_b", val_b);
    sim.setinput("oe_c", oe_c);
    sim.setinput("val_c", val_c);
    sim.sleep(2);
    print(string.format("oe_a=%d val_a=%d oe_b=%d val_b=%d oe_c=%d val_c=%d -> bus=%s\n",
        oe_a and 1 or 0, val_a, oe_b and 1 or 0, val_b, oe_c and 1 or 0, val_c,
        sim.getoutput("bus"):tobin()));
end

drive(false, 0, false, 0, false, 0);   -- ninguno maneja -> bus = zzzz (flotando)
drive(true, 5, false, 0, false, 0);    -- solo a maneja -> bus = 0101
drive(false, 0, false, 0, true, 12);   -- solo c maneja -> bus = 1100
drive(true, 5, true, 5, false, 0);     -- a y b coinciden, c flotando -> bus = 0101
drive(true, 5, true, 10, false, 0);    -- a y b discrepan, c flotando -> bus = xxxx (contencion)
drive(true, 5, true, 5, true, 5);      -- los tres coinciden -> bus = 0101
drive(true, 5, true, 5, true, 10);     -- a y b coinciden, c discrepa -> bus = xxxx (contencion)
