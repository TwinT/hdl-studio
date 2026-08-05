-- Prueba simple del SR Latch: recorre Set, Hold, Reset, Hold y el estado
-- prohibido, mostrando q/q_n despues de cada paso. El sleep entre pasos le da
-- tiempo a la realimentacion cruzada (NOR-NOR) de estabilizarse.

print("=== Simulacion: SR Latch ===\n");

local function step(s, r, label)
    sim.setinput("s", s);
    sim.setinput("r", r);
    sim.sleep(2);
    print(string.format("%s: s=%d r=%d -> q=%s q_n=%s\n",
        label, s and 1 or 0, r and 1 or 0,
        sim.getoutput("q"):tobin(), sim.getoutput("q_n"):tobin()));
end

step(true,  false, "Set");
step(false, false, "Hold");
step(false, true,  "Reset");
step(false, false, "Hold");
step(true,  true,  "Prohibido (s=r=1)");
