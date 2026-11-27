/**
 * Every tunable number and every player-visible string in Spirebound.
 * Balance and localisation are data changes — game.js holds no magic numbers
 * that a designer would want to turn.
 */

export const WORLD = { w: 2800, h: 1563 };

export const TUNE = {
  magnet: 100,
  gemSpeed: 540,
  ultPerDmg: 0.05,
  ultMax: 100,
  dash: { speed: 880, dur: 0.17, inv: 0.32 },
  contactInv: 0.45,
  heartChance: 0.022,
  heartHeal: 0.15,
  maxEnemies: 110,
  hitStop: 0.04,
  shake: 9,
  realmHeal: 0.4,
  spawnFade: 0.6,
};

/** Mirrors the room's bound (src/logic.js) so an honest client is never refused. */
export const SCORE_CAP = [25000, 55000, 90000, 130000];

export const xpNeed = (lvl) => Math.floor(5 + lvl * 6 + lvl * lvl * 0.9);

export const HERO_ORDER = ["warden", "gunner", "knight"];

export const HEROES = {
  warden: {
    id: "warden", name: "Rootwarden", role: "Bulwark", sprite: "hero_warden", h: 122, color: "#8dff5c",
    hp: 175, speed: 205, dashCd: 1.7,
    stats: { Vigor: 5, Might: 4, Reach: 2, Haste: 2 },
    attack: { kind: "cleave", dmg: 34, cd: 0.56, range: 150, arc: 2.3, knock: 170 },
    ult: { id: "quake", name: "Thornquake" },
    blurb: "An old guardian of the ruins. Wades in, sweeps wide, and refuses to fall.",
    dashNote: "Shield bash — dashing through foes wounds them.",
    ultNote: "Roots erupt around you: heavy damage, stun, and you mend.",
  },
  gunner: {
    id: "gunner", name: "Emberline", role: "Marksman", sprite: "hero_gunner", h: 108, color: "#5cc0ff",
    hp: 105, speed: 245, dashCd: 1.15,
    stats: { Vigor: 2, Might: 4, Reach: 5, Haste: 5 },
    attack: { kind: "bolt", dmg: 16, cd: 0.27, speed: 860, range: 520, r: 7 },
    ult: { id: "overcharge", name: "Overcharge" },
    blurb: "A dragon-hunter with a cannon for an arm. Fragile, fast, and never out of range.",
    dashNote: "Quick roll — the shortest dash recovery of the three.",
    ultNote: "The cannon runs hot: rapid piercing fire for four seconds.",
  },
  knight: {
    id: "knight", name: "Frostcrown", role: "Controller", sprite: "hero_knight", h: 110, color: "#7ff3ff",
    hp: 130, speed: 230, dashCd: 1.5,
    stats: { Vigor: 3, Might: 3, Reach: 4, Haste: 3 },
    attack: { kind: "shards", dmg: 11, cd: 0.5, count: 3, spread: 0.2, speed: 640, range: 410, r: 8, slow: 1.4 },
    ult: { id: "whiteout", name: "Whiteout" },
    blurb: "Heir to the ice spire. Fans of frost shards slow everything they touch.",
    dashNote: "Ice slide — a burst of frost chills foes where you stop.",
    ultNote: "Freezes every foe in sight. Frozen foes take half again as much damage.",
  },
};

export const ENEMIES = {
  spearman: { name: "Legion Spearman", sprite: "en_spearman", h: 94, r: 19, hp: 26, speed: 106, dmg: 9, xp: 1, score: 10, ai: "chase" },
  archer: { name: "Legion Javelineer", sprite: "en_spearman", tint: "#ffd27a", h: 88, r: 18, hp: 20, speed: 92, dmg: 8, xp: 2, score: 15, ai: "ranged", range: 340, shotCd: 2.4, shotSpeed: 295 },
  brute: { name: "Thorn Brute", sprite: "en_brute", h: 152, r: 34, hp: 150, speed: 70, dmg: 20, xp: 6, score: 45, ai: "charge", chargeSpeed: 470, knockRes: 0.8 },
  imp: { name: "Ember Imp", sprite: "en_imp", h: 68, r: 15, hp: 17, speed: 168, dmg: 7, xp: 1, score: 10, ai: "chase", wobble: 1 },
  caster: { name: "Cinder Caller", sprite: "en_imp", tint: "#ffb347", h: 88, r: 18, hp: 34, speed: 88, dmg: 10, xp: 3, score: 20, ai: "ranged", range: 380, shotCd: 2.6, shotSpeed: 275, pool: true },
  hound: { name: "Magma Hound", sprite: "en_hound", h: 98, r: 28, hp: 95, speed: 100, dmg: 17, xp: 5, score: 40, ai: "charge", chargeSpeed: 560, trail: true, knockRes: 0.5 },
  wraith: { name: "Frost Wraith", sprite: "en_wraith", h: 106, r: 19, hp: 48, speed: 132, dmg: 13, xp: 2, score: 20, ai: "blink", float: 1 },
  rimecaller: { name: "Rime Caller", sprite: "en_wraith", tint: "#a9dcff", h: 98, r: 18, hp: 40, speed: 88, dmg: 10, xp: 3, score: 25, ai: "ranged", range: 380, shotCd: 2.3, shotSpeed: 285, slow: 1.3, float: 1 },
  golem: { name: "Ice Golem", sprite: "en_golem", h: 152, r: 36, hp: 270, speed: 62, dmg: 24, xp: 8, score: 60, ai: "chase", burst: 8, knockRes: 0.9 },
};

export const BOSSES = {
  colossus: { name: "Thorn Colossus", title: "Heart of the Ruins", sprite: "boss_colossus", h: 330, r: 70, hp: 2800, speed: 60, dmg: 26, score: 3000, xp: 30, keep: 230, patterns: ["slam", "thorns", "summon"], minion: "spearman" },
  dragon: { name: "Cinderwing", title: "Tyrant of the Canyon", sprite: "boss_dragon", h: 340, r: 86, hp: 4400, speed: 76, dmg: 32, score: 5000, xp: 40, keep: 320, patterns: ["breath", "rain", "gust"], minion: "imp" },
  king: { name: "The Hollow King", title: "Warden of the Spire", sprite: "boss_king", h: 330, r: 66, hp: 6200, speed: 88, dmg: 38, score: 8000, xp: 50, keep: 260, patterns: ["beams", "rings", "blink", "summon"], minion: "wraith" },
};

export const REALMS = [
  {
    id: "verdant", numeral: "I", name: "The Verdant Ruins", floor: "floor_verdant", key: "key_verdant",
    arena: { cx: 0.48, cy: 0.6, rx: 0.4, ry: 0.33 }, ambient: "leaves", grade: "rgba(60,110,50,0.08)",
    hint: "The Crimson Legion holds the old stones. Keep moving — your champion strikes on their own.",
    duration: 80, rate: [1.0, 0.52], hpMul: 1, dmgMul: 1,
    waves: [
      { t: 0, mix: [["spearman", 1]] },
      { t: 20, mix: [["spearman", 3], ["archer", 1]] },
      { t: 46, mix: [["spearman", 4], ["archer", 2], ["brute", 1]] },
    ],
    pulses: [{ t: 34, type: "spearman", n: 16 }, { t: 66, type: "spearman", n: 22 }],
    boss: "colossus",
  },
  {
    id: "ember", numeral: "II", name: "The Ember Canyon", floor: "floor_ember", key: "key_ember",
    arena: { cx: 0.5, cy: 0.67, rx: 0.36, ry: 0.29 }, ambient: "embers", grade: "rgba(150,60,10,0.08)",
    hint: "The ground itself burns here. Red on the stone means move.",
    duration: 90, rate: [0.85, 0.44], hpMul: 1.45, dmgMul: 1.3,
    waves: [
      { t: 0, mix: [["imp", 1]] },
      { t: 18, mix: [["imp", 4], ["caster", 1]] },
      { t: 44, mix: [["imp", 5], ["caster", 2], ["hound", 1]] },
    ],
    pulses: [{ t: 36, type: "imp", n: 22 }, { t: 72, type: "imp", n: 28 }],
    boss: "dragon",
  },
  {
    id: "frost", numeral: "III", name: "The Frost Reach", floor: "floor_frost", key: "key_frost",
    arena: { cx: 0.47, cy: 0.65, rx: 0.36, ry: 0.3 }, ambient: "snow", grade: "rgba(60,110,170,0.09)",
    hint: "The Spire is close. What guards it does not walk — it arrives.",
    duration: 100, rate: [0.8, 0.42], hpMul: 2.0, dmgMul: 1.6,
    waves: [
      { t: 0, mix: [["wraith", 1]] },
      { t: 18, mix: [["wraith", 3], ["rimecaller", 1]] },
      { t: 44, mix: [["wraith", 4], ["rimecaller", 2], ["golem", 1]] },
    ],
    pulses: [{ t: 38, type: "wraith", n: 14 }, { t: 78, type: "wraith", n: 18 }],
    boss: "king",
  },
];

/** `k` is 1 for a level-up boon and 2 for a guardian's spoils (doubled). */
export const BOONS = [
  { id: "might", icon: "⚔︎", name: "Heartwood Might", desc: "+18% damage", max: 6, apply: (p, k) => { p.dmgMul += 0.18 * k; } },
  { id: "haste", icon: "➶︎", name: "Quickening", desc: "+14% attack speed", max: 6, apply: (p, k) => { p.rateMul += 0.14 * k; } },
  { id: "vigor", icon: "♥︎", name: "Deep Roots", desc: "+25 max health and mend 25", max: 6, apply: (p, k) => { p.maxHp += 25 * k; p.hp = Math.min(p.maxHp, p.hp + 25 * k); } },
  { id: "stride", icon: "»", name: "Windstride", desc: "+9% movement speed", max: 4, apply: (p, k) => { p.speedMul += 0.09 * k; } },
  { id: "reach", icon: "◎", name: "Far Sight", desc: "+14% attack range and a wider pickup", max: 4, apply: (p, k) => { p.rangeMul += 0.14 * k; p.magnet += 35 * k; } },
  { id: "flurry", icon: "⁂", name: "Flurry", desc: "+1 projectile, or a wider cleave", max: 3, apply: (p, k) => { p.extra += k; } },
  { id: "wisp", icon: "✦︎", name: "Lantern Wisp", desc: "A spirit circles you, burning what it touches", max: 3, apply: (p, k) => { p.wisps += k; } },
  { id: "leech", icon: "☘︎", name: "Sapdrinker", desc: "Mend 1 health for every foe felled", max: 3, apply: (p, k) => { p.leech += k; } },
  { id: "surge", icon: "✺︎", name: "Beacon Surge", desc: "Ultimate charges 25% faster", max: 3, apply: (p, k) => { p.ultMul += 0.25 * k; } },
  { id: "fleet", icon: "↯︎", name: "Fleetfoot", desc: "Dash recovers 18% sooner", max: 3, apply: (p, k) => { p.dashMul *= Math.pow(0.82, k); } },
  { id: "aegis", icon: "◈", name: "Stoneskin", desc: "Take 10% less damage", max: 4, apply: (p, k) => { p.armor = Math.min(0.6, p.armor + 0.1 * k); } },
  { id: "keen", icon: "✧︎", name: "Keen Edge", desc: "+12% chance to strike for double", max: 4, apply: (p, k) => { p.crit += 0.12 * k; } },
];

export const STR = {
  title: "Spirebound",
  tagline: "Three realms. One spire. Hold the line.",
  loading: "Waking the Spire…",
  begin: "Begin the Ascent",
  hall: "Hall of Ascents",
  chooseHero: "Choose your champion",
  chooseHint: "Each fights on their own — you choose where to stand.",
  ascend: "Ascend",
  back: "Back",
  realm: "Realm",
  enter: "Tap or press any key to enter",
  wave: "until the guardian wakes",
  guardian: "Guardian",
  ambush: "Ambush!",
  realmCleared: "Realm cleared",
  spoils: "Spoils of the guardian",
  spoilsHint: "A fallen guardian's boon counts double.",
  levelUp: "Level up",
  levelHint: "Choose a boon.",
  rank: "Rank",
  paused: "Paused",
  resume: "Resume",
  abandon: "Abandon ascent",
  howTo: "How to play",
  ctl: [
    ["Move", "WASD or arrows · left stick · drag anywhere"],
    ["Dash — a moment of invulnerability", "Space · A button · the Dash button"],
    ["Ultimate — charges as you deal damage", "E or Q · X button · the Ult button"],
    ["Pause", "Esc or P · Start"],
  ],
  ctlAuto: "Your champion attacks the nearest foe on their own. Red on the ground is about to hurt — step out of it.",
  sound: "Sound",
  shake: "Screen shake",
  on: "On",
  off: "Off",
  won: "The Spire Is Yours",
  wonSub: "The beacon burns with your name.",
  fell: "You Fell",
  fellIn: "in {realm}",
  score: "Score",
  kills: "Foes felled",
  level: "Level",
  time: "Time",
  realms: "Realms cleared",
  again: "Ascend again",
  changeHero: "Change champion",
  hallEmpty: "No ascents recorded yet. Be the first name on the wall.",
  hallNote: "Share this hall's link and your friends' ascents appear on the same wall.",
  copyLink: "Copy hall link",
  copied: "Link copied",
  yourName: "Your name",
  save: "Save",
  saved: "Saved",
  close: "Close",
  unranked: "Offline — this ascent was not recorded.",
  climbed: "climbed",
  dash: "Dash",
  ult: "Ult",
  lvl: "Lv",
  you: "you",
  wanderer: "Wanderer",
};
