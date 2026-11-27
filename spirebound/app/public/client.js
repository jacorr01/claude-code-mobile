/**
 * Spirebound — screens, HUD and the link to the hall.
 *
 * The fight runs in game.js; this file owns everything around it: loading,
 * menus, the DOM HUD, and the socket to the room that deals seeds and keeps the
 * Hall of Ascents. The game is fully playable offline — a run simply goes
 * unrecorded when the hall cannot be reached.
 */
import { STR, HEROES, HERO_ORDER, REALMS, BOSSES, ABILITIES, ENEMIES, TUNE, SCORE_CAP } from "./data.js";
import { ANIMS } from "./anims.js";
import { MODELS } from "./models.js";
import { Stage3D } from "./stage3d.js";
import { Game } from "./game.js";
import { Sound } from "./audio.js";
import { Input } from "./input.js";

const $ = (s) => document.querySelector(s);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
const params = new URLSearchParams(location.search);
const DEV = {
  auto: params.get("auto") === "1",
  speed: Math.max(1, Math.min(16, Number(params.get("speed")) || 1)),
  dev: params.get("dev") === "1",
  hero: params.get("hero"),
  ab: (params.get("ab") || "").split(",").filter(Boolean),
  realm: Math.max(0, Math.min(2, Number(params.get("realm")) || 0)),
  skip: Number(params.get("skip")) || 0,
};
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};
const NAME_RE = /^[A-Za-z0-9 _.'-]{1,16}$/;
const fmt = (n) => Math.round(n).toLocaleString("en-US");
const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

const settings = { sound: store.get("spire:sound", "1") === "1", shake: store.get("spire:shake", "1") === "1" };

// ── art ────────────────────────────────────────────────────────────────────

const art = { anims: {} };
function loadImage(src) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => res(img);
    img.onerror = () => rej(new Error("failed to load " + src));
    img.src = src;
  });
}
async function loadArt(id, ext) {
  if (art[id]) return;
  const img = await loadImage(`/art/${id}.${ext}`);
  art[id] = { id, img, aspect: img.naturalWidth / img.naturalHeight };
}
const loadFloor = (id) => loadArt(id, "jpg").catch(() => {});
/** Animation sheets cut from generated clips; a hero without one simply uses their still. */
async function loadAnim(hero, act, meta) {
  const img = await loadImage(meta.src);
  (art.anims[hero] ||= {})[act] = { ...meta, id: `${hero}_${act}`, img };
}

// ── the game, its sound and its input ──────────────────────────────────────

// The 3D character layer. `?flat=1` (or a browser without WebGL) falls back to sprites.
const coarse = matchMedia("(pointer: coarse)").matches;
const stage = params.get("flat") === "1" ? null : new Stage3D($("#gl"), coarse);
const modelJobs = {};
function loadModel(id) {
  const m = MODELS[id];
  if (!stage || !stage.ok || !m) return Promise.resolve();
  return (modelJobs[id] ||= stage.load(id, m.src, m).catch(() => {}));
}
/** Every model a realm needs: the hero, its foes and its guardian. */
function realmModels(index, heroId) {
  const r = REALMS[index];
  const ids = new Set([HEROES[heroId].sprite, BOSSES[r.boss].sprite, ENEMIES[BOSSES[r.boss].minion].sprite]);
  for (const w of r.waves) for (const [type] of w.mix) ids.add(ENEMIES[type].sprite);
  return Promise.all([...ids].map(loadModel));
}
const wait = (ms) => new Promise((res) => setTimeout(res, ms));

const sound = new Sound();
sound.on = settings.sound;
let input = null;
let run = { hero: store.get("spire:hero", "gunner"), loadout: [], ranked: false, started: false, over: true };
const handlers = {};
const game = new Game($("#cv"), art, {
  poll: () => input && input.poll(),
  frame: (dt) => hud(dt),
  sfx: (n, v, r) => sound.play(n, v, r),
  event: (type, d) => handlers[type] && handlers[type](d),
}, { shake: settings.shake, auto: DEV.auto, speed: DEV.speed, dev: DEV.dev, stage, top: $("#fx") });
input = new Input(game, $("#cv"), $("#stick"));
addEventListener("resize", () => game.resize());
if (matchMedia("(pointer: coarse)").matches) document.body.classList.add("touch");
window.__spire = { game, art, stage };

// ── screens ────────────────────────────────────────────────────────────────

const SCREENS = ["load", "title", "hero", "loadout", "realm", "end"];
function show(id) {
  for (const s of SCREENS) $("#scr-" + s).classList.toggle("show", s === id);
}
function overlay(id, on) {
  $("#scr-" + id).classList.toggle("show", on);
}
function hudOn(on) {
  $("#hud").classList.toggle("on", on);
  if (!on) $("#bossBar").classList.remove("on");
}

let bannerTimer = 0;
function banner(title, sub, ms, hazard) {
  const b = $("#banner");
  $("#bannerTitle").textContent = title;
  $("#bannerSub").textContent = sub || "";
  b.classList.toggle("hazard", !!hazard);
  b.classList.add("on");
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => b.classList.remove("on"), ms);
}

function applyStrings() {
  document.querySelectorAll("[data-t]").forEach((n) => { n.textContent = STR[n.dataset.t]; });
  document.title = STR.title;
  const list = $("#ctlList");
  for (const [what, how] of STR.ctl) {
    const row = el("div");
    row.append(el("dt", "", what), el("dd", "", how));
    list.append(row);
  }
  syncToggles();
}

function syncToggles() {
  const s = `${STR.sound}: ${settings.sound ? STR.on : STR.off}`;
  $("#btnSound").textContent = s;
  $("#tglSound").textContent = s;
  $("#tglShake").textContent = `${STR.shake}: ${settings.shake ? STR.on : STR.off}`;
}
function toggleSound() {
  settings.sound = !settings.sound;
  store.set("spire:sound", settings.sound ? "1" : "0");
  sound.setOn(settings.sound);
  sound.unlock();
  syncToggles();
}
function toggleShake() {
  settings.shake = !settings.shake;
  store.set("spire:shake", settings.shake ? "1" : "0");
  game.opts.shake = settings.shake;
  syncToggles();
}

function buildHeroes() {
  const wrap = $("#heroes");
  for (const id of HERO_ORDER) {
    const h = HEROES[id];
    const card = el("article", "hero-card");
    card.style.setProperty("--c", h.color);
    const pic = el("div", "pic");
    const img = el("img");
    img.src = `/art/${h.sprite}.webp`;
    img.alt = h.name;
    pic.append(img);
    const title = el("h3", "", h.name);
    title.append(el("span", "role", h.role));
    const body = el("div", "body");
    body.append(el("p", "", h.blurb));
    const grid = el("div", "statgrid");
    for (const [k, v] of Object.entries(h.stats)) {
      const pips = el("div", "pips");
      for (let i = 1; i <= 5; i++) pips.append(el("i", i <= v ? "on" : ""));
      grid.append(el("span", "", k), pips);
    }
    const kit = el("div", "kit");
    const dash = el("p");
    dash.append(el("b", "", STR.dash + ": "), h.dashNote);
    const ult = el("p");
    ult.append(el("b", "", h.ult.name + ": "), h.ultNote);
    kit.append(dash, ult);
    body.append(grid, kit);
    const go = el("button", "btn primary", `${STR.ascend} · ${h.name}`);
    go.type = "button";
    go.addEventListener("click", () => openLoadout(id));
    card.append(pic, title, body, go);
    wrap.append(card);
  }
}

// ── the hall (network) ─────────────────────────────────────────────────────

/** A private hall per browser unless a shared one is named in the link. */
function hallRoom() {
  const named = params.get("room");
  if (named && /^[A-Za-z0-9_-]{1,64}$/.test(named)) return named;
  let id = store.get("spire:hall", "");
  if (!id) {
    id = "h-" + Math.random().toString(36).slice(2, 10);
    store.set("spire:hall", id);
  }
  return id;
}
function playerId() {
  let id = store.get("hf:game:playerId", "");
  if (!id) {
    id = Math.random().toString(36).slice(2, 12);
    store.set("hf:game:playerId", id);
  }
  return id;
}

const PING = "__ping", PONG = "__pong";
const room = hallRoom();
const net = { ws: null, retry: 0, view: null, seated: false, onRun: null, lastN: -1 };

function connect() {
  let ws;
  try {
    ws = new WebSocket(`${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/ws/${encodeURIComponent(room)}`);
  } catch {
    return;
  }
  net.ws = ws;
  ws.addEventListener("open", () => {
    net.retry = 0;
    send({ type: "join", playerId: playerId() });
  });
  ws.addEventListener("message", (event) => {
    if (event.data === PONG) return;
    let msg;
    try { msg = JSON.parse(event.data); } catch { return; }
    if (msg.type !== "state" || !msg.view) return;
    const first = net.view === null;
    net.view = msg.view;
    net.seated = msg.status === "playing" && Array.isArray(msg.seats) && msg.seats.includes(msg.you);
    const r = msg.view.run;
    if (first) {
      net.lastN = r ? r.n : 0;
      const mine = store.get("spire:name", "");
      if (net.seated && NAME_RE.test(mine) && mine !== msg.view.name) act({ type: "name", name: mine });
    } else if (r && r.n !== net.lastN) {
      net.lastN = r.n;
      if (net.onRun) net.onRun(r);
    }
    renderHall();
  });
  ws.addEventListener("close", () => {
    net.seated = false;
    net.retry = Math.min(net.retry + 1, 6);
    setTimeout(connect, 500 * 2 ** (net.retry - 1));
  });
  ws.addEventListener("error", () => { /* close follows */ });
}
function send(msg) {
  if (net.ws && net.ws.readyState === WebSocket.OPEN) net.ws.send(JSON.stringify(msg));
}
const act = (action) => send({ type: "action", action });
setInterval(() => {
  if (net.ws && net.ws.readyState === WebSocket.OPEN) net.ws.send(PING);
}, 30000);

function renderHall() {
  const hall = (net.view && net.view.hall) || [];
  document.querySelectorAll(".hall-list").forEach((list) => {
    list.textContent = "";
    if (!hall.length) {
      list.append(el("li", "empty", STR.hallEmpty));
      return;
    }
    hall.forEach((e, i) => {
      const li = el("li", e.you ? "you" : "");
      const who = el("span", "who", e.name);
      who.append(el("small", "", (HEROES[e.hero] ? HEROES[e.hero].name : "") + (e.you ? ` · ${STR.you}` : "")));
      const reach = el("span", "reach", e.won ? `♛ ${STR.climbed}` : `${STR.realm} ${REALMS[Math.min(e.realm, REALMS.length - 1)].numeral}`);
      li.append(el("span", "", String(i + 1)), who, reach, el("span", "pts", fmt(e.score)));
      list.append(li);
    });
  });
  const nameInput = $("#nameInput");
  if (document.activeElement !== nameInput) nameInput.value = (net.view && net.view.name) || store.get("spire:name", "");
}

// ── loadout ────────────────────────────────────────────────────────────────

const DOT = String.fromCharCode(183), TIMES = String.fromCharCode(215);
const lo = { hero: null, picks: [] };
function savedLoadout(heroId) {
  const h = HEROES[heroId];
  const saved = store.get("spire:lo:" + heroId, "").split(",").filter((id) => h.abilities.includes(id));
  const picks = [...new Set(saved)].slice(0, 2);
  for (const id of h.abilities) if (picks.length < 2 && !picks.includes(id)) picks.push(id);
  return picks;
}
function iconImg(id, cls) {
  const img = el("img", cls || "");
  img.src = `/art/icons/${id}.webp`;
  img.alt = "";
  return img;
}
function renderLoadout() {
  const h = HEROES[lo.hero], list = $("#abList");
  list.textContent = "";
  for (const id of h.abilities) {
    const a = ABILITIES[id], slot = lo.picks.indexOf(id);
    const card = el("button", "ab-card" + (slot >= 0 ? " on" : ""));
    card.type = "button";
    card.setAttribute("aria-pressed", slot >= 0 ? "true" : "false");
    const text = el("div", "txt");
    const head = el("b", "", a.name);
    head.append(el("small", "", `${a.tag} ${DOT} ${a.cd}${STR.recharge}`));
    text.append(head, el("span", "", a.desc));
    card.append(iconImg(id), text, el("i", "slot", slot >= 0 ? String(slot + 1) : ""));
    card.addEventListener("click", () => {
      if (lo.picks.includes(id)) return;
      // The older pick makes way: you always hold exactly two.
      lo.picks.shift();
      lo.picks.push(id);
      sound.play("pick", 0.7);
      renderLoadout();
    });
    list.append(card);
  }
}
function openLoadout(heroId) {
  sound.unlock();
  const h = HEROES[heroId];
  lo.hero = heroId;
  lo.picks = savedLoadout(heroId);
  $("#scr-loadout").style.setProperty("--c", h.color);
  $("#loadName").textContent = h.name;
  $("#loadPic").src = `/art/${h.sprite}.webp`;
  const kit = $("#kitList");
  kit.textContent = "";
  for (const [icon, name, note] of [["dash", STR.dash, h.dashNote], [h.ult.id, h.ult.name, h.ultNote]]) {
    const row = el("div", "kit-row");
    const text = el("p");
    text.append(el("b", "", name + ": "), note);
    row.append(iconImg(icon), text);
    kit.append(row);
  }
  renderLoadout();
  show("loadout");
}

// ── run flow ───────────────────────────────────────────────────────────────

function startRun(heroId, loadout) {
  sound.unlock();
  const picks = Array.isArray(loadout) && loadout.length === 2 ? loadout : savedLoadout(heroId);
  store.set("spire:hero", heroId);
  store.set("spire:lo:" + heroId, picks.join(","));
  run = { hero: heroId, loadout: picks, ranked: false, started: false, over: false };
  const mine = run;
  const begin = (seed, ranked) => {
    if (mine.started || run !== mine) return;
    mine.started = true;
    mine.ranked = ranked;
    net.onRun = null;
    const h = HEROES[heroId];
    $("#hudPortrait").src = `/art/${h.sprite}.webp`;
    $("#hud").style.setProperty("--hero", h.color);
    for (const id of ["dashBtn", "a1Btn", "a2Btn"]) $("#" + id).style.setProperty("--c", h.color);
    $("#a1Btn img").src = `/art/icons/${picks[0]}.webp`;
    $("#a2Btn img").src = `/art/icons/${picks[1]}.webp`;
    $("#ultBtn img").src = `/art/icons/${h.ult.id}.webp`;
    game.start(heroId, seed, picks);
    if (DEV.realm) game.beginRealm(DEV.realm);
  };
  const local = () => ((Date.now() ^ (Math.random() * 0xffffffff)) >>> 0) || 1;
  if (net.seated) {
    net.onRun = (r) => begin(r.seed, true);
    act({ type: "start", hero: heroId });
    setTimeout(() => begin(local(), false), 1500);
  } else begin(local(), false);
}

handlers.realm = ({ index }) => {
  const r = REALMS[index];
  input.mode = "off";
  input.release();
  hudOn(false);
  overlay("choice", false);
  $("#realmArt").src = `/art/${r.key}.jpg`;
  $("#realmNum").textContent = `${STR.realm} ${r.numeral}`;
  $("#realmTitle").textContent = r.name;
  $("#realmHint").textContent = r.hint;
  show("realm");
  // The floor and this realm's models load behind the intro card (models may take a moment longer;
  // anything not ready yet is drawn as a sprite until it arrives).
  const floor = Promise.all([loadFloor(r.floor), Promise.race([realmModels(index, run.hero), wait(9000)])]);
  if (stage && stage.ok) stage.light(r.light[0], r.light[1], r.light[2]);
  const next = REALMS[index + 1];
  let done = false;
  const scr = $("#scr-realm");
  const enter = () => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    input.onAny = null;
    scr.onclick = null;
    floor.then(() => {
      show(null);
      hudOn(true);
      $("#realmName").textContent = r.name;
      input.mode = "play";
      game.go();
      if (DEV.skip) game.realmT = DEV.skip;
      sound.music(true);
      banner(r.name, `${STR.realm} ${r.numeral}`, 1800);
      if (next) {
        loadFloor(next.floor);
        realmModels(index + 1, run.hero);
      }
    });
  };
  // Armed a beat late, so the tap that chose the hero or the boon cannot skip the card.
  setTimeout(() => {
    if (done) return;
    scr.onclick = enter;
    input.onAny = () => { enter(); return true; };
  }, 500);
  const timer = setTimeout(enter, DEV.auto ? 250 : 7000);
};

handlers.boss = ({ id }) => banner(BOSSES[id].name, BOSSES[id].title, 2300, true);
handlers.bossSpawn = ({ id }) => {
  $("#bossName").textContent = BOSSES[id].name;
  $("#bossBar").classList.add("on");
};
handlers.pulse = () => banner(STR.ambush, "", 1100, true);
handlers.streak = ({ n }) => {
  banner(STR.streaks[n] || STR.streaks[100], `${n} ${STR.streak}`, 1300);
  sound.play("levelup", 0.5, 1.4);
};
handlers.realmClear = ({ realm, score, bonus }) => {
  $("#bossBar").classList.remove("on");
  banner(STR.realmCleared, `+${fmt(bonus)}`, 2300);
  if (run.ranked) act({ type: "clear", realm, score: Math.min(score, SCORE_CAP[realm]) });
};

handlers.choice = (c) => {
  input.mode = "choice";
  input.release();
  const spoils = c.kind === "spoils";
  $("#choiceTitle").textContent = spoils ? STR.spoils : STR.levelUp;
  $("#choiceHint").textContent = spoils ? STR.spoilsHint : STR.levelHint;
  const wrap = $("#choiceCards");
  wrap.textContent = "";
  wrap.classList.remove("armed");
  let picked = false;
  const choose = (i) => {
    const o = c.options[i];
    if (!o || picked || !wrap.classList.contains("armed")) return;
    picked = true;
    input.onPick = null;
    overlay("choice", false);
    input.mode = "play";
    game.pick(o.id);
  };
  c.options.forEach((o, i) => {
    const card = el("button", "card");
    card.type = "button";
    card.style.animationDelay = `${i * 70}ms`;
    const ico = el("div", "ico", o.img ? "" : o.icon);
    if (o.img) ico.append(iconImg(o.img));
    card.append(ico, el("b", "", o.name), el("span", "", o.desc + (spoils ? ` ${TIMES}2` : "")), el("small", "", `${STR.rank} ${o.rank} / ${o.max}`), el("kbd", "", String(i + 1)));
    card.addEventListener("click", () => choose(i));
    wrap.append(card);
  });
  input.onPick = choose;
  overlay("choice", true);
  // Armed late so a finger already on the screen cannot pick blind.
  setTimeout(() => {
    wrap.classList.add("armed");
    if (DEV.auto) choose(0);
  }, DEV.auto ? 60 : 380);
};

handlers.end = ({ won, score }) => {
  input.mode = "off";
  input.release();
  run.over = true;
  if (run.ranked) act({ type: "end", score: Math.min(score, SCORE_CAP[game.cleared]), won });
  sound.music(false);
  if (won) sound.play("levelup", 1, 0.8);
  setTimeout(() => showEnd(won), won ? 900 : 1600);
};

function showEnd(won) {
  const p = game.player, r = game.realm;
  hudOn(false);
  overlay("choice", false);
  overlay("pause", false);
  $("#endArt").src = `/art/${won ? "key_title" : r.key}.jpg`;
  $("#endTitle").textContent = won ? STR.won : STR.fell;
  $("#endSub").textContent = won ? STR.wonSub : STR.fellIn.replace("{realm}", r.name);
  const stats = $("#endStats");
  stats.textContent = "";
  for (const [k, v] of [[STR.score, fmt(game.score)], [STR.realms, `${game.cleared} / ${REALMS.length}`], [STR.kills, fmt(p.kills)], [STR.streak, fmt(p.best)], [STR.level, p.level], [STR.time, clock(game.runTime)]]) {
    const d = el("div");
    d.append(el("dt", "", k), el("dd", "", String(v)));
    stats.append(d);
  }
  $("#endNote").textContent = run.ranked ? "" : STR.unranked;
  renderHall();
  game.stop();
  show("end");
  if (DEV.auto) window.__spire.result = { won, score: game.score, cleared: game.cleared, level: p.level, kills: p.kills, time: game.runTime };
}

function togglePause(force) {
  const ph = game.phase;
  const playing = ph === "waves" || ph === "boss" || ph === "bossIntro" || ph === "cleared";
  if (!playing || game.choice) return;
  const on = force === undefined ? !game.paused : force;
  if (on === game.paused) return;
  game.paused = on;
  overlay("pause", on);
  input.mode = on ? "off" : "play";
  input.release();
}

function toTitle() {
  game.stop();
  sound.music(false);
  hudOn(false);
  overlay("pause", false);
  overlay("choice", false);
  input.mode = "off";
  show("title");
}

// ── HUD ────────────────────────────────────────────────────────────────────

const H = {
  hp: $("#hpFill"), hpText: $("#hpText"), xp: $("#xpFill"), lvl: $("#lvlText"), wave: $("#waveFill"), sub: $("#realmSub"),
  score: $("#scoreText"), boss: $("#bossFill"), dash: $("#dashBtn"), ult: $("#ultBtn"), a1: $("#a1Btn"), a2: $("#a2Btn"),
  pips: [...document.querySelectorAll("#dashBtn .charges i")],
  combo: $("#combo"), comboN: $("#comboN"), comboBar: $("#comboBar"),
};
const last = {};
function put(node, key, value, prop) {
  if (last[key] === value) return;
  last[key] = value;
  if (prop === "w") node.style.width = value;
  else if (prop === "cd") node.style.setProperty("--cd", value);
  else if (prop === "ready") node.classList.toggle("ready", value);
  else node.textContent = value;
}
let hudT = 0, slowT = 0;
function hud(dt) {
  hudT += dt;
  // If the frame rate stays low while models are on screen, trade quality for speed.
  if (stage && stage.ok && game.running() && !DEV.auto) {
    slowT = game.fps < 30 ? slowT + dt : Math.max(0, slowT - dt * 2);
    if (slowT > 3) {
      slowT = 0;
      stage.lower();
    }
  }
  if (hudT < 0.066) return;
  hudT = 0;
  const p = game.player;
  if (!p || game.phase === "idle") return;
  put(H.hp, "hp", `${Math.max(0, (p.hp / p.maxHp) * 100).toFixed(1)}%`, "w");
  put(H.hpText, "hpT", `${Math.ceil(p.hp)}/${Math.round(p.maxHp)}`);
  put(H.xp, "xp", `${((p.xp / p.need) * 100).toFixed(1)}%`, "w");
  put(H.lvl, "lvl", `${STR.lvl} ${p.level}`);
  put(H.score, "score", fmt(game.score));
  const boss = game.boss;
  if (boss) {
    put(H.boss, "boss", `${Math.max(0, (boss.hp / boss.maxHp) * 100).toFixed(1)}%`, "w");
    put(H.wave, "wave", "100%", "w");
    put(H.sub, "sub", STR.guardian);
  } else {
    const k = Math.min(1, game.realmT / game.realm.duration);
    put(H.wave, "wave", `${(k * 100).toFixed(1)}%`, "w");
    const left = Math.max(0, Math.ceil(game.realm.duration - game.realmT));
    put(H.sub, "sub", game.phase === "waves" ? `${clock(left)} ${STR.wave}` : "");
  }
  const full = p.dashN >= TUNE.dash.charges;
  put(H.dash, "dash", full ? "0.00" : Math.max(0, Math.min(1, p.dashRe / (game.hero.dashCd * p.dashMul))).toFixed(2), "cd");
  put(H.dash, "dashR", p.dashN > 0, "ready");
  for (let i = 0; i < H.pips.length; i++) put(H.pips[i], "pip" + i, i < p.dashN, "ready");
  for (let i = 0; i < 2; i++) {
    const a = p.ab[i], node = i ? H.a2 : H.a1;
    if (!a) continue;
    put(node, "ab" + i, Math.max(0, Math.min(1, a.cd / a.max)).toFixed(2), "cd");
    put(node, "abR" + i, a.cd <= 0, "ready");
  }
  // kill streak: shown from five, thumps on every kill, and drains as it is about to lapse
  const streak = p.combo >= 5;
  if (last.comboOn !== streak) { last.comboOn = streak; H.combo.classList.toggle("on", streak); }
  if (streak) {
    if (last.comboN !== p.combo) {
      last.comboN = p.combo;
      H.comboN.textContent = String.fromCharCode(215) + p.combo;
      H.combo.classList.remove("hit");
      void H.combo.offsetWidth;
      H.combo.classList.add("hit");
    }
    H.comboBar.style.transform = `scaleX(${Math.max(0, p.comboT / TUNE.comboTime).toFixed(2)})`;
  }
  put(H.ult, "ult", (1 - p.ult / TUNE.ultMax).toFixed(2), "cd");
  put(H.ult, "ultR", p.ult >= TUNE.ultMax, "ready");
}

// ── wiring ─────────────────────────────────────────────────────────────────

function wire() {
  $("#btnBegin").addEventListener("click", () => { sound.unlock(); show("hero"); });
  $("#btnHall").addEventListener("click", () => { renderHall(); overlay("hall", true); });
  $("#btnHallClose").addEventListener("click", () => overlay("hall", false));
  $("#btnSound").addEventListener("click", toggleSound);
  $("#tglSound").addEventListener("click", toggleSound);
  $("#tglShake").addEventListener("click", toggleShake);
  $("#btnHeroBack").addEventListener("click", () => show("title"));
  $("#btnAgain").addEventListener("click", () => startRun(run.hero, run.loadout));
  $("#btnChange").addEventListener("click", () => show("hero"));
  $("#btnLoadBack").addEventListener("click", () => show("hero"));
  $("#btnStart").addEventListener("click", () => startRun(lo.hero, lo.picks.slice()));
  $("#btnResume").addEventListener("click", () => togglePause(false));
  $("#pauseBtn").addEventListener("click", () => togglePause());
  $("#btnAbandon").addEventListener("click", () => {
    if (run.ranked && !run.over) act({ type: "end", score: Math.min(game.score, SCORE_CAP[game.cleared]), won: false });
    run.over = true;
    toTitle();
  });
  const press = (node, key) => node.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    if (input.mode === "play") game.input[key] = true;
  });
  press($("#dashBtn"), "dash");
  press($("#ultBtn"), "ult");
  press($("#a1Btn"), "a1");
  press($("#a2Btn"), "a2");
  input.onPause = () => togglePause();
  input.onBlur = () => togglePause(true);
  $("#nameForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const v = $("#nameInput").value.trim();
    if (!NAME_RE.test(v)) return;
    store.set("spire:name", v);
    act({ type: "name", name: v });
    const b = $("#btnName");
    b.textContent = STR.saved;
    setTimeout(() => { b.textContent = STR.save; }, 1400);
    $("#nameInput").blur();
  });
  $("#btnCopy").addEventListener("click", async () => {
    const url = `${location.origin}/?room=${encodeURIComponent(room)}`;
    const b = $("#btnCopy");
    try {
      await navigator.clipboard.writeText(url);
      b.textContent = STR.copied;
    } catch {
      prompt(STR.copyLink, url);
    }
    setTimeout(() => { b.textContent = STR.copyLink; }, 1600);
  });
}

async function boot() {
  applyStrings();
  buildHeroes();
  wire();
  renderHall();
  const sprites = new Set();
  for (const id of HERO_ORDER) sprites.add(HEROES[id].sprite);
  for (const e of Object.values(ENEMIES)) sprites.add(e.sprite);
  for (const b of Object.values(BOSSES)) sprites.add(b.sprite);
  const jobs = [...sprites].map((id) => loadArt(id, "webp").catch(() => {}));
  jobs.push(loadFloor(REALMS[0].floor), loadImage("/art/key_title.jpg").catch(() => {}));
  for (const [hero, acts] of Object.entries(ANIMS)) for (const [act, meta] of Object.entries(acts)) jobs.push(loadAnim(hero, act, meta).catch(() => {}));
  let done = 0;
  const fill = $("#loadFill");
  await Promise.all(jobs.map((j) => j.then(() => { done++; fill.style.width = `${(done / jobs.length) * 100}%`; })));
  show("title");
  connect();
  if (DEV.auto) startRun(HEROES[DEV.hero] ? DEV.hero : "gunner", DEV.ab.length === 2 ? DEV.ab : null);
}

boot();
