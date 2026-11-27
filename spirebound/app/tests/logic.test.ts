/**
 * The Hall of Ascents rules, as pure functions. The client is untrusted, so the
 * interesting cases are the ones where it lies.
 */
import { describe, expect, it } from "vitest";

import { applyAction, isGameOver, setup, validateAction, viewFor } from "../src/logic.js";

type S = any;
const play = (state: S, who: string, action: unknown): S => {
  const verdict = validateAction(state, who, action);
  if (!verdict.ok) throw new Error(`rejected: ${(verdict as { error?: string }).error}`);
  return applyAction(state, who, action);
};
const refuse = (state: S, who: string, action: unknown) => validateAction(state, who, action) as { ok: boolean; error?: string };

describe("starting an ascent", () => {
  it("deals a seed from the room and advances it every time", () => {
    let s: S = setup(["a"]);
    s = play(s, "a", { type: "start", hero: "gunner" });
    const first = s.runs.a.seed;
    s = play(s, "b", { type: "start", hero: "warden" });
    expect(typeof first).toBe("number");
    expect(s.runs.b.seed).not.toBe(first);
    expect(s.runs.a).toMatchObject({ hero: "gunner", realm: 0, score: 0 });
  });

  it("is deterministic: the same seats and actions give the same seeds", () => {
    const run = () => play(setup(["a", "b"]), "a", { type: "start", hero: "knight" }).runs.a.seed;
    expect(run()).toBe(run());
  });

  it("refuses an unknown hero and malformed actions", () => {
    const s: S = setup(["a"]);
    expect(refuse(s, "a", { type: "start", hero: "dragon" }).error).toBe("unknown hero");
    expect(refuse(s, "a", null).ok).toBe(false);
    expect(refuse(s, "a", [1]).ok).toBe(false);
    expect(refuse(s, "a", { type: "win" }).error).toBe("unknown action");
  });

  it("never mutates the state it was given", () => {
    const s: S = setup(["a"]);
    const frozen = JSON.stringify(s);
    play(s, "a", { type: "start", hero: "gunner" });
    expect(JSON.stringify(s)).toBe(frozen);
  });
});

describe("climbing", () => {
  const started = (): S => play(setup(["a"]), "a", { type: "start", hero: "gunner" });

  it("clears realms strictly in order", () => {
    let s = started();
    expect(refuse(s, "a", { type: "clear", realm: 2, score: 100 }).error).toBe("realms are cleared in order");
    s = play(s, "a", { type: "clear", realm: 1, score: 9000 });
    expect(refuse(s, "a", { type: "clear", realm: 1, score: 9500 }).ok).toBe(false);
    s = play(s, "a", { type: "clear", realm: 2, score: 20000 });
    s = play(s, "a", { type: "clear", realm: 3, score: 31000 });
    expect(refuse(s, "a", { type: "clear", realm: 4, score: 32000 }).ok).toBe(false);
  });

  it("bounds the score a client may report", () => {
    const s = started();
    expect(refuse(s, "a", { type: "clear", realm: 1, score: 9_999_999 }).error).toBe("score out of range");
    expect(refuse(s, "a", { type: "clear", realm: 1, score: -5 }).error).toBe("score cannot go down");
    expect(refuse(s, "a", { type: "clear", realm: 1, score: 10.5 }).ok).toBe(false);
    expect(refuse(s, "a", { type: "end", score: 26000, won: false }).error).toBe("score out of range");
  });

  it("refuses a victory that skipped the climb, and any report without a run", () => {
    const s = started();
    expect(refuse(s, "a", { type: "end", score: 100, won: true }).error).toBe("the spire is not yet climbed");
    expect(refuse(s, "nobody", { type: "end", score: 100, won: false }).error).toBe("no ascent in progress");
    expect(refuse(s, "nobody", { type: "clear", realm: 1, score: 100 }).error).toBe("no ascent in progress");
  });
});

describe("the hall", () => {
  it("records a finished run, best first, and closes the run", () => {
    let s: S = setup(["a", "b"]);
    s = play(s, "a", { type: "name", name: "Rootwarden" });
    s = play(s, "a", { type: "start", hero: "warden" });
    s = play(s, "b", { type: "start", hero: "knight" });
    s = play(s, "a", { type: "end", score: 4000, won: false });
    s = play(s, "b", { type: "end", score: 7000, won: false });
    expect(s.runs).toEqual({});
    expect(s.hall.map((e: any) => e.score)).toEqual([7000, 4000]);
    expect(s.hall[1].name).toBe("Rootwarden");
    expect(s.hall[0].name).toBe("Wanderer");
  });

  it("keeps only the ten best", () => {
    let s: S = setup(["a"]);
    for (let i = 1; i <= 13; i++) {
      s = play(s, "a", { type: "start", hero: "gunner" });
      s = play(s, "a", { type: "end", score: i * 100, won: false });
    }
    expect(s.hall).toHaveLength(10);
    expect(s.hall[0].score).toBe(1300);
    expect(s.hall[9].score).toBe(400);
  });

  it("validates names", () => {
    const s: S = setup(["a"]);
    expect(refuse(s, "a", { type: "name", name: "" }).ok).toBe(false);
    expect(refuse(s, "a", { type: "name", name: " padded " }).ok).toBe(false);
    expect(refuse(s, "a", { type: "name", name: "<script>" }).ok).toBe(false);
    expect(refuse(s, "a", { type: "name", name: "x".repeat(17) }).ok).toBe(false);
    expect(refuse(s, "a", { type: "name", name: "Ember O'Neil" }).ok).toBe(true);
  });

  it("never ends", () => {
    expect(isGameOver(setup(["a"]))).toEqual({ over: false });
  });
});

describe("what each player sees", () => {
  it("shows your own run and marks your hall entries, without leaking other ids", () => {
    let s: S = setup(["alice-id", "bob-id"]);
    s = play(s, "alice-id", { type: "start", hero: "warden" });
    s = play(s, "alice-id", { type: "end", score: 500, won: false });
    s = play(s, "alice-id", { type: "start", hero: "gunner" });

    const bob = viewFor(s, "bob-id") as any;
    expect(bob.run).toBeNull();
    expect(bob.hall).toEqual([{ name: "Wanderer", hero: "warden", score: 500, realm: 0, won: false, you: false }]);
    expect(bob.climbing).toEqual([{ name: "Wanderer", hero: "gunner", realm: 0 }]);
    expect(JSON.stringify(bob)).not.toContain("alice-id");

    const alice = viewFor(s, "alice-id") as any;
    expect(alice.run.hero).toBe("gunner");
    expect(alice.hall[0].you).toBe(true);
    expect(alice.climbing).toEqual([]);
  });
});
