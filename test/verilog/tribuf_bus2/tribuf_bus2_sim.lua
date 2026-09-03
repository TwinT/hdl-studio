-- Igual que bus_top pero en un solo modulo, sin submodulos - aisla si un
-- bug necesita jerarquia entre modulos para disparar, o pasa tambien en el
-- caso plano.
--
-- Los valores esperados en los comentarios salen de probar la logica de
-- Tribuf/TriMerge por separado (test/pipeline.spec.mjs), no de correr este
-- script: la simulacion interactiva real (F5, extension host) todavia no
-- se corrio.

print("=== Simulacion: tribuf_bus2 (bus compartido, sin submodulos) ===\n");

local function drive(oe_a, val_a, oe_b, val_b)
    sim.setinput("oe_a", oe_a);
    sim.setinput("val_a", val_a);
    sim.setinput("oe_b", oe_b);
    sim.setinput("val_b", val_b);
    sim.sleep(20);
    print(string.format("oe_a=%d val_a=%d oe_b=%d val_b=%d -> bus=%s\n",
        oe_a and 1 or 0, val_a, oe_b and 1 or 0, val_b,
        sim.getoutput("bus"):tobin()));
end

drive(true, 5, false, 0);   -- solo a maneja -> bus = 0101
drive(false, 0, true, 10);  -- solo b maneja -> bus = 1010
drive(true, 5, true, 5);    -- ambos manejan, coinciden -> bus = 0101
drive(true, 5, true, 10);   -- ambos manejan, discrepan -> bus = xxxx (contencion)
drive(false, 0, false, 0);  -- ninguno maneja -> bus = zzzz (flotando)
