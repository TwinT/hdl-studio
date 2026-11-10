-- Tests del contador: aparecen en la vista Testing de VS Code (con el proyecto
-- abierto y este archivo agregado a sus fuentes). Cada test(nombre, funcion)
-- corre solo, sobre una simulacion nueva desde el tick 0, y falla si un
-- assert falla. Desde la terminal Lua o el panel de scripts corren todos
-- seguidos, sobre la misma simulacion.

local function reset()
    sim.setinput("rst", true)
    sim.wait(sim.posedge("clk"))
    sim.setinput("rst", false)
end

-- La cuenta despues de `flancos` flancos de subida, leida en el siguiente
-- flanco de bajada: justo en el flanco, la salida todavia no cambio.
local function cuenta_tras(flancos)
    for _ = 1, flancos do sim.wait(sim.posedge("clk")) end
    sim.wait(sim.negedge("clk"))
    return sim.getoutput("count"):tointeger()
end

test("arranca en 0 despues del reset", function ()
    reset()
    assert(cuenta_tras(0) == 0)
end)

test("cuenta cada flanco de subida", function ()
    reset()
    local c = cuenta_tras(5)
    assert(c == 5, "despues de 5 flancos la cuenta es " .. c)
end)

test("vuelve a 0 despues de 15", function ()
    reset()
    local c = cuenta_tras(16)
    assert(c == 0, "despues de 16 flancos la cuenta es " .. c)
end)
