(() => {
"use strict";

/* ===================================================================
   1. CANVAS SETUP
   =================================================================== */
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

let W = 0, H = 0;

/* ===================================================================
   2. UTILITIES
   =================================================================== */
const TAU   = Math.PI * 2;
const rand  = (min, max) => Math.random() * (max - min) + min;
const clamp = (v, min, max) => (v < min ? min : v > max ? max : v);

/* ===================================================================
   3. DEVICE DETECTION (tanpa user-agent sniffing)
   =================================================================== */
const Device = (() => {
  let hasTouch = (typeof navigator !== "undefined") &&
                 ((navigator.maxTouchPoints | 0) > 0 || "ontouchstart" in window);

  // Jika terdeteksi pointer touch aktual, aktifkan juga (dukungan hybrid)
  function markTouch() { hasTouch = true; }
  return {
    hasTouch: () => hasTouch,
    markTouch
  };
})();

/* ===================================================================
   4. SOUND ENGINE
   =================================================================== */
const Sound = (() => {
  let ac = null;

  function audio() {
    if (!ac) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ac = new AC();
    }
    if (ac.state === "suspended") ac.resume();
    return ac;
  }

  function tone({ freq = 440, freq2 = null, type = "square",
                  dur = 0.15, vol = 0.12, delay = 0 } = {}) {
    const a = audio(); if (!a) return;
    const t0 = a.currentTime + delay;
    const osc = a.createOscillator();
    const gain = a.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (freq2) osc.frequency.exponentialRampToValueAtTime(Math.max(1, freq2), t0 + dur);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain); gain.connect(a.destination);
    osc.start(t0); osc.stop(t0 + dur + 0.03);
  }

  function noise({ dur = 0.4, vol = 0.3, from = 1600, to = 90 } = {}) {
    const a = audio(); if (!a) return;
    const t0 = a.currentTime;
    const len = Math.max(1, Math.floor(a.sampleRate * dur));
    const buffer = a.createBuffer(1, len, a.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = a.createBufferSource();
    src.buffer = buffer;
    const filter = a.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(from, t0);
    filter.frequency.exponentialRampToValueAtTime(Math.max(20, to), t0 + dur);
    const gain = a.createGain();
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter); filter.connect(gain); gain.connect(a.destination);
    src.start(t0); src.stop(t0 + dur);
  }

  return {
    unlock()     { audio(); },
    shoot()      { tone({ freq: 900, freq2: 260, type: "square",   dur: 0.10, vol: 0.055 }); },
    hitEnemy()   { tone({ freq: 320, freq2: 130, type: "sawtooth", dur: 0.07, vol: 0.05 }); },
    enemyShoot() { tone({ freq: 220, freq2: 110, type: "sine",     dur: 0.16, vol: 0.045 }); },
    explode()    { noise({ dur: 0.45, vol: 0.30, from: 1700, to: 80 }); },
    jump()       { tone({ freq: 480, freq2: 720, type: "triangle", dur: 0.14, vol: 0.06 }); },
    dash()       { tone({ freq: 300, freq2: 900, type: "sawtooth", dur: 0.18, vol: 0.06 }); },
    playerHit()  {
      noise({ dur: 0.35, vol: 0.28, from: 900, to: 60 });
      tone({ freq: 180, freq2: 60, type: "sawtooth", dur: 0.35, vol: 0.12 });
    },
    gameOver() {
      tone({ freq: 520, freq2: 190, type: "sawtooth", dur: 0.50, vol: 0.14 });
      tone({ freq: 390, freq2: 140, type: "square",   dur: 0.50, vol: 0.11, delay: 0.22 });
      tone({ freq: 250, freq2:  70, type: "sawtooth", dur: 0.90, vol: 0.14, delay: 0.45 });
      noise({ dur: 1.0, vol: 0.16, from: 800, to: 60 });
    }
  };
})();

/* ===================================================================
   5. INPUT MANAGER
   ------------------------------------------------------------------
   Satu-satunya sumber input untuk gameplay.
   Ekspos: state.moveX, state.moveY, state.attack
           edge.jump / dash / interact / pause / reset
   =================================================================== */
const InputManager = (() => {
  const DEFAULT_BINDINGS = {
    left:     ["ArrowLeft", "KeyA"],
    right:    ["ArrowRight", "KeyD"],
    up:       ["ArrowUp", "KeyW"],
    down:     ["ArrowDown", "KeyS"],
    jump:     ["Space"],
    dash:     ["ShiftLeft", "ShiftRight"],
    interact: ["KeyE"],
    pause:    ["Escape", "KeyP"],
    reset:    ["KeyR"],
    attack:   ["KeyJ"]
  };

  // --- state exposed to gameplay ---
  const state = {
    moveX: 0,
    moveY: 0,
    attack: false
  };

  const edge = {
    jump: false,
    dash: false,
    interact: false,
    pause: false,
    reset: false
  };

  // --- internal sources ---
  const keyboardDir = { left: false, right: false, up: false, down: false };
  const stick       = { x: 0, y: 0 };
  const attackSrc   = { mouse: false, keyboard: false, mobile: false };

  // --- bindings (persisted) ---
  let bindings = loadBindings();

  function loadBindings() {
    try {
      const raw = localStorage.getItem("starfall_bindings");
      if (!raw) return structuredCloneSafe(DEFAULT_BINDINGS);
      const parsed = JSON.parse(raw);
      const out = structuredCloneSafe(DEFAULT_BINDINGS);
      for (const k of Object.keys(out)) {
        if (Array.isArray(parsed[k])) out[k] = parsed[k];
      }
      return out;
    } catch (e) { return structuredCloneSafe(DEFAULT_BINDINGS); }
  }
  function structuredCloneSafe(obj) { return JSON.parse(JSON.stringify(obj)); }

  function saveBindings() {
    try { localStorage.setItem("starfall_bindings", JSON.stringify(bindings)); } catch (e) {}
  }

  // --- recompute combined movement ---
  function recompute() {
    const kx = (keyboardDir.right ? 1 : 0) - (keyboardDir.left ? 1 : 0);
    const ky = (keyboardDir.down  ? 1 : 0) - (keyboardDir.up   ? 1 : 0);

    // Kalau keyboard bergerak, prioritaskan keyboard (nilai tegas ±1).
    // Kalau tidak, pakai joystick. Kalau keduanya, ambil yang lebih besar.
    const mx = (kx !== 0 && Math.abs(kx) >= Math.abs(stick.x)) ? kx : stick.x;
    const my = (ky !== 0 && Math.abs(ky) >= Math.abs(stick.y)) ? ky : stick.y;

    state.moveX = clamp(mx, -1, 1);
    state.moveY = clamp(my, -1, 1);
  }

  // --- rebinding capture ---
  let captureCallback = null;
  function startCapture(cb) { captureCallback = cb; }
  function cancelCapture()  { captureCallback = null; }

  // --- helper: is user typing in an input? ---
  function isTypingInField() {
    const el = document.activeElement;
    if (!el) return false;
    const tag = el.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
    if (el.isContentEditable) return true;
    return false;
  }

  // --- keyboard handlers ---
  function onKeyDown(e) {
    if (isTypingInField()) return;

    // Capture mode (untuk rebind)
    if (captureCallback) {
      if (e.code !== "Escape") {
        const cb = captureCallback;
        captureCallback = null;
        cb(e.code);
      } else {
        captureCallback = null;
      }
      e.preventDefault();
      return;
    }

    // Jangan preventDefault kalau focus ada di elemen UI (button/link)
    // supaya Space / Enter tetap mengaktifkan tombol.
    const tag = (e.target && e.target.tagName) || "";
    const isUIElement = tag === "BUTTON" || tag === "A" ||
                        tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";

    if (!isUIElement &&
        ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Space",
         "PageUp", "PageDown", "Home", "End"].includes(e.code)) {
      e.preventDefault();
    }

    for (const action of Object.keys(bindings)) {
      if (bindings[action].includes(e.code)) {
        triggerActionDown(action);
      }
    }
  }

  function onKeyUp(e) {
    if (isTypingInField()) return;
    for (const action of Object.keys(bindings)) {
      if (bindings[action].includes(e.code)) {
        triggerActionUp(action);
      }
    }
  }

  function triggerActionDown(action) {
    switch (action) {
      case "left":     keyboardDir.left = true;   break;
      case "right":    keyboardDir.right = true;  break;
      case "up":       keyboardDir.up = true;     break;
      case "down":     keyboardDir.down = true;   break;
      case "attack":   attackSrc.keyboard = true; recomputeAttack(); break;
      case "jump":     edge.jump = true;          break;
      case "dash":     edge.dash = true;          break;
      case "interact": edge.interact = true;      break;
      case "pause":    edge.pause = true;         break;
      case "reset":    edge.reset = true;         break;
    }
    if (["left", "right", "up", "down"].includes(action)) recompute();
  }

  function triggerActionUp(action) {
    switch (action) {
      case "left":     keyboardDir.left = false;  break;
      case "right":    keyboardDir.right = false; break;
      case "up":       keyboardDir.up = false;    break;
      case "down":     keyboardDir.down = false;  break;
      case "attack":   attackSrc.keyboard = false; recomputeAttack(); break;
      // edge actions tidak butuh keyup
    }
    if (["left", "right", "up", "down"].includes(action)) recompute();
  }

  function recomputeAttack() {
    state.attack = attackSrc.mouse || attackSrc.keyboard || attackSrc.mobile;
  }

  // --- attach / detach ---
  let attached = false;
  function attach() {
    if (attached) return;
    attached = true;
    window.addEventListener("keydown", onKeyDown, { passive: false });
    window.addEventListener("keyup", onKeyUp);
    // Jika window kehilangan fokus, anggap semua tombol dilepas (anti-stuck)
    window.addEventListener("blur", releaseAll);
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) releaseAll();
    });
  }
  function destroy() {
    if (!attached) return;
    attached = false;
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    window.removeEventListener("blur", releaseAll);
  }

  function releaseAll() {
    keyboardDir.left = keyboardDir.right = keyboardDir.up = keyboardDir.down = false;
    stick.x = 0; stick.y = 0;
    attackSrc.keyboard = attackSrc.mouse = attackSrc.mobile = false;
    edge.jump = edge.dash = edge.interact = edge.pause = edge.reset = false;
    recompute();
    recomputeAttack();
  }

  return {
    state,
    edge,
    attach,
    destroy,
    releaseAll,

    consume(name) {
      if (!edge[name]) return false;
      edge[name] = false;
      return true;
    },

    // Untuk joystick & analog
    setStick(x, y) { stick.x = x; stick.y = y; recompute(); },

    // Untuk sumber attack (mouse / keyboard / mobile button)
    setAttack(src, value) {
      if (!(src in attackSrc)) return;
      attackSrc[src] = !!value;
      recomputeAttack();
    },

    // Untuk tombol mobile edge actions
    pressEdge(name) { if (name in edge) edge[name] = true; },

    // Bindings accessor
    getBindings: () => bindings,
    setBinding(action, code) {
      if (!bindings[action]) return;
      // Hapus code dari action lain agar tidak konflik
      for (const k of Object.keys(bindings)) {
        bindings[k] = bindings[k].filter(c => c !== code);
      }
      bindings[action] = [code, ...bindings[action]];
      saveBindings();
    },
    resetBindings() {
      bindings = structuredCloneSafe(DEFAULT_BINDINGS);
      saveBindings();
    },
    defaultBindings: () => structuredCloneSafe(DEFAULT_BINDINGS),

    // Rebind capture
    startCapture,
    cancelCapture,
    isCapturing: () => !!captureCallback
  };
})();

InputManager.attach();

/* ===================================================================
   6. DOM REFERENCES
   =================================================================== */
const scoreEl        = document.getElementById("score");
const livesEl        = document.getElementById("lives");
const startScreen    = document.getElementById("start-screen");
const gameOverScreen = document.getElementById("gameover-screen");
const settingsScreen = document.getElementById("settings-screen");
const finalScoreEl   = document.getElementById("final-score");
const bestScoreEl    = document.getElementById("best-score");
const startBtn       = document.getElementById("start-btn");
const restartBtn     = document.getElementById("restart-btn");
const settingsToggle = document.getElementById("settings-toggle");
const closeSettingsBtn = document.getElementById("close-settings");
const mobileControls = document.getElementById("mobile-controls");
const joystickEl     = document.getElementById("joystick");
const joystickKnob   = document.getElementById("joystick-knob");
const startKeysEl    = document.getElementById("start-keys");

/* ===================================================================
   7. SETTINGS PERSISTENCE
   =================================================================== */
const Settings = (() => {
  const DEFAULTS = {
    mobileControls: "auto", // "auto" | "on" | "off"
    stickSens: 1.0,
    stickDead: 0.14
  };
  let data = { ...DEFAULTS };

  function load() {
    try {
      const raw = localStorage.getItem("starfall_settings");
      if (raw) Object.assign(data, JSON.parse(raw));
    } catch (e) {}
  }
  function save() {
    try { localStorage.setItem("starfall_settings", JSON.stringify(data)); } catch (e) {}
  }
  return {
    get: () => data,
    set(k, v) { data[k] = v; save(); },
    load
  };
})();
Settings.load();

function shouldShowMobileControls() {
  const mode = Settings.get().mobileControls;
  if (mode === "off") return false;
  if (mode === "on")  return true;
  return Device.hasTouch();
}

function updateMobileControlsVisibility() {
  const visible = shouldShowMobileControls() &&
                  (state.mode === "playing" || state.mode === "paused");
  mobileControls.classList.toggle("visible", visible);
  mobileControls.setAttribute("aria-hidden", visible ? "false" : "true");
}

function updateInstructionText() {
  // Sesuaikan teks instruksi dengan metode input yang terdeteksi
  if (Device.hasTouch() && startKeysEl) {
    startKeysEl.innerHTML = `
      <kbd>◀ ▶</kbd> JOYSTICK — MOVE<br />
      <kbd>🔥</kbd> ATTACK &nbsp;•&nbsp; <kbd>⬆</kbd> JUMP<br />
      <kbd>⚡</kbd> DASH &nbsp;•&nbsp; <kbd>E</kbd> INTERACT<br />
      <kbd>⏸</kbd> PAUSE &nbsp;•&nbsp; gear untuk setelan
    `;
  }
}

/* ===================================================================
   8. VIRTUAL JOYSTICK
   =================================================================== */
function setupJoystick(baseEl, knobEl) {
  let activePointer = null;
  let centerX = 0, centerY = 0, maxRadius = 0;

  function refreshCenter() {
    const rect = baseEl.getBoundingClientRect();
    centerX = rect.left + rect.width  / 2;
    centerY = rect.top  + rect.height / 2;
    // Radius knob = (base - knob) / 2 * 0.92 (sedikit di dalam border)
    maxRadius = (rect.width / 2) * 0.78;
  }

  function apply(clientX, clientY) {
    let dx = clientX - centerX;
    let dy = clientY - centerY;
    const dist = Math.hypot(dx, dy);

    if (dist > maxRadius) {
      dx = dx / dist * maxRadius;
      dy = dy / dist * maxRadius;
    }

    knobEl.style.transform =
      `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;

    // Normalize
    let nx = dx / maxRadius;
    let ny = dy / maxRadius;

    // Dead zone (radial)
    const dead = Settings.get().stickDead;
    const mag = Math.hypot(nx, ny);
    if (mag < dead) {
      InputManager.setStick(0, 0);
      return;
    }

    // Remap dari [dead, 1] ke [0, 1], lalu kalikan sensitivity
    const sens = Settings.get().stickSens;
    const remap = ((mag - dead) / (1 - dead)) * sens;
    const ang = Math.atan2(ny, nx);
    const outX = Math.cos(ang) * Math.min(remap, 1);
    const outY = Math.sin(ang) * Math.min(remap, 1);
    InputManager.setStick(outX, outY);
  }

  function reset() {
    activePointer = null;
    baseEl.classList.remove("active");
    knobEl.style.transform = "translate(-50%, -50%)";
    InputManager.setStick(0, 0);
  }

  baseEl.addEventListener("pointerdown", (e) => {
    if (activePointer !== null) return;
    Device.markTouch();
    activePointer = e.pointerId;
    baseEl.setPointerCapture(e.pointerId);
    baseEl.classList.add("active");
    refreshCenter();
    apply(e.clientX, e.clientY);
    e.preventDefault();
  });

  baseEl.addEventListener("pointermove", (e) => {
    if (e.pointerId !== activePointer) return;
    apply(e.clientX, e.clientY);
    e.preventDefault();
  });

  function onRelease(e) {
    if (e.pointerId !== activePointer) return;
    reset();
  }
  baseEl.addEventListener("pointerup", onRelease);
  baseEl.addEventListener("pointercancel", onRelease);
  baseEl.addEventListener("lostpointercapture", onRelease);

  // Jika layout berubah (rotate), reset
  window.addEventListener("resize", () => { if (activePointer !== null) reset(); });
}

setupJoystick(joystickEl, joystickKnob);

/* ===================================================================
   9. MOBILE ACTION BUTTONS
   =================================================================== */
document.querySelectorAll(".action-btn").forEach((btn) => {
  const action = btn.dataset.action;
  let activePointer = null;

  btn.addEventListener("pointerdown", (e) => {
    if (activePointer !== null) return;
    Device.markTouch();
    activePointer = e.pointerId;
    btn.setPointerCapture(e.pointerId);
    btn.classList.add("pressed");
    if (action === "attack") {
      InputManager.setAttack("mobile", true);
    } else {
      InputManager.pressEdge(action);
    }
    e.preventDefault();
  });

  function onRelease(e) {
    if (e.pointerId !== activePointer) return;
    activePointer = null;
    btn.classList.remove("pressed");
    if (action === "attack") InputManager.setAttack("mobile", false);
  }
  btn.addEventListener("pointerup", onRelease);
  btn.addEventListener("pointercancel", onRelease);
  btn.addEventListener("lostpointercapture", onRelease);
});

/* ===================================================================
   10. MOUSE ATTACK ON CANVAS
   =================================================================== */
(() => {
  let attackPointer = null;

  canvas.addEventListener("pointerdown", (e) => {
    if (attackPointer !== null) return;
    // Mouse: hanya klik kiri
    if (e.pointerType === "mouse" && e.button !== 0) return;
    // Jangan fire jika di tengah menu
    if (state.mode !== "playing" && state.mode !== "paused") return;

    attackPointer = e.pointerId;
    try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
    InputManager.setAttack("mouse", true);
    e.preventDefault();
  });

  function release(e) {
    if (e.pointerId !== attackPointer) return;
    attackPointer = null;
    InputManager.setAttack("mouse", false);
  }
  canvas.addEventListener("pointerup", release);
  canvas.addEventListener("pointercancel", release);
  canvas.addEventListener("lostpointercapture", release);
})();

/* ===================================================================
   11. GAME STATE & ENTITIES
   =================================================================== */
const MAX_LIVES = 3;

const state = {
  mode: "ready",      // "ready" | "playing" | "paused" | "settings" | "gameover"
  prevMode: "playing", // untuk restore setelah settings
  score: 0,
  best: 0,
  elapsed: 0,
  spawnTimer: 0,
  shake: 0,
  time: 0,
  gameOverAt: 0
};

try { state.best = parseInt(localStorage.getItem("starfall_best") || "0", 10) || 0; } catch (e) {}

const player = {
  x: 0, y: 0,
  baseY: 0,
  w: 38, h: 44,
  speed: 430,
  cooldown: 0,
  fireRate: 0.16,
  lives: MAX_LIVES,
  invuln: 0,
  // jump
  jumping: false,
  jumpVy: 0,
  jumpCooldown: 0,
  // dash
  dashing: false,
  dashVx: 0,
  dashTime: 0,
  dashCooldown: 0,
  lastDirX: 1
};

const bullets      = [];
const enemyBullets = [];
const enemies      = [];
const particles    = [];
let stars          = [];

/* ===================================================================
   12. RESIZE / STARS
   =================================================================== */
function makeStars() {
  stars = [];
  const count = Math.round((W * H) / 9000);
  for (let i = 0; i < count; i++) {
    const layer = Math.random();
    stars.push({
      x: Math.random() * W,
      y: Math.random() * H,
      r: layer < 0.6 ? 0.7 : layer < 0.9 ? 1.2 : 1.9,
      speed: layer < 0.6 ? 16 : layer < 0.9 ? 44 : 86,
      a: 0.25 + Math.random() * 0.7,
      tw: Math.random() * TAU
    });
  }
}

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const rect = canvas.getBoundingClientRect();
  W = Math.max(1, rect.width);
  H = Math.max(1, rect.height);

  canvas.width  = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  makeStars();

  // Reset posisi pemain relatif ke ukuran baru
  player.baseY = H - 72;
  player.x = clamp(player.x || W / 2, player.w / 2 + 8, W - player.w / 2 - 8);
  player.y = player.baseY;
}

window.addEventListener("resize", resize);
window.addEventListener("orientationchange", () => setTimeout(resize, 80));

function updateStars(dt) {
  for (const s of stars) {
    s.y += s.speed * dt;
    if (s.y > H + 2) {
      s.y = -2;
      s.x = Math.random() * W;
    }
  }
}

/* ===================================================================
   13. GAME FLOW
   =================================================================== */
function resetGame() {
  state.score = 0;
  state.elapsed = 0;
  state.spawnTimer = 0.7;
  state.shake = 0;

  bullets.length = 0;
  enemyBullets.length = 0;
  enemies.length = 0;
  particles.length = 0;

  player.x = W / 2;
  player.baseY = H - 72;
  player.y = player.baseY;
  player.lives = MAX_LIVES;
  player.invuln = 0;
  player.cooldown = 0;
  player.jumping = false;
  player.jumpVy = 0;
  player.jumpCooldown = 0;
  player.dashing = false;
  player.dashVx = 0;
  player.dashTime = 0;
  player.dashCooldown = 0;
  player.lastDirX = 1;

  updateHUD();
}

function clearEdgeTriggers() {
  InputManager.consume("jump");
  InputManager.consume("dash");
  InputManager.consume("interact");
  InputManager.consume("pause");
  InputManager.consume("reset");
}

function startGame() {
  try { Sound.unlock(); } catch (e) { /* audio boleh gagal, game tetap jalan */ }
  resetGame();
  state.mode = "playing";
  startScreen.classList.add("hidden");
  gameOverScreen.classList.add("hidden");
  settingsScreen.classList.add("hidden");
  updateMobileControlsVisibility();
  clearEdgeTriggers();
}

function gameOver() {
  state.mode = "gameover";
  state.gameOverAt = state.time;
  Sound.gameOver();

  if (state.score > state.best) {
    state.best = state.score;
    try { localStorage.setItem("starfall_best", String(state.best)); } catch (e) {}
  }

  finalScoreEl.textContent = state.score;
  bestScoreEl.textContent = state.best;
  gameOverScreen.classList.remove("hidden");
  updateMobileControlsVisibility();
}

function openSettings() {
  if (state.mode === "settings") return;
  state.prevMode = state.mode;
  state.mode = "settings";
  settingsScreen.classList.remove("hidden");
  updateMobileControlsVisibility();
  InputManager.releaseAll();
  renderBindingsList();
}

function closeSettings() {
  if (state.mode !== "settings") return;
  settingsScreen.classList.add("hidden");
  state.mode = state.prevMode === "ready" ? "ready"
              : state.prevMode === "gameover" ? "gameover"
              : state.prevMode === "paused" ? "paused"
              : "playing";
  updateMobileControlsVisibility();
  InputManager.cancelCapture();
}

function updateHUD() {
  scoreEl.textContent = state.score;
  let html = "";
  for (let i = 0; i < MAX_LIVES; i++) {
    html += `<span class="${i < player.lives ? "on" : ""}">♥</span>`;
  }
  livesEl.innerHTML = html;
}

/* ===================================================================
   14. SPAWNING
   =================================================================== */
function spawnEnemy(diff) {
  const margin = 44;
  const x = rand(margin, Math.max(margin + 1, W - margin));
  const roll = Math.random();
  let e;

  if (roll < Math.min(0.10 + diff * 0.06, 0.35)) {
    e = {
      type: "tank",
      x, y: -50, w: 46, h: 44,
      hp: 3,
      speed: 46 + diff * 8,
      color: "#c04dff", glow: "#e2a8ff",
      points: 30,
      shootTimer: rand(0.9, 2.0)
    };
  } else if (roll < 0.62) {
    e = {
      type: "sine",
      x, y: -34, w: 30, h: 30,
      hp: 1,
      speed: 72 + diff * 14,
      baseX: x, t: 0,
      freq: rand(1.2, 2.4),
      amp: rand(40, Math.max(60, Math.min(130, W * 0.25))),
      phase: rand(0, TAU),
      color: "#ffa63d", glow: "#ffd18a",
      points: 15
    };
  } else {
    e = {
      type: "straight",
      x, y: -34, w: 32, h: 30,
      hp: 1,
      speed: 96 + diff * 18,
      color: "#ff5f6d", glow: "#ff9aa2",
      points: 10
    };
  }
  e.flash = 0;
  enemies.push(e);
}

function enemyShoot(e) {
  const dx = player.x - e.x;
  const dy = player.y - e.y;
  const len = Math.hypot(dx, dy) || 1;
  const speed = 235;
  enemyBullets.push({
    x: e.x,
    y: e.y + e.h * 0.4,
    vx: (dx / len) * speed,
    vy: (dy / len) * speed,
    r: 5
  });
  Sound.enemyShoot();
}

/* ===================================================================
   15. PARTICLES
   =================================================================== */
function explode(x, y, color, count) {
  for (let i = 0; i < count; i++) {
    const a = rand(0, TAU);
    const sp = rand(40, 270);
    const life = rand(0.35, 0.9);
    particles.push({
      x, y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp,
      life, max: life,
      size: rand(1.4, 3.4),
      color
    });
  }
}

function spark(x, y, color) {
  for (let i = 0; i < 5; i++) {
    const a = rand(0, TAU);
    const sp = rand(30, 130);
    const life = rand(0.15, 0.35);
    particles.push({
      x, y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp,
      life, max: life,
      size: rand(1, 2.2),
      color
    });
  }
}

function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt;
    if (p.life <= 0) { particles.splice(i, 1); continue; }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx *= 0.96;
    p.vy *= 0.96;
  }
}

/* ===================================================================
   16. COLLISION
   =================================================================== */
function hits(a, b) {
  return Math.abs(a.x - b.x) < (a.w + b.w) * 0.5 &&
         Math.abs(a.y - b.y) < (a.h + b.h) * 0.5;
}

/* ===================================================================
   17. UPDATE — GAMEPLAY
   =================================================================== */
function fireBullet() {
  bullets.push({
    x: player.x,
    y: player.y - player.h * 0.5,
    w: 5,
    h: 16,
    vy: -760
  });
  Sound.shoot();
}

function hitPlayer() {
  if (player.invuln > 0) return;

  player.lives--;
  player.invuln = 2.0;
  state.shake = 16;
  explode(player.x, player.y, "#8ef0ff", 26);
  Sound.playerHit();
  updateHUD();

  if (player.lives <= 0) {
    player.lives = 0;
    updateHUD();
    gameOver();
  }
}

function killEnemy(e) {
  state.score += e.points;
  explode(e.x, e.y, e.glow, 20);
  Sound.explode();
  updateHUD();
}

function tryJump() {
  if (player.jumping || player.jumpCooldown > 0) return;
  player.jumping = true;
  player.jumpVy = -620;
  player.jumpCooldown = 0.7;
  player.invuln = Math.max(player.invuln, 0.4);
  Sound.jump();
  spark(player.x, player.y + 12, "#8ef0ff");
}

function tryDash() {
  if (player.dashing || player.dashCooldown > 0) return;
  const mx = InputManager.state.moveX;
  const dir = mx !== 0 ? Math.sign(mx) : (player.lastDirX || 1);
  player.dashing = true;
  player.dashVx = dir * 900;
  player.dashTime = 0.16;
  player.dashCooldown = 0.9;
  player.invuln = Math.max(player.invuln, 0.3);
  Sound.dash();
  spark(player.x - dir * 14, player.y, "#a8f0ff");
}

function updateGame(dt) {
  state.elapsed += dt;
  const diff = 1 + state.elapsed / 22;

  /* ---------- Player movement (horizontal + vertical) ---------- */
  const mx = InputManager.state.moveX;
  const my = InputManager.state.moveY;

  if (mx !== 0) player.lastDirX = Math.sign(mx);

  // X axis (blocked by dash)
  if (!player.dashing) {
    player.x += mx * player.speed * dt;
  }

  // Y axis: hanya saat tidak jumping
  if (!player.jumping) {
    // Base Y bisa naik/turun dalam batas [H*0.45, H-40]
    player.baseY = clamp(
      player.baseY + my * player.speed * dt,
      Math.max(60, H * 0.45),
      H - 40
    );
    player.y = player.baseY;
  }

  // Jump physics
  if (player.jumping) {
    player.y += player.jumpVy * dt;
    player.jumpVy += 1800 * dt;
    if (player.y >= player.baseY) {
      player.y = player.baseY;
      player.jumping = false;
      player.jumpVy = 0;
    }
  }

  // Dash physics
  if (player.dashing) {
    player.x += player.dashVx * dt;
    player.dashTime -= dt;
    if (player.dashTime <= 0) player.dashing = false;
  }

  // Clamp X
  player.x = clamp(player.x, player.w * 0.5 + 8, W - player.w * 0.5 - 8);

  // Cooldowns
  if (player.jumpCooldown > 0) player.jumpCooldown -= dt;
  if (player.dashCooldown > 0) player.dashCooldown -= dt;
  if (player.invuln > 0) player.invuln -= dt;

  /* ---------- Shooting ---------- */
  player.cooldown -= dt;
  if (InputManager.state.attack && player.cooldown <= 0) {
    fireBullet();
    player.cooldown = player.fireRate;
  }

  /* ---------- Enemy spawning ---------- */
  state.spawnTimer -= dt;
  if (state.spawnTimer <= 0) {
    spawnEnemy(diff);
    const base = Math.max(0.32, 1.15 - state.elapsed * 0.014);
    state.spawnTimer = base * rand(0.7, 1.3);
  }

  /* ---------- Player bullets ---------- */
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    b.y += b.vy * dt;
    if (b.y + b.h < -20) bullets.splice(i, 1);
  }

  /* ---------- Enemy bullets ---------- */
  for (let i = enemyBullets.length - 1; i >= 0; i--) {
    const b = enemyBullets[i];
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    if (b.y > H + 30 || b.y < -50 || b.x < -50 || b.x > W + 50) {
      enemyBullets.splice(i, 1);
    }
  }

  /* ---------- Enemies ---------- */
  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i];
    e.y += e.speed * dt;

    if (e.type === "sine") {
      e.t += dt;
      e.x = clamp(
        e.baseX + Math.sin(e.t * e.freq + e.phase) * e.amp,
        e.w * 0.5 + 6,
        W - e.w * 0.5 - 6
      );
    }

    if (e.flash > 0) e.flash -= dt;

    if (e.type === "tank" && e.y > 50) {
      e.shootTimer -= dt;
      if (e.shootTimer <= 0) {
        e.shootTimer = Math.max(0.7, 1.9 - state.elapsed * 0.02);
        enemyShoot(e);
      }
    }

    if (e.y - e.h * 0.5 > H + 50) {
      enemies.splice(i, 1);
      continue;
    }

    // Tabrakan dengan pemain
    if (Math.abs(e.x - player.x) < e.w * 0.45 + player.w * 0.4 &&
        Math.abs(e.y - player.y) < e.h * 0.45 + player.h * 0.4) {
      explode(e.x, e.y, e.glow, 18);
      enemies.splice(i, 1);
      hitPlayer();
    }
  }

  /* ---------- Player bullets vs enemies ---------- */
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    let consumed = false;
    for (let j = enemies.length - 1; j >= 0; j--) {
      const e = enemies[j];
      if (!hits(b, e)) continue;
      consumed = true;
      e.hp -= 1;
      e.flash = 0.1;
      spark(b.x, b.y - 6, e.glow);
      if (e.hp <= 0) {
        killEnemy(e);
        enemies.splice(j, 1);
      } else {
        Sound.hitEnemy();
      }
      break;
    }
    if (consumed) bullets.splice(i, 1);
  }

  /* ---------- Enemy bullets vs player ---------- */
  for (let i = enemyBullets.length - 1; i >= 0; i--) {
    const b = enemyBullets[i];
    if (Math.abs(b.x - player.x) < player.w * 0.42 + b.r &&
        Math.abs(b.y - player.y) < player.h * 0.42 + b.r) {
      enemyBullets.splice(i, 1);
      spark(b.x, b.y, "#ff8fd0");
      hitPlayer();
    }
  }
}

/* ===================================================================
   18. RENDER
   =================================================================== */
function drawNebula() {
  const g1 = ctx.createRadialGradient(
    W * 0.18, H * 0.12, 0,
    W * 0.18, H * 0.12, Math.max(W, H) * 0.65
  );
  g1.addColorStop(0, "rgba(76, 30, 150, 0.32)");
  g1.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = g1;
  ctx.fillRect(0, 0, W, H);

  const g2 = ctx.createRadialGradient(
    W * 0.85, H * 0.75, 0,
    W * 0.85, H * 0.75, Math.max(W, H) * 0.6
  );
  g2.addColorStop(0, "rgba(0, 90, 140, 0.26)");
  g2.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = g2;
  ctx.fillRect(0, 0, W, H);
}

function drawStars() {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const s of stars) {
    const twinkle = 0.75 + Math.sin(state.time * 3 + s.tw) * 0.25;
    ctx.globalAlpha = s.a * twinkle;
    ctx.fillStyle = "#cfe9ff";
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

function drawParticles() {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const p of particles) {
    ctx.globalAlpha = Math.max(0, p.life / p.max);
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

function drawBullets() {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";

  ctx.shadowColor = "#5ef0ff";
  ctx.shadowBlur = 14;
  ctx.fillStyle = "#dcfeff";
  for (const b of bullets) {
    ctx.fillRect(b.x - b.w / 2, b.y - b.h / 2, b.w, b.h);
  }

  ctx.shadowColor = "#ff6fc4";
  ctx.shadowBlur = 14;
  ctx.fillStyle = "#ffc2e6";
  for (const b of enemyBullets) {
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r, 0, TAU);
    ctx.fill();
  }

  ctx.restore();
}

function drawEnemy(e) {
  ctx.save();
  ctx.translate(e.x, e.y);
  const col = e.flash > 0 ? "#ffffff" : e.color;
  ctx.shadowColor = e.flash > 0 ? "#ffffff" : e.glow;
  ctx.shadowBlur = 16;
  ctx.fillStyle = col;

  if (e.type === "tank") {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (TAU * i) / 6 - Math.PI / 2;
      const px = Math.cos(a) * e.w * 0.5;
      const py = Math.sin(a) * e.h * 0.5;
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    }
    ctx.closePath();
    ctx.fill();

    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    ctx.arc(0, 0, e.w * 0.17, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
  } else if (e.type === "sine") {
    ctx.beginPath();
    ctx.moveTo(0, -e.h * 0.5);
    ctx.lineTo(e.w * 0.5, 0);
    ctx.lineTo(0, e.h * 0.5);
    ctx.lineTo(-e.w * 0.5, 0);
    ctx.closePath();
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.moveTo(0, e.h * 0.5);
    ctx.lineTo(e.w * 0.5, -e.h * 0.5);
    ctx.lineTo(0, -e.h * 0.5 + 9);
    ctx.lineTo(-e.w * 0.5, -e.h * 0.5);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function drawEnemies() { for (const e of enemies) drawEnemy(e); }

function drawPlayer() {
  if (player.invuln > 0 && Math.floor(state.time * 14) % 2 === 0) return;

  const { x, y, w, h } = player;
  ctx.save();
  ctx.translate(x, y);

  // Flame
  const flame = rand(10, 24);
  ctx.globalCompositeOperation = "lighter";
  const fg = ctx.createLinearGradient(0, h * 0.5 - 8, 0, h * 0.5 + flame);
  fg.addColorStop(0, "rgba(170, 245, 255, 0.95)");
  fg.addColorStop(1, "rgba(60, 120, 255, 0)");
  ctx.fillStyle = fg;
  ctx.beginPath();
  ctx.moveTo(-7, h * 0.5 - 8);
  ctx.lineTo(7, h * 0.5 - 8);
  ctx.lineTo(0, h * 0.5 + flame);
  ctx.closePath();
  ctx.fill();
  ctx.globalCompositeOperation = "source-over";

  // Hull
  ctx.shadowColor = "#48d8ff";
  ctx.shadowBlur = 20;
  ctx.fillStyle = "#8ef0ff";
  ctx.beginPath();
  ctx.moveTo(0, -h * 0.5);
  ctx.lineTo(w * 0.42, h * 0.10);
  ctx.lineTo(w * 0.50, h * 0.50);
  ctx.lineTo(0, h * 0.28);
  ctx.lineTo(-w * 0.50, h * 0.50);
  ctx.lineTo(-w * 0.42, h * 0.10);
  ctx.closePath();
  ctx.fill();

  // Cockpit
  ctx.shadowBlur = 10;
  ctx.fillStyle = "#0b2a4a";
  ctx.beginPath();
  ctx.ellipse(0, -h * 0.14, w * 0.15, h * 0.20, 0, 0, TAU);
  ctx.fill();

  ctx.restore();
}

function drawPaused() {
  ctx.save();
  ctx.fillStyle = "rgba(3, 6, 16, 0.55)";
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = "#8ef0ff";
  ctx.shadowColor = "#48d8ff";
  ctx.shadowBlur = 24;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "700 42px ui-monospace, Menlo, Consolas, monospace";
  ctx.fillText("PAUSED", W / 2, H / 2 - 10);

  ctx.shadowBlur = 0;
  ctx.font = "13px ui-monospace, Menlo, Consolas, monospace";
  ctx.fillStyle = "#7f9ab3";
  ctx.fillText("PRESS ESC / P TO RESUME", W / 2, H / 2 + 34);
  ctx.restore();
}

function render() {
  ctx.save();
  if (state.shake > 0.5) {
    ctx.translate(
      rand(-state.shake, state.shake) * 0.4,
      rand(-state.shake, state.shake) * 0.4
    );
  }
  ctx.fillStyle = "#04050e";
  ctx.fillRect(-40, -40, W + 80, H + 80);
  drawNebula();
  drawStars();
  drawParticles();
  drawBullets();
  drawEnemies();
  drawPlayer();
  ctx.restore();

  if (state.mode === "paused") drawPaused();
}

/* ===================================================================
   19. SETTINGS UI
   =================================================================== */
function refreshMcModeButtons() {
  const mode = Settings.get().mobileControls;
  document.querySelectorAll("#mc-mode .radio-btn").forEach(b => {
    b.classList.toggle("active", b.dataset.val === mode);
  });
}

document.querySelectorAll("#mc-mode .radio-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    Settings.set("mobileControls", btn.dataset.val);
    refreshMcModeButtons();
    updateMobileControlsVisibility();
  });
});

const stickSens = document.getElementById("stick-sens");
const stickSensVal = document.getElementById("stick-sens-val");
const stickDead = document.getElementById("stick-dead");
const stickDeadVal = document.getElementById("stick-dead-val");

stickSens.value = Settings.get().stickSens;
stickSensVal.textContent = Number(Settings.get().stickSens).toFixed(2);
stickDead.value = Settings.get().stickDead;
stickDeadVal.textContent = Number(Settings.get().stickDead).toFixed(2);

stickSens.addEventListener("input", () => {
  const v = parseFloat(stickSens.value);
  Settings.set("stickSens", v);
  stickSensVal.textContent = v.toFixed(2);
});
stickDead.addEventListener("input", () => {
  const v = parseFloat(stickDead.value);
  Settings.set("stickDead", v);
  stickDeadVal.textContent = v.toFixed(2);
});

/* ---------- Bindings list ---------- */
function prettyCode(code) {
  if (!code) return "—";
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (code === "ShiftLeft") return "L-SHIFT";
  if (code === "ShiftRight") return "R-SHIFT";
  if (code === "Space") return "SPACE";
  if (code === "Escape") return "ESC";
  if (code === "Enter") return "ENTER";
  return code.toUpperCase();
}

function renderBindingsList() {
  const listEl = document.getElementById("bindings-list");
  const bindings = InputManager.getBindings();
  const actions = [
    ["left", "MOVE LEFT"],
    ["right", "MOVE RIGHT"],
    ["up", "MOVE UP"],
    ["down", "MOVE DOWN"],
    ["attack", "ATTACK"],
    ["jump", "JUMP"],
    ["dash", "DASH"],
    ["interact", "INTERACT"],
    ["pause", "PAUSE"],
    ["reset", "RESET"]
  ];
  listEl.innerHTML = "";
  actions.forEach(([action, label]) => {
    const row = document.createElement("div");
    row.className = "binding-row";
    const labelEl = document.createElement("span");
    labelEl.className = "label";
    labelEl.textContent = label;
    const codeBtn = document.createElement("button");
    codeBtn.className = "code";
    codeBtn.textContent = prettyCode(bindings[action][0]);
    codeBtn.setAttribute("aria-label", `Rebind ${label}`);
    codeBtn.addEventListener("click", () => {
      if (InputManager.isCapturing()) return;
      codeBtn.classList.add("listening");
      codeBtn.textContent = "PRESS...";
      InputManager.startCapture((newCode) => {
        InputManager.setBinding(action, newCode);
        codeBtn.classList.remove("listening");
        renderBindingsList();
      });
    });
    row.appendChild(labelEl);
    row.appendChild(codeBtn);
    listEl.appendChild(row);
  });
}

document.getElementById("reset-bindings").addEventListener("click", () => {
  InputManager.resetBindings();
  renderBindingsList();
});

/* ---------- Settings open/close ---------- */
settingsToggle.addEventListener("click", () => {
  if (state.mode === "settings") closeSettings();
  else openSettings();
});
closeSettingsBtn.addEventListener("click", closeSettings);

/* ===================================================================
   20. MENU BUTTONS
   =================================================================== */
startBtn.addEventListener("click", startGame);
restartBtn.addEventListener("click", startGame);

/* ===================================================================
   21. WINDOW BLUR (auto-pause)
   =================================================================== */
window.addEventListener("blur", () => {
  if (state.mode === "playing") {
    state.mode = "paused";
    updateMobileControlsVisibility();
  }
  InputManager.releaseAll();
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    if (state.mode === "playing") {
      state.mode = "paused";
      updateMobileControlsVisibility();
    }
    InputManager.releaseAll();
  }
});

/* ===================================================================
   22. MAIN LOOP
   =================================================================== */
let lastTime = 0;

function handleEdgeActions() {
  // Pause toggle
  if (InputManager.consume("pause")) {
    if (state.mode === "playing") {
      state.mode = "paused";
      updateMobileControlsVisibility();
    } else if (state.mode === "paused") {
      state.mode = "playing";
      updateMobileControlsVisibility();
    } else if (state.mode === "settings") {
      closeSettings();
    }
  }

  // Reset (R)
  if (InputManager.consume("reset")) {
    if (state.mode === "playing" || state.mode === "paused" || state.mode === "gameover") {
      startGame();
      return;
    }
  }

  // Start / restart dari menu
  if (state.mode === "ready") {
    if (InputManager.consume("jump") || InputManager.consume("interact")) {
      startGame();
    }
  } else if (state.mode === "gameover" && state.time - state.gameOverAt > 0.8) {
    if (InputManager.consume("jump") || InputManager.consume("interact")) {
      startGame();
    }
  }

  // Jump / Dash saat bermain
  if (state.mode === "playing") {
    if (InputManager.consume("jump")) tryJump();
    if (InputManager.consume("dash")) tryDash();
  }
}

function loop(ts) {
  try {
    if (!lastTime) lastTime = ts;
    let dt = (ts - lastTime) / 1000;
    lastTime = ts;
    dt = Math.min(dt, 0.05);

    state.time += dt;

    if (state.mode !== "paused" && state.mode !== "settings") {
      updateStars(dt);
      updateParticles(dt);
      if (state.shake > 0) state.shake = Math.max(0, state.shake - dt * 60);
    }

    handleEdgeActions();

    if (state.mode === "playing") updateGame(dt);

    render();
  } catch (err) {
    // Satu error tidak boleh menghentikan requestAnimationFrame.
    console.error("[loop]", err);
  }
  requestAnimationFrame(loop);
}

/* ===================================================================
   23. BOOT
   =================================================================== */
resize();
resetGame();
refreshMcModeButtons();
updateInstructionText();
updateMobileControlsVisibility();
requestAnimationFrame(loop);

// Bersihkan listener saat unload
window.addEventListener("beforeunload", () => InputManager.destroy());

})();
