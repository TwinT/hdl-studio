//! Lua scripts inside the engine: the `vec` and `sim` libraries (the API
//! HDL Studio always had, see the README) on Lua 5.4. A script runs as a
//! coroutine; `sim.sleep`/`sim.wait` register a wake-up (an alarm, one-shot
//! monitors) and yield, and the engine resumes the script after the step
//! where it fires, with the circuit stopped at that tick.
//! Since 1.0 (CHANGELOG): `tointeger` takes up to 63 bits, a string
//! narrower than the input it is assigned to is zero-extended, the REPL
//! prints the values of an expression, `sim.registerdisplay` isn't there.
// Portions Copyright (c) 2018 Marek Materzok, BSD-2-Clause (see NOTICE).

use hdlstudio_logic::{Bit, LogicVec};
use hdlstudio_sim::{Event, Sim};
use mlua::{
    AnyUserData, Function, HookTriggers, Lua, MetaMethod, MultiValue, ThreadStatus, UserData, UserDataMethods, Value,
    Variadic, VmState,
};
use std::cell::{Cell, RefCell};
use std::collections::HashMap;
use std::rc::Rc;
use std::time::{Duration, Instant};

pub type SharedSim = Rc<RefCell<Option<Sim>>>;

/// What scripts tell the client, by script name.
#[derive(Debug)]
pub enum LuaEvent {
    Print {
        name: String,
        messages: Vec<String>,
    },
    /// The script waits for the simulation (it didn't finish at once).
    Started {
        name: String,
    },
    Stopped {
        name: String,
    },
    Error {
        name: String,
        message: String,
    },
}

/// Monitor and alarm ids for scripts, apart from the client's.
const FIRST_ID: u64 = 1 << 62;

#[derive(Clone, PartialEq, Eq, Hash)]
enum Key {
    Script(String),
    Repl,
}

struct Globals {
    sim: SharedSim,
    next_id: u64,
    /// The script each wake-up id resumes.
    wakes: HashMap<u64, Key>,
    events: Vec<LuaEvent>,
}

/// One script's Lua state (the REPL keeps one across submissions).
struct Runner {
    lua: Lua,
    state: Rc<RefCell<RunnerState>>,
}

struct RunnerState {
    key: Key,
    /// The name events carry (each REPL submission has its own).
    name: String,
    thread: Option<mlua::Thread>,
    print_result: bool,
    /// The wake-up ids the thread waits on.
    waits: Vec<u64>,
}

pub struct LuaEngine {
    globals: Rc<RefCell<Globals>>,
    runners: HashMap<Key, Runner>,
    /// When the running script was last resumed, and how long it may run
    /// before it sleeps or waits: the simulation (and `lua_stop`) can't run
    /// meanwhile, so `while true do end` would hang the engine.
    // ponytail: wall-clock budget per resume; a script computing for longer
    // than this without sim.sleep fails, raise BUDGET if one legitimately does.
    resumed: Rc<Cell<Instant>>,
    budget: Duration,
}

const BUDGET: Duration = Duration::from_secs(5);

fn err(msg: impl Into<String>) -> mlua::Error {
    mlua::Error::RuntimeError(msg.into())
}

/// The message of a Lua error, without mlua's wrapping.
fn message(e: &mlua::Error) -> String {
    match e {
        mlua::Error::CallbackError { cause, .. } => message(cause),
        mlua::Error::WithContext { cause, .. } => message(cause),
        // without mlua's traceback
        mlua::Error::RuntimeError(s) => s.split("\nstack traceback:").next().unwrap_or_default().to_string(),
        mlua::Error::SyntaxError { message, .. } => message.clone(),
        e => e.to_string(),
    }
}

/// An error raised by a library function, with the script position that
/// called it (like `luaL_error`).
fn lerr(lua: &Lua, msg: &str) -> mlua::Error {
    lerr_at(lua, 1, msg)
}

/// `lerr` for the function at stack `level` (0 inside a hook).
fn lerr_at(lua: &Lua, level: usize, msg: &str) -> mlua::Error {
    let at = lua.inspect_stack(level, |d| {
        let src = d.source().short_src.map(|s| s.to_string()).unwrap_or_default();
        d.current_line().map(|l| format!("{src}:{l}: "))
    });
    err(format!("{}{msg}", at.flatten().unwrap_or_default()))
}

/// A four-valued vector in Lua.
#[derive(Clone)]
struct LVec(LogicVec);

/// An event a script can wait for: a wire reaching a value, or any of
/// several (`e1 | e2`).
#[derive(Clone)]
struct LEvent(Vec<(u32, LogicVec)>);

impl UserData for LEvent {
    fn add_methods<M: UserDataMethods<Self>>(m: &mut M) {
        m.add_meta_function(MetaMethod::BOr, |lua, (a, b): (AnyUserData, AnyUserData)| {
            let (a, b) = (a.borrow::<LEvent>()?, b.borrow::<LEvent>()?);
            lua.create_userdata(LEvent(a.0.iter().chain(&b.0).cloned().collect()))
        });
    }
}

/// A vec, a boolean, an integer or a string
/// ("8hff"), cut or zero-extended to `bits` when given.
fn to_vec(v: &Value, bits: Option<usize>) -> mlua::Result<Option<LogicVec>> {
    let r = match v {
        Value::UserData(ud) if ud.is::<LVec>() => ud.borrow::<LVec>()?.0.clone(),
        Value::Boolean(b) => LogicVec::from_bool(*b, bits.unwrap_or(1)),
        Value::Integer(i) => LogicVec::from_i64(*i, bits),
        Value::String(s) => {
            LogicVec::parse(&s.to_str()?).ok_or_else(|| err(format!("invalid vector {}", s.to_string_lossy())))?
        }
        Value::Number(n) => LogicVec::parse(&n.to_string()).ok_or_else(|| err(format!("invalid vector {n}")))?,
        _ => return Ok(None),
    };
    Ok(Some(match bits {
        Some(b) if r.bits() < b => LogicVec::concat(&[&r, &LogicVec::zeros(b - r.bits())]),
        Some(b) if r.bits() > b => r.slice(0, b),
        _ => r,
    }))
}

fn check_vec(v: &Value, bits: Option<usize>, arg: usize, f: &str) -> mlua::Result<LogicVec> {
    to_vec(v, bits)?.ok_or_else(|| err(format!("bad argument #{arg} to '{f}' (not convertible to vec)")))
}

impl UserData for LVec {
    fn add_methods<M: UserDataMethods<Self>>(m: &mut M) {
        type Bin = fn(&LogicVec, &LogicVec) -> LogicVec;
        let binary: [(&str, Option<MetaMethod>, Bin); 6] = [
            ("band", Some(MetaMethod::BAnd), LogicVec::and),
            ("bor", Some(MetaMethod::BOr), LogicVec::or),
            ("bxor", Some(MetaMethod::BXor), LogicVec::xor),
            ("bnand", None, LogicVec::nand),
            ("bnor", None, LogicVec::nor),
            ("bxnor", None, LogicVec::xnor),
        ];
        for (name, meta, f) in binary {
            m.add_method(name, move |_, a, b: Value| Ok(LVec(f(&a.0, &check_vec(&b, Some(a.0.bits()), 1, name)?))));
            if let Some(meta) = meta {
                m.add_meta_function(meta, move |_, (a, b): (Value, Value)| {
                    let a = check_vec(&a, None, 1, name)?;
                    Ok(LVec(f(&a, &check_vec(&b, Some(a.bits()), 2, name)?)))
                });
            }
        }
        type Un = fn(&LogicVec) -> LogicVec;
        let unary: [(&str, Un); 8] = [
            ("bnot", LogicVec::not),
            ("xmask", LogicVec::xmask),
            ("rand", LogicVec::reduce_and),
            ("ror", LogicVec::reduce_or),
            ("rxor", LogicVec::reduce_xor),
            ("rnand", LogicVec::reduce_nand),
            ("rnor", LogicVec::reduce_nor),
            ("rxnor", LogicVec::reduce_xnor),
        ];
        for (name, f) in unary {
            m.add_method(name, move |_, a, ()| Ok(LVec(f(&a.0))));
        }
        m.add_meta_method(MetaMethod::BNot, |_, a, ()| Ok(LVec(a.0.not())));
        type Pred = fn(&LogicVec) -> bool;
        let preds: [(&str, Pred); 4] = [
            ("ishigh", LogicVec::is_high),
            ("islow", LogicVec::is_low),
            ("isdefined", LogicVec::is_defined),
            ("isfullydefined", LogicVec::is_fully_defined),
        ];
        for (name, f) in preds {
            m.add_method(name, move |_, a, ()| Ok(f(&a.0)));
        }
        m.add_method("tobin", |_, a, ()| Ok(a.0.to_bin()));
        m.add_method("tooct", |_, a, ()| Ok(a.0.to_oct()));
        m.add_method("tohex", |_, a, ()| Ok(a.0.to_hex()));
        m.add_method("bits", |_, a, ()| Ok(a.0.bits()));
        m.add_method("tointeger", |lua, a, ()| {
            if !a.0.is_fully_defined() {
                return Err(lerr(lua, "tointeger: the vector isn't fully defined"));
            }
            if a.0.bits() > 63 {
                return Err(lerr(lua, "tointeger: the vector is too wide"));
            }
            Ok(a.0.to_u64().unwrap() as i64)
        });
        m.add_method("tointegersigned", |lua, a, ()| {
            if !a.0.is_fully_defined() || a.0.bits() == 0 {
                return Err(lerr(lua, "tointegersigned: the vector isn't fully defined"));
            }
            a.0.to_i64().ok_or_else(|| lerr(lua, "tointegersigned: the vector is too wide"))
        });
        m.add_meta_method(MetaMethod::Len, |_, a, ()| Ok(a.0.bits()));
        m.add_meta_method(MetaMethod::ToString, |_, a, ()| Ok(a.0.to_bin()));
        m.add_meta_function(MetaMethod::Eq, |_, (a, b): (Value, Value)| {
            Ok(check_vec(&a, None, 1, "__eq")? == check_vec(&b, None, 2, "__eq")?)
        });
        // `a .. b` puts `a` above `b`, like Verilog's {a, b}
        m.add_meta_function(MetaMethod::Concat, |_, (a, b): (Value, Value)| {
            let (a, b) = (check_vec(&a, None, 1, "__concat")?, check_vec(&b, None, 2, "__concat")?);
            Ok(LVec(LogicVec::concat(&[&b, &a])))
        });
        // v(i): bit i (from the end if negative); v(i, n): n bits from i
        m.add_meta_method(MetaMethod::Call, |lua, a, (i, n): (i64, Option<i64>)| {
            let bits = a.0.bits() as i64;
            if i < -bits || i >= bits {
                return Err(lerr(lua, "bad argument #1 to '__call' (index out of bounds)"));
            }
            let i = if i >= 0 { i } else { bits + i } as usize;
            Ok(LVec(match n {
                None => LogicVec::make(1, a.0.get(i)),
                Some(n) if n < 0 => return Err(lerr(lua, "slice count negative")),
                Some(n) => a.0.slice(i, i + n as usize),
            }))
        });
    }
}

fn vec_library(lua: &Lua) -> mlua::Result<()> {
    let vec = lua.create_table()?;
    type Parse = fn(&str, Option<usize>) -> Option<LogicVec>;
    let parsers: [(&str, Parse); 3] =
        [("frombin", LogicVec::from_bin), ("fromoct", LogicVec::from_oct), ("fromhex", LogicVec::from_hex)];
    for (name, f) in parsers {
        vec.set(
            name,
            lua.create_function(move |lua, (s, n): (String, Option<usize>)| {
                f(&s, n).map(LVec).ok_or_else(|| lerr(lua, &format!("vec.{name}: invalid digits {s}")))
            })?,
        )?;
    }
    vec.set(
        "frombool",
        lua.create_function(|_, (b, n): (Value, Option<usize>)| {
            Ok(LVec(LogicVec::from_bool(b.as_boolean().unwrap_or(!b.is_nil()), n.unwrap_or(1))))
        })?,
    )?;
    vec.set("frominteger", lua.create_function(|_, (k, n): (i64, Option<usize>)| Ok(LVec(LogicVec::from_i64(k, n))))?)?;
    let meta = lua.create_table()?;
    meta.set(
        "__call",
        lua.create_function(|_, (_, v, n): (Value, Value, Option<usize>)| Ok(LVec(check_vec(&v, n, 1, "vec")?)))?,
    )?;
    vec.set_metatable(Some(meta))?;
    lua.globals().set("vec", vec)
}

impl LuaEngine {
    pub fn new(sim: SharedSim) -> LuaEngine {
        LuaEngine {
            globals: Rc::new(RefCell::new(Globals { sim, next_id: FIRST_ID, wakes: HashMap::new(), events: vec![] })),
            runners: HashMap::new(),
            resumed: Rc::new(Cell::new(Instant::now())),
            budget: BUDGET,
        }
    }

    pub fn take_events(&mut self) -> Vec<LuaEvent> {
        std::mem::take(&mut self.globals.borrow_mut().events)
    }

    /// Is a script waiting on the simulation?
    pub fn active(&self) -> bool {
        self.runners.values().any(|r| r.state.borrow().thread.is_some())
    }

    /// Drops every script, silently (a new circuit).
    pub fn reset(&mut self) {
        self.runners.clear();
        let mut g = self.globals.borrow_mut();
        g.wakes.clear();
        g.events.clear();
    }

    fn new_runner(&self, key: Key) -> mlua::Result<Runner> {
        let lua = Lua::new();
        let state = Rc::new(RefCell::new(RunnerState {
            key,
            name: String::new(),
            thread: None,
            print_result: false,
            waits: vec![],
        }));
        vec_library(&lua)?;
        let (g, st) = (self.globals.clone(), state.clone());
        lua.globals().set(
            "print",
            lua.create_function(move |lua, args: Variadic<Value>| {
                let tostring: Function = lua.globals().get("tostring")?;
                let messages = args.iter().map(|v| tostring.call::<String>(v.clone())).collect::<mlua::Result<_>>()?;
                let name = st.borrow().name.clone();
                g.borrow_mut().events.push(LuaEvent::Print { name, messages });
                Ok(())
            })?,
        )?;
        let sim = lua.create_table()?;
        let g = self.globals.clone();
        // runs `f` on the circuit
        let with = move |lua: &Lua, f: &mut dyn FnMut(&mut Sim) -> Result<Value, String>| -> mlua::Result<Value> {
            let g = g.borrow();
            let mut s = g.sim.borrow_mut();
            let sim = s.as_mut().ok_or_else(|| lerr(lua, "no circuit"))?;
            f(sim).map_err(|e| lerr(lua, &e))
        };
        let with = Rc::new(with);
        let w = with.clone();
        sim.set("tick", lua.create_function(move |lua, ()| (*w)(lua, &mut |s| Ok(Value::Integer(s.tick() as i64))))?)?;
        let w = with.clone();
        sim.set(
            "setinput",
            lua.create_function(move |lua, (name, v): (String, Value)| {
                (*w)(lua, &mut |s| {
                    let dev = s.find_input(&name).ok_or("sim.setinput: input not found")?.to_string();
                    let bits = s.input_bits(&dev);
                    let v = to_vec(&v, bits)
                        .map_err(|e| message(&e))?
                        .ok_or("bad argument #2 to 'setinput' (not convertible to vec)")?;
                    s.set_input(&dev, v).map(|_| Value::Nil)
                })
            })?,
        )?;
        let w = with.clone();
        sim.set(
            "setinput_id",
            lua.create_function(move |lua, (id, v): (String, Value)| {
                (*w)(lua, &mut |s| {
                    let v = to_vec(&v, None)
                        .map_err(|e| message(&e))?
                        .ok_or("bad argument #2 to 'setinput_id' (not convertible to vec)")?;
                    s.set_input(&id, v).map(|_| Value::Nil)
                })
            })?,
        )?;
        let w = with.clone();
        sim.set(
            "getoutput",
            lua.create_function(move |lua, name: String| {
                let mut out = None;
                (*w)(lua, &mut |s| {
                    let net = s.find_output(&name).ok_or("sim.getoutput: output not found")?;
                    out = Some(s.net_value(net).clone());
                    Ok(Value::Nil)
                })?;
                Ok(LVec(out.unwrap()))
            })?,
        )?;
        let w = with.clone();
        sim.set(
            "getoutput_id",
            lua.create_function(move |lua, id: String| {
                let mut out = None;
                (*w)(lua, &mut |s| {
                    let net = s.find_output_id(&id).ok_or("sim.getoutput_id: output not found")?;
                    out = Some(s.net_value(net).clone());
                    Ok(Value::Nil)
                })?;
                Ok(LVec(out.unwrap()))
            })?,
        )?;
        // (s1, ..., sn, s): wire s in the subcircuit labelled s1/../sn
        let find = |s: &Sim, args: &[String], what: &str| -> Result<(u32, usize), String> {
            let (name, path) = args.split_last().ok_or_else(|| format!("sim.{what}: not enough arguments"))?;
            let path: Vec<&str> = path.iter().map(String::as_str).collect();
            let net = s.find_wire(&path, name).ok_or_else(|| format!("sim.{what}: wire not found"))?;
            Ok((net, s.net_value(net).bits()))
        };
        let w = with.clone();
        sim.set(
            "getvalue",
            lua.create_function(move |lua, args: Variadic<String>| {
                let mut out = None;
                (*w)(lua, &mut |s| {
                    let (net, _) = find(s, &args, "getvalue")?;
                    out = Some(s.net_value(net).clone());
                    Ok(Value::Nil)
                })?;
                Ok(LVec(out.unwrap()))
            })?,
        )?;
        for (name, level) in [("posedge", Bit::One), ("negedge", Bit::Zero)] {
            let w = with.clone();
            sim.set(
                name,
                lua.create_function(move |lua, args: Variadic<String>| {
                    let mut ev = None;
                    (*w)(lua, &mut |s| {
                        let (net, bits) = find(s, &args, name)?;
                        if bits != 1 {
                            return Err(format!("sim.{name}: wire not 1-bit"));
                        }
                        ev = Some(LEvent(vec![(net, LogicVec::make(1, level))]));
                        Ok(Value::Nil)
                    })?;
                    Ok(ev.unwrap())
                })?,
            )?;
        }
        let w = with.clone();
        sim.set(
            "value",
            lua.create_function(move |lua, args: MultiValue| {
                let mut args = args.into_iter();
                let v = args.next().unwrap_or(Value::Nil);
                let names = args.map(|a| a.to_string()).collect::<mlua::Result<Vec<String>>>()?;
                if names.is_empty() {
                    return Err(lerr(lua, "sim.value: not enough arguments"));
                }
                let mut ev = None;
                (*w)(lua, &mut |s| {
                    let (net, bits) = find(s, &names, "value")?;
                    let v = to_vec(&v, Some(bits))
                        .map_err(|e| message(&e))?
                        .ok_or("bad argument #1 to 'value' (not convertible to vec)")?;
                    ev = Some(LEvent(vec![(net, v)]));
                    Ok(Value::Nil)
                })?;
                Ok(ev.unwrap())
            })?,
        )?;
        // the wake-ups; the Lua side of sleep/wait yields after them
        let current = |lua: &Lua, st: &RunnerState, what: &str| -> mlua::Result<()> {
            match &st.thread {
                Some(t) if *t == lua.current_thread() => Ok(()),
                _ => Err(lerr(lua, &format!("sim.{what}: thread not suspendable"))),
            }
        };
        let (g, st) = (self.globals.clone(), state.clone());
        sim.set(
            "_sleep",
            lua.create_function(move |lua, n: i64| {
                current(lua, &st.borrow(), "sleep")?;
                if n <= 0 {
                    return Err(lerr(lua, "bad argument #1 to 'sleep' (sim.sleep: too short delay)"));
                }
                let mut g = g.borrow_mut();
                let id = g.next_id;
                g.next_id += 1;
                let key = st.borrow().key.clone();
                g.wakes.insert(id, key);
                st.borrow_mut().waits.push(id);
                let mut s = g.sim.borrow_mut();
                let sim = s.as_mut().ok_or_else(|| lerr(lua, "no circuit"))?;
                let tick = sim.tick() + n as u64;
                sim.alarm(id, tick, false);
                Ok(())
            })?,
        )?;
        let (g, st) = (self.globals.clone(), state.clone());
        sim.set(
            "_wait",
            lua.create_function(move |lua, (e, n): (AnyUserData, Option<i64>)| {
                current(lua, &st.borrow(), "wait")?;
                let e = e
                    .borrow::<LEvent>()
                    .map_err(|_| lerr(lua, "bad argument #1 to 'wait' (not convertible to event)"))?;
                let mut g = g.borrow_mut();
                let key = st.borrow().key.clone();
                let mut ids = vec![];
                for _ in 0..e.0.len() + n.is_some() as usize {
                    let id = g.next_id;
                    g.next_id += 1;
                    g.wakes.insert(id, key.clone());
                    ids.push(id);
                }
                let mut s = g.sim.borrow_mut();
                let sim = s.as_mut().ok_or_else(|| lerr(lua, "no circuit"))?;
                for ((net, v), &id) in e.0.iter().zip(&ids) {
                    sim.monitor(id, *net, Some(vec![v.clone()]), false, true);
                }
                if let Some(n) = n {
                    let tick = sim.tick() + n.max(0) as u64;
                    sim.alarm(*ids.last().unwrap(), tick, false);
                }
                st.borrow_mut().waits.extend(ids);
                Ok(())
            })?,
        )?;
        sim.set(
            "registerdisplay",
            lua.create_function(|lua, _: MultiValue| -> mlua::Result<()> {
                Err(lerr(lua, "sim.registerdisplay is not supported yet"))
            })?,
        )?;
        lua.globals().set("sim", sim)?;
        lua.load(
            r#"
            local _sleep, _wait = sim._sleep, sim._wait
            sim._sleep, sim._wait = nil, nil
            function sim.sleep(n)
                if not coroutine.isyieldable() then error("sim.sleep: thread not yieldable", 2) end
                _sleep(n)
                coroutine.yield()
            end
            function sim.wait(e, n)
                if not coroutine.isyieldable() then error("sim.wait: thread not yieldable", 2) end
                _wait(e, n)
                coroutine.yield()
            end
            "#,
        )
        .set_name("=sim")
        .exec()?;
        Ok(Runner { lua, state })
    }

    /// Runs `script` (named `label` in error messages); events carry
    /// `name`. A REPL submission shares the REPL's state and prints the
    /// values of an expression.
    pub fn run(&mut self, name: &str, script: &str, repl: bool, label: &str) {
        let key = if repl { Key::Repl } else { Key::Script(name.to_string()) };
        self.stop_thread(&key, false);
        if !repl || !self.runners.contains_key(&key) {
            match self.new_runner(key.clone()) {
                Ok(r) => {
                    self.runners.insert(key.clone(), r);
                }
                Err(e) => {
                    self.event(LuaEvent::Error { name: name.into(), message: message(&e) });
                    return;
                }
            }
        }
        let runner = &self.runners[&key];
        let chunk = |s: &str| runner.lua.load(s.to_string()).set_name(format!("@{label}")).into_function();
        let func = if repl { chunk(&format!("return {script}")).or_else(|_| chunk(script)) } else { chunk(script) };
        {
            let mut st = runner.state.borrow_mut();
            st.name = name.into();
            st.print_result = repl;
        }
        let (resumed, budget) = (self.resumed.clone(), self.budget);
        let thread = func.and_then(|f| runner.lua.create_thread(f)).and_then(|t| {
            t.set_hook(HookTriggers::new().every_nth_instruction(100_000), move |lua, _| {
                if resumed.get().elapsed() < budget {
                    return Ok(VmState::Continue);
                }
                let s = budget.as_secs_f64();
                Err(lerr_at(lua, 0, &format!("the script ran for {s} s without sim.sleep or sim.wait")))
            })?;
            Ok(t)
        });
        match thread {
            Ok(t) => {
                runner.state.borrow_mut().thread = Some(t);
                self.resume(&key, true);
            }
            Err(e) => {
                self.event(LuaEvent::Stopped { name: name.into() });
                self.event(LuaEvent::Error { name: name.into(), message: message(&e) });
            }
        }
    }

    /// Stops a script (or the REPL's current submission; `quit` drops the
    /// REPL's state too).
    pub fn stop(&mut self, name: &str, repl: bool, quit: bool) {
        let key = if repl { Key::Repl } else { Key::Script(name.to_string()) };
        self.stop_thread(&key, true);
        if !repl || quit {
            self.runners.remove(&key);
        }
    }

    fn event(&mut self, e: LuaEvent) {
        self.globals.borrow_mut().events.push(e);
    }

    /// Cancels the thread's wake-ups and drops it; `report`: tell the client.
    fn stop_thread(&mut self, key: &Key, report: bool) {
        self.clear_waits(key);
        let Some(runner) = self.runners.get(key) else { return };
        let mut st = runner.state.borrow_mut();
        if st.thread.take().is_some() && report {
            let name = st.name.clone();
            drop(st);
            self.event(LuaEvent::Stopped { name });
        }
    }

    fn clear_waits(&mut self, key: &Key) {
        let Some(runner) = self.runners.get(key) else { return };
        let waits = std::mem::take(&mut runner.state.borrow_mut().waits);
        let mut g = self.globals.borrow_mut();
        for id in &waits {
            g.wakes.remove(id);
        }
        let mut s = g.sim.borrow_mut();
        if let Some(sim) = s.as_mut() {
            for id in waits {
                sim.unmonitor(id);
                sim.unalarm(id);
            }
        }
    }

    fn resume(&mut self, key: &Key, first: bool) {
        self.clear_waits(key);
        let runner = &self.runners[key];
        let Some(thread) = runner.state.borrow().thread.clone() else { return };
        self.resumed.set(Instant::now());
        let result = thread.resume::<MultiValue>(());
        let name = runner.state.borrow().name.clone();
        match result {
            Ok(_) if thread.status() == ThreadStatus::Resumable => {
                if first {
                    self.event(LuaEvent::Started { name });
                }
            }
            Ok(values) => {
                let print = runner.state.borrow().print_result && !values.is_empty();
                if print {
                    let tostring: mlua::Result<Function> = runner.lua.globals().get("tostring");
                    let messages = tostring.and_then(|f| {
                        values.iter().map(|v| f.call::<String>(v.clone())).collect::<mlua::Result<Vec<_>>>()
                    });
                    match messages {
                        Ok(messages) => self.event(LuaEvent::Print { name: name.clone(), messages }),
                        Err(e) => self.event(LuaEvent::Error { name: name.clone(), message: message(&e) }),
                    }
                }
                self.stop_thread(key, true);
            }
            Err(e) => {
                self.stop_thread(key, true);
                self.event(LuaEvent::Error { name, message: message(&e) });
            }
        }
    }

    /// Resumes the scripts whose wake-ups fired; returns the other events
    /// (the client's).
    pub fn on_events(&mut self, events: Vec<Event>) -> Vec<Event> {
        let mut client = vec![];
        let mut wake = vec![];
        for e in events {
            let id = match &e {
                Event::Monitor { id, .. } | Event::Alarm { id, .. } if *id >= FIRST_ID => *id,
                _ => {
                    client.push(e);
                    continue;
                }
            };
            if let Some(key) = self.globals.borrow().wakes.get(&id) {
                wake.push(key.clone());
            }
        }
        for key in wake {
            // a thread waiting on several events wakes once
            let waiting = self.runners.get(&key).is_some_and(|r| !r.state.borrow().waits.is_empty());
            if waiting {
                self.resume(&key, false);
            }
        }
        client
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_script_that_never_yields_is_stopped() {
        let mut engine = LuaEngine::new(Rc::new(RefCell::new(None)));
        engine.budget = Duration::from_millis(50);
        engine.run("t", "local n = 0\nwhile true do n = n + 1 end", false, "t.lua");
        let events = engine.take_events();
        assert!(
            matches!(&events[..], [LuaEvent::Stopped { .. }, LuaEvent::Error { message, .. }] if message.contains("t.lua:2: the script ran for")),
            "{events:?}"
        );
        assert!(!engine.active());
    }
}
