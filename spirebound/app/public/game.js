/**
 * Spirebound — the fight.
 *
 * A fixed-timestep simulation (60 Hz) whose positions are interpolated at render
 * time, so motion stays smooth at any display rate. Gameplay randomness comes
 * from one seeded generator; purely visual randomness uses Math.random.
 */
import { WORLD, TUNE, HEROES, ENEMIES, REALMS, BOSSES, BOONS, ABILITIES, SCORE_CAP, xpNeed } from "./data.js";

const TAU = Math.PI * 2;
const STEP = 1 / 60;
const HAZARD = "#ff5a2a";
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const angDiff = (a, b) => {
  let d = (a - b) % TAU;
  if (d > Math.PI) d -= TAU;
  else if (d < -Math.PI) d += TAU;
  return d;
};

function rng32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Game {
  constructor(canvas, art, hooks, opts = {}) {
    this.cv = canvas;
    this.ctx = canvas.getContext("2d", { alpha: false });
    this.art = art;
    this.hooks = hooks;
    this.opts = { shake: true, auto: false, speed: 1, dev: false, ...opts };
    this.input = { mx: 0, my: 0, dash: false, ult: false, a1: false, a2: false };
    this.phase = "idle";
    this.paused = false;
    this.choice = null;
    this.enemies = [];
    this.shots = [];
    this.zones = [];
    this.fzones = [];
    this.allies = [];
    this.lobs = [];
    this.gems = [];
    this.parts = [];
    this.dusts = [];
    this.texts = [];
    this.rings = [];
    this.fx = [];
    this.corpses = [];
    this.timers = [];
    this.order = [];
    this.ambient = [];
    this.ghosts = [];
    this.sils = new Map();
    this.glows = new Map();
    this.cam = { x: WORLD.w / 2, y: WORLD.h / 2, shake: 0, punch: 0 };
    this.time = 0;
    this.acc = 0;
    this.last = 0;
    this.hitStop = 0;
    this.fps = 60;
    this.hurtFlash = 0;
    this.seq = 1;
    this.player = null;
    this.boss = null;
    this.realm = REALMS[0];
    this.realmIdx = 0;
    this.realmT = 0;
    this.arena = { cx: 0, cy: 0, rx: 1, ry: 1 };
    this.rand = rng32(1);
    this.resize();
    this._frame = this._frame.bind(this);
    requestAnimationFrame(this._frame);
  }

  // ── lifecycle ────────────────────────────────────────────────────────────

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.W = window.innerWidth;
    this.H = window.innerHeight;
    this.dpr = dpr;
    this.cv.width = Math.round(this.W * dpr);
    this.cv.height = Math.round(this.H * dpr);
    this.zoom = 0.34 + Math.sqrt(this.W * this.H) / 1500;
    const v = (this.vig ||= document.createElement("canvas"));
    v.width = v.height = 256;
    const g = v.getContext("2d");
    const gr = g.createRadialGradient(128, 128, 70, 128, 128, 182);
    gr.addColorStop(0, "rgba(0,0,0,0)");
    gr.addColorStop(1, "rgba(0,0,0,0.66)");
    g.fillStyle = gr;
    g.fillRect(0, 0, 256, 256);
    this.initAmbient();
  }

  start(heroId, seed, loadout) {
    const h = HEROES[heroId];
    this.heroId = heroId;
    this.hero = h;
    this.rand = rng32(seed);
    const picks = (Array.isArray(loadout) ? loadout : []).filter((id, i, a) => h.abilities.includes(id) && a.indexOf(id) === i).slice(0, 2);
    for (const id of h.abilities) if (picks.length < 2 && !picks.includes(id)) picks.push(id);
    this.player = {
      x: 0, y: 0, ox: 0, oy: 0, dx: 0, dy: 0, vx: 0, vy: 0, z: 0, r: 18, hp: h.hp, maxHp: h.hp, face: 1, aim: 0, atkT: 0.5,
      dashN: TUNE.dash.charges, dashRe: 0, dashSeq: 0, rush: null, inv: 0, flash: 0, slow: 0, over: 0, bark: 0,
      swing: 0, swingAng: 0, swingHalf: 1, swingR: 100, kick: 0, ghostT: 0, atkAnim: 0, atkDur: 0.3, runPhase: 0, stepT: 0,
      ult: 0, level: 1, xp: 0, need: xpNeed(1), kills: 0,
      ab: picks.map((id) => ({ id, cd: 0, max: ABILITIES[id].cd, lvl: 0 })),
      boons: {}, dmgMul: 1, rateMul: 1, speedMul: 1, rangeMul: 1, magnet: TUNE.magnet,
      extra: 0, pierce: 0, wisps: 0, leech: 0, ultMul: 1, dashMul: 1, armor: 0, crit: 0, abCd: 1, abDmg: 1,
    };
    this.score = 0;
    this.cleared = 0;
    this.runTime = 0;
    this.uid = 1;
    this.pending = 0;
    this.choice = null;
    this.paused = false;
    this.beginRealm(0);
  }

  stop() {
    this.phase = "idle";
    this.choice = null;
    this.paused = false;
  }

  beginRealm(i) {
    const r = REALMS[i], p = this.player;
    this.realmIdx = i;
    this.realm = r;
    this.arena = { cx: r.arena.cx * WORLD.w, cy: r.arena.cy * WORLD.h, rx: r.arena.rx * WORLD.w, ry: r.arena.ry * WORLD.h };
    for (const k of ["enemies", "shots", "zones", "fzones", "allies", "lobs", "gems", "parts", "dusts", "texts", "rings", "fx", "corpses", "timers", "ghosts"]) this[k].length = 0;
    this.boss = null;
    this.purge = false;
    p.x = p.ox = p.dx = this.arena.cx;
    p.y = p.oy = p.dy = this.arena.cy + this.arena.ry * 0.25;
    p.vx = p.vy = p.z = 0;
    p.rush = null;
    p.inv = 1;
    this.cam.x = p.x;
    this.cam.y = p.y;
    this.realmT = 0;
    this.spawnT = 1.4;
    this.pulseIdx = 0;
    this.phaseT = 0;
    this.bossTime = 0;
    this.trickleT = 5;
    this.initAmbient();
    this.phase = "intro";
    this.hooks.event("realm", { index: i });
  }

  /** The intro card was dismissed: the waves begin. */
  go() {
    if (this.phase === "intro") this.phase = "waves";
  }

  running() {
    const ph = this.phase;
    return !this.paused && !this.choice && (ph === "waves" || ph === "bossIntro" || ph === "boss" || ph === "cleared");
  }

  after(delay, fn) {
    this.timers.push({ t: delay, fn });
  }

  sfx(name, vol, rate) {
    this.hooks.sfx?.(name, vol, rate);
  }

  _frame(ts) {
    requestAnimationFrame(this._frame);
    const dt = Math.min(0.1, (ts - this.last) / 1000 || 0);
    this.last = ts;
    if (dt > 0) this.fps += (1 / dt - this.fps) * 0.05;
    this.hooks.poll?.();
    if (this.running()) {
      this.acc += dt * this.opts.speed;
      let n = 0;
      const max = 6 * this.opts.speed;
      while (this.acc >= STEP && n < max && this.running()) {
        this.step(STEP);
        this.acc -= STEP;
        n++;
      }
      if (this.acc > STEP) this.acc = 0;
    }
    this.render(dt);
    this.hooks.frame?.(dt);
  }

  // ── simulation ───────────────────────────────────────────────────────────

  step(dt) {
    // Remember where everything was, so render can blend between two steps.
    const p = this.player, en = this.enemies, S = this.shots;
    p.ox = p.x;
    p.oy = p.y;
    for (let i = 0; i < en.length; i++) { en[i].ox = en[i].x; en[i].oy = en[i].y; }
    for (let i = 0; i < S.length; i++) { S[i].ox = S[i].x; S[i].oy = S[i].y; }
    if (this.hitStop > 0) {
      this.hitStop -= dt;
      return;
    }
    this.time += dt;
    this.runTime += dt;
    const T = this.timers;
    for (let i = T.length - 1; i >= 0; i--) {
      const t = T[i];
      t.t -= dt;
      if (t.t <= 0) {
        T[i] = T[T.length - 1];
        T.pop();
        t.fn();
      }
    }
    if (this.opts.auto) this.autopilot();
    this.updatePlayer(dt);
    if (this.phase === "waves") this.director(dt);
    else if (this.phase === "bossIntro") {
      this.phaseT += dt;
      if (this.phaseT >= 2.2) this.spawnBoss();
    } else if (this.phase === "boss") {
      this.bossTime += dt;
      // A guardian never fights alone: a thin trickle keeps the floor contested.
      this.trickleT -= dt;
      if (this.trickleT <= 0) {
        this.trickleT = 2.2;
        if (this.boss && this.enemies.length < 16) {
          const pt = this.spawnPoint();
          this.spawn(this.boss.d.minion, pt.x, pt.y);
        }
      }
    } else if (this.phase === "cleared") {
      this.phaseT += dt;
      if (this.phaseT >= 2.6) {
        this.afterClear();
        return;
      }
    }
    for (let i = 0; i < en.length; i++) this.updateEnemy(en[i], dt);
    this.separate();
    this.updateShots(dt);
    this.updateZones(dt);
    this.updateAllies(dt);
    this.updateGems(dt);
    if (this.purge) {
      // A guardian fell this step: everything it commanded goes with it.
      this.purge = false;
      this.zones.length = 0;
      this.timers.length = 0;
      for (let i = S.length - 1; i >= 0; i--) if (S[i].own === 1) S.splice(i, 1);
    }
    for (let i = en.length - 1; i >= 0; i--) {
      if (en[i].hp <= 0) {
        en[i] = en[en.length - 1];
        en.pop();
      }
    }
    if (this.pending > 0 && !this.choice && (this.phase === "waves" || this.phase === "boss")) this.offer("level");
  }

  clampArena(o, m) {
    const A = this.arena, rx = A.rx - m, ry = A.ry - m;
    const dx = (o.x - A.cx) / rx, dy = (o.y - A.cy) / ry;
    const q = dx * dx + dy * dy;
    if (q <= 1) return false;
    const s = 1 / Math.sqrt(q);
    o.x = A.cx + dx * s * rx;
    o.y = A.cy + dy * s * ry;
    return true;
  }

  addScore(n) {
    this.score = Math.min(this.score + n, SCORE_CAP[this.cleared]);
  }

  heal(n) {
    const p = this.player;
    p.hp = Math.min(p.maxHp, p.hp + n);
  }

  gainXp(v) {
    const p = this.player;
    p.xp += v;
    while (p.xp >= p.need) {
      p.xp -= p.need;
      p.level++;
      p.need = xpNeed(p.level);
      this.pending++;
      this.rings.push({ x: p.x, y: p.y, t: 0, dur: 0.5, r0: 20, r1: 190, color: "#fff2c8", w: 9 });
    }
  }

  // ── player ───────────────────────────────────────────────────────────────

  updatePlayer(dt) {
    const p = this.player, h = this.hero, I = this.input, en = this.enemies;
    p.inv -= dt;
    p.flash -= dt;
    p.swing -= dt;
    p.kick -= dt;
    p.atkAnim -= dt;
    if (p.slow > 0) p.slow -= dt;
    if (p.over > 0) p.over -= dt;
    if (p.bark > 0) p.bark -= dt;
    for (const a of p.ab) if (a.cd > 0) a.cd -= dt;
    if (p.dashN < TUNE.dash.charges) {
      p.dashRe -= dt;
      if (p.dashRe <= 0) {
        p.dashN++;
        p.dashRe = h.dashCd * p.dashMul;
      }
    }
    let mx = I.mx, my = I.my;
    const ml = Math.hypot(mx, my);
    if (ml > 1) { mx /= ml; my /= ml; }
    const live = this.phase !== "cleared";

    if (I.dash) {
      I.dash = false;
      if (p.dashN > 0 && !p.rush) {
        let dx = p.face, dy = 0;
        if (ml > 0.2) { dx = mx / ml; dy = my / ml; }
        if (p.dashN === TUNE.dash.charges) p.dashRe = h.dashCd * p.dashMul;
        p.dashN--;
        this.startRush("dash", dx, dy, TUNE.dash.dur, TUNE.dash.speed, TUNE.dash.inv);
        this.sfx("dash", 0.8);
      }
    }
    if (I.a1) { I.a1 = false; if (live) this.castAbility(0, mx, my, ml); }
    if (I.a2) { I.a2 = false; if (live) this.castAbility(1, mx, my, ml); }

    if (p.rush) this.updateRush(dt);
    else {
      // Velocity eases toward the stick: quick to start, quicker to stop.
      const sp = h.speed * p.speedMul * (p.slow > 0 ? 0.6 : 1);
      const tx = mx * sp, ty = my * sp;
      const ddx = tx - p.vx, ddy = ty - p.vy, d = Math.hypot(ddx, ddy);
      const rate = (ml > 0.05 ? TUNE.accel : TUNE.decel) * dt;
      if (d <= rate) { p.vx = tx; p.vy = ty; }
      else { p.vx += (ddx / d) * rate; p.vy += (ddy / d) * rate; }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const spd = Math.hypot(p.vx, p.vy), k = spd / h.speed;
      p.runPhase += dt * k * h.runRate;
      if (spd > 60) {
        p.stepT -= dt * k;
        if (p.stepT <= 0) {
          p.stepT = 0.5 / h.runRate / 1;
          this.dust(p.x - p.vx * 0.03, p.y - p.vy * 0.03, 1);
        }
      }
    }
    this.clampArena(p, 30);

    const a = h.attack, range = a.range * p.rangeMul;
    let best = null, bd = range * 1.1;
    for (let i = 0; i < en.length; i++) {
      const e = en[i];
      if (e.hp <= 0 || e.hidden || e.born > 0) continue;
      const d = Math.hypot(e.x - p.x, e.y - p.y) - e.r;
      if (d < bd) { bd = d; best = e; }
    }
    if (best) {
      p.aim = Math.atan2(best.y - p.y, best.x - p.x);
      p.face = Math.cos(p.aim) >= 0 ? 1 : -1;
    } else if (ml > 0.15) {
      p.aim = Math.atan2(my, mx);
      if (Math.abs(mx) > 0.1) p.face = mx > 0 ? 1 : -1;
    }
    p.atkT -= dt * p.rateMul * (p.over > 0 ? 2.6 : 1);
    if (p.atkT <= 0) {
      if (best && live && !(p.rush && p.rush.kind !== "dash")) {
        this.attack(range);
        p.atkT += a.cd;
        if (p.atkT < 0) p.atkT = 0;
      } else p.atkT = 0;
    }
    if (I.ult) {
      I.ult = false;
      if (p.ult >= TUNE.ultMax && live) this.castUlt();
    }
    for (let k = 0; k < p.wisps; k++) {
      const wa = this.time * 2.4 + (TAU * k) / p.wisps;
      const wx = p.x + Math.cos(wa) * 80, wy = p.y + Math.sin(wa) * 64;
      for (let i = 0; i < en.length; i++) {
        const e = en[i];
        if (e.hp <= 0 || e.hidden || e.wispT > 0) continue;
        if (Math.hypot(e.x - wx, e.y - wy) < e.r + 26) {
          e.wispT = 0.45;
          this.damage(e, 9 * p.dmgMul, 0, 0);
        }
      }
    }
  }

  /** A burst of forced movement: the dash, a charge, a leap. */
  startRush(kind, dx, dy, dur, speed, inv) {
    const p = this.player;
    p.rush = { kind, dx, dy, dur, speed, t: 0, seq: this.seq++, dmg: 0, land: null };
    p.inv = Math.max(p.inv, inv);
    p.ghostT = 0;
    this.rings.push({ x: p.x, y: p.y, t: 0, dur: 0.28, r0: 14, r1: 70, color: this.hero.color, w: 5 });
    this.dust(p.x, p.y, 4);
    return p.rush;
  }

  updateRush(dt) {
    const p = this.player, h = this.hero, r = p.rush, en = this.enemies;
    r.t += dt;
    const k = Math.min(1, r.t / r.dur);
    const sp = r.speed * (1.4 - 0.8 * k); // fast out, easing in to the stop
    p.x += r.dx * sp * dt;
    p.y += r.dy * sp * dt;
    p.vx = r.dx * sp * 0.35;
    p.vy = r.dy * sp * 0.35;
    p.z = r.kind === "jump" ? Math.sin(k * Math.PI) * 96 : 0;
    p.ghostT -= dt;
    if (p.ghostT <= 0) {
      p.ghostT = 0.03;
      this.ghosts.push({ x: p.x, y: p.y - p.z, face: p.face, t: 0.24 });
    }
    const bash = r.kind === "charge" ? r.dmg : r.kind === "dash" && h.id === "warden" ? 22 * p.dmgMul : 0;
    if (bash) {
      for (let i = 0; i < en.length; i++) {
        const e = en[i];
        if (e.hp <= 0 || e.hidden || e.bash === r.seq) continue;
        if (Math.hypot(e.x - p.x, e.y - p.y) < e.r + (r.kind === "charge" ? 62 : 48)) {
          e.bash = r.seq;
          if (r.kind === "charge") e.stun = Math.max(e.stun, e.boss ? 0.6 : 1.4);
          this.damage(e, bash, r.dx * 320, r.dy * 320);
        }
      }
    }
    if (k < 1) return;
    p.rush = null;
    p.z = 0;
    this.dust(p.x, p.y, 5);
    if (r.kind === "dash" && h.id === "knight") {
      this.rings.push({ x: p.x, y: p.y, t: 0, dur: 0.35, r0: 20, r1: 130, color: h.color, w: 5 });
      for (let i = 0; i < en.length; i++) {
        const e = en[i];
        if (e.hp > 0 && !e.hidden && Math.hypot(e.x - p.x, e.y - p.y) < 130 + e.r) e.slow = Math.max(e.slow, 2.2);
      }
    } else if (r.kind === "charge") {
      this.rings.push({ x: p.x, y: p.y, t: 0, dur: 0.4, r0: 20, r1: 170, color: h.color, w: 10 });
      this.cam.shake = Math.max(this.cam.shake, 10);
    } else if (r.land) this.explode(p.x, p.y, r.land.r, r.land.dmg, { knock: 260 });
  }

  attack(range) {
    const p = this.player, a = this.hero.attack, ang = p.aim, en = this.enemies;
    p.kick = 0.09;
    p.atkDur = Math.min(0.34, a.cd * 0.85 / Math.max(1, p.rateMul * (p.over > 0 ? 2.6 : 1)));
    p.atkAnim = p.atkDur;
    if (a.kind === "cleave") {
      const half = a.arc / 2 + p.extra * 0.28;
      for (let i = 0; i < en.length; i++) {
        const e = en[i];
        if (e.hp <= 0 || e.hidden) continue;
        const dx = e.x - p.x, dy = e.y - p.y, d = Math.hypot(dx, dy) || 1;
        if (d - e.r > range) continue;
        if (d > 34 && Math.abs(angDiff(Math.atan2(dy, dx), ang)) > half) continue;
        this.damage(e, a.dmg * p.dmgMul, (dx / d) * a.knock, (dy / d) * a.knock);
      }
      p.swing = 0.2;
      p.swingAng = ang;
      p.swingHalf = half;
      p.swingR = range;
      this.sfx("shot", 0.35, 0.6 + Math.random() * 0.1);
      return;
    }
    const n = (a.count || 1) + p.extra;
    const spread = a.kind === "bolt" ? 0.1 : a.spread;
    const pierce = p.over > 0 ? 6 : p.pierce;
    const ox = p.x + Math.cos(ang) * 30, oy = p.y + Math.sin(ang) * 30;
    for (let i = 0; i < n; i++) {
      const off = (i - (n - 1) / 2) * spread;
      this.shot(ox, oy, ang + off, a.speed, a.r, a.dmg * p.dmgMul, range / a.speed, 0, pierce, a.slow || 0, 0.12);
    }
    this.fx.push({ kind: "flash", x: ox, y: oy, t: 0, dur: 0.09, r: a.kind === "bolt" ? 34 : 44 });
    this.sfx("shot", 0.3, (a.kind === "bolt" ? 1 : 1.35) + Math.random() * 0.12);
  }

  /** Where a thrown ability should land: the thickest knot of foes in reach. */
  clusterPoint(reach) {
    const p = this.player, en = this.enemies;
    let best = null, bs = 0;
    for (let i = 0; i < en.length; i++) {
      const e = en[i];
      if (e.hp <= 0 || e.hidden || Math.hypot(e.x - p.x, e.y - p.y) > reach) continue;
      let s = e.boss ? 4 : 1;
      for (let j = 0; j < en.length; j++) {
        const o = en[j];
        if (o !== e && o.hp > 0 && Math.hypot(o.x - e.x, o.y - e.y) < 160) s++;
      }
      if (s > bs) { bs = s; best = e; }
    }
    if (best) return { x: best.x, y: best.y };
    const pt = { x: p.x + Math.cos(p.aim) * 260, y: p.y + Math.sin(p.aim) * 260 };
    this.clampArena(pt, 40);
    return pt;
  }

  /** A friendly blast: hurts every foe in the radius. */
  explode(x, y, r, dmg, o = {}) {
    const en = this.enemies, col = o.color || this.hero.color;
    for (let i = 0; i < en.length; i++) {
      const e = en[i];
      if (e.hp <= 0 || e.hidden) continue;
      const dx = e.x - x, dy = e.y - y, d = Math.hypot(dx, dy) || 1;
      if (d > r + e.r) continue;
      if (o.stun) e.stun = Math.max(e.stun, e.boss ? o.stun * 0.4 : o.stun);
      if (o.freeze) e.frozen = Math.max(e.frozen, e.boss ? o.freeze * 0.4 : o.freeze);
      if (o.slow) e.slow = Math.max(e.slow, o.slow);
      const kn = o.knock || 0;
      this.damage(e, dmg, (dx / d) * kn, (dy / d) * kn);
    }
    this.rings.push({ x, y, t: 0, dur: 0.42, r0: r * 0.2, r1: r, color: col, w: 14 });
    this.puff(x, y - 20, col, 16, r * 1.6);
    this.cam.shake = Math.max(this.cam.shake, 11);
    this.sfx("boom", 0.6, 1.1);
  }

  castAbility(i, mx, my, ml) {
    const p = this.player, h = this.hero, a = p.ab[i], en = this.enemies;
    if (!a || a.cd > 0 || p.rush) return false;
    const def = ABILITIES[a.id];
    const pow = p.dmgMul * p.abDmg * (1 + 0.35 * a.lvl);
    a.max = def.cd * p.abCd * Math.pow(0.85, a.lvl);
    a.cd = a.max;
    const ang = p.aim, cx = Math.cos(ang), cy = Math.sin(ang);
    // Movement abilities follow the stick; everything else follows the aim.
    let dx = cx, dy = cy;
    if (ml > 0.2) { dx = mx / ml; dy = my / ml; }
    p.atkDur = 0.34;
    p.atkAnim = 0.34;
    p.kick = 0.14;
    this.sfx("ult", 0.5, 1.5);
    const col = h.color;
    switch (a.id) {
      case "charge": {
        const r = this.startRush("charge", dx, dy, 0.36, 1150, 0.5);
        r.dmg = 55 * pow;
        break;
      }
      case "snare": {
        const half = 0.75, len = 400;
        for (let k = 0; k < en.length; k++) {
          const e = en[k];
          if (e.hp <= 0 || e.hidden) continue;
          const ex = e.x - p.x, ey = e.y - p.y, d = Math.hypot(ex, ey) || 1;
          if (d - e.r > len || (d > 40 && Math.abs(angDiff(Math.atan2(ey, ex), ang)) > half)) continue;
          e.stun = Math.max(e.stun, e.boss ? 1 : 2.6);
          this.damage(e, 40 * pow, 0, 0);
          this.puff(e.x, e.y - 10, col, 5, 110);
        }
        this.fx.push({ kind: "cone", x: p.x, y: p.y, ang, half, len, t: 0, dur: 0.45 });
        this.cam.shake = Math.max(this.cam.shake, 8);
        break;
      }
      case "bark":
        p.bark = 4.5;
        this.rings.push({ x: p.x, y: p.y, t: 0, dur: 0.4, r0: 20, r1: 110, color: col, w: 10 });
        break;
      case "totem":
        this.allies.push({ kind: "totem", x: p.x + cx * 60, y: p.y + cy * 60, t: 0, life: 7, tick: 0.8, tickT: 0.25, dmg: 24 * pow, r: 205, pulse: 0 });
        break;
      case "scatter": {
        const ox = p.x + cx * 30, oy = p.y + cy * 30;
        for (let k = 0; k < 9; k++) this.shot(ox, oy, ang + (k / 8 - 0.5) * 1.0, 820, 7, 13 * pow, 0.3, 0, 1, 0, 0.5);
        this.fx.push({ kind: "flash", x: ox, y: oy, t: 0, dur: 0.14, r: 80 });
        p.vx -= cx * 420;
        p.vy -= cy * 420;
        this.cam.shake = Math.max(this.cam.shake, 9);
        break;
      }
      case "grenade": {
        const t = this.clusterPoint(540);
        this.lobs.push({ x0: p.x, y0: p.y, x1: t.x, y1: t.y, t: 0, dur: 0.5, r: 150, dmg: 80 * pow, pool: { kind: "plasma", r: 115, dur: 3.2, tick: 0.4, dmg: 10 * pow } });
        break;
      }
      case "sentry":
        this.allies.push({ kind: "sentry", x: p.x - cx * 46, y: p.y - cy * 46, t: 0, life: 9, tick: 0.28, tickT: 0.3, dmg: 9 * pow, range: 480, ang: 0 });
        break;
      case "rocketjump": {
        if (ml <= 0.2) { dx = -cx; dy = -cy; }
        this.explode(p.x, p.y, 150, 55 * pow, { knock: 380 });
        const r = this.startRush("jump", dx, dy, 0.44, 880, 0.6);
        r.land = { r: 120, dmg: 35 * pow };
        break;
      }
      case "spike": {
        const sx = p.x, sy = p.y, tag = this.seq++;
        for (let k = 0; k < 7; k++) {
          this.after(k * 0.045, () => {
            const x = sx + cx * (70 + k * 72), y = sy + cy * (70 + k * 72);
            this.fx.push({ kind: "spike", x, y, t: 0, dur: 0.6, s: 0.8 + k * 0.06 });
            for (let m = 0; m < en.length; m++) {
              const e = en[m];
              if (e.hp <= 0 || e.hidden || e.tag === tag || Math.hypot(e.x - x, e.y - y) > 64 + e.r) continue;
              e.tag = tag;
              e.frozen = Math.max(e.frozen, e.boss ? 0.6 : 1.6);
              this.damage(e, 34 * pow, cx * 120, cy * 120);
            }
          });
        }
        break;
      }
      case "nova":
        this.explode(p.x, p.y, 270, 32 * pow, { freeze: 2.6 });
        break;
      case "blizzard": {
        const t = this.clusterPoint(560);
        this.fzones.push({ kind: "ice", x: t.x, y: t.y, r: 210, t: 0, dur: 6, tick: 0.5, tickT: 0.1, dmg: 13 * pow, slow: 1.0 });
        this.rings.push({ x: t.x, y: t.y, t: 0, dur: 0.5, r0: 30, r1: 210, color: col, w: 10 });
        break;
      }
      case "blink": {
        this.allies.push({ kind: "mirror", x: p.x, y: p.y, t: 0, life: 0.8, dmg: 60 * pow, r: 175, face: p.face });
        this.puff(p.x, p.y - 40, col, 10, 160);
        p.x += dx * 380;
        p.y += dy * 380;
        this.clampArena(p, 30);
        p.ox = p.x;
        p.oy = p.y;
        p.inv = Math.max(p.inv, 0.4);
        this.puff(p.x, p.y - 40, col, 10, 160);
        this.rings.push({ x: p.x, y: p.y, t: 0, dur: 0.3, r0: 10, r1: 90, color: col, w: 6 });
        break;
      }
    }
    return true;
  }

  castUlt() {
    const p = this.player, h = this.hero, en = this.enemies, id = h.ult.id;
    p.ult = 0;
    this.cam.shake = 18;
    this.cam.punch = 0.05;
    p.atkDur = 0.34;
    p.atkAnim = 0.34;
    this.sfx("ult", 0.9);
    if (id === "quake") {
      this.rings.push({ x: p.x, y: p.y, t: 0, dur: 0.5, r0: 30, r1: 360, color: h.color, w: 16 });
      for (let i = 0; i < en.length; i++) {
        const e = en[i];
        if (e.hp <= 0 || e.hidden) continue;
        const dx = e.x - p.x, dy = e.y - p.y, d = Math.hypot(dx, dy) || 1;
        if (d > 360 + e.r) continue;
        e.stun = e.boss ? 0.8 : 1.8;
        this.damage(e, 95 * p.dmgMul, (dx / d) * 320, (dy / d) * 320);
      }
      for (let i = this.shots.length - 1; i >= 0; i--) {
        const s = this.shots[i];
        if (s.own === 1 && Math.hypot(s.x - p.x, s.y - p.y) < 360) this.shots.splice(i, 1);
      }
      this.heal(p.maxHp * 0.15);
      this.hitStop = 0.07;
    } else if (id === "overcharge") {
      p.over = 4.2;
      this.rings.push({ x: p.x, y: p.y, t: 0, dur: 0.4, r0: 20, r1: 200, color: h.color, w: 8 });
    } else {
      this.rings.push({ x: p.x, y: p.y, t: 0, dur: 0.6, r0: 40, r1: 820, color: h.color, w: 22 });
      for (let i = 0; i < en.length; i++) {
        const e = en[i];
        if (e.hp <= 0 || e.hidden) continue;
        if (Math.hypot(e.x - p.x, e.y - p.y) > 820) continue;
        this.damage(e, 40 * p.dmgMul, 0, 0);
        e.frozen = e.boss ? 1.6 : 3.6;
      }
      for (let i = this.shots.length - 1; i >= 0; i--) if (this.shots[i].own === 1) this.shots.splice(i, 1);
      this.hitStop = 0.07;
    }
  }

  hurt(dmg, inv) {
    const p = this.player;
    if (p.inv > 0 || this.phase === "cleared" || this.phase === "dead" || this.phase === "won") return false;
    p.hp -= dmg * (1 - p.armor) * (p.bark > 0 ? 0.3 : 1);
    p.inv = inv;
    p.flash = 0.18;
    this.hurtFlash = 0.4;
    this.cam.shake = Math.max(this.cam.shake, TUNE.shake);
    this.sfx("hurt", 0.9);
    if (p.hp <= 0) {
      p.hp = 0;
      this.phase = "dead";
      this.puff(p.x, p.y - 40, this.hero.color, 40, 260);
      this.hooks.event("end", { won: false, score: this.score });
    }
    return true;
  }

  // ── damage & death ───────────────────────────────────────────────────────

  damage(e, dmg, kx, ky) {
    const p = this.player;
    let crit = false;
    if (p.crit > 0 && this.rand() < p.crit) { dmg *= 2; crit = true; }
    if (e.frozen > 0) dmg *= 1.5;
    e.hp -= dmg;
    e.flash = 0.12;
    const kr = e.boss ? 0 : 1 - (e.d.knockRes || 0);
    e.kx += kx * kr;
    e.ky += ky * kr;
    p.ult = Math.min(TUNE.ultMax, p.ult + dmg * TUNE.ultPerDmg * p.ultMul);
    if (this.texts.length < 36) this.texts.push({ x: e.x + (Math.random() - 0.5) * 24, y: e.y - e.h * 0.8, v: Math.round(dmg), crit, t: 0, vx: (Math.random() - 0.5) * 40 });
    if (e.hp <= 0) this.kill(e);
    else this.sfx("hit", 0.35, 1 + Math.random() * 0.25);
  }

  kill(e) {
    const p = this.player;
    e.hp = 0;
    this.puff(e.x, e.y - e.h * 0.4, e.boss ? "#ffd9a0" : "#e8dcc8", e.boss ? 70 : 7, e.boss ? 420 : 170);
    if (this.corpses.length < 48) this.corpses.push({ d: e.d, x: e.x, y: e.y, h: e.h, face: e.face, t: 0, dur: e.boss ? 1.1 : 0.34, kx: e.kx * 0.25, ky: e.ky * 0.25 });
    if (e.boss) {
      this.bossDead(e);
      return;
    }
    p.kills++;
    this.addScore(Math.round(e.d.score * (1 + 0.25 * this.realmIdx)));
    this.dropGem(e.x, e.y, e.d.xp, false);
    if (this.rand() < TUNE.heartChance) this.dropGem(e.x, e.y, 0, true);
    if (p.leech) this.heal(p.leech);
    if (e.d.burst) this.ring(e.x, e.y, e.d.burst, this.rand() * TAU, 190, 9 * this.realm.dmgMul, 0, 1.2);
    this.sfx("hit", 0.55, 0.7);
  }

  dropGem(x, y, v, heart) {
    const a = Math.random() * TAU, s = 60 + Math.random() * 120;
    this.gems.push({ x, y, v, heart, pull: false, vx: Math.cos(a) * s, vy: Math.sin(a) * s, sp: 0, t: 0 });
  }

  bossDead(b) {
    this.boss = null;
    this.cleared++;
    const bonus = b.d.score + Math.max(0, 1500 - Math.floor(this.bossTime * 20));
    this.addScore(bonus);
    for (const e of this.enemies) {
      if (e !== b && e.hp > 0) {
        e.hp = 0;
        this.puff(e.x, e.y - e.h * 0.4, "#e8dcc8", 6, 150);
        if (this.corpses.length < 48) this.corpses.push({ d: e.d, x: e.x, y: e.y, h: e.h, face: e.face, t: 0, dur: 0.34, kx: 0, ky: 0 });
      }
    }
    for (let i = 0; i < 14; i++) this.dropGem(b.x, b.y, Math.ceil(b.d.xp / 14), i % 7 === 0);
    this.purge = true;
    this.phase = "cleared";
    this.phaseT = 0;
    this.cam.shake = 28;
    this.cam.punch = 0.08;
    this.hitStop = 0.22;
    this.rings.push({ x: b.x, y: b.y, t: 0, dur: 0.9, r0: 40, r1: 700, color: "#fff2c8", w: 26 });
    this.sfx("roar", 0.7, 0.7);
    this.hooks.event("realmClear", { realm: this.cleared, score: this.score, bonus });
  }

  afterClear() {
    if (this.cleared >= REALMS.length) {
      this.phase = "won";
      this.hooks.event("end", { won: true, score: this.score });
      return;
    }
    this.heal(this.player.maxHp * TUNE.realmHeal);
    this.offer("spoils");
  }

  // ── boons ────────────────────────────────────────────────────────────────

  offer(kind) {
    const p = this.player;
    const pool = BOONS.filter((b) => (p.boons[b.id] || 0) < b.max).map((b) => ({ id: b.id, name: b.name, desc: b.desc, icon: b.icon, img: null, max: b.max, rank: (p.boons[b.id] || 0) + 1 }));
    // Each equipped ability can be mastered three times.
    for (const a of p.ab) {
      if (a.lvl >= 3) continue;
      const d = ABILITIES[a.id];
      pool.push({ id: "m:" + a.id, name: `${d.name} Mastery`, desc: "+35% power and recharges 15% sooner", icon: "", img: a.id, max: 3, rank: a.lvl + 1 });
    }
    const options = [];
    while (options.length < 3 && pool.length) options.push(pool.splice(Math.floor(this.rand() * pool.length), 1)[0]);
    if (!options.length) {
      if (kind === "spoils") this.beginRealm(this.realmIdx + 1);
      else this.pending = 0;
      return;
    }
    this.choice = { kind, options };
    this.sfx("levelup", 0.8);
    this.hooks.event("choice", this.choice);
  }

  pick(id) {
    const c = this.choice;
    if (!c || !c.options.some((o) => o.id === id)) return;
    const p = this.player, k = c.kind === "spoils" ? 2 : 1;
    if (id.startsWith("m:")) {
      const a = p.ab.find((x) => x.id === id.slice(2));
      if (a) a.lvl = Math.min(3, a.lvl + k);
    } else {
      const b = BOONS.find((x) => x.id === id);
      p.boons[id] = (p.boons[id] || 0) + 1;
      b.apply(p, k);
    }
    this.choice = null;
    this.sfx("pick", 0.8);
    if (c.kind === "spoils") this.beginRealm(this.realmIdx + 1);
    else this.pending = Math.max(0, this.pending - 1);
  }

  // ── spawning ─────────────────────────────────────────────────────────────

  director(dt) {
    const r = this.realm;
    this.realmT += dt;
    const t = this.realmT;
    if (t >= r.duration) {
      this.phase = "bossIntro";
      this.phaseT = 0;
      this.sfx("roar", 1);
      this.hooks.event("boss", { id: r.boss });
      return;
    }
    const pu = r.pulses[this.pulseIdx];
    if (pu && t >= pu.t) {
      this.pulseIdx++;
      this.pulse(pu);
      this.spawnT = 4.5;
      return;
    }
    this.spawnT -= dt;
    if (this.spawnT > 0) return;
    const k = t / r.duration;
    this.spawnT = r.rate[0] + (r.rate[1] - r.rate[0]) * k;
    let w = r.waves[0];
    for (const x of r.waves) if (t >= x.t) w = x;
    let tot = 0;
    for (const m of w.mix) tot += m[1];
    // Packs grow as the realm wears on: one foe at first, three by the end.
    const pack = 1 + Math.floor(k * 2 + this.rand() * 0.9);
    const pt = this.spawnPoint();
    for (let n = 0; n < pack && this.enemies.length < TUNE.maxEnemies; n++) {
      let roll = this.rand() * tot, type = w.mix[0][0];
      for (const m of w.mix) {
        roll -= m[1];
        if (roll < 0) { type = m[0]; break; }
      }
      const e = this.spawn(type, pt.x + (this.rand() - 0.5) * 90, pt.y + (this.rand() - 0.5) * 70);
      this.clampArena(e, 30);
      e.ox = e.x;
      e.oy = e.y;
    }
  }

  spawnPoint() {
    const A = this.arena, p = this.player;
    let bx = A.cx, by = A.cy, bd = -1;
    for (let i = 0; i < 8; i++) {
      const a = this.rand() * TAU, f = 0.86 + this.rand() * 0.1;
      const x = A.cx + Math.cos(a) * A.rx * f, y = A.cy + Math.sin(a) * A.ry * f;
      const d = Math.hypot(x - p.x, y - p.y);
      if (d > bd) { bd = d; bx = x; by = y; }
      if (d > 420) break;
    }
    return { x: bx, y: by };
  }

  pulse(pu) {
    const p = this.player, a0 = this.rand() * TAU;
    for (let i = 0; i < pu.n; i++) {
      const a = a0 + (TAU * i) / pu.n;
      const e = this.spawn(pu.type, p.x + Math.cos(a) * 440, p.y + Math.sin(a) * 350);
      this.clampArena(e, 40);
      e.ox = e.x;
      e.oy = e.y;
    }
    this.hooks.event("pulse", {});
  }

  spawn(type, x, y) {
    const d = ENEMIES[type], r = this.realm;
    const e = {
      uid: this.uid++, type, d, boss: false, x, y, ox: x, oy: y, dx: x, dy: y, kx: 0, ky: 0,
      hp: d.hp * r.hpMul, maxHp: d.hp * r.hpMul, r: d.r, h: d.h, dmg: d.dmg * r.dmgMul,
      speed: d.speed * (0.9 + this.rand() * 0.2), face: 1, flash: 0, stun: 0, slow: 0, frozen: 0,
      born: TUNE.spawnFade, st: "move", stT: 0, cd: 0.8 + this.rand() * 2, ang: 0, hitCd: 0, wispT: 0,
      bash: 0, tag: 0, phase: this.rand() * TAU, hidden: false, tx: 0, ty: 0, trailT: 0, walk: 0, moving: false, lunge: 0,
    };
    this.enemies.push(e);
    return e;
  }

  spawnBoss() {
    const A = this.arena, p = this.player, d = BOSSES[this.realm.boss];
    const up = p.y > A.cy, x = A.cx, y = A.cy + A.ry * (up ? -0.5 : 0.5);
    const b = {
      uid: this.uid++, type: this.realm.boss, d, boss: true, x, y, ox: x, oy: y, dx: x, dy: y, kx: 0, ky: 0,
      hp: d.hp, maxHp: d.hp, r: d.r, h: d.h, dmg: d.dmg, speed: d.speed, face: 1, flash: 0, stun: 0, slow: 0, frozen: 0,
      born: 0.9, st: "idle", stT: 0, idle: 1.3, busy: 0, pi: 0, dir: 1, cd: 0, ang: 0, hitCd: 0, wispT: 0, bash: 0, tag: 0,
      phase: 0, hidden: false, tx: 0, ty: 0, trailT: 0, walk: 0, moving: false, lunge: 0,
    };
    this.enemies.push(b);
    this.boss = b;
    this.phase = "boss";
    this.bossTime = 0;
    this.trickleT = 5;
    this.cam.shake = 20;
    this.rings.push({ x: b.x, y: b.y, t: 0, dur: 0.7, r0: 30, r1: 380, color: HAZARD, w: 14 });
    this.hooks.event("bossSpawn", { id: this.realm.boss });
  }

  // ── enemies ──────────────────────────────────────────────────────────────

  updateEnemy(e, dt) {
    if (e.hp <= 0) return;
    const p = this.player;
    e.moving = false;
    if (e.born > 0) {
      e.born -= dt;
      return;
    }
    e.flash -= dt;
    e.hitCd -= dt;
    e.wispT -= dt;
    e.lunge -= dt;
    if (e.kx || e.ky) {
      e.x += e.kx * dt;
      e.y += e.ky * dt;
      e.kx *= 0.86;
      e.ky *= 0.86;
      if (Math.abs(e.kx) + Math.abs(e.ky) < 6) e.kx = e.ky = 0;
    }
    if (e.frozen > 0) { e.frozen -= dt; return; }
    if (e.stun > 0) { e.stun -= dt; return; }
    let sp = e.speed;
    if (e.slow > 0) { e.slow -= dt; sp *= 0.5; }
    const dx = p.x - e.x, dy = p.y - e.y, dist = Math.hypot(dx, dy) || 1, nx = dx / dist, ny = dy / dist;
    e.stT += dt;
    if (e.boss) {
      this.updateBoss(e, dt, sp, nx, ny, dist);
      return;
    }
    const d = e.d, ai = d.ai;
    let mvx = 0, mvy = 0, hitMul = 1;
    if (ai === "chase") {
      mvx = nx;
      mvy = ny;
      if (d.wobble) {
        const w = Math.sin(this.time * 5 + e.phase) * 0.7;
        mvx -= ny * w;
        mvy += nx * w;
      }
    } else if (ai === "ranged") {
      if (e.st === "aim") {
        if (e.stT >= 0.4) {
          this.enemyShot(e, Math.atan2(dy, dx), dist);
          e.st = "move";
          e.cd = d.shotCd * (0.85 + this.rand() * 0.3);
        }
      } else {
        const want = d.range;
        if (dist > want) { mvx = nx; mvy = ny; }
        else if (dist < want * 0.6) { mvx = -nx; mvy = -ny; }
        else { const s = e.uid % 2 ? 0.6 : -0.6; mvx = -ny * s; mvy = nx * s; }
        e.cd -= dt;
        if (e.cd <= 0 && dist < want * 1.25) { e.st = "aim"; e.stT = 0; }
      }
    } else if (ai === "charge") {
      if (e.st === "move") {
        mvx = nx;
        mvy = ny;
        e.cd -= dt;
        if (dist < 310 && e.cd <= 0) { e.st = "wind"; e.stT = 0; e.ang = Math.atan2(dy, dx); }
      } else if (e.st === "wind") {
        if (e.stT < 0.4) e.ang = Math.atan2(dy, dx);
        if (e.stT >= 0.65) { e.st = "dash"; e.stT = 0; e.trailT = 0; }
      } else if (e.st === "dash") {
        e.x += Math.cos(e.ang) * d.chargeSpeed * dt;
        e.y += Math.sin(e.ang) * d.chargeSpeed * dt;
        e.moving = true;
        hitMul = 1.4;
        if (d.trail) {
          e.trailT -= dt;
          if (e.trailT <= 0) {
            e.trailT = 0.13;
            this.addZone({ kind: "circle", x: e.x, y: e.y, r: 42, delay: 0.3, dur: 2.4, dmg: 5 * this.realm.dmgMul, tick: 0.4 });
          }
        }
        if (e.stT >= 0.5 || this.clampArena(e, e.r)) { e.st = "rest"; e.stT = 0; this.dust(e.x, e.y, 3); }
      } else if (e.stT >= 0.7) {
        e.st = "move";
        e.cd = 1.6 + this.rand() * 1.5;
      }
    } else if (ai === "blink") {
      if (e.st === "fade") {
        if (e.stT >= 0.65) {
          e.x = e.ox = e.tx;
          e.y = e.oy = e.ty;
          e.hidden = false;
          e.st = "move";
          e.cd = 3 + this.rand() * 2;
          e.flash = 0.15;
          e.hitCd = 0.5;
        }
        return;
      }
      mvx = nx;
      mvy = ny;
      e.cd -= dt;
      if (e.cd <= 0 && dist < 520 && dist > 100) {
        const a = this.rand() * TAU;
        e.tx = p.x + Math.cos(a) * 60;
        e.ty = p.y + Math.sin(a) * 60;
        e.st = "fade";
        e.stT = 0;
        e.hidden = true;
        this.puff(e.x, e.y - e.h * 0.4, "#bfe9ff", 6, 120);
        this.addZone({ kind: "circle", x: e.tx, y: e.ty, r: 58, delay: 0.65, dur: 0.12, dmg: e.dmg, tick: 0 });
        return;
      }
    }
    if (mvx || mvy) {
      e.x += mvx * sp * dt;
      e.y += mvy * sp * dt;
      e.moving = true;
      e.walk += dt * (sp / 70);
    }
    if (e.st !== "dash") e.face = nx >= 0 ? 1 : -1;
    else e.face = Math.cos(e.ang) >= 0 ? 1 : -1;
    if (dist < e.r + p.r && e.hitCd <= 0) {
      e.hitCd = 0.6;
      e.lunge = 0.2;
      if (this.hurt(e.dmg * hitMul, TUNE.contactInv) && p.bark > 0) this.damage(e, 20 * p.dmgMul, -nx * 220, -ny * 220);
    }
  }

  enemyShot(e, ang, dist) {
    const d = e.d;
    const life = d.pool ? clamp(dist / d.shotSpeed, 0.5, 2.2) : 2.6;
    const s = this.shot(e.x + Math.cos(ang) * 20, e.y + Math.sin(ang) * 20, ang, d.shotSpeed, 9, e.dmg, life, 1, 0, d.slow || 0, 0);
    s.pool = !!d.pool;
  }

  updateBoss(b, dt, sp, nx, ny, dist) {
    const p = this.player;
    if (b.st === "idle") {
      const want = b.d.keep;
      let mx = 0, my = 0;
      if (dist > want + 50) { mx = nx; my = ny; }
      else if (dist < want - 90) { mx = -nx * 0.6; my = -ny * 0.6; }
      else { mx = -ny * b.dir * 0.7; my = nx * b.dir * 0.7; }
      b.x += mx * sp * dt;
      b.y += my * sp * dt;
      b.moving = true;
      b.walk += dt * (sp / 110);
      b.face = nx >= 0 ? 1 : -1;
      if (b.stT >= b.idle) this.bossPattern(b);
    } else if (b.stT >= b.busy) {
      b.st = "idle";
      b.stT = 0;
      b.idle = b.hp < b.maxHp * 0.35 ? 0.7 : 1.15;
      b.dir = this.rand() < 0.5 ? 1 : -1;
    }
    if (dist < b.r + p.r && b.hitCd <= 0) {
      b.hitCd = 0.7;
      b.lunge = 0.25;
      if (this.hurt(b.dmg, TUNE.contactInv) && p.bark > 0) this.damage(b, 20 * p.dmgMul, 0, 0);
    }
  }

  bossPattern(b) {
    const rage = b.hp < b.maxHp * 0.35, p = this.player;
    const pat = b.d.patterns[b.pi % b.d.patterns.length];
    b.pi++;
    b.st = "busy";
    b.stT = 0;
    b.lunge = 0.35;
    const alive = () => b.hp > 0;
    if (pat === "slam") {
      const n = rage ? 5 : 3;
      for (let i = 0; i < n; i++) {
        this.after(i * 0.5, () => {
          if (alive()) this.addZone({ kind: "circle", x: p.x, y: p.y, r: 150, delay: 0.75, dur: 0.14, dmg: 26, tick: 0, boom: true });
        });
      }
      b.busy = n * 0.5 + 0.9;
    } else if (pat === "thorns") {
      const n = rage ? 3 : 2;
      for (let i = 0; i < n; i++) {
        this.after(0.35 + i * 0.6, () => {
          if (alive()) this.fan(b.x, b.y, Math.atan2(p.y - b.y, p.x - b.x), 7, 0.9, 300, 16);
        });
      }
      b.busy = n * 0.6 + 0.7;
    } else if (pat === "summon") {
      const n = rage ? 7 : 5;
      for (let i = 0; i < n; i++) {
        const a = (TAU * i) / n;
        const e = this.spawn(b.d.minion, b.x + Math.cos(a) * 130, b.y + Math.sin(a) * 100);
        this.clampArena(e, 40);
        e.ox = e.x;
        e.oy = e.y;
      }
      b.busy = 1.0;
    } else if (pat === "breath") {
      const dur = rage ? 2.6 : 2.0;
      this.addZone({ kind: "cone", src: b, x: b.x, y: b.y, ang: Math.atan2(p.y - b.y, p.x - b.x), half: 0.33, len: 580, delay: 0.9, dur, dmg: 9, tick: 0.2, track: rage ? 0.9 : 0.65 });
      b.busy = 0.9 + dur + 0.3;
    } else if (pat === "rain") {
      const n = rage ? 10 : 7;
      for (let i = 0; i < n; i++) {
        this.after(i * 0.28, () => {
          if (!alive()) return;
          const a = this.rand() * TAU, d = this.rand() * 170;
          this.addZone({ kind: "circle", x: p.x + Math.cos(a) * d, y: p.y + Math.sin(a) * d, r: 92, delay: 0.75, dur: 0.14, dmg: 22, tick: 0, boom: true, pool: true });
        });
      }
      b.busy = n * 0.28 + 1.0;
    } else if (pat === "gust") {
      const n = rage ? 3 : 2;
      for (let i = 0; i < n; i++) {
        this.after(0.3 + i * 0.55, () => {
          if (alive()) this.ring(b.x, b.y, 18, i * 0.17, 250, 14, 0, 0);
        });
      }
      b.busy = n * 0.55 + 0.8;
    } else if (pat === "beams") {
      const n = rage ? 4 : 3, dir = this.rand() < 0.5 ? 1 : -1, a0 = this.rand() * TAU;
      for (let i = 0; i < n; i++) {
        this.addZone({ kind: "beam", src: b, x: b.x, y: b.y, ang: a0 + (TAU * i) / n, len: 1200, w: 40, delay: 1.0, dur: 4.0, dmg: 12, tick: 0.25, rot: 0.55 * dir * (rage ? 1.25 : 1) });
      }
      b.busy = 5.2;
    } else if (pat === "rings") {
      const n = rage ? 4 : 3;
      for (let i = 0; i < n; i++) {
        this.after(0.3 + i * 0.75, () => {
          if (alive()) this.ring(b.x, b.y, 22, this.rand() * TAU, 215, 14, 5, 0);
        });
      }
      b.busy = n * 0.75 + 0.8;
    } else if (pat === "blink") {
      const n = rage ? 3 : 2;
      for (let i = 0; i < n; i++) {
        this.after(i * 1.0, () => {
          if (!alive()) return;
          this.addZone({ kind: "circle", x: p.x, y: p.y, r: 165, delay: 0.75, dur: 0.14, dmg: 30, tick: 0, boom: true, warp: b });
        });
      }
      b.busy = n * 1.0 + 0.9;
    }
  }

  separate() {
    const en = this.enemies, n = en.length;
    for (let i = 0; i < n; i++) {
      const a = en[i];
      if (a.hp <= 0 || a.hidden) continue;
      for (let j = i + 1; j < n; j++) {
        const b = en[j];
        if (b.hp <= 0 || b.hidden) continue;
        const dx = b.x - a.x, dy = b.y - a.y, rr = (a.r + b.r) * 0.85, d2 = dx * dx + dy * dy;
        if (d2 >= rr * rr || d2 < 0.01) continue;
        const d = Math.sqrt(d2), push = (rr - d) / d;
        const wa = a.boss ? 0 : b.boss ? 1 : 0.5, wb = b.boss ? 0 : a.boss ? 1 : 0.5;
        a.x -= dx * push * wa;
        a.y -= dy * push * wa;
        b.x += dx * push * wb;
        b.y += dy * push * wb;
      }
      this.clampArena(a, a.r * 0.6);
    }
  }

  // ── projectiles ──────────────────────────────────────────────────────────

  shot(x, y, ang, speed, r, dmg, life, own, pierce, slow, knock) {
    const s = { x, y, ox: x, oy: y, dx: x, dy: y, vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed, r, dmg, life, own, pierce, slow, knock: knock || 0, pool: false, hits: null };
    this.shots.push(s);
    return s;
  }

  fan(x, y, ang, n, spread, speed, dmg) {
    for (let i = 0; i < n; i++) this.shot(x, y, ang + (i / (n - 1) - 0.5) * spread, speed, 10, dmg, 3.2, 1, 0, 0, 0);
  }

  /** A ring of hostile shots; `gap` leaves that many adjacent slots empty. */
  ring(x, y, n, a0, speed, dmg, gap, slow) {
    for (let i = gap; i < n; i++) this.shot(x, y, a0 + (TAU * i) / n, speed, 10, dmg, 4, 1, 0, slow, 0);
  }

  updateShots(dt) {
    const S = this.shots, en = this.enemies, p = this.player, A = this.arena;
    for (let i = S.length - 1; i >= 0; i--) {
      const s = S[i];
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.life -= dt;
      let dead = s.life <= 0;
      const landed = dead;
      if (!dead) {
        if (s.own === 0) {
          for (let j = 0; j < en.length; j++) {
            const e = en[j];
            if (e.hp <= 0 || e.hidden) continue;
            const rr = e.r + s.r + 8, dx = e.x - s.x, dy = e.y - s.y;
            if (dx * dx + dy * dy >= rr * rr) continue;
            if (s.hits && s.hits.includes(e.uid)) continue;
            this.damage(e, s.dmg, s.vx * s.knock, s.vy * s.knock);
            if (s.slow) e.slow = Math.max(e.slow, s.slow);
            this.fx.push({ kind: "hit", x: s.x, y: s.y, t: 0, dur: 0.14, r: 26 });
            if (s.pierce > 0) {
              s.pierce--;
              (s.hits ||= []).push(e.uid);
            } else {
              dead = true;
              break;
            }
          }
        } else {
          const rr = p.r + s.r, dx = p.x - s.x, dy = p.y - s.y;
          if (dx * dx + dy * dy < rr * rr && p.inv <= 0 && p.z < 30) {
            if (this.hurt(s.dmg, 0.25) && s.slow) p.slow = s.slow;
            dead = true;
          }
        }
        const qx = (s.x - A.cx) / (A.rx + 160), qy = (s.y - A.cy) / (A.ry + 160);
        if (qx * qx + qy * qy > 1) dead = true;
      }
      if (!dead) continue;
      if (s.own === 1 && s.pool && landed) this.addZone({ kind: "circle", x: s.x, y: s.y, r: 60, delay: 0, dur: 2.6, dmg: 5 * this.realm.dmgMul, tick: 0.4 });
      this.puff(s.x, s.y - 34, s.own ? HAZARD : this.hero.color, 3, 90);
      S[i] = S[S.length - 1];
      S.pop();
    }
  }

  // ── ground hazards ───────────────────────────────────────────────────────

  addZone(z) {
    z.t = 0;
    z.tickT = 0;
    z.fired = false;
    z.hit = false;
    this.zones.push(z);
    return z;
  }

  inZone(z, o, pad) {
    const dx = o.x - z.x, dy = o.y - z.y;
    if (z.kind === "circle") return dx * dx + dy * dy < (z.r + pad) * (z.r + pad);
    const d = Math.hypot(dx, dy);
    if (z.kind === "cone") return d < z.len + pad && Math.abs(angDiff(Math.atan2(dy, dx), z.ang)) < z.half + pad / Math.max(d, 60);
    const c = Math.cos(z.ang), s = Math.sin(z.ang), along = dx * c + dy * s;
    return along > 0 && along < z.len && Math.abs(dy * c - dx * s) < z.w / 2 + pad;
  }

  updateZones(dt) {
    const Z = this.zones, p = this.player;
    for (let i = Z.length - 1; i >= 0; i--) {
      const z = Z[i];
      z.t += dt;
      let dead = false;
      if (z.src) {
        if (z.src.hp <= 0) dead = true;
        z.x = z.src.x;
        z.y = z.src.y;
      }
      if (!dead && z.t >= z.delay) {
        if (!z.fired) {
          z.fired = true;
          if (z.warp && z.warp.hp > 0) { z.warp.x = z.warp.ox = z.x; z.warp.y = z.warp.oy = z.y; }
          if (z.boom) {
            this.cam.shake = Math.max(this.cam.shake, 12);
            this.puff(z.x, z.y - 10, HAZARD, 14, 260);
            this.sfx("boom", 0.7);
          }
        }
        if (z.kind === "cone" && z.track) z.ang += clamp(angDiff(Math.atan2(p.y - z.y, p.x - z.x), z.ang), -z.track * dt, z.track * dt);
        else if (z.kind === "beam") z.ang += z.rot * dt;
        z.tickT -= dt;
        // A leaping hero is over the ground hazard, not in it.
        if (p.z < 30 && this.inZone(z, p, z.kind === "circle" ? 4 : 0)) {
          if (z.tick === 0) {
            if (!z.hit && this.hurt(z.dmg, 0.3)) z.hit = true;
          } else if (z.tickT <= 0 && this.hurt(z.dmg, 0.1)) z.tickT = z.tick;
        }
        if (z.t >= z.delay + z.dur) {
          dead = true;
          if (z.pool) this.addZone({ kind: "circle", x: z.x, y: z.y, r: z.r * 0.85, delay: 0, dur: 3.2, dmg: 6, tick: 0.45 });
        }
      }
      if (dead) {
        const k = Z.indexOf(z);
        Z[k] = Z[Z.length - 1];
        Z.pop();
      }
    }
  }

  // ── the hero's own summons, thrown things and storms ─────────────────────

  updateAllies(dt) {
    const p = this.player, en = this.enemies;
    const L = this.lobs;
    for (let i = L.length - 1; i >= 0; i--) {
      const l = L[i];
      l.t += dt;
      if (l.t < l.dur) continue;
      this.explode(l.x1, l.y1, l.r, l.dmg, { knock: 220 });
      if (l.pool) this.fzones.push({ kind: l.pool.kind, x: l.x1, y: l.y1, r: l.pool.r, t: 0, dur: l.pool.dur, tick: l.pool.tick, tickT: l.pool.tick, dmg: l.pool.dmg, slow: 0 });
      L.splice(i, 1);
    }
    const F = this.fzones;
    for (let i = F.length - 1; i >= 0; i--) {
      const z = F[i];
      z.t += dt;
      z.tickT -= dt;
      if (z.tickT <= 0) {
        z.tickT = z.tick;
        for (let j = 0; j < en.length; j++) {
          const e = en[j];
          if (e.hp <= 0 || e.hidden || Math.hypot(e.x - z.x, e.y - z.y) > z.r + e.r) continue;
          if (z.slow) e.slow = Math.max(e.slow, z.slow);
          this.damage(e, z.dmg, 0, 0);
        }
      }
      if (z.t >= z.dur) F.splice(i, 1);
    }
    const A = this.allies;
    for (let i = A.length - 1; i >= 0; i--) {
      const a = A[i];
      a.t += dt;
      if (a.kind === "totem") {
        a.pulse -= dt;
        a.tickT -= dt;
        if (a.tickT <= 0) {
          a.tickT = a.tick;
          a.pulse = 0.35;
          this.rings.push({ x: a.x, y: a.y, t: 0, dur: 0.4, r0: 20, r1: a.r, color: this.hero.color, w: 6 });
          for (let j = 0; j < en.length; j++) {
            const e = en[j];
            if (e.hp > 0 && !e.hidden && Math.hypot(e.x - a.x, e.y - a.y) < a.r + e.r) this.damage(e, a.dmg, 0, 0);
          }
          if (Math.hypot(p.x - a.x, p.y - a.y) < a.r + 60) this.heal(p.maxHp * 0.02);
        }
      } else if (a.kind === "sentry") {
        a.tickT -= dt;
        if (a.tickT <= 0) {
          let best = null, bd = a.range;
          for (let j = 0; j < en.length; j++) {
            const e = en[j];
            if (e.hp <= 0 || e.hidden || e.born > 0) continue;
            const d = Math.hypot(e.x - a.x, e.y - a.y) - e.r;
            if (d < bd) { bd = d; best = e; }
          }
          if (best) {
            a.tickT = a.tick;
            a.ang = Math.atan2(best.y - a.y, best.x - a.x);
            this.shot(a.x, a.y, a.ang, 820, 6, a.dmg, a.range / 820 + 0.1, 0, 0, 0, 0.08);
            this.fx.push({ kind: "flash", x: a.x, y: a.y - 8, t: 0, dur: 0.07, r: 24 });
          }
        }
      }
      if (a.t < a.life) continue;
      if (a.kind === "mirror") this.explode(a.x, a.y, a.r, a.dmg, { freeze: 1.2 });
      else this.puff(a.x, a.y - 30, this.hero.color, 8, 130);
      A.splice(i, 1);
    }
  }

  updateGems(dt) {
    const G = this.gems, p = this.player, all = this.phase === "cleared";
    for (let i = G.length - 1; i >= 0; i--) {
      const g = G[i];
      g.t += dt;
      // Gems scatter when they drop, then rush in once the hero is near.
      g.x += g.vx * dt;
      g.y += g.vy * dt;
      g.vx *= 0.88;
      g.vy *= 0.88;
      const dx = p.x - g.x, dy = p.y - g.y, d = Math.hypot(dx, dy) || 1;
      if ((all || d < p.magnet) && g.t > 0.18) g.pull = true;
      if (g.pull) {
        g.sp = Math.min(TUNE.gemSpeed * (all ? 2 : 1.5), g.sp + 2600 * dt);
        g.x += (dx / d) * g.sp * dt;
        g.y += (dy / d) * g.sp * dt;
      }
      if (d < p.r + 16 && g.t > 0.18) {
        if (g.heart) this.heal(p.maxHp * TUNE.heartHeal);
        else this.gainXp(g.v);
        this.fx.push({ kind: "hit", x: p.x, y: p.y + 30, t: 0, dur: 0.16, r: 22, col: g.heart ? "#ff6f8f" : "#7fe9ff" });
        G[i] = G[G.length - 1];
        G.pop();
      }
    }
  }

  // ── autopilot (dev: ?auto=1) ─────────────────────────────────────────────

  autopilot() {
    const p = this.player, I = this.input, A = this.arena;
    let ax = 0, ay = 0, near = 1e9, threat = false, tgt = null, td = 1e9, close = 0;
    const melee = this.hero.attack.kind === "cleave";
    const range = this.hero.attack.range * p.rangeMul;
    for (const e of this.enemies) {
      if (e.hp <= 0 || e.hidden) continue;
      const dx = p.x - e.x, dy = p.y - e.y, d = Math.hypot(dx, dy) || 1, edge = d - e.r;
      if (edge < near) near = edge;
      if (edge < td) { td = edge; tgt = e; }
      if (edge < 320) close += e.boss ? 4 : 1;
      const keep = e.boss ? (melee ? 90 : 300) : melee ? 60 : Math.min(200, range * 0.55);
      if (edge < keep) {
        const w = ((keep - edge) / keep) * (e.boss ? 3 : 1.5);
        ax += (dx / d) * w;
        ay += (dy / d) * w;
      }
    }
    if (tgt && td > range * 0.8) {
      ax += ((tgt.x - p.x) / (td + tgt.r)) * 0.8;
      ay += ((tgt.y - p.y) / (td + tgt.r)) * 0.8;
    }
    for (const s of this.shots) {
      if (s.own !== 1) continue;
      const dx = p.x - s.x, dy = p.y - s.y, d = Math.hypot(dx, dy) || 1;
      if (d > 160) continue;
      const vl = Math.hypot(s.vx, s.vy) || 1, px = -s.vy / vl, py = s.vx / vl;
      const side = dx * px + dy * py >= 0 ? 1 : -1, w = ((160 - d) / 160) * 2.2;
      ax += px * side * w;
      ay += py * side * w;
    }
    for (const z of this.zones) {
      if (z.kind === "circle") {
        const dx = p.x - z.x, dy = p.y - z.y, d = Math.hypot(dx, dy) || 1;
        if (d < z.r + 70) {
          ax += (dx / d) * 4;
          ay += (dy / d) * 4;
          if (d < z.r + 10 && z.t > z.delay - 0.3) threat = true;
        }
      } else if (this.inZone(z, p, 110)) {
        const ang = Math.atan2(p.y - z.y, p.x - z.x), s = angDiff(ang, z.ang) >= 0 ? 1 : -1;
        ax += -Math.sin(ang) * s * 4.5;
        ay += Math.cos(ang) * s * 4.5;
        if (this.inZone(z, p, 10) && z.t > z.delay - 0.2) threat = true;
      }
    }
    ax += ((A.cx - p.x) / A.rx) * 1.4;
    ay += ((A.cy - p.y) / A.ry) * 1.4;
    let gb = null, gd = 340;
    for (const g of this.gems) {
      const d = Math.hypot(g.x - p.x, g.y - p.y);
      if (d < gd) { gd = d; gb = g; }
    }
    if (gb && near > 110) {
      ax += ((gb.x - p.x) / gd) * 1.1;
      ay += ((gb.y - p.y) / gd) * 1.1;
    }
    const l = Math.hypot(ax, ay);
    if (l > 0.08) { I.mx = ax / l; I.my = ay / l; }
    else I.mx = I.my = 0;
    if ((threat || (!melee && near < 22)) && p.dashN > 0) I.dash = true;
    if (close >= 3) {
      if (p.ab[0] && p.ab[0].cd <= 0) I.a1 = true;
      else if (p.ab[1] && p.ab[1].cd <= 0) I.a2 = true;
    }
    if (p.ult >= TUNE.ultMax && (this.boss || this.enemies.length > 8)) I.ult = true;
  }

  // ── effects ──────────────────────────────────────────────────────────────

  puff(x, y, color, n, speed) {
    if (this.parts.length > 260) return;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, v = speed * (0.3 + Math.random() * 0.7);
      this.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 40, t: 0, life: 0.3 + Math.random() * 0.4, size: 5 + Math.random() * 9, color });
    }
  }

  /** Soft ground dust: footsteps, landings, skids. */
  dust(x, y, n) {
    if (this.dusts.length > 90) return;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, v = n > 1 ? 40 + Math.random() * 70 : 12;
      this.dusts.push({ x: x + (Math.random() - 0.5) * 14, y: y + (Math.random() - 0.5) * 6, vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.5, t: 0, life: 0.35 + Math.random() * 0.25, r: 7 + Math.random() * 7 });
    }
  }

  initAmbient() {
    const kind = this.realm ? this.realm.ambient : "leaves";
    const n = 34, A = (this.ambient = []);
    for (let i = 0; i < n; i++) {
      const s = 0.5 + Math.random();
      const a = { x: Math.random() * this.W, y: Math.random() * this.H, s, ph: Math.random() * TAU, vx: 0, vy: 0 };
      if (kind === "leaves") { a.vx = 18 * s; a.vy = 26 * s; }
      else if (kind === "embers") { a.vx = 8 * s; a.vy = -34 * s; }
      else { a.vx = -26 * s; a.vy = 46 * s; }
      A.push(a);
    }
  }

  sil(a, color) {
    const key = a.id + color;
    let c = this.sils.get(key);
    if (c) return c;
    c = document.createElement("canvas");
    c.width = a.img.naturalWidth;
    c.height = a.img.naturalHeight;
    const g = c.getContext("2d");
    g.drawImage(a.img, 0, 0);
    g.globalCompositeOperation = "source-in";
    g.fillStyle = color;
    g.fillRect(0, 0, c.width, c.height);
    this.sils.set(key, c);
    return c;
  }

  glow(color) {
    let c = this.glows.get(color);
    if (c) return c;
    c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d");
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, "#ffffff");
    gr.addColorStop(0.22, color);
    gr.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = gr;
    g.globalAlpha = 0.95;
    g.fillRect(0, 0, 64, 64);
    this.glows.set(color, c);
    return c;
  }

  // ── rendering ────────────────────────────────────────────────────────────

  /**
   * Draw one frame of a sprite, feet at (x, y). `a` is a still image or a sheet
   * ({cols, cw, ch, ax}); the same call tints and flashes it.
   */
  sprite(a, frame, x, y, h, face, sx, sy, rot, alpha, flash, tint, tintA) {
    const ctx = this.ctx;
    let u = 0, v = 0, cw = a.img.naturalWidth, ch = a.img.naturalHeight, ax = 0.5;
    if (a.cols) {
      cw = a.cw;
      ch = a.ch;
      u = (frame % a.cols) * cw;
      v = Math.floor(frame / a.cols) * ch;
      ax = a.ax;
    }
    const w = (h * cw) / ch;
    ctx.save();
    ctx.translate(x, y);
    if (rot) ctx.rotate(rot);
    ctx.scale(face * sx, sy);
    ctx.globalAlpha = alpha;
    ctx.drawImage(a.img, u, v, cw, ch, -w * ax, -h, w, h);
    if (tintA > 0) {
      ctx.globalAlpha = alpha * tintA;
      ctx.drawImage(this.sil(a, tint), u, v, cw, ch, -w * ax, -h, w, h);
    }
    if (flash > 0) {
      ctx.globalAlpha = alpha * flash;
      ctx.drawImage(this.sil(a, "#ffffff"), u, v, cw, ch, -w * ax, -h, w, h);
    }
    ctx.restore();
  }

  render(dt) {
    const ctx = this.ctx, W = this.W, H = this.H, dpr = this.dpr, p = this.player;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "#06080b";
    ctx.fillRect(0, 0, this.cv.width, this.cv.height);
    if (!p || this.phase === "idle") return;
    const live = this.running();

    // Blend every moving thing between its last two simulated positions.
    const A = live ? clamp(this.acc / STEP, 0, 1) : 1;
    p.dx = p.ox + (p.x - p.ox) * A;
    p.dy = p.oy + (p.y - p.oy) * A;
    for (const e of this.enemies) { e.dx = e.ox + (e.x - e.ox) * A; e.dy = e.oy + (e.y - e.oy) * A; }
    for (const s of this.shots) { s.dx = s.ox + (s.x - s.ox) * A; s.dy = s.oy + (s.y - s.oy) * A; }

    // camera: leads the hero a little, eases after them, and kicks on big hits
    this.cam.punch *= Math.pow(0.004, dt);
    const z = this.zoom * (1 + this.cam.punch);
    const vw = W / z, vh = H / z;
    const lx = p.dx + clamp(p.vx * 0.2, -70, 70), ly = p.dy - 40 + clamp(p.vy * 0.2, -55, 55);
    const tx = vw >= WORLD.w ? WORLD.w / 2 : clamp(lx, vw / 2, WORLD.w - vw / 2);
    const ty = vh >= WORLD.h ? WORLD.h / 2 : clamp(ly, vh / 2, WORLD.h - vh / 2);
    const k = 1 - Math.exp(-dt * 7.5);
    this.cam.x += (tx - this.cam.x) * k;
    this.cam.y += (ty - this.cam.y) * k;
    let sx = 0, sy = 0;
    if (this.cam.shake > 0.4) {
      if (this.opts.shake) {
        sx = (Math.random() - 0.5) * this.cam.shake;
        sy = (Math.random() - 0.5) * this.cam.shake;
      }
      this.cam.shake *= Math.pow(0.002, dt);
    }
    ctx.setTransform(z * dpr, 0, 0, z * dpr, (W / 2 - this.cam.x * z + sx) * dpr, (H / 2 - this.cam.y * z + sy) * dpr);

    const floor = this.art[this.realm.floor];
    if (floor) ctx.drawImage(floor.img, 0, 0, WORLD.w, WORLD.h);
    else {
      ctx.fillStyle = "#1a2026";
      ctx.beginPath();
      ctx.ellipse(this.arena.cx, this.arena.cy, this.arena.rx, this.arena.ry, 0, 0, TAU);
      ctx.fill();
    }

    this.drawFriendlyGround(ctx);
    this.drawZones(ctx);

    // ground dust
    for (let i = this.dusts.length - 1; i >= 0; i--) {
      const d = this.dusts[i];
      if (live) { d.t += dt; d.x += d.vx * dt; d.y += d.vy * dt; d.vx *= 0.92; d.vy *= 0.92; }
      const f = d.t / d.life;
      if (f >= 1) { this.dusts[i] = this.dusts[this.dusts.length - 1]; this.dusts.pop(); continue; }
      ctx.globalAlpha = (1 - f) * 0.3;
      ctx.fillStyle = this.realm.dust;
      ctx.beginPath();
      ctx.ellipse(d.x, d.y - f * 10, d.r * (0.6 + f), d.r * (0.6 + f) * 0.6, 0, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // rings on the ground
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      if (live) r.t += dt;
      const q = r.t / r.dur;
      if (q >= 1) { this.rings.splice(i, 1); continue; }
      const e = 1 - (1 - q) * (1 - q), rr = r.r0 + (r.r1 - r.r0) * e;
      ctx.globalAlpha = (1 - q) * 0.8;
      ctx.strokeStyle = r.color;
      ctx.lineWidth = r.w * (1 - q * 0.7);
      ctx.beginPath();
      ctx.ellipse(r.x, r.y, rr, rr * 0.8, 0, 0, TAU);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // gems
    for (const g of this.gems) {
      const bob = Math.sin(this.time * 6 + g.x) * 3;
      ctx.drawImage(this.glow(g.heart ? "#ff6f8f" : "#7fe9ff"), g.x - 16, g.y - 22 + bob, 32, 32);
      ctx.fillStyle = g.heart ? "#ffd0da" : "#eaffff";
      ctx.beginPath();
      if (g.heart) ctx.arc(g.x, g.y - 6 + bob, 5, 0, TAU);
      else { ctx.moveTo(g.x, g.y - 13 + bob); ctx.lineTo(g.x + 5, g.y - 6 + bob); ctx.lineTo(g.x, g.y + 1 + bob); ctx.lineTo(g.x - 5, g.y - 6 + bob); }
      ctx.fill();
    }

    // the fallen: a quick white flash, squash and fade
    for (let i = this.corpses.length - 1; i >= 0; i--) {
      const c = this.corpses[i];
      if (live) { c.t += dt; c.x += c.kx * dt; c.y += c.ky * dt; }
      const f = c.t / c.dur;
      if (f >= 1) { this.corpses.splice(i, 1); continue; }
      const a = this.art[c.d.sprite];
      if (a) this.sprite(a, 0, c.x, c.y, c.h, c.face, 1 + f * 0.35, 1 - f * 0.55, 0, 1 - f, 1 - f * 0.4, null, 0);
    }

    // y-sorted actors
    const order = this.order;
    order.length = 0;
    for (const e of this.enemies) if (e.hp > 0 && !e.hidden) order.push(e);
    for (const a of this.allies) order.push(a);
    if (this.phase !== "dead") order.push(p);
    order.sort((a, b) => (a.dy ?? a.y) - (b.dy ?? b.y));
    ctx.fillStyle = "rgba(0,0,0,0.36)";
    for (const o of order) {
      const r = (o.r && o.kind === undefined ? o.r : 16) * 1.15 * (o === p ? 1 - (p.z / 96) * 0.45 : 1);
      ctx.beginPath();
      ctx.ellipse(o.dx ?? o.x, o.dy ?? o.y, r, r * 0.42, 0, 0, TAU);
      ctx.fill();
    }
    for (const o of order) {
      if (o === p) this.drawPlayer(ctx, dt, live);
      else if (o.kind) this.drawAlly(ctx, o);
      else this.drawEnemy(ctx, o);
    }

    // projectiles, flashes and sparks, additive
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    for (const s of this.shots) {
      const col = s.own ? HAZARD : this.hero.color, y = s.dy - 34;
      ctx.strokeStyle = col;
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = s.r * 1.1;
      ctx.beginPath();
      ctx.moveTo(s.dx - s.vx * 0.05, y - s.vy * 0.05);
      ctx.lineTo(s.dx, y);
      ctx.stroke();
      ctx.globalAlpha = 1;
      const d = s.r * 5.2;
      ctx.drawImage(this.glow(col), s.dx - d / 2, y - d / 2, d, d);
    }
    for (const l of this.lobs) {
      const q = l.t / l.dur, x = l.x0 + (l.x1 - l.x0) * q, y = l.y0 + (l.y1 - l.y0) * q - Math.sin(q * Math.PI) * 130 - 30;
      ctx.drawImage(this.glow(this.hero.color), x - 22, y - 22, 44, 44);
    }
    for (let k2 = 0; k2 < p.wisps; k2++) {
      const wa = this.time * 2.4 + (TAU * k2) / p.wisps;
      ctx.drawImage(this.glow("#ffc36b"), p.dx + Math.cos(wa) * 80 - 24, p.dy + Math.sin(wa) * 64 - 58, 48, 48);
    }
    if (p.swing > 0) {
      const q = 1 - p.swing / 0.2;
      ctx.globalAlpha = (1 - q) * 0.75;
      ctx.fillStyle = this.hero.color;
      ctx.beginPath();
      const a0 = p.swingAng - p.swingHalf, a1 = a0 + p.swingHalf * 2 * Math.min(1, q * 1.6 + 0.25);
      ctx.arc(p.dx, p.dy - 20, p.swingR, a0, a1);
      ctx.arc(p.dx, p.dy - 20, p.swingR * 0.62, a1, a0, true);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    this.drawFx(ctx, dt, live);
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const q = this.parts[i];
      if (live || this.phase === "dead") {
        q.t += dt;
        q.x += q.vx * dt;
        q.y += q.vy * dt;
        q.vx *= 0.94;
        q.vy *= 0.94;
      }
      const f = q.t / q.life;
      if (f >= 1) { this.parts[i] = this.parts[this.parts.length - 1]; this.parts.pop(); continue; }
      const d = q.size * (1 - f) * 3;
      ctx.globalAlpha = 1 - f;
      ctx.drawImage(this.glow(q.color), q.x - d / 2, q.y - d / 2, d, d);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";

    // damage numbers: pop in large, settle, drift up
    ctx.textAlign = "center";
    ctx.lineJoin = "round";
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const t = this.texts[i];
      if (live) t.t += dt;
      const f = t.t / 0.6;
      if (f >= 1) { this.texts[i] = this.texts[this.texts.length - 1]; this.texts.pop(); continue; }
      const pop = 1 + Math.max(0, 0.6 - f * 5);
      ctx.globalAlpha = 1 - f * f;
      ctx.font = `700 ${Math.round((t.crit ? 25 : 16) * pop)}px ui-sans-serif, system-ui, sans-serif`;
      ctx.lineWidth = 4;
      ctx.strokeStyle = "rgba(0,0,0,0.75)";
      ctx.fillStyle = t.crit ? "#ffd866" : "#ffffff";
      const x = t.x + t.vx * f, y = t.y - f * 38;
      ctx.strokeText(t.v, x, y);
      ctx.fillText(t.v, x, y);
    }
    ctx.globalAlpha = 1;

    // screen space
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = this.realm.grade;
    ctx.fillRect(0, 0, W, H);
    this.drawAmbient(ctx, dt, W, H);
    ctx.drawImage(this.vig, 0, 0, W, H);
    if (this.hurtFlash > 0 || p.hp < p.maxHp * 0.3) {
      this.hurtFlash = Math.max(0, this.hurtFlash - dt);
      const low = p.hp < p.maxHp * 0.3 && this.phase !== "dead" ? 0.1 + Math.sin(this.time * 6) * 0.05 : 0;
      const a = Math.max(this.hurtFlash * 0.9, low);
      const gr = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.7);
      gr.addColorStop(0, "rgba(255,30,20,0)");
      gr.addColorStop(1, `rgba(255,30,20,${a.toFixed(3)})`);
      ctx.fillStyle = gr;
      ctx.fillRect(0, 0, W, H);
    }
    if (this.phase === "bossIntro") {
      ctx.fillStyle = `rgba(0,0,0,${(0.35 * Math.sin((Math.min(this.phaseT, 2.2) / 2.2) * Math.PI)).toFixed(3)})`;
      ctx.fillRect(0, 0, W, H);
    }
    if (this.opts.dev) {
      ctx.fillStyle = "#9f9";
      ctx.font = "12px monospace";
      ctx.textAlign = "left";
      ctx.fillText(`${this.fps.toFixed(0)} fps · ${this.enemies.length} foes · ${this.shots.length} shots · ${this.zones.length} zones · ${this.parts.length} parts · ${this.phase} ${this.realmT.toFixed(0)}s`, 8, H - 8);
    }
  }

  /** The hero's own storms, burns and landing markers — always in the hero's colour. */
  drawFriendlyGround(ctx) {
    const col = this.hero.color;
    for (const z of this.fzones) {
      const fade = Math.min(1, (z.dur - z.t) * 2, z.t * 5);
      ctx.globalAlpha = 0.2 * fade;
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.ellipse(z.x, z.y, z.r, z.r * 0.8, 0, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 0.55 * fade;
      ctx.strokeStyle = col;
      ctx.lineWidth = 3;
      ctx.setLineDash([14, 12]);
      ctx.lineDashOffset = -this.time * 60;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "#ffffff";
      const n = z.kind === "ice" ? 16 : 9;
      for (let i = 0; i < n; i++) {
        const a = this.time * (z.kind === "ice" ? 2.2 : 0.9) + i * 2.4, rr = z.r * (0.25 + ((i * 37) % 70) / 100);
        ctx.globalAlpha = 0.6 * fade;
        ctx.fillRect(z.x + Math.cos(a) * rr, z.y + Math.sin(a) * rr * 0.8 - (z.kind === "ice" ? 0 : ((this.time * 60 + i * 20) % 40)), 3, 3);
      }
    }
    for (const l of this.lobs) {
      ctx.globalAlpha = 0.5 + (l.t / l.dur) * 0.4;
      ctx.strokeStyle = col;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(l.x1, l.y1, l.r, l.r * 0.8, 0, 0, TAU);
      ctx.stroke();
    }
    for (const a of this.allies) {
      if (a.kind !== "totem") continue;
      ctx.globalAlpha = 0.25;
      ctx.strokeStyle = col;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(a.x, a.y, a.r, a.r * 0.8, 0, 0, TAU);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  drawAlly(ctx, a) {
    const col = this.hero.color, fade = Math.min(1, (a.life - a.t) * 3, a.t * 6);
    if (a.kind === "totem") {
      const s = 1 + Math.max(0, a.pulse) * 0.5;
      ctx.globalAlpha = fade;
      ctx.fillStyle = "#3b2c1c";
      ctx.beginPath();
      ctx.moveTo(a.x - 13, a.y);
      ctx.lineTo(a.x - 9, a.y - 74);
      ctx.lineTo(a.x, a.y - 88);
      ctx.lineTo(a.x + 9, a.y - 74);
      ctx.lineTo(a.x + 13, a.y);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "#1c140c";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.globalCompositeOperation = "lighter";
      ctx.drawImage(this.glow(col), a.x - 26 * s, a.y - 66 - 26 * s, 52 * s, 52 * s);
      ctx.drawImage(this.glow(col), a.x - 12, a.y - 34, 24, 24);
      ctx.globalCompositeOperation = "source-over";
    } else if (a.kind === "sentry") {
      const y = a.y - 46 + Math.sin(this.time * 4 + a.x) * 5;
      ctx.globalAlpha = fade;
      ctx.save();
      ctx.translate(a.x, y);
      ctx.fillStyle = "#2a3644";
      ctx.strokeStyle = col;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, -14);
      ctx.lineTo(16, 0);
      ctx.lineTo(0, 12);
      ctx.lineTo(-16, 0);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.rotate(a.ang);
      ctx.fillStyle = "#8fa2b6";
      ctx.fillRect(4, -3, 18, 6);
      ctx.restore();
      ctx.globalCompositeOperation = "lighter";
      ctx.drawImage(this.glow(col), a.x - 14, y - 14, 28, 28);
      ctx.globalCompositeOperation = "source-over";
    } else {
      const img = this.art[this.hero.sprite];
      if (img) {
        const pulse = 0.45 + Math.sin(a.t * 26) * 0.25;
        this.sprite(img, 0, a.x, a.y, this.hero.h, a.face, 1, 1, 0, pulse, 0, col, 1);
      }
    }
    ctx.globalAlpha = 1;
  }

  drawFx(ctx, dt, live) {
    const col = this.hero.color;
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const f = this.fx[i];
      if (live) f.t += dt;
      const q = f.t / f.dur;
      if (q >= 1) { this.fx[i] = this.fx[this.fx.length - 1]; this.fx.pop(); continue; }
      if (f.kind === "flash" || f.kind === "hit") {
        const d = f.r * (f.kind === "hit" ? 0.6 + q * 1.6 : 2 - q);
        ctx.globalAlpha = 1 - q;
        ctx.drawImage(this.glow(f.col || col), f.x - d / 2, f.y - 34 - d / 2, d, d);
      } else if (f.kind === "cone") {
        ctx.globalAlpha = (1 - q) * 0.55;
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.moveTo(f.x, f.y);
        ctx.arc(f.x, f.y, f.len * Math.min(1, q * 3 + 0.3), f.ang - f.half, f.ang + f.half);
        ctx.closePath();
        ctx.fill();
      } else if (f.kind === "spike") {
        const up = Math.min(1, q * 7), fade = q > 0.6 ? 1 - (q - 0.6) / 0.4 : 1, hgt = 96 * f.s * up;
        // each shard: a coloured body with a bright inner facet
        for (let k = -1; k <= 1; k++) {
          const bx = f.x + k * 17, hh = hgt * (k === 0 ? 1 : 0.62);
          ctx.globalAlpha = fade * 0.75;
          ctx.fillStyle = col;
          ctx.beginPath();
          ctx.moveTo(bx - 12, f.y + 4);
          ctx.lineTo(bx + k * 7, f.y - hh);
          ctx.lineTo(bx + 12, f.y + 4);
          ctx.closePath();
          ctx.fill();
          ctx.globalAlpha = fade * 0.9;
          ctx.fillStyle = "#f2fdff";
          ctx.beginPath();
          ctx.moveTo(bx - 3, f.y + 2);
          ctx.lineTo(bx + k * 7, f.y - hh * 0.96);
          ctx.lineTo(bx + 7, f.y + 2);
          ctx.closePath();
          ctx.fill();
        }
        ctx.drawImage(this.glow(col), f.x - 44, f.y - 54, 88, 88);
      }
    }
    ctx.globalAlpha = 1;
  }

  drawZones(ctx) {
    for (const z of this.zones) {
      const armed = z.t >= z.delay, q = armed ? 1 : z.t / z.delay;
      if (z.kind === "circle") {
        const ry = z.r * 0.8;
        if (!armed) {
          ctx.fillStyle = "rgba(255,70,30,0.14)";
          ctx.beginPath();
          ctx.ellipse(z.x, z.y, z.r, ry, 0, 0, TAU);
          ctx.fill();
          ctx.fillStyle = "rgba(255,90,40,0.34)";
          ctx.beginPath();
          ctx.ellipse(z.x, z.y, z.r * q, ry * q, 0, 0, TAU);
          ctx.fill();
          ctx.strokeStyle = "rgba(255,120,60,0.95)";
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.ellipse(z.x, z.y, z.r, ry, 0, 0, TAU);
          ctx.stroke();
        } else {
          const left = 1 - (z.t - z.delay) / z.dur;
          const a = z.tick ? 0.3 + Math.sin(this.time * 14 + z.x) * 0.08 : 0.85 * left;
          ctx.fillStyle = z.tick ? `rgba(255,110,30,${(a * Math.min(1, left * 4)).toFixed(3)})` : `rgba(255,230,190,${a.toFixed(3)})`;
          ctx.beginPath();
          ctx.ellipse(z.x, z.y, z.r, ry, 0, 0, TAU);
          ctx.fill();
        }
      } else if (z.kind === "cone") {
        ctx.fillStyle = armed ? `rgba(255,120,30,${(0.5 + Math.sin(this.time * 30) * 0.12).toFixed(3)})` : `rgba(255,80,30,${(0.1 + q * 0.2).toFixed(3)})`;
        ctx.beginPath();
        ctx.moveTo(z.x, z.y);
        ctx.arc(z.x, z.y, z.len, z.ang - z.half, z.ang + z.half);
        ctx.closePath();
        ctx.fill();
        if (armed) {
          ctx.fillStyle = "rgba(255,240,200,0.4)";
          ctx.beginPath();
          ctx.moveTo(z.x, z.y);
          ctx.arc(z.x, z.y, z.len * 0.8, z.ang - z.half * 0.45, z.ang + z.half * 0.45);
          ctx.closePath();
          ctx.fill();
        } else {
          ctx.strokeStyle = "rgba(255,120,60,0.9)";
          ctx.lineWidth = 3;
          ctx.stroke();
        }
      } else {
        const ex = z.x + Math.cos(z.ang) * z.len, ey = z.y + Math.sin(z.ang) * z.len;
        ctx.lineCap = "round";
        ctx.strokeStyle = armed ? "rgba(255,90,40,0.55)" : `rgba(255,90,40,${(0.25 + q * 0.4).toFixed(3)})`;
        ctx.lineWidth = armed ? z.w : 4;
        ctx.beginPath();
        ctx.moveTo(z.x, z.y);
        ctx.lineTo(ex, ey);
        ctx.stroke();
        if (armed) {
          ctx.strokeStyle = "rgba(255,245,225,0.95)";
          ctx.lineWidth = z.w * 0.3;
          ctx.beginPath();
          ctx.moveTo(z.x, z.y);
          ctx.lineTo(ex, ey);
          ctx.stroke();
        }
      }
    }
    // wind-up lines for chargers
    ctx.lineCap = "round";
    for (const e of this.enemies) {
      if (e.hp <= 0 || e.st !== "wind") continue;
      ctx.strokeStyle = `rgba(255,90,40,${(0.25 + (e.stT / 0.65) * 0.5).toFixed(3)})`;
      ctx.lineWidth = e.r * 1.4;
      ctx.beginPath();
      ctx.moveTo(e.dx, e.dy);
      ctx.lineTo(e.dx + Math.cos(e.ang) * e.d.chargeSpeed * 0.5, e.dy + Math.sin(e.ang) * e.d.chargeSpeed * 0.5);
      ctx.stroke();
    }
  }

  drawEnemy(ctx, e) {
    const a = this.art[e.d.sprite];
    let alpha = 1, sx = 1, sy = 1, lift = 0, rot = 0, fwd = 0;
    if (e.born > 0) {
      const k = 1 - e.born / (e.boss ? 0.9 : TUNE.spawnFade);
      alpha = k;
      sy = 0.35 + 0.65 * k;
    }
    if (e.st === "wind" || e.st === "aim") { sx = 1.1; sy *= 0.9; }
    else if (e.st === "dash") { sx = 1.16; sy *= 0.88; }
    const still = e.frozen > 0 || e.stun > 0 || e.born > 0;
    if (e.d.float) lift = 8 + (still ? 0 : Math.sin(this.time * 3 + e.phase) * 4);
    if (!still) {
      if (e.moving && !e.d.float) {
        // A two-beat waddle: rock side to side and hop on each step.
        const w = e.walk * TAU * (e.boss ? 0.9 : 1.5) + e.phase;
        rot = Math.sin(w) * (e.boss ? 0.035 : 0.075);
        lift += Math.abs(Math.sin(w)) * (e.boss ? 5 : 4);
      } else if (e.d.float) rot = Math.sin(this.time * 2 + e.phase) * 0.05;
      sy *= 1 + Math.sin(this.time * (e.boss ? 3 : 6) + e.phase) * (e.boss ? 0.014 : 0.018);
    } else if (e.stun > 0) rot = Math.sin(this.time * 16 + e.phase) * 0.05;
    if (e.lunge > 0) {
      const q = e.lunge / (e.boss ? 0.35 : 0.2);
      fwd = Math.sin(q * Math.PI) * (e.boss ? 26 : 14);
      sx *= 1 + Math.sin(q * Math.PI) * 0.1;
    }
    if (!a) {
      ctx.fillStyle = "#b03a2e";
      ctx.beginPath();
      ctx.arc(e.dx, e.dy - e.r, e.r, 0, TAU);
      ctx.fill();
    } else {
      const frozen = e.frozen > 0;
      const warn = e.st === "aim" || e.st === "wind";
      const tint = frozen ? "#9fe4ff" : warn ? "#ff5a2a" : e.d.tint;
      const tintA = frozen ? 0.55 : warn ? 0.3 + Math.sin(this.time * 30) * 0.15 : e.d.tint ? 0.3 : 0;
      this.sprite(a, 0, e.dx + fwd * e.face, e.dy - lift, e.h, e.face, sx, sy, rot, alpha, e.flash > 0 ? Math.min(1, e.flash * 8) : 0, tint, tint ? tintA : 0);
    }
    if (!e.boss && e.maxHp > 90 && e.hp < e.maxHp) {
      const w = e.r * 2;
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.fillRect(e.dx - w / 2, e.dy - e.h - 12, w, 5);
      ctx.fillStyle = "#ff5a3c";
      ctx.fillRect(e.dx - w / 2, e.dy - e.h - 12, w * (e.hp / e.maxHp), 5);
    }
  }

  drawPlayer(ctx, dt, live) {
    const p = this.player, h = this.hero, still = this.art[h.sprite], anims = (this.art.anims && this.art.anims[h.id]) || {};
    const x = p.dx, y = p.dy;
    // footing ring: the hero must pop off any floor
    const ready = p.ult >= TUNE.ultMax;
    ctx.strokeStyle = h.color;
    ctx.globalAlpha = ready ? 0.65 + Math.sin(this.time * 8) * 0.25 : 0.4;
    ctx.lineWidth = ready ? 5 : 3;
    ctx.beginPath();
    ctx.ellipse(x, y, 30, 13, 0, 0, TAU);
    ctx.stroke();
    ctx.globalAlpha = 1;
    if (!still) {
      ctx.fillStyle = h.color;
      ctx.beginPath();
      ctx.arc(x, y - 30 - p.z, 22, 0, TAU);
      ctx.fill();
      return;
    }
    // pick the frame: an attack plays over standing (and over everything for a melee swing), otherwise run or idle
    const spd = Math.hypot(p.vx, p.vy), moving = spd > 50 && !p.rush;
    let a = still, frame = 0, hh = h.h;
    if (p.atkAnim > 0 && anims.atk && (h.attack.kind === "cleave" || !moving)) {
      a = anims.atk;
      frame = Math.min(a.n - 1, Math.floor((1 - p.atkAnim / p.atkDur) * a.n));
    } else if ((moving || p.rush) && anims.run) {
      a = anims.run;
      frame = p.rush ? a.lead : Math.floor((p.runPhase % 1) * a.n) % a.n;
    }
    if (a !== still) hh = h.h * a.scale;
    for (let i = this.ghosts.length - 1; i >= 0; i--) {
      const g = this.ghosts[i];
      if (live) g.t -= dt;
      if (g.t <= 0) { this.ghosts.splice(i, 1); continue; }
      this.sprite(a, frame, g.x, g.y, hh, g.face, 1.1, 0.94, 0, (g.t / 0.24) * 0.4, 0, h.color, 1);
    }
    let sx = 1, sy = 1 + (moving ? 0 : Math.sin(this.time * 3.4) * 0.014), rot = clamp(p.vx / h.speed, -1.4, 1.4) * 0.05;
    if (p.rush) { sx = 1.14; sy = 0.9; rot = clamp(p.rush.dx, -1, 1) * 0.16; }
    else if (p.kick > 0 && a === still) { sx = 1.06; sy *= 0.95; }
    const blink = p.inv > 0 && !p.rush && Math.sin(this.time * 44) > 0.2 ? 0.6 : 1;
    const tint = p.bark > 0 ? "#8dff5c" : p.over > 0 ? "#ffffff" : p.slow > 0 ? "#7fb8ff" : null;
    const tintA = p.bark > 0 ? 0.3 + Math.sin(this.time * 10) * 0.08 : p.over > 0 ? 0.2 + Math.sin(this.time * 24) * 0.12 : p.slow > 0 ? 0.4 : 0;
    this.sprite(a, frame, x, y - p.z, hh, p.face, sx, sy, rot, blink, p.flash > 0 ? Math.min(1, p.flash * 6) : 0, tint, tintA);
    if (p.bark > 0) {
      ctx.globalAlpha = 0.5 + Math.sin(this.time * 9) * 0.2;
      ctx.strokeStyle = h.color;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.ellipse(x, y - h.h * 0.45, h.h * 0.5, h.h * 0.62, 0, 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  drawAmbient(ctx, dt, W, H) {
    const kind = this.realm.ambient;
    ctx.globalCompositeOperation = kind === "leaves" ? "source-over" : "lighter";
    ctx.fillStyle = kind === "leaves" ? "rgba(150,190,90,0.5)" : kind === "embers" ? "rgba(255,150,60,0.75)" : "rgba(230,245,255,0.7)";
    for (const a of this.ambient) {
      a.x += (a.vx + Math.sin(this.time * 1.3 + a.ph) * 14) * dt;
      a.y += a.vy * dt;
      if (a.x > W + 10) a.x = -10; else if (a.x < -10) a.x = W + 10;
      if (a.y > H + 10) a.y = -10; else if (a.y < -10) a.y = H + 10;
      const s = kind === "leaves" ? 3.2 * a.s : 2 * a.s;
      if (kind === "leaves") {
        ctx.beginPath();
        ctx.ellipse(a.x, a.y, s * 1.6, s * 0.7, a.ph + this.time * a.s, 0, TAU);
        ctx.fill();
      } else ctx.fillRect(a.x, a.y, s, s);
    }
    ctx.globalCompositeOperation = "source-over";
  }
}
