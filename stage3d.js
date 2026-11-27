/**
 * The 3D layer. Every champion, foe and guardian is a rigged model drawn by
 * three.js on a transparent canvas that sits between the painted floor (below)
 * and the effects canvas (above).
 *
 * The simulation stays 2D: an actor at game position (x, y) stands on the ground
 * plane at (x, 0, y / sin(pitch)), and an orthographic camera pitched down by
 * PITCH looks at it. That makes a ground point land on exactly the same screen
 * pixel the 2D layers use, so models, floor decals and projectiles line up.
 */
import * as THREE from "./vendor/three.module.min.js";
import { GLTFLoader } from "./vendor/jsm/loaders/GLTFLoader.js";
import { clone as cloneRig } from "./vendor/jsm/utils/SkeletonUtils.js";

const PITCH = (36 * Math.PI) / 180;
const SIN = Math.sin(PITCH), COS = Math.cos(PITCH);
const TAU = Math.PI * 2;
const DIST = 2600;
const WHITE = new THREE.Color(0xffffff);
const tmpColor = new THREE.Color();
const GLOW = 0.32;

export class Stage3D {
  constructor(canvas, lowPower) {
    this.ok = false;
    this.models = {};
    this.live = new Map();
    this.pool = {};
    this.dying = [];
    this.cheap = 0;
    try {
      this.r = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: !lowPower, powerPreference: "high-performance" });
    } catch {
      return;
    }
    this.r.setClearColor(0x000000, 0);
    this.r.outputColorSpace = THREE.SRGBColorSpace;
    this.r.shadowMap.enabled = true;
    this.r.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 10, DIST * 3);
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x4a5262, 2.1);
    this.sun = new THREE.DirectionalLight(0xffffff, 2.6);
    this.sun.castShadow = true;
    const sh = this.sun.shadow;
    sh.mapSize.set(lowPower ? 1024 : 2048, lowPower ? 1024 : 2048);
    sh.camera.left = sh.camera.bottom = -1100;
    sh.camera.right = sh.camera.top = 1100;
    sh.camera.near = 100;
    sh.camera.far = 4000;
    sh.camera.updateProjectionMatrix();
    sh.bias = -0.0006;
    sh.normalBias = 2;
    // A rim light from behind lifts the silhouettes off the floor.
    this.rim = new THREE.DirectionalLight(0xffffff, 1.1);
    // The floor is a painting on the 2D layer; this plane only catches shadows.
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(12000, 12000), new THREE.ShadowMaterial({ opacity: 0.42 }));
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.scene.add(this.hemi, this.sun, this.sun.target, this.rim, this.rim.target, this.ground);
    this.loader = new GLTFLoader();
    this.ok = true;
  }

  resize(w, h, dpr) {
    if (!this.ok) return;
    this.w = w;
    this.h = h;
    this.dpr = dpr;
    this.r.setPixelRatio(this.cheap >= 1 ? Math.min(1, dpr) : dpr);
    this.r.setSize(w, h, false);
  }

  /**
   * The device is struggling: give something up. First the extra pixels of a
   * high-density screen, then the cast shadows. Returns false when nothing is left.
   */
  lower() {
    if (!this.ok || this.cheap >= 2) return false;
    this.cheap = (this.cheap || 0) + 1;
    if (this.cheap === 1) this.resize(this.w, this.h, this.dpr);
    else {
      this.sun.castShadow = false;
      this.r.shadowMap.enabled = false;
      this.ground.visible = false;
    }
    return true;
  }

  /** Mood per realm: sky colour, key light colour, rim colour. */
  light(sky, sun, rim) {
    if (!this.ok) return;
    this.hemi.color.set(sky);
    this.sun.color.set(sun);
    this.rim.color.set(rim);
  }

  has(id) {
    return this.ok && !!this.models[id];
  }

  /** Ground speed (game px per second) that matches the model's main clip played at normal rate. */
  gait(id) {
    const m = this.models[id];
    return !m || !m.clips.length ? 100 : m.clips[0].duration < 1 ? 185 : 62;
  }

  /** A model with no skeleton clips (a beast the auto-rig cannot handle): the game rocks it by hand. */
  rigid(id) {
    return this.ok && !!this.models[id] && this.models[id].clips.length === 0;
  }

  /**
   * Load a rigged model. `names` renames its clips in order (a one-clip model's
   * clip is "Move"); `yaw` corrects a model that does not face +Z.
   */
  async load(id, url, o = {}) {
    if (!this.ok || this.models[id]) return;
    const g = url.endsWith(".txt") ? await this.loadPacked(url) : await this.loader.loadAsync(url);
    const root = g.scene;
    root.traverse((n) => {
      if (!n.isMesh) return;
      n.castShadow = true;
      n.frustumCulled = false;
      const map = n.material && n.material.map;
      // The texture also glows a little on its own, so runes, embers and ice keep their colour in shade.
      n.material = new THREE.MeshLambertMaterial({ map: map || null, color: 0xffffff, emissive: 0xffffff, emissiveMap: map || null, emissiveIntensity: GLOW });
    });
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root);
    const names = o.names || ["Move"];
    g.animations.forEach((c, i) => { c.name = names[i] || c.name; });
    this.models[id] = { root, clips: g.animations, h: Math.max(1e-3, box.max.y - box.min.y), minY: box.min.y, yaw: o.yaw || 0, first: names[0] };
  }

  /**
   * A model packed as base64 text, for hosts that serve no binary model files.
   * Such hosts usually also forbid fetching blob: URLs, which is how the loader
   * decodes textures when createImageBitmap exists, so it is hidden while the
   * parser is built and the loader falls back to plain image elements.
   */
  async loadPacked(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`model ${url}: ${res.status}`);
    const text = atob((await res.text()).trim());
    const bytes = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
    return new Promise((ok, fail) => {
      const bitmap = self.createImageBitmap;
      self.createImageBitmap = undefined;
      try {
        this.loader.parse(bytes.buffer, "", ok, fail);
      } catch (e) {
        fail(e);
      } finally {
        self.createImageBitmap = bitmap;
      }
    });
  }

  inst(key, id) {
    let it = this.live.get(key);
    if (it) return it;
    const m = this.models[id];
    const pool = (this.pool[id] ||= []);
    it = pool.pop();
    if (!it) {
      const obj = cloneRig(m.root);
      const mats = [];
      obj.traverse((n) => {
        if (n.isMesh) {
          n.material = n.material.clone();
          mats.push(n.material);
        }
      });
      const mixer = new THREE.AnimationMixer(obj);
      const acts = {};
      for (const c of m.clips) acts[c.name] = mixer.clipAction(c);
      const holder = new THREE.Group();
      holder.rotation.order = "YXZ";
      holder.add(obj);
      it = { id, m, holder, mixer, acts, mats, cur: null, token: null, yaw: null, flash: -1, tint: "", used: false };
    }
    it.yaw = null;
    it.cur = null;
    it.token = null;
    it.mixer.stopAllAction();
    it.holder.rotation.set(0, 0, 0);
    this.scene.add(it.holder);
    this.live.set(key, it);
    return it;
  }

  /** Point the camera at the same spot, at the same scale, as the 2D layers. */
  begin(camX, camY, zoom, w, h) {
    const vw = w / zoom, vh = h / zoom, c = this.cam;
    c.left = -vw / 2;
    c.right = vw / 2;
    c.top = vh / 2;
    c.bottom = -vh / 2;
    c.updateProjectionMatrix();
    const tz = camY / SIN;
    c.position.set(camX, SIN * DIST, tz + COS * DIST);
    c.lookAt(camX, 0, tz);
    this.sun.position.set(camX - 520, 1200, tz + 640);
    this.sun.target.position.set(camX, 0, tz);
    this.rim.position.set(camX + 400, 700, tz - 900);
    this.rim.target.position.set(camX, 0, tz);
  }

  /**
   * Place one actor for this frame.
   * o: h (how tall it should look on screen, in game px), yaw (2D facing angle),
   * anim, speed, token (changes restart a one-shot), once, lift, pitch, sx, sy,
   * flash (0-1), tint, tintA, dt.
   */
  draw(key, id, x, y, o) {
    const it = this.inst(key, id), m = it.m, hd = it.holder;
    it.used = true;
    const s = o.h / COS / m.h;
    hd.position.set(x, (o.lift || 0) / COS - m.minY * s, y / SIN);
    hd.scale.set(s * (o.sx || 1), s * (o.sy || 1), s * (o.sx || 1));
    const want = Math.PI / 2 - o.yaw + m.yaw;
    if (it.yaw === null) it.yaw = want;
    else {
      const d = ((((want - it.yaw + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
      it.yaw += d * Math.min(1, o.dt * (o.turn || 14));
    }
    hd.rotation.y = it.yaw;
    hd.rotation.x = o.pitch || 0;
    hd.rotation.z = o.roll || 0;
    const act = it.acts[o.anim] || it.acts[m.first];
    if (act) {
      if (act !== it.cur || (o.once && o.token !== it.token)) {
        if (it.cur && it.cur !== act) it.cur.fadeOut(0.12);
        act.reset();
        act.setLoop(o.once ? THREE.LoopOnce : THREE.LoopRepeat, o.once ? 1 : Infinity);
        act.clampWhenFinished = !!o.once;
        act.fadeIn(it.cur && it.cur !== act ? 0.12 : 0).play();
        it.cur = act;
        it.token = o.token;
      }
      // `fit` plays a one-shot in exactly that many seconds, whatever the clip's length
      act.timeScale = o.fit ? act.getClip().duration / o.fit : o.speed === undefined ? 1 : o.speed;
      it.mixer.update(o.dt);
    }
    const fl = o.flash > 0 ? Math.round(o.flash * 8) / 8 : 0;
    const tk = o.tintA > 0 ? o.tint + Math.round(o.tintA * 8) : "";
    if (fl !== it.flash || tk !== it.tint) {
      it.flash = fl;
      it.tint = tk;
      for (const mat of it.mats) {
        mat.emissiveIntensity = GLOW + fl * 2.4;
        if (tk) mat.color.copy(WHITE).lerp(tmpColor.set(o.tint), Math.min(0.85, o.tintA * 1.6));
        else mat.color.copy(WHITE);
      }
    }
  }

  /** The actor fell: its model topples and sinks, then goes back to the pool. */
  kill(key) {
    const it = this.live.get(key);
    if (!it) return;
    this.live.delete(key);
    it.t = 0;
    for (const mat of it.mats) mat.emissiveIntensity = GLOW + 2;
    it.flash = -1;
    this.dying.push(it);
  }

  release(it) {
    this.scene.remove(it.holder);
    (this.pool[it.id] ||= []).push(it);
  }

  /** Drop everything (a new realm, or back to the menus). */
  clear() {
    if (!this.ok) return;
    for (const it of this.live.values()) this.release(it);
    this.live.clear();
    for (const it of this.dying) this.release(it);
    this.dying.length = 0;
  }

  blank() {
    if (!this.ok) return;
    this.clear();
    this.r.clear();
  }

  end(dt) {
    for (const [key, it] of this.live) {
      if (it.used) it.used = false;
      else {
        this.release(it);
        this.live.delete(key);
      }
    }
    for (let i = this.dying.length - 1; i >= 0; i--) {
      const it = this.dying[i];
      it.t += dt;
      const q = Math.min(1, it.t / 0.42);
      it.holder.rotation.x = -q * q * 1.45;
      it.holder.position.y -= dt * 60 * q;
      const e = Math.max(0, 2 - q * 4);
      for (const mat of it.mats) mat.emissiveIntensity = GLOW + e;
      if (q >= 1) {
        this.release(it);
        this.dying.splice(i, 1);
      }
    }
    this.r.render(this.scene, this.cam);
  }
}
