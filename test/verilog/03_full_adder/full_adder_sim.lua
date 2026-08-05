-- Recorre las 8 combinaciones de a, b, cin y muestra sum/cout para cada una
-- (tabla de verdad completa del full adder).

print("=== Simulacion: Full Adder ===\n");

for i = 0, 7 do
    local a   = (i & 4) ~= 0;
    local b   = (i & 2) ~= 0;
    local cin = (i & 1) ~= 0;
    sim.setinput("a", a);
    sim.setinput("b", b);
    sim.setinput("cin", cin);
    sim.sleep(2);
    print(string.format("a=%d b=%d cin=%d -> sum=%d cout=%d\n",
        a and 1 or 0, b and 1 or 0, cin and 1 or 0,
        sim.getoutput("sum"):tointeger(), sim.getoutput("cout"):tointeger()));
end
