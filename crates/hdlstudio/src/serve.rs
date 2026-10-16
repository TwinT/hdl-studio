//! `hdlstudio serve`: the engine as a child process, one JSON object per
//! line both ways. It runs like digitaljs's simulation worker: a free
//! running loop (rate-limited or flat out) in 10 ms slices, an `update` with
//! the changed outputs of the observed (sub)circuits every 25 ms, monitors
//! and alarms checked after each step.
//!
//! Requests (`op`), all addressed by digitaljs path ("dev3/dev12"; a
//! subcircuit's graph is its path plus "/", the top level is ""):
//!   load {session, circuit, defaultcomb}   step {id, next, sync}
//!   start   start_fast   stop {id, sync}   interval {ms}   ping {id, sync}
//!   set_input {path, value}   set_param {path, name, value}
//!   mem_write {path, addr, value}   observe {graph}   unobserve {graph}
//!   monitor {id, path, port, triggers, stop, once}   unmonitor {id}
//!   alarm {id, tick, stop}   unalarm {id}
//!   lua_run {name, script, repl, label}   lua_stop {name, repl, quit}
//!   watch {id, path, port}   unwatch {id}   (record an output's changes)
//!   wave {id, watches: [id], from, to, bins}   (acked with their windows,
//!   see wave.rs, by watch id, and the tick)
//! Events (`ev`), each with the `session` of the last load:
//!   update {tick, pending, changes: [[path, port, value]],
//!           mems: [[path, addr, value]], states: [[path, state]]}
//!   ack {id, result}   monitor {id, tick, value, stop, once}
//!   alarm {id, tick, stop}   error {message}
//!   lua_print {name, messages}   lua_started {name}   lua_stopped {name}
//!   lua_error {name, message}
//! Values are binary strings, most significant bit first.

use crate::lua::{LuaEngine, LuaEvent, SharedSim};
use crate::wave::Wave;
use hdlstudio_logic::LogicVec;
use hdlstudio_netlist::Circuit;
use hdlstudio_sim::{Event, Sim};
use std::cell::RefCell;
use std::rc::Rc;
use serde_json::{Value, json};
use std::collections::{HashMap, HashSet};
use std::io::{BufRead, Write};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::time::{Duration, Instant};

const SLICE: Duration = Duration::from_millis(10);
/// Monitor ids of the watches (the client's are below, Lua's above).
const WATCH: u64 = 1 << 61;
const UPDATE: Duration = Duration::from_millis(25);

enum Mode {
    Stopped,
    /// `start`: `interval` ms per tick (fractional for >1k ticks/s).
    Interval { last: Instant, owed: f64 },
    Fast,
}

struct Server {
    /// Shared with the scripts, which run on this thread between steps.
    sim: SharedSim,
    lua: LuaEngine,
    session: Value,
    mode: Mode,
    interval: f64,
    observed: HashSet<String>,
    /// Probes by net, and the graph each probe is in.
    probes_by_net: HashMap<u32, Vec<usize>>,
    probe_graph: Vec<String>,
    /// Probes to send whatever their net did (a graph just observed).
    resend: Vec<usize>,
    mems: Vec<Value>,
    states: Vec<Value>,
    watches: HashMap<u64, Wave>,
    last_update: Instant,
    dirty: bool,
    out: std::io::BufWriter<std::io::Stdout>,
}

fn bin(v: &LogicVec) -> Value {
    Value::String(v.to_bin())
}

fn graph_of(path: &str) -> String {
    path.rfind('/').map_or(String::new(), |i| path[..=i].to_string())
}

impl Server {
    fn send(&mut self, mut ev: Value) {
        ev["session"] = self.session.clone();
        serde_json::to_writer(&mut self.out, &ev).unwrap();
        self.out.write_all(b"\n").unwrap();
    }

    /// Runs `f` on the circuit.
    fn with<R>(&self, f: impl FnOnce(&mut Sim) -> Result<R, String>) -> Result<R, String> {
        f(self.sim.borrow_mut().as_mut().ok_or("no circuit loaded")?)
    }

    fn update(&mut self) {
        let shared = self.sim.clone();
        let mut b = shared.borrow_mut();
        let Some(sim) = b.as_mut() else { return };
        let mut probes: Vec<usize> = std::mem::take(&mut self.resend);
        for net in sim.take_changed() {
            probes.extend(self.probes_by_net.get(&net).into_iter().flatten().filter(|&&p| self.observed.contains(&self.probe_graph[p])));
        }
        probes.sort_unstable();
        probes.dedup();
        let changes: Vec<Value> =
            probes.iter().map(|&p| json!([sim.probes[p].path, sim.probes[p].port, bin(sim.value(&sim.probes[p]))])).collect();
        let (tick, pending) = (sim.tick(), sim.has_pending_events());
        let ev = json!({
            "ev": "update", "tick": tick, "pending": pending, "changes": changes,
            "mems": std::mem::take(&mut self.mems), "states": std::mem::take(&mut self.states),
        });
        self.send(ev);
        self.last_update = Instant::now();
        self.dirty = false;
    }

    /// Sends what the last step(s) produced; a monitor or alarm that asks to
    /// stop stops the run. The update goes first, so a callback sees the
    /// values that triggered it.
    fn events(&mut self) {
        let Some((events, stop)) = self.sim.borrow_mut().as_mut().map(Sim::take_events) else { return };
        if stop {
            self.mode = Mode::Stopped;
        }
        // the scripts' wake-ups: they run now, stopped at this tick
        let mut events = self.lua.on_events(events);
        self.lua_events();
        events.retain(|e| match e {
            Event::Monitor { id, tick, value, .. } if *id >= WATCH => {
                if let Some(w) = self.watches.get_mut(&(id - WATCH)) {
                    w.push(*tick, value.clone());
                }
                false
            }
            _ => true,
        });
        if events.iter().any(|e| matches!(e, Event::Monitor { .. } | Event::Alarm { .. })) {
            self.update();
        }
        for e in events {
            match e {
                Event::Monitor { id, tick, value, stop, once } => {
                    self.send(json!({"ev": "monitor", "id": id, "tick": tick, "value": bin(&value), "stop": stop, "once": once}))
                }
                Event::Alarm { id, tick, stop } => self.send(json!({"ev": "alarm", "id": id, "tick": tick, "stop": stop})),
                Event::Memory { path, addr, value } => self.mems.push(json!([path, addr, bin(&value)])),
                Event::FsmState { path, state } => {
                    if self.observed.contains(&graph_of(&path)) {
                        self.states.push(json!([path, state]));
                    }
                }
            }
        }
        self.dirty = true;
    }

    fn lua_events(&mut self) {
        for e in self.lua.take_events() {
            let ev = match e {
                LuaEvent::Print { name, messages } => json!({"ev": "lua_print", "name": name, "messages": messages}),
                LuaEvent::Started { name } => json!({"ev": "lua_started", "name": name}),
                LuaEvent::Stopped { name } => json!({"ev": "lua_stopped", "name": name}),
                LuaEvent::Error { name, message } => json!({"ev": "lua_error", "name": name, "message": message}),
            };
            self.send(ev);
        }
    }

    fn step(&mut self, next: bool) -> Result<usize, String> {
        let r = self.with(|s| if next { s.update_gates_next() } else { s.update_gates() });
        self.events();
        r
    }

    fn run_slice(&mut self) -> Result<(), String> {
        let start = Instant::now();
        match &mut self.mode {
            Mode::Stopped => {}
            Mode::Fast => {
                while start.elapsed() < SLICE && matches!(self.mode, Mode::Fast) && self.with(|s| Ok(s.has_pending_events()))? {
                    self.step(true)?;
                }
            }
            Mode::Interval { last, owed } => {
                // as digitaljs's worker: run the ticks owed since the last
                // slice; empty ticks cost nothing; a backlog is dropped
                *owed += start.duration_since(*last).as_secs_f64() * 1000.0 / self.interval;
                *last = start;
                let steps = owed.floor();
                if steps < 1.0 {
                    return Ok(());
                }
                *owed -= steps;
                let target = self.with(|s| Ok(s.tick()))? + steps as u64;
                while matches!(self.mode, Mode::Interval { .. }) && self.with(|s| Ok(s.next_event_tick()))?.is_some_and(|k| k < target) {
                    self.step(true)?;
                    if start.elapsed() >= SLICE {
                        if let Mode::Interval { owed, .. } = &mut self.mode {
                            *owed = 0.0;
                        }
                        return Ok(());
                    }
                }
                if matches!(self.mode, Mode::Interval { .. }) {
                    self.with(|s| {
                        s.skip_to(target);
                        Ok(())
                    })?;
                    self.dirty = true;
                }
            }
        }
        Ok(())
    }

    fn handle(&mut self, line: &str) -> Result<(), String> {
        let req: Value = serde_json::from_str(line).map_err(|e| format!("bad request: {e}"))?;
        let str_ = |k: &str| req[k].as_str().ok_or_else(|| format!("{k} missing"));
        let u64_ = |k: &str| req[k].as_u64().ok_or_else(|| format!("{k} missing"));
        let vec_ = |k: &str| -> Result<LogicVec, String> {
            let s = str_(k)?;
            LogicVec::from_bin(s, Some(s.len())).ok_or_else(|| format!("bad value {s}"))
        };
        let flag = |k: &str| req[k].as_bool().unwrap_or(false);
        let ack = |s: &mut Server, result: Value| {
            if let Some(id) = req.get("id").filter(|v| !v.is_null()) {
                s.send(json!({"ev": "ack", "id": id, "result": result}));
            }
        };
        match str_("op")? {
            "load" => {
                let circuit: Circuit = serde_json::from_value(req["circuit"].clone()).map_err(|e| format!("bad circuit: {e}"))?;
                let sim = Sim::new(&circuit, flag("defaultcomb"))?;
                self.session = req["session"].clone();
                self.probes_by_net.clear();
                self.probe_graph = sim.probes.iter().map(|p| graph_of(&p.path)).collect();
                for (i, _) in sim.probes.iter().enumerate() {
                    self.probes_by_net.entry(sim.net_of(i)).or_default().push(i);
                }
                *self.sim.borrow_mut() = Some(sim);
                self.lua.reset();
                self.mode = Mode::Stopped;
                self.observed.clear();
                self.resend.clear();
                self.mems.clear();
                self.states.clear();
                self.watches.clear();
                ack(self, Value::Null);
            }
            "step" => {
                let count = self.step(flag("next"))?;
                if flag("sync") {
                    self.update();
                }
                ack(self, json!(count));
            }
            "start" => self.mode = Mode::Interval { last: Instant::now(), owed: 0.0 },
            "start_fast" => self.mode = Mode::Fast,
            "stop" => {
                self.mode = Mode::Stopped;
                if flag("sync") {
                    self.update();
                }
                ack(self, Value::Null);
            }
            "ping" => {
                if flag("sync") {
                    self.update();
                }
                ack(self, Value::Null);
            }
            "interval" => self.interval = req["ms"].as_f64().ok_or("ms missing")?,
            "set_input" => {
                let (path, v) = (str_("path")?, vec_("value")?);
                self.with(|s| s.set_input(path, v))?;
                self.dirty = true;
            }
            "set_param" => {
                if str_("name")? == "propagation" {
                    let (path, p) = (str_("path")?, u64_("value")?);
                    self.with(|s| s.set_propagation(path, p))?;
                }
            }
            "mem_write" => {
                let (path, addr, v) = (str_("path")?, u64_("addr")?, vec_("value")?);
                self.with(|s| s.write_memory(path, addr as usize, v))?;
                self.dirty = true;
            }
            "observe" => {
                let graph = str_("graph")?.to_string();
                self.resend.extend((0..self.probe_graph.len()).filter(|&p| self.probe_graph[p] == graph));
                self.observed.insert(graph);
                self.dirty = true;
            }
            "unobserve" => {
                self.observed.remove(str_("graph")?);
            }
            "monitor" => {
                let (id, path, port) = (u64_("id")?, str_("path")?, str_("port")?);
                let triggers = match req["triggers"].as_array() {
                    Some(t) => Some(
                        t.iter()
                            .map(|v| v.as_str().and_then(|s| LogicVec::from_bin(s, Some(s.len()))).ok_or("bad trigger"))
                            .collect::<Result<Vec<_>, _>>()?,
                    ),
                    None => None,
                };
                self.with(|s| {
                    let probe = s.find_probe(path, port).ok_or_else(|| format!("no output {path}.{port}"))?;
                    s.monitor(id, s.net_of(probe), triggers, flag("stop"), flag("once"));
                    Ok(())
                })?;
                self.events();
            }
            "unmonitor" => {
                let id = u64_("id")?;
                self.with(|s| {
                    s.unmonitor(id);
                    Ok(())
                })?
            }
            "alarm" => {
                let (id, tick, stop) = (u64_("id")?, u64_("tick")?, flag("stop"));
                self.with(|s| {
                    s.alarm(id, tick, stop);
                    Ok(())
                })?;
            }
            "unalarm" => {
                let id = u64_("id")?;
                self.with(|s| {
                    s.unalarm(id);
                    Ok(())
                })?
            }
            "watch" => {
                let (id, path, port) = (u64_("id")?, str_("path")?, str_("port")?);
                self.with(|s| {
                    let probe = s.find_probe(path, port).ok_or_else(|| format!("no output {path}.{port}"))?;
                    // reports the value now, then each change
                    s.monitor(WATCH + id, s.net_of(probe), None, false, false);
                    Ok(())
                })?;
                self.watches.insert(id, Wave::default());
                self.events();
            }
            "unwatch" => {
                let id = u64_("id")?;
                self.watches.remove(&id);
                self.with(|s| {
                    s.unmonitor(WATCH + id);
                    Ok(())
                })?
            }
            "wave" => {
                let (from, to, bins) = (u64_("from")?, u64_("to")?, u64_("bins")?);
                let mut waves = serde_json::Map::new();
                for id in req["watches"].as_array().ok_or("watches missing")?.iter().filter_map(Value::as_u64) {
                    if let Some(w) = self.watches.get(&id) {
                        waves.insert(id.to_string(), w.window(from, to.max(from), bins));
                    }
                }
                let tick = self.with(|s| Ok(s.tick()))?;
                ack(self, json!({"tick": tick, "waves": waves}));
            }
            "lua_run" => {
                let (name, script) = (str_("name")?, str_("script")?);
                let label = req["label"].as_str().unwrap_or(name);
                self.lua.run(name, script, flag("repl"), label);
                self.lua_events();
                self.dirty = true;
            }
            "lua_stop" => {
                self.lua.stop(str_("name").unwrap_or_default(), flag("repl"), flag("quit"));
                self.lua_events();
            }
            op => return Err(format!("unknown op {op}")),
        }
        Ok(())
    }
}

pub fn serve() -> Result<(), String> {
    let (tx, rx) = mpsc::channel::<String>();
    std::thread::spawn(move || {
        for line in std::io::stdin().lock().lines() {
            let Ok(line) = line else { break };
            if tx.send(line).is_err() {
                break;
            }
        }
    });
    let sim: SharedSim = Rc::new(RefCell::new(None));
    let mut s = Server {
        lua: LuaEngine::new(sim.clone()),
        sim,
        session: Value::Null,
        mode: Mode::Stopped,
        interval: 10.0,
        observed: HashSet::new(),
        probes_by_net: HashMap::new(),
        probe_graph: vec![],
        resend: vec![],
        mems: vec![],
        states: vec![],
        watches: HashMap::new(),
        last_update: Instant::now(),
        dirty: false,
        out: std::io::BufWriter::new(std::io::stdout()),
    };
    let mut next_slice = Instant::now();
    loop {
        let running = !matches!(s.mode, Mode::Stopped);
        let wait = if running { next_slice.saturating_duration_since(Instant::now()) } else { Duration::from_secs(3600) };
        let first = match rx.recv_timeout(wait) {
            Ok(line) => Some(line),
            Err(RecvTimeoutError::Timeout) => None,
            Err(RecvTimeoutError::Disconnected) => return Ok(()),
        };
        for line in first.into_iter().chain(std::iter::from_fn(|| rx.try_recv().ok())) {
            if let Err(e) = s.handle(&line) {
                s.send(json!({"ev": "error", "message": e}));
            }
        }
        if !matches!(s.mode, Mode::Stopped) && Instant::now() >= next_slice {
            next_slice = Instant::now() + SLICE;
            if let Err(e) = s.run_slice() {
                s.mode = Mode::Stopped;
                s.send(json!({"ev": "error", "message": e}));
            }
            // flat out runs slice after slice while there is something to do
            if matches!(s.mode, Mode::Fast) && s.sim.borrow().as_ref().is_some_and(Sim::has_pending_events) {
                next_slice = Instant::now();
            }
        }
        let running = !matches!(s.mode, Mode::Stopped);
        if (running && s.last_update.elapsed() >= UPDATE) || (!running && s.dirty) {
            s.update();
        }
        s.out.flush().map_err(|e| e.to_string())?;
    }
}
