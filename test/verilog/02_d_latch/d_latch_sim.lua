-- Muestra el comportamiento "transparente vs congelado" del D latch:
-- con en=1, q sigue a d; con en=0, q se congela aunque d cambie.

print("=== Simulacion: D Latch ===\n");

local function step(d, en, label)
    sim.setinput("d", d);
    sim.setinput("en", en);
    sim.sleep(2);
    print(string.format("%s: d=%d en=%d -> q=%d\n",
        label, d and 1 or 0, en and 1 or 0, sim.getoutput("q"):tointeger()));
end

step(false, true,  "en=1, d=0 (transparente)");
step(true,  true,  "en=1, d=1 (transparente)");
step(false, true,  "en=1, d=0 (transparente)");
step(true,  false, "en=0, d=1 (congelado, q no deberia cambiar)");
step(false, false, "en=0, d=0 (sigue congelado)");
