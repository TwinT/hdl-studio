-- Demuestra un solo tri-state buffer sin merge (bus con un unico driver):
-- oe activo pasa val, oe inactivo deja el bus en alta impedancia (z).
--
-- Los valores esperados en los comentarios salen de probar Tribuf.operation()
-- por separado (test/pipeline.spec.mjs), no de correr este script: la
-- simulacion interactiva real (F5, extension host) todavia no se corrio.

print("=== Simulacion: tribuf_single (un solo driver tri-state) ===\n");

local function drive(oe, val)
    sim.setinput("oe", oe);
    sim.setinput("val", val);
    sim.sleep(2);
    print(string.format("oe=%d val=%d -> bus=%s\n",
        oe and 1 or 0, val, sim.getoutput("bus"):tobin()));
end

drive(true, 5);   -- oe activo -> bus = 0101
drive(false, 5);  -- oe inactivo -> bus = zzzz (flotando)
