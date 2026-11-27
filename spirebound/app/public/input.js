/**
 * Input: keyboard (physical key codes), touch/mouse drag-anywhere stick, and
 * gamepad — all feeding the same four values on `game.input`. Opposite
 * directions cancel; losing focus releases everything.
 */
const STICK_R = 56;

export class Input {
  constructor(game, canvas, stickEl) {
    this.g = game;
    this.cv = canvas;
    this.stickEl = stickEl;
    this.keys = new Set();
    this.stick = { id: null, ox: 0, oy: 0, x: 0, y: 0 };
    this.pad = [];
    this.mode = "off"; // "off" | "play" | "choice"
    this.onPause = null;
    this.onPick = null;
    this.onAny = null;
    this.onBlur = null;
    this.bind();
  }

  bind() {
    addEventListener("keydown", (e) => {
      const tag = e.target && e.target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.repeat) return;
      this.keys.add(e.code);
      if (this.onAny && this.onAny()) { e.preventDefault(); return; }
      if (e.code.startsWith("Arrow") || e.code === "Space") e.preventDefault();
      if (this.mode === "choice") {
        if (e.code === "Digit1" || e.code === "Numpad1") this.onPick?.(0);
        else if (e.code === "Digit2" || e.code === "Numpad2") this.onPick?.(1);
        else if (e.code === "Digit3" || e.code === "Numpad3") this.onPick?.(2);
        return;
      }
      if (e.code === "Escape" || e.code === "KeyP") this.onPause?.();
      if (this.mode !== "play") return;
      if (e.code === "Space" || e.code === "ShiftLeft" || e.code === "ShiftRight") this.g.input.dash = true;
      else if (e.code === "KeyE" || e.code === "KeyQ" || e.code === "Enter") this.g.input.ult = true;
    });
    addEventListener("keyup", (e) => this.keys.delete(e.code));
    addEventListener("blur", () => { this.release(); this.onBlur?.(); });
    document.addEventListener("visibilitychange", () => { if (document.hidden) { this.release(); this.onBlur?.(); } });

    const cv = this.cv;
    cv.addEventListener("pointerdown", (e) => {
      if (this.mode !== "play" || this.stick.id !== null) return;
      this.stick.id = e.pointerId;
      this.stick.ox = e.clientX;
      this.stick.oy = e.clientY;
      this.stick.x = this.stick.y = 0;
      try { cv.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
      this.drawStick(true);
      e.preventDefault();
    });
    cv.addEventListener("pointermove", (e) => {
      if (e.pointerId !== this.stick.id) return;
      let dx = e.clientX - this.stick.ox, dy = e.clientY - this.stick.oy;
      const len = Math.hypot(dx, dy);
      if (len > STICK_R) {
        // Let the origin trail the finger so a long drag never runs out of travel.
        this.stick.ox += (dx / len) * (len - STICK_R);
        this.stick.oy += (dy / len) * (len - STICK_R);
        dx = (dx / len) * STICK_R; dy = (dy / len) * STICK_R;
      }
      this.stick.x = dx / STICK_R;
      this.stick.y = dy / STICK_R;
      this.drawStick(true);
    });
    const up = (e) => {
      if (e.pointerId !== this.stick.id) return;
      this.stick.id = null;
      this.stick.x = this.stick.y = 0;
      this.drawStick(false);
    };
    cv.addEventListener("pointerup", up);
    cv.addEventListener("pointercancel", up);
    cv.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  release() {
    this.keys.clear();
    this.stick.id = null;
    this.stick.x = this.stick.y = 0;
    this.drawStick(false);
    this.g.input.mx = this.g.input.my = 0;
  }

  drawStick(on) {
    const el = this.stickEl;
    if (!el) return;
    el.classList.toggle("on", on);
    if (!on) return;
    el.style.left = this.stick.ox + "px";
    el.style.top = this.stick.oy + "px";
    el.firstElementChild.style.transform = `translate(${this.stick.x * STICK_R}px, ${this.stick.y * STICK_R}px)`;
  }

  /** Edge-detect a gamepad button. */
  pressed(gp, i) {
    const now = !!(gp.buttons[i] && gp.buttons[i].pressed);
    const was = !!this.pad[i];
    this.pad[i] = now;
    return now && !was;
  }

  poll() {
    const k = this.keys, I = this.g.input;
    let mx = 0, my = 0;
    if (this.mode === "play") {
      if (k.has("KeyA") || k.has("ArrowLeft")) mx -= 1;
      if (k.has("KeyD") || k.has("ArrowRight")) mx += 1;
      if (k.has("KeyW") || k.has("ArrowUp")) my -= 1;
      if (k.has("KeyS") || k.has("ArrowDown")) my += 1;
      mx += this.stick.x;
      my += this.stick.y;
    }
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let gp = null;
    for (const p of pads) if (p && p.connected) { gp = p; break; }
    if (gp) {
      const a = this.pressed(gp, 0), b = this.pressed(gp, 1), x = this.pressed(gp, 2), rb = this.pressed(gp, 5), start = this.pressed(gp, 9);
      if ((a || b || x || start) && this.onAny && this.onAny()) return;
      if (this.mode === "choice") {
        if (x) this.onPick?.(0); else if (a) this.onPick?.(1); else if (b) this.onPick?.(2);
      } else {
        if (start) this.onPause?.();
        if (this.mode === "play") {
          const ax = gp.axes[0] || 0, ay = gp.axes[1] || 0;
          if (Math.hypot(ax, ay) > 0.22) { mx += ax; my += ay; }
          if (gp.buttons[14]?.pressed) mx -= 1;
          if (gp.buttons[15]?.pressed) mx += 1;
          if (gp.buttons[12]?.pressed) my -= 1;
          if (gp.buttons[13]?.pressed) my += 1;
          if (a || rb) I.dash = true;
          if (x || b) I.ult = true;
        }
      }
    }
    if (this.g.opts.auto) return;
    const len = Math.hypot(mx, my);
    if (len > 1) { mx /= len; my /= len; }
    I.mx = mx;
    I.my = my;
  }
}
