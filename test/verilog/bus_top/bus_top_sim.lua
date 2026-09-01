-- Demuestra resolucion de bus compartido con 2 drivers tri-state: un solo
-- driver activo pasa su valor, ninguno activo deja el bus en alta impedancia
-- (z), y ambos activos con valores distintos produce contencion (x).
--
-- Los valores esperados en los comentarios de cada linea salen de probar la
-- logica de Tribuf/TriMerge por separado (operation() a mano + conversion
-- real yosys -> yosys2digitaljs), no de correr este script: la simulacion
-- interactiva real (F5, extension host) todavia no se corrio.

print("=== Simulacion: bus_top (bus compartido tri-state) ===\n");

local function drive(oe_a, val_a, oe_b, val_b)
    sim.setinput("oe_a", oe_a);
    sim.setinput("val_a", val_a);
    sim.setinput("oe_b", oe_b);
    sim.setinput("val_b", val_b);
    sim.sleep(2);
    print(string.format("oe_a=%d val_a=%d oe_b=%d val_b=%d -> bus=%s\n",
        oe_a and 1 or 0, val_a, oe_b and 1 or 0, val_b,
        sim.getoutput("bus"):tobin()));
end

drive(true, 5, false, 0);   -- only a drives -> bus = 0101
drive(false, 0, true, 10);  -- only b drives -> bus = 1010
drive(true, 5, true, 5);    -- both drive, agree -> bus = 0101
drive(true, 5, true, 10);   -- both drive, disagree -> bus = xxxx (contention)
drive(false, 0, false, 0);  -- neither drives -> bus = zzzz (floating)
