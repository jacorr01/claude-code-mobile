/**
 * Spirebound — the Hall of Ascents.
 *
 * The fight itself (movement, enemies, bosses) is simulated on each player's own
 * device, because a 60 Hz action game cannot round-trip every frame through a
 * room. What the room owns is everything that must be shared and trusted:
 *
 *   - the SEED of each ascent (so a run's waves and boons are dealt by the room,
 *     not picked by the client),
 *   - the progress of each ascent (realms are cleared strictly in order), and
 *   - the Hall of Ascents: the ten best runs of everyone who shares this hall.
 *
 * The client is untrusted, so every number it reports is bounded here.
 */

export const meta = { game: "Spirebound", minPlayers: 1, maxPlayers: 8 };

const HEROES = ["warden", "gunner", "knight"];
const REALMS = 3;
const HALL_SIZE = 10;
/** Highest score a run can honestly hold while it has cleared N realms. */
const SCORE_CAP = [25000, 55000, 90000, 130000];
const NAME_RE = /^[A-Za-z0-9 _.'-]{1,16}$/;
const DEFAULT_NAME = "Wanderer";

const OK = { ok: true };
const bad = (error) => ({ ok: false, error });

/** Deterministic seed stream (LCG) — the room's only source of "randomness". */
function nextSeed(seed) {
  return (Math.imul(seed, 1664525) + 1013904223) >>> 0;
}

function hashSeats(players) {
  let h = 2166136261;
  for (const id of players) {
    for (let i = 0; i < id.length; i++) {
      h ^= id.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
  }
  return h >>> 0 || 1;
}

export function setup(players) {
  return { seed: hashSeats(players), runs: {}, names: {}, hall: [], total: 0 };
}

function checkScore(run, score, realmsCleared) {
  if (!Number.isInteger(score) || score < run.score) return bad("score cannot go down");
  if (score > SCORE_CAP[realmsCleared]) return bad("score out of range");
  return OK;
}

export function validateAction(state, playerId, action) {
  if (!action || typeof action !== "object" || Array.isArray(action)) return bad("malformed action");
  const run = state.runs[playerId];
  switch (action.type) {
    case "name":
      if (typeof action.name !== "string" || !NAME_RE.test(action.name) || action.name.trim() !== action.name) {
        return bad("a name is 1-16 letters, digits or spaces");
      }
      return OK;
    case "start":
      if (!HEROES.includes(action.hero)) return bad("unknown hero");
      return OK;
    case "clear":
      if (!run) return bad("no ascent in progress");
      if (!Number.isInteger(action.realm) || action.realm !== run.realm + 1 || action.realm > REALMS) {
        return bad("realms are cleared in order");
      }
      return checkScore(run, action.score, action.realm);
    case "end":
      if (!run) return bad("no ascent in progress");
      if (typeof action.won !== "boolean") return bad("malformed action");
      if (action.won && run.realm !== REALMS) return bad("the spire is not yet climbed");
      return checkScore(run, action.score, run.realm);
    default:
      return bad("unknown action");
  }
}

export function applyAction(state, playerId, action) {
  const run = state.runs[playerId];
  switch (action.type) {
    case "name":
      return { ...state, names: { ...state.names, [playerId]: action.name } };
    case "start": {
      const seed = nextSeed(state.seed);
      const total = state.total + 1;
      const fresh = { hero: action.hero, seed, realm: 0, score: 0, n: total };
      return { ...state, seed, total, runs: { ...state.runs, [playerId]: fresh } };
    }
    case "clear":
      return {
        ...state,
        runs: { ...state.runs, [playerId]: { ...run, realm: action.realm, score: action.score } },
      };
    case "end": {
      const runs = { ...state.runs };
      delete runs[playerId];
      const entry = {
        id: playerId,
        name: state.names[playerId] ?? DEFAULT_NAME,
        hero: run.hero,
        score: action.score,
        realm: run.realm,
        won: action.won,
        n: run.n,
      };
      const hall = [...state.hall, entry]
        .sort((a, b) => b.score - a.score || a.n - b.n)
        .slice(0, HALL_SIZE);
      return { ...state, runs, hall };
    }
    default:
      return state;
  }
}

/** The hall never closes: an ascent ends, the room does not. */
export function isGameOver() {
  return { over: false };
}

/**
 * A player sees their own run (with its seed) and the shared hall. Other
 * players' ids are never sent: an id is the claim that reclaims a seat.
 */
export function viewFor(state, playerId) {
  return {
    name: state.names[playerId] ?? null,
    run: state.runs[playerId] ?? null,
    hall: state.hall.map((e) => ({
      name: e.name,
      hero: e.hero,
      score: e.score,
      realm: e.realm,
      won: e.won,
      you: e.id === playerId,
    })),
    climbing: Object.keys(state.runs)
      .filter((id) => id !== playerId)
      .map((id) => ({
        name: state.names[id] ?? DEFAULT_NAME,
        hero: state.runs[id].hero,
        realm: state.runs[id].realm,
      })),
  };
}
