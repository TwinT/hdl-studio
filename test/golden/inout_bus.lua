-- The shared inout bus of 12_inout_bus: one driver passes, a released bus
-- floats (it must not keep its last value), two drivers that disagree give
-- x. `seen` samples the bus at each rising clock edge.
local function edge() sim.wait(sim.posedge("clk")) sim.sleep(10) end
local function set(t) for k, v in pairs(t) do sim.setinput(k, v) end end
set{ ld_a = false, oe_a = false, ld_b = false, oe_b = false }
-- the outside world loads a through the top-level driver
set{ drive = true, data = 5, ld_a = true }
edge()
edge()
print("outside drives 5", sim.getoutput("seen"))
-- a drives the bus, b loads it from there
set{ drive = false, data = 0, ld_a = false, oe_a = true, ld_b = true }
edge()
edge()
print("a drives", sim.getoutput("seen"))
-- nobody drives: the bus floats
set{ oe_a = false, ld_b = false }
edge()
edge()
print("nobody drives", sim.getoutput("seen"))
-- only b drives: b really loaded 5 off the bus
set{ oe_b = true }
edge()
edge()
print("b drives", sim.getoutput("seen"))
-- b and the outside world disagree
set{ drive = true, data = 10 }
edge()
edge()
print("b and the outside disagree", sim.getoutput("seen"))
