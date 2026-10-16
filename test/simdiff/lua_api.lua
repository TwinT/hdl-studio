-- Exercises the whole vec/sim API, for luadiff.spec.mjs (on 12_inout_bus).
local function show(...)
    local t = {}
    for i = 1, select("#", ...) do t[i] = tostring((select(i, ...))) end
    print(table.concat(t, " "))
end

local a, b = vec("8ha5"), vec("8h0f")
show(a, a:tohex(), a:tooct(), a:tobin(), #a, a:bits())
show(vec(5), vec(-3), vec(5, 8), vec(-3, 8), vec(true), vec(false, 4), vec("4b1x0z"), vec(a), vec(a, 4), vec(a, 12))
show(vec.frombin("1x0z"), vec.fromoct("17", 6), vec.fromhex("f0", 12), vec.frombool(true, 3), vec.frominteger(-2, 5))
show(a:tointeger(), vec("4b1010"):tointegersigned(), vec(-1, 16):tointegersigned())
show(a & b, a | b, a ~ b, ~a, a .. b, a(0), a(-1), a(2, 4), a & 3, a | 15) -- (a narrower string crashes digitaljs_lua)
show(a:band(b), a:bor(b), a:bxor(b), a:bnand(b), a:bnor(b), a:bxnor(b), a:bnot())
show(a:rand(), a:ror(), a:rxor(), a:rnand(), a:rnor(), a:rxnor())
local x = vec.frombin("10x1z0")
show(x:xmask(), x:ishigh(), x:islow(), x:isdefined(), x:isfullydefined(),
     vec.frombin("xx"):isdefined(), vec("4hf"):ishigh(), vec("4h0"):islow())
show(a == vec("8ha5"), a == b, a == vec("9ha5"))
-- errors (their messages differ: hdlstudio says where; an unknown input
-- isn't here: it crashes digitaljs_lua past pcall)
show(pcall(function () return vec.frombin("1x"):tointeger() end) == false, pcall(sim.getvalue, "nope") == false)

-- drive the bus, load it into register a, then let a drive it
show("tick", sim.tick())
sim.setinput("drive", true)
sim.setinput("data", 6)
sim.setinput("ld_a", true)
sim.wait(sim.posedge("clk"))
show("loaded at", sim.tick(), sim.getoutput("seen"), sim.getvalue("bus"), sim.getvalue("pair", "a", "val"))
sim.setinput("ld_a", false)
sim.setinput("drive", false)
sim.setinput("oe_a", true)
sim.wait(sim.posedge("clk"))
sim.wait(sim.posedge("clk"))
show("a drives", sim.tick(), sim.getoutput("seen"), sim.getvalue("bus"))
-- a value the bus already has: only the timeout wakes it
sim.wait(sim.value("4b0110", "bus"), 50)
show("timeout", sim.tick())
sim.wait(sim.negedge("clk") | sim.posedge("clk"))
show("either edge", sim.tick(), sim.getvalue("clk"))
sim.setinput("oe_a", false)
sim.wait(sim.value("4bzzzz", "bus"), 1000)
show("released", sim.tick(), sim.getvalue("bus"))
sim.sleep(7)
show("slept", sim.tick())
