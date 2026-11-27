/**
 * Room behaviour, exercised through real WebSockets in workerd.
 *
 * These tests are the safety net for the whole games migration: every existing
 * game speaks the wire protocol asserted here, so a regression in this file is a
 * regression in every migrated game. They deliberately drive the PUBLIC surface
 * (connect, send frames, read frames) rather than poking at internals.
 */

import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

/** Open a socket to a room and collect frames as they arrive. */
async function open(room = "main") {
  const res = await SELF.fetch(`https://game.test/ws/${room}`, {
    headers: { Upgrade: "websocket" },
  });
  expect(res.status).toBe(101);
  const ws = res.webSocket;
  if (!ws) throw new Error("no webSocket on the upgrade response");
  ws.accept();

  const frames: unknown[] = [];
  ws.addEventListener("message", (event: MessageEvent) => {
    const data = typeof event.data === "string" ? event.data : "";
    // Keepalive auto-responses are not protocol traffic.
    if (data === "__pong") return;
    try {
      frames.push(JSON.parse(data));
    } catch {
      frames.push(data);
    }
  });

  /** Wait for the next frame matching `pred` (frames can arrive out of step). */
  const next = async (pred: (f: any) => boolean, label: string) => {
    for (let i = 0; i < 100; i++) {
      const hit = frames.find(pred);
      if (hit) return hit as any;
      await scheduler.wait(10);
    }
    throw new Error(`timed out waiting for ${label}; got ${JSON.stringify(frames)}`);
  };

  return {
    ws,
    frames,
    next,
    send: (msg: unknown) => ws.send(JSON.stringify(msg)),
    state: () => next((f) => f?.type === "state", "a state frame"),
    error: () => next((f) => f?.type === "error", "an error frame"),
  };
}

/**
 * A fresh room name per call. Durable Object state persists across tests in the
 * pool, so reusing a literal name would inherit the previous test's seats and
 * make the suite order-dependent.
 */
let seq = 0;
function uniq(label: string): string {
  seq += 1;
  return `${label}-${seq}-${crypto.randomUUID().slice(0, 6)}`;
}


describe("routing", () => {
  it("rejects a non-upgrade request to /ws instead of waking a room", async () => {
    const res = await SELF.fetch("https://game.test/ws");
    expect(res.status).toBe(426);
  });

  it("rejects a room name that isn't a short safe label", async () => {
    const res = await SELF.fetch("https://game.test/ws/../../etc/passwd", {
      headers: { Upgrade: "websocket" },
    });
    expect(res.status).not.toBe(101);
  });
});

describe("a hall", () => {
  it("opens for a single player and requires a join before anything else", async () => {
    const room = uniq("solo");
    const a = await open(room);
    a.send({ type: "action", action: { type: "start", hero: "gunner" } });
    expect((await a.error()).error).toBe("join first");
    a.send({ type: "join", playerId: "p-solo" });
    const st = await a.state();
    expect(st.status).toBe("playing");
    expect(st.view).toMatchObject({ run: null, hall: [], climbing: [] });
    expect(st.meta).toMatchObject({ game: "Spirebound", minPlayers: 1 });
  });

  it("deals a seed, tracks the climb and records the run in the hall", async () => {
    const room = uniq("climb");
    const a = await open(room);
    a.send({ type: "join", playerId: "p-climb" });
    await a.state();

    a.send({ type: "action", action: { type: "start", hero: "dragon" } });
    expect((await a.error()).error).toBe("unknown hero");

    a.send({ type: "action", action: { type: "start", hero: "knight" } });
    const started = await a.next((f) => f?.type === "state" && f.view?.run, "a run");
    expect(started.view.run).toMatchObject({ hero: "knight", realm: 0, score: 0 });
    expect(typeof started.view.run.seed).toBe("number");

    a.send({ type: "action", action: { type: "clear", realm: 1, score: 8000 } });
    await a.next((f) => f?.type === "state" && f.view?.run?.realm === 1, "realm 1 cleared");

    a.send({ type: "action", action: { type: "end", score: 9500, won: false } });
    const ended = await a.next((f) => f?.type === "state" && f.view?.hall?.length === 1, "a hall entry");
    expect(ended.view.run).toBeNull();
    expect(ended.view.hall[0]).toEqual({ name: "Wanderer", hero: "knight", score: 9500, realm: 1, won: false, you: true });
    // The hall stays open: an ascent ends, the room does not.
    expect(ended.status).toBe("playing");
  });

  it("refuses a forged score and a victory that skipped the climb", async () => {
    const room = uniq("forge");
    const a = await open(room);
    a.send({ type: "join", playerId: "p-forge" });
    await a.state();
    a.send({ type: "action", action: { type: "start", hero: "gunner" } });
    await a.next((f) => f?.type === "state" && f.view?.run, "a run");

    a.send({ type: "action", action: { type: "end", score: 999999999, won: false } });
    expect((await a.error()).error).toBe("score out of range");
    a.frames.length = 0;
    a.send({ type: "action", action: { type: "end", score: 100, won: true } });
    expect((await a.error()).error).toBe("the spire is not yet climbed");
  });

  it("shares the hall between players without leaking their ids", async () => {
    const room = uniq("shared");
    const a = await open(room);
    a.send({ type: "join", playerId: "p-secret-alice" });
    await a.state();
    a.send({ type: "action", action: { type: "name", name: "Alice" } });
    a.send({ type: "action", action: { type: "start", hero: "warden" } });
    await a.next((f) => f?.type === "state" && f.view?.run, "alice's run");
    a.send({ type: "action", action: { type: "end", score: 1200, won: false } });
    await a.next((f) => f?.type === "state" && f.view?.hall?.length === 1, "alice's entry");

    const b = await open(room);
    b.send({ type: "join", playerId: "p-bob" });
    const seen = await b.state();
    expect(seen.view.hall).toEqual([{ name: "Alice", hero: "warden", score: 1200, realm: 0, won: false, you: false }]);
    expect(JSON.stringify(seen.view)).not.toContain("p-secret-alice");
  });

  it("restores a run after a dropped connection", async () => {
    const room = uniq("persist");
    const a = await open(room);
    a.send({ type: "join", playerId: "p-back" });
    await a.state();
    a.send({ type: "action", action: { type: "start", hero: "gunner" } });
    const before = await a.next((f) => f?.type === "state" && f.view?.run, "a run");
    a.ws.close();

    const again = await open(room);
    again.send({ type: "join", playerId: "p-back" });
    const restored = await again.next((f) => f?.type === "state" && f.view?.run, "the restored run");
    expect(restored.view.run.seed).toBe(before.view.run.seed);
  });
});
