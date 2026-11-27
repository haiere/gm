(() => {
'use strict';

/* =========================================================================
   ORBIT WEAVER  —  unified input edition
   -------------------------------------------------------------------------
   Core mechanic (unchanged): the ship ALWAYS orbits the core automatically.
   All input is routed through InputManager; gameplay never reads raw events.
   ========================================================================= */

/* ------------------------- Constants ------------------------- */
const TAU = Math.PI * 2;

const FIELD_R          = 400;
const CORE_R           = 58;

const PLAYER_MIN_R     = CORE_R + 24;
const PLAYER_MAX_R     = FIELD_R - 16;
const PLAYER_OUT_SPEED = 330;
const PLAYER_IN_SPEED  = 235;
const PLAYER_ORBIT     = 1.6;
const PLAYER_HIT_R     = 9;

const ORB_R            = 8;
const ORB_COLLECT_R    = 27;

const AST_MIN_SIZE     = 13;
const AST_MAX_SIZE     = 26;

const ORB_SCORE        = 10;
const COMBO_WINDOW     = 2.6;
const COMBO_MAX        = 8;

const LEVEL_DURATION   = 15;

/* --- new combat / ability constants --- */
const BULLET_SPEED     = 680;
const BULLET_LIFE      = 1.5;
const BULLET_R         = 4;
const FIRE_CD          = 0.15;
const AST_SCORE        = 20;
const AUTOAIM_RANGE    = 300;

const JUMP_DIST        = 95;
const JUMP_CD          = 1.1;
const JUMP_INVULN      = 0.35;

const DASH_CD          = 3.0;
const DASH_TIME        = 0.40;
const DASH_SPEED       = 820;

const PULSE_CD         = 7.0;
const PULSE_RADIUS     = 250;

/* ------------------------- Utilities ------------------------- */
const rand  = (min, max) => min + Math.random() * (max - min);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const toXY  = (radius, angle) => ({
  x: Math.cos(angle) * radius,
  y: Math.sin(angle) * radius
});

function isTypingTarget(el) {
  if (!el || !el.tagName) return false;
  const t = el.tagName;
  return t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT' || el.isContentEditable === true;
}

const KEY_NAMES = {
  Space: 'SPACE', Escape: 'ESC', Enter: 'ENTER', Tab: 'TAB',
  ShiftLeft: 'L-SHIFT', ShiftRight: 'R-SHIFT',
  ControlLeft: 'L-CTRL', ControlRight: 'R-CTRL',
  AltLeft: 'L-ALT', AltRight: 'R-ALT',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']',
  Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backslash: '\\'
};

function prettyKey(code) {
  if (!code) return '—';
  if (KEY_NAMES[code]) return KEY_NAMES[code];
  if (code.indexOf('Key') === 0) return code.slice(3);
  if (code.indexOf('Digit') === 0) return code.slice(5);
  if (code.indexOf('Numpad') === 0) return 'NUM' + code.slice(6);
  return code.toUpperCase();
}

/* ------------------------- Settings ------------------------- */
const Settings = (() => {
  const defaults = {
    joystickSensitivity: 1.0,
    mouseSensitivity: 1.0,
    showTouchControls: 'auto'
  };

  const s = Object.assign({}, defaults);

  try {
    const raw = JSON.parse(localStorage.getItem('orbitWeaverSettings') || 'null');
    if (raw && typeof raw === 'object') {
      if (typeof raw.joystickSensitivity === 'number') s.joystickSensitivity = clamp(raw.joystickSensitivity, 0.4, 1.8);
      if (typeof raw.mouseSensitivity === 'number') s.mouseSensitivity = clamp(raw.mouseSensitivity, 0.4, 2.0);
      if (raw.showTouchControls === 'auto' || raw.showTouchControls === 'on' || raw.showTouchControls === 'off') {
        s.showTouchControls = raw.showTouchControls;
      }
    }
  } catch (e) { /* ignore */ }

  s.save = function () {
    try {
      localStorage.setItem('orbitWeaverSettings', JSON.stringify({
        joystickSensitivity: s.joystickSensitivity,
        mouseSensitivity: s.mouseSensitivity,
        showTouchControls: s.showTouchControls
      }));
    } catch (e) { /* ignore */ }
  };

  s.reset = function () {
    s.joystickSensitivity = defaults.joystickSensitivity;
    s.mouseSensitivity = defaults.mouseSensitivity;
    s.showTouchControls = defaults.showTouchControls;
    s.save();
  };

  return s;
})();

/* ------------------------- Device detection ------------------------- */
const Device = (() => {
  let touchCapable = false;
  try {
    touchCapable =
      (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0) ||
      ('ontouchstart' in window) ||
      (window.matchMedia && window.matchMedia('(any-pointer: coarse)').matches);
  } catch (e) { touchCapable = false; }

  function touchControlsEnabled() {
    if (Settings.showTouchControls === 'on') return true;
    if (Settings.showTouchControls === 'off') return false;
    return touchCapable;
  }

  return { touchCapable, touchControlsEnabled };
})();

/* =========================================================================
   InputManager
   ========================================================================= */
const Input = (() => {

  const DEFAULT_BINDINGS = {
    thrustOut:  ['KeyW', 'ArrowUp'],
    thrustIn:   ['KeyS', 'ArrowDown'],
    orbitLeft:  ['KeyA', 'ArrowLeft'],
    orbitRight: ['KeyD', 'ArrowRight'],
    attack:     ['KeyF'],
    jump:       ['Space'],
    dash:       ['ShiftLeft', 'ShiftRight'],
    interact:   ['KeyE'],
    pause:      ['Escape'],
    reset:      ['KeyR']
  };

  const BINDING_LABELS = {
    thrustOut: 'Thrust Out',
    thrustIn: 'Thrust In',
    orbitLeft: 'Orbit Left',
    orbitRight: 'Orbit Right',
    attack: 'Fire',
    jump: 'Jump',
    dash: 'Dash',
    interact: 'Interact / Pulse',
    pause: 'Pause',
    reset: 'Restart'
  };

  const BINDING_ORDER = [
    'thrustOut', 'thrustIn', 'orbitLeft', 'orbitRight',
    'attack', 'jump', 'dash', 'interact', 'pause', 'reset'
  ];

  /* ---------- internal state ---------- */
  let bindings = loadBindings();
  const keysDown = new Set();
  const pointerActions = new Map();   // pointerId -> action name
  let pressedEdges = {};
  let keyCaptureCb = null;
  let canvasTouchThrust = new Set();  // pointerIds touching the canvas (thrust-out)

  const api = {
    moveX: 0,
    moveY: 0,
    aim: { x: 0, y: 0, active: false },
    joy: { x: 0, y: 0, active: false },
    BINDING_ORDER,
    BINDING_LABELS
  };

  /* ---------- bindings persistence ---------- */
  function loadBindings() {
    const b = {};
    for (const k in DEFAULT_BINDINGS) b[k] = DEFAULT_BINDINGS[k].slice();
    try {
      const saved = JSON.parse(localStorage.getItem('orbitWeaverBindings') || 'null');
      if (saved && typeof saved === 'object') {
        for (const k in b) {
          if (Array.isArray(saved[k]) && saved[k].length && saved[k].every(c => typeof c === 'string')) {
            b[k] = saved[k].slice();
          }
        }
      }
    } catch (e) { /* ignore */ }
    return b;
  }

  function saveBindings() {
    try { localStorage.setItem('orbitWeaverBindings', JSON.stringify(bindings)); } catch (e) { /* ignore */ }
  }

  function setBinding(action, code) {
    if (!bindings[action]) return;
    // Remove this code from every other action to avoid conflicts
    for (const k in bindings) {
      if (k === action) continue;
      const i = bindings[k].indexOf(code);
      if (i !== -1) bindings[k].splice(i, 1);
    }
    if (bindings[action].indexOf(code) === -1) bindings[action] = [code];
    saveBindings();
    if (typeof api.onBindingsChanged === 'function') api.onBindingsChanged();
  }

  function resetBindings() {
    for (const k in DEFAULT_BINDINGS) bindings[k] = DEFAULT_BINDINGS[k].slice();
    saveBindings();
    if (typeof api.onBindingsChanged === 'function') api.onBindingsChanged();
  }

  function getBindingLabel(action) {
    const codes = bindings[action];
    if (!codes || !codes.length) return '—';
    return codes.map(prettyKey).join(' / ');
  }

  /* ---------- action queries ---------- */
  function down(action) {
    const codes = bindings[action];
    if (codes) {
      for (let i = 0; i < codes.length; i++) {
        if (keysDown.has(codes[i])) return true;
      }
    }
    if (action === 'thrustOut' && canvasTouchThrust.size > 0) return true;
    for (const a of pointerActions.values()) {
      if (a === action) return true;
    }
    return false;
  }

  function takePressed() {
    const p = pressedEdges;
    pressedEdges = {};
    return p;
  }

  function markPressedForCode(code) {
    for (const action in bindings) {
      const codes = bindings[action];
      for (let i = 0; i < codes.length; i++) {
        if (codes[i] === code) { pressedEdges[action] = true; break; }
      }
    }
  }

  /* ---------- movement merge ---------- */
  function refresh() {
    let kx = 0, ky = 0;
    if (down('orbitRight')) kx += 1;
    if (down('orbitLeft')) kx -= 1;
    if (down('thrustIn')) ky += 1;
    if (down('thrustOut')) ky -= 1;

    const jx = api.joy.x;
    const jy = api.joy.y;

    const magK = Math.sqrt(kx * kx + ky * ky);
    const magJ = Math.sqrt(jx * jx + jy * jy);

    // Pick whichever source is pushing harder — safe merge, never both at once
    if (magJ > magK) {
      api.moveX = jx;
      api.moveY = jy;
    } else {
      api.moveX = kx;
      api.moveY = ky;
    }

    const m = Math.sqrt(api.moveX * api.moveX + api.moveY * api.moveY);
    if (m > 1) {
      api.moveX /= m;
      api.moveY /= m;
    }
  }

  /* ---------- reset ---------- */
  function resetAll() {
    keysDown.clear();
    pointerActions.clear();
    canvasTouchThrust.clear();
    pressedEdges = {};
    api.joy.x = 0;
    api.joy.y = 0;
    api.joy.active = false;
    api.moveX = 0;
    api.moveY = 0;
    const knob = document.getElementById('joyKnob');
    const base = document.getElementById('joystick');
    if (knob) knob.style.transform = 'translate(-50%, -50%)';
    if (base) base.classList.remove('active');
    document.querySelectorAll('.tbtn.pressed').forEach(el => el.classList.remove('pressed'));
  }

  /* ---------- key capture (rebinding) ---------- */
  function captureNextKey(cb) { keyCaptureCb = cb; }
  function isCapturingKeys() { return keyCaptureCb !== null; }

  /* ---------- keyboard listeners ---------- */
  function onKeyDown(e) {
    if (keyCaptureCb) {
      e.preventDefault();
      e.stopPropagation();
      const cb = keyCaptureCb;
      keyCaptureCb = null;
      if (e.code !== 'Escape') cb(e.code);
      return;
    }

    if (isTypingTarget(e.target)) return;

    const code = e.code;
    let bound = false;
    for (const action in bindings) {
      if (bindings[action].indexOf(code) !== -1) { bound = true; break; }
    }
    if (!bound) return;

    e.preventDefault();

    if (!keysDown.has(code)) {
      keysDown.add(code);
      markPressedForCode(code);
    }
  }

  function onKeyUp(e) {
    if (keyCaptureCb) { e.preventDefault(); return; }
    const code = e.code;
    if (keysDown.has(code)) {
      e.preventDefault();
      keysDown.delete(code);
    }
  }

  function onWindowBlur() { resetAll(); }

  /* ---------- canvas pointer (mouse fire / touch thrust) ---------- */
  function attachCanvas(canvas) {
    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse') {
        if (e.button === 0) {
          pointerActions.set(e.pointerId, 'attack');
          pressedEdges.attack = true;
        }
      } else {
        // Touch / pen on the play-field acts as the original "hold to fly outward"
        canvasTouchThrust.add(e.pointerId);
        pressedEdges.thrustOut = true;
      }
      api.aim.active = false;
      e.preventDefault();
    }, { passive: false });

    // Aiming with the mouse
    window.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'mouse') {
        api.aim.x = e.clientX;
        api.aim.y = e.clientY;
        api.aim.active = true;
      }
    }, { passive: true });
  }

  /* ---------- global pointer release ---------- */
  function attachGlobalPointer() {
    const release = (e) => {
      pointerActions.delete(e.pointerId);
      canvasTouchThrust.delete(e.pointerId);
    };
    window.addEventListener('pointerup', release, { passive: true });
    window.addEventListener('pointercancel', release, { passive: true });
    window.addEventListener('blur', () => { resetAll(); });
  }

  /* ---------- virtual joystick ---------- */
  function attachJoystick() {
    const base = document.getElementById('joystick');
    const knob = document.getElementById('joyKnob');
    if (!base || !knob) return;

    const DEAD_ZONE = 0.16;
    let pid = null;
    let cx = 0, cy = 0, maxR = 40;

    function apply(clientX, clientY) {
      let dx = clientX - cx;
      let dy = clientY - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist > maxR) {
        dx = (dx / dist) * maxR;
        dy = (dy / dist) * maxR;
      }

      knob.style.transform =
        'translate(calc(-50% + ' + dx.toFixed(1) + 'px), calc(-50% + ' + dy.toFixed(1) + 'px))';

      const nx = dx / maxR;
      const ny = dy / maxR;
      const mag = Math.sqrt(nx * nx + ny * ny);

      if (mag <= DEAD_ZONE) {
        api.joy.x = 0;
        api.joy.y = 0;
        api.joy.active = true;
        return;
      }

      // Remap past the dead zone so the response stays smooth
      const scaled = Math.min(1, ((mag - DEAD_ZONE) / (1 - DEAD_ZONE)) * Settings.joystickSensitivity);
      api.joy.x = (nx / mag) * scaled;
      api.joy.y = (ny / mag) * scaled;
      api.joy.active = true;
    }

    function reset() {
      pid = null;
      api.joy.x = 0;
      api.joy.y = 0;
      api.joy.active = false;
      knob.style.transform = 'translate(-50%, -50%)';
      base.classList.remove('active');
    }

    base.addEventListener('pointerdown', (e) => {
      if (pid !== null) return;
      e.preventDefault();
      pid = e.pointerId;
      const r = base.getBoundingClientRect();
      cx = r.left + r.width / 2;
      cy = r.top + r.height / 2;
      maxR = r.width * 0.28;
      try { base.setPointerCapture(pid); } catch (err) { /* ignore */ }
      base.classList.add('active');
      apply(e.clientX, e.clientY);
    }, { passive: false });

    base.addEventListener('pointermove', (e) => {
      if (e.pointerId !== pid) return;
      e.preventDefault();
      apply(e.clientX, e.clientY);
    }, { passive: false });

    const end = (e) => { if (e.pointerId === pid) reset(); };
    base.addEventListener('pointerup', end);
    base.addEventListener('pointercancel', end);
    base.addEventListener('lostpointercapture', end);
    window.addEventListener('blur', reset);
  }

  /* ---------- on-screen action buttons ---------- */
  function attachTouchButtons() {
    const buttons = document.querySelectorAll('.tbtn[data-action]');

    buttons.forEach((btn) => {
      const action = btn.dataset.action;

      const release = (e) => {
        if (pointerActions.get(e.pointerId) === action) {
          pointerActions.delete(e.pointerId);
        }
        btn.classList.remove('pressed');
      };

      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        pointerActions.set(e.pointerId, action);
        pressedEdges[action] = true;
        btn.classList.add('pressed');
        try { btn.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      }, { passive: false });

      btn.addEventListener('pointerup', release);
      btn.addEventListener('pointercancel', release);
      btn.addEventListener('lostpointercapture', release);
      btn.addEventListener('contextmenu', (e) => e.preventDefault());
    });
  }

  /* ---------- public api ---------- */
  api.down = down;
  api.takePressed = takePressed;
  api.refresh = refresh;
  api.resetAll = resetAll;
  api.captureNextKey = captureNextKey;
  api.isCapturingKeys = isCapturingKeys;
  api.setBinding = setBinding;
  api.resetBindings = resetBindings;
  api.getBindingLabel = getBindingLabel;
  api.getBindings = () => bindings;
  api.onBindingsChanged = null;

  api.attach = function (canvas) {
    window.addEventListener('keydown', onKeyDown, false);
    window.addEventListener('keyup', onKeyUp, false);
    window.addEventListener('blur', onWindowBlur, false);
    attachCanvas(canvas);
    attachGlobalPointer();
    attachJoystick();
    attachTouchButtons();
  };

  return api;
})();

/* ------------------------- Canvas / view ------------------------- */
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

const view = { W: 0, H: 0, dpr: 1, scale: 1 };

function resize() {
  view.W = window.innerWidth;
  view.H = window.innerHeight;
  view.dpr = Math.min(window.devicePixelRatio || 1, 2);

  canvas.width  = Math.round(view.W * view.dpr);
  canvas.height = Math.round(view.H * view.dpr);
  canvas.style.width  = view.W + 'px';
  canvas.style.height = view.H + 'px';

  view.scale = (Math.min(view.W, view.H) * 0.46) / FIELD_R;
}

/* ------------------------- Sound ------------------------- */
const Sound = (() => {
  let audio = null;
  let available = true;

  function ensure() {
    if (!available) return null;
    if (!audio) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) { available = false; return null; }
      audio = new AC();
    }
    if (audio.state === 'suspended') audio.resume();
    return audio;
  }

  function tone(freq, dur, type, vol, delay) {
    type = type || 'sine';
    vol = vol === undefined ? 0.06 : vol;
    delay = delay || 0;
    const a = ensure();
    if (!a) return;
    const t0 = a.currentTime + delay;
    const osc = a.createOscillator();
    const gain = a.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.linearRampToValueAtTime(vol, t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain);
    gain.connect(a.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
  }

  function sweep(f1, f2, dur, type, vol) {
    type = type || 'sawtooth';
    vol = vol === undefined ? 0.09 : vol;
    const a = ensure();
    if (!a) return;
    const t0 = a.currentTime;
    const osc = a.createOscillator();
    const gain = a.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f1, t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(f2, 1), t0 + dur);
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain);
    gain.connect(a.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
  }

  return {
    ensure: ensure,
    collect: function (combo) { tone(520 + combo * 68, 0.12, 'triangle', 0.07); },
    levelUp: function () { tone(660, 0.1, 'square', 0.05); tone(990, 0.16, 'square', 0.05, 0.09); },
    die:     function () { sweep(420, 55, 0.7, 'sawtooth', 0.1); },
    start:   function () { tone(440, 0.1, 'triangle', 0.06); tone(660, 0.1, 'triangle', 0.06, 0.09); tone(880, 0.18, 'triangle', 0.06, 0.18); },
    shoot:   function () { tone(880, 0.05, 'square', 0.028); },
    hit:     function () { tone(240, 0.06, 'square', 0.04); },
    explode: function () { sweep(300, 90, 0.24, 'sawtooth', 0.05); },
    jump:    function () { sweep(300, 720, 0.16, 'triangle', 0.06); },
    dash:    function () { sweep(180, 900, 0.26, 'sawtooth', 0.07); },
    pulse:   function () { tone(300, 0.28, 'sine', 0.07); tone(600, 0.24, 'sine', 0.05, 0.04); },
    ui:      function () { tone(620, 0.06, 'triangle', 0.04); },
    deny:    function () { tone(160, 0.09, 'square', 0.035); }
  };
})();

/* ------------------------- Game state ------------------------- */
const game = {
  mode: 'start',           // 'start' | 'playing' | 'paused' | 'gameover'
  time: 0,
  elapsed: 0,
  score: 0,
  best: 0,
  combo: 1,
  comboTimer: 0,
  level: 1,
  holding: false,
  shake: 0,
  playerHeading: -Math.PI / 2,
  player: { angle: -Math.PI / 2, radius: PLAYER_MIN_R + 130 },
  trail: [],
  asteroids: [],
  orbs: [],
  particles: [],
  stars: [],
  bullets: [],
  pulseRings: [],
  fireCooldown: 0,
  invuln: 0,
  dashTime: 0,
  dashDir: 1,
  abilities: { jump: 0, dash: 0, interact: 0 },
  spawn: { asteroid: 1.2, orb: 0.4 }
};

const ui = {
  settingsOpen: false,
  settingsFrom: 'pause',
  overVisible: false
};

/* ------------------------- Stars ------------------------- */
function makeStars() {
  const stars = [];
  for (let i = 0; i < 170; i++) {
    stars.push({
      x: rand(-1000, 1000),
      y: rand(-1000, 1000),
      r: rand(0.6, 1.9),
      a: rand(0.2, 0.85),
      tw: rand(0.5, 2.4),
      phase: rand(0, TAU)
    });
  }
  return stars;
}
game.stars = makeStars();

/* ------------------------- Entity factories ------------------------- */
function makeAsteroidShape(size) {
  const points = [];
  const n = 8 + Math.floor(Math.random() * 4);
  for (let i = 0; i < n; i++) {
    points.push({ a: (i / n) * TAU, r: size * rand(0.7, 1.2) });
  }
  return points;
}

function spawnAsteroid() {
  const size = rand(AST_MIN_SIZE, AST_MAX_SIZE);
  const pPos = toXY(game.player.radius, game.player.angle);

  for (let attempt = 0; attempt < 14; attempt++) {
    const orbitR = rand(PLAYER_MIN_R, PLAYER_MAX_R);
    const angle = rand(0, TAU);
    const x = Math.cos(angle) * orbitR;
    const y = Math.sin(angle) * orbitR;

    const pdx = x - pPos.x, pdy = y - pPos.y;
    if (pdx * pdx + pdy * pdy < 150 * 150) continue;

    let clash = false;
    for (let i = 0; i < game.asteroids.length; i++) {
      const a = game.asteroids[i];
      const ap = toXY(a.orbitR, a.angle);
      const dx = x - ap.x, dy = y - ap.y;
      const minDist = size + a.size + 26;
      if (dx * dx + dy * dy < minDist * minDist) { clash = true; break; }
    }
    if (clash) continue;

    game.asteroids.push({
      orbitR: orbitR,
      angle: angle,
      size: size,
      speed: (Math.random() < 0.5 ? -1 : 1) * rand(0.35, 2.05),
      spin: rand(0, TAU),
      spinSpeed: rand(-1.4, 1.4),
      shape: makeAsteroidShape(size),
      hp: size > 19 ? 2 : 1,
      flash: 0
    });
    return true;
  }
  return false;
}

function spawnOrb() {
  const pPos = toXY(game.player.radius, game.player.angle);

  for (let attempt = 0; attempt < 14; attempt++) {
    const orbitR = rand(PLAYER_MIN_R + 12, PLAYER_MAX_R - 12);
    const angle = rand(0, TAU);
    const x = Math.cos(angle) * orbitR;
    const y = Math.sin(angle) * orbitR;

    let blocked = false;
    for (let i = 0; i < game.asteroids.length; i++) {
      const a = game.asteroids[i];
      const ap = toXY(a.orbitR, a.angle);
      const dx = x - ap.x, dy = y - ap.y;
      const minDist = a.size + ORB_COLLECT_R + 12;
      if (dx * dx + dy * dy < minDist * minDist) { blocked = true; break; }
    }
    if (blocked) continue;

    const pdx = x - pPos.x, pdy = y - pPos.y;
    if (pdx * pdx + pdy * pdy < 90 * 90) continue;

    game.orbs.push({ orbitR: orbitR, angle: angle, phase: rand(0, TAU) });
    return true;
  }
  return false;
}

/* ------------------------- Particles ------------------------- */
function spawnBurst(x, y, color, count, speed) {
  speed = speed || 160;
  for (let i = 0; i < count; i++) {
    const a = rand(0, TAU);
    const s = rand(speed * 0.35, speed);
    game.particles.push({
      x: x, y: y,
      vx: Math.cos(a) * s,
      vy: Math.sin(a) * s,
      r: rand(1.6, 4),
      life: rand(0.35, 0.75),
      maxLife: 0.75,
      color: color
    });
  }
}

function updateParticles(dt) {
  const damp = Math.pow(0.14, dt);
  for (let i = game.particles.length - 1; i >= 0; i--) {
    const p = game.particles[i];
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx *= damp;
    p.vy *= damp;
    p.life -= dt;
    if (p.life <= 0) game.particles.splice(i, 1);
  }
}

function updatePulseRings(dt) {
  for (let i = game.pulseRings.length - 1; i >= 0; i--) {
    const r = game.pulseRings[i];
    r.life -= dt;
    if (r.life <= 0) game.pulseRings.splice(i, 1);
  }
}

/* ------------------------- Run lifecycle ------------------------- */
function resetRun() {
  game.elapsed = 0;
  game.score = 0;
  game.combo = 1;
  game.comboTimer = 0;
  game.level = 1;
  game.shake = 0;
  game.holding = false;
  game.player.angle = -Math.PI / 2;
  game.player.radius = PLAYER_MIN_R + 130;
  game.playerHeading = -Math.PI / 2;
  game.trail.length = 0;
  game.asteroids.length = 0;
  game.orbs.length = 0;
  game.particles.length = 0;
  game.bullets.length = 0;
  game.pulseRings.length = 0;
  game.fireCooldown = 0;
  game.invuln = 0;
  game.dashTime = 0;
  game.dashDir = 1;
  game.abilities.jump = 0;
  game.abilities.dash = 0;
  game.abilities.interact = 0;
  game.spawn.asteroid = 1.0;
  game.spawn.orb = 0.35;

  for (let i = 0; i < 6; i++) spawnAsteroid();
  for (let i = 0; i < 3; i++) spawnOrb();

  syncHUD(true);
}

function startGame() {
  Sound.ensure();
  Sound.start();
  ui.settingsOpen = false;
  ui.overVisible = false;
  Input.resetAll();
  resetRun();
  game.mode = 'playing';
  updateScreens();
}

function setPaused(v) {
  if (v) {
    if (game.mode !== 'playing') return;
    game.mode = 'paused';
    ui.settingsOpen = false;
    Input.resetAll();
    Sound.ui();
  } else {
    if (game.mode !== 'paused') return;
    game.mode = 'playing';
    ui.settingsOpen = false;
    Input.resetAll();
    lastTime = performance.now();
    Sound.ui();
  }
  updateScreens();
}

function die(px, py) {
  game.mode = 'gameover';
  game.holding = false;
  game.shake = 1.3;
  game.dashTime = 0;
  game.bullets.length = 0;
  spawnBurst(px, py, '#ff8ba0', 26, 280);
  spawnBurst(px, py, '#ffd479', 16, 200);
  Sound.die();

  const isNewBest = game.score > game.best;
  if (isNewBest) {
    game.best = game.score;
    try { localStorage.setItem('orbitWeaverBest', String(game.best)); } catch (e) { /* ignore */ }
  }

  finalScoreEl.textContent = String(game.score);
  bestScoreEl.textContent = String(game.best);
  finalLevelEl.textContent = String(game.level);
  newBestEl.style.visibility = isNewBest && game.score > 0 ? 'visible' : 'hidden';

  ui.overVisible = false;
  updateScreens();

  setTimeout(function () {
    if (game.mode === 'gameover') {
      ui.overVisible = true;
      updateScreens();
    }
  }, 420);
}

/* ------------------------- Abilities ------------------------- */
function radialInputSign() {
  // moveY: -1 = up = outward, +1 = down = inward
  return Input.moveY > 0.15 ? -1 : 1;
}

function fireBullet(px, py, angle) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  game.bullets.push({
    x: px + cos * 16,
    y: py + sin * 16,
    vx: cos * BULLET_SPEED,
    vy: sin * BULLET_SPEED,
    life: BULLET_LIFE
  });
  spawnBurst(px + cos * 18, py + sin * 18, '#ffe9a8', 3, 90);
  Sound.shoot();
}

function tryJump() {
  if (game.abilities.jump > 0) { Sound.deny(); return; }
  game.abilities.jump = JUMP_CD;
  game.invuln = Math.max(game.invuln, JUMP_INVULN);

  const dir = radialInputSign();
  const before = game.player.radius;
  game.player.radius = clamp(game.player.radius + dir * JUMP_DIST, PLAYER_MIN_R, PLAYER_MAX_R);
  if (game.player.radius === before) { game.abilities.jump = JUMP_CD * 0.5; }

  game.trail.length = 0;
  const p = toXY(game.player.radius, game.player.angle);
  spawnBurst(p.x, p.y, '#7dffd8', 12, 190);
  Sound.jump();
}

function tryDash() {
  if (game.abilities.dash > 0) { Sound.deny(); return; }
  game.abilities.dash = DASH_CD;
  game.dashTime = DASH_TIME;
  game.dashDir = radialInputSign();
  game.trail.length = 0;
  Sound.dash();
}

function tryPulse(px, py) {
  if (game.abilities.interact > 0) { Sound.deny(); return; }
  game.abilities.interact = PULSE_CD;
  game.pulseRings.push({ x: px, y: py, life: 0.55, maxLife: 0.55 });
  Sound.pulse();

  // Pull nearby orbs toward the ship
  for (let i = 0; i < game.orbs.length; i++) {
    const o = game.orbs[i];
    const ox = Math.cos(o.angle) * o.orbitR;
    const oy = Math.sin(o.angle) * o.orbitR;
    const dx = px - ox;
    const dy = py - oy;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d < PULSE_RADIUS && d > 1) {
      const pull = d * 0.75;
      const nx = ox + (dx / d) * pull;
      const ny = oy + (dy / d) * pull;
      o.orbitR = clamp(Math.sqrt(nx * nx + ny * ny), PLAYER_MIN_R, PLAYER_MAX_R);
      o.angle = Math.atan2(ny, nx);
    }
  }

  // Push asteroids away from the ship (world-space, then back to polar)
  const range = PULSE_RADIUS * 0.8;
  for (let i = 0; i < game.asteroids.length; i++) {
    const a = game.asteroids[i];
    const ax = Math.cos(a.angle) * a.orbitR;
    const ay = Math.sin(a.angle) * a.orbitR;
    const dx = ax - px;
    const dy = ay - py;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d < range && d > 1) {
      const push = (1 - d / range) * 85;
      const nx = ax + (dx / d) * push;
      const ny = ay + (dy / d) * push;
      a.orbitR = clamp(Math.sqrt(nx * nx + ny * ny), PLAYER_MIN_R, PLAYER_MAX_R);
      a.angle = Math.atan2(ny, nx);
    }
  }

  spawnBurst(px, py, '#9dffe4', 18, 240);
}

/* ------------------------- Update logic ------------------------- */
function updateSpawning(dt) {
  game.spawn.asteroid -= dt;
  const maxAsteroids = Math.min(24, 6 + game.level * 2);
  if (game.spawn.asteroid <= 0 && game.asteroids.length < maxAsteroids) {
    spawnAsteroid();
    game.spawn.asteroid = Math.max(0.38, 1.5 - game.level * 0.1);
  }

  game.spawn.orb -= dt;
  const maxOrbs = Math.min(9, 3 + game.level);
  if (game.spawn.orb <= 0 && game.orbs.length < maxOrbs) {
    game.spawn.orb = spawnOrb() ? Math.max(0.35, 1.05 - game.level * 0.05) : 0.25;
  }
}

function collectOrb(x, y) {
  game.score += ORB_SCORE * game.combo;
  spawnBurst(x, y, '#7dffd8', 10, 150);
  Sound.collect(game.combo);
  game.combo = Math.min(game.combo + 1, COMBO_MAX);
  game.comboTimer = COMBO_WINDOW;
  game.shake = Math.min(game.shake + 0.1, 0.35);
  bumpCombo();
}

function destroyAsteroid(index) {
  const a = game.asteroids[index];
  const ap = toXY(a.orbitR, a.angle);
  spawnBurst(ap.x, ap.y, '#b9c9dd', 12, 190);
  spawnBurst(ap.x, ap.y, '#ffd479', 6, 130);
  game.asteroids.splice(index, 1);
  game.score += AST_SCORE;
  game.shake = Math.min(game.shake + 0.12, 0.5);
  Sound.explode();
}

function computeAimAngle(px, py, fallback) {
  if (Input.aim.active) {
    const wx = (Input.aim.x - view.W / 2) / view.scale;
    const wy = (Input.aim.y - view.H / 2) / view.scale;
    const dx = wx - px;
    const dy = wy - py;
    if (dx * dx + dy * dy > 4) return Math.atan2(dy, dx);
  }

  // Gentle auto-aim: lock onto the closest rock when no mouse is in play
  let bestAngle = null;
  let bestDist = AUTOAIM_RANGE * AUTOAIM_RANGE;
  for (let i = 0; i < game.asteroids.length; i++) {
    const a = game.asteroids[i];
    const ax = Math.cos(a.angle) * a.orbitR;
    const ay = Math.sin(a.angle) * a.orbitR;
    const dx = ax - px;
    const dy = ay - py;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestDist) {
      bestDist = d2;
      bestAngle = Math.atan2(dy, dx);
    }
  }
  return bestAngle !== null ? bestAngle : fallback;
}

function update(dt) {
  const pressed = Input.takePressed();

  /* ---- Global (works in every mode) ---- */
  if (pressed.pause) {
    if (ui.settingsOpen) {
      closeSettings();
    } else if (game.mode === 'playing') {
      setPaused(true);
    } else if (game.mode === 'paused') {
      setPaused(false);
    }
  }

  if (pressed.reset) {
    if (game.mode === 'playing' || game.mode === 'paused' || game.mode === 'gameover') {
      startGame();
      return;
    }
  }

  if (game.mode === 'paused') return;

  game.time += dt;
  updateParticles(dt);
  updatePulseRings(dt);
  if (game.shake > 0) game.shake = Math.max(0, game.shake - dt * 2.2);

  /* ---- Idle states ---- */
  if (game.mode !== 'playing') {
    for (let i = 0; i < game.asteroids.length; i++) {
      const a = game.asteroids[i];
      a.angle += a.speed * 0.35 * dt;
      a.spin += a.spinSpeed * 0.5 * dt;
    }
    return;
  }

  /* ---- Difficulty escalation ---- */
  game.elapsed += dt;
  const newLevel = 1 + Math.floor(game.elapsed / LEVEL_DURATION);
  if (newLevel !== game.level) {
    game.level = newLevel;
    Sound.levelUp();
    levelEl.classList.remove('pop');
    void levelEl.offsetWidth;
    levelEl.classList.add('pop');
  }

  /* ---- Ability cooldowns ---- */
  if (game.fireCooldown > 0) game.fireCooldown = Math.max(0, game.fireCooldown - dt);
  if (game.invuln > 0) game.invuln = Math.max(0, game.invuln - dt);
  if (game.dashTime > 0) game.dashTime = Math.max(0, game.dashTime - dt);
  game.abilities.jump = Math.max(0, game.abilities.jump - dt);
  game.abilities.dash = Math.max(0, game.abilities.dash - dt);
  game.abilities.interact = Math.max(0, game.abilities.interact - dt);

  /* ---- Ability inputs (unified, mobile + desktop) ---- */
  if (pressed.jump) tryJump();
  if (pressed.dash) tryDash();

  /* ---- Player: radial thrust + automatic orbit ---- */
  const p = game.player;

  const outAmt = clamp(-Input.moveY, 0, 1);
  const inAmt  = clamp( Input.moveY, 0, 1);
  game.holding = outAmt > 0.15;

  let radialVel;
  if (game.dashTime > 0) {
    radialVel = game.dashDir * DASH_SPEED;
  } else {
    radialVel = outAmt * PLAYER_OUT_SPEED - (1 - outAmt) * PLAYER_IN_SPEED * (1 + inAmt * 0.8);
  }

  let nextR = p.radius + radialVel * dt;
  if (nextR < PLAYER_MIN_R) { nextR = PLAYER_MIN_R; radialVel = 0; }
  if (nextR > PLAYER_MAX_R) { nextR = PLAYER_MAX_R; radialVel = 0; }
  p.radius = nextR;

  const orbitMul = clamp(1 + Input.moveX * 0.7, 0.3, 1.7);
  const orbitRate = PLAYER_ORBIT * orbitMul;

  p.angle += orbitRate * dt;
  if (p.angle > TAU) p.angle -= TAU;
  if (p.angle < 0) p.angle += TAU;

  const cosA = Math.cos(p.angle);
  const sinA = Math.sin(p.angle);
  const px = cosA * p.radius;
  const py = sinA * p.radius;

  /* ---- Heading (velocity-based, refined by aim) ---- */
  const vx = radialVel * cosA - p.radius * orbitRate * sinA;
  const vy = radialVel * sinA + p.radius * orbitRate * cosA;
  const velocityHeading = Math.atan2(vy, vx);

  const aimAngle = computeAimAngle(px, py, velocityHeading);
  let dHead = aimAngle - game.playerHeading;
  while (dHead > Math.PI) dHead -= TAU;
  while (dHead < -Math.PI) dHead += TAU;
  game.playerHeading += dHead * Math.min(1, dt * 16);

  /* ---- Motion trail ---- */
  game.trail.push({ x: px, y: py });
  const maxTrail = game.dashTime > 0 ? 22 : 14;
  while (game.trail.length > maxTrail) game.trail.shift();

  /* ---- Firing ---- */
  if (Input.down('attack') && game.fireCooldown <= 0) {
    fireBullet(px, py, game.playerHeading);
    game.fireCooldown = FIRE_CD;
  }

  /* ---- Interact / pulse (needs a fresh ship position) ---- */
  if (pressed.interact) tryPulse(px, py);

  /* ---- Asteroids ---- */
  const speedMul = 1 + (game.level - 1) * 0.09;
  for (let i = 0; i < game.asteroids.length; i++) {
    const a = game.asteroids[i];
    a.angle += a.speed * speedMul * dt;
    a.spin += a.spinSpeed * dt;
    if (a.flash > 0) a.flash = Math.max(0, a.flash - dt);
  }

  /* ---- Bullets ---- */
  for (let i = game.bullets.length - 1; i >= 0; i--) {
    const b = game.bullets[i];
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.life -= dt;

    if (b.life <= 0 || Math.sqrt(b.x * b.x + b.y * b.y) > FIELD_R + 80) {
      game.bullets.splice(i, 1);
      continue;
    }

    let consumed = false;
    for (let j = game.asteroids.length - 1; j >= 0; j--) {
      const a = game.asteroids[j];
      const ax = Math.cos(a.angle) * a.orbitR;
      const ay = Math.sin(a.angle) * a.orbitR;
      const dx = ax - b.x;
      const dy = ay - b.y;
      const rr = a.size * 0.85 + BULLET_R;
      if (dx * dx + dy * dy < rr * rr) {
        game.bullets.splice(i, 1);
        consumed = true;
        a.hp -= 1;
        a.flash = 0.12;
        if (a.hp <= 0) {
          destroyAsteroid(j);
        } else {
          spawnBurst(b.x, b.y, '#ffd479', 5, 120);
          Sound.hit();
        }
        break;
      }
    }
    if (consumed) continue;
  }

  /* ---- Collisions: asteroids vs player ---- */
  const invulnerable = game.invuln > 0 || game.dashTime > 0;
  for (let i = game.asteroids.length - 1; i >= 0; i--) {
    const a = game.asteroids[i];
    const ax = Math.cos(a.angle) * a.orbitR;
    const ay = Math.sin(a.angle) * a.orbitR;
    const dx = ax - px;
    const dy = ay - py;
    const hitR = a.size * 0.8 + PLAYER_HIT_R;
    if (dx * dx + dy * dy < hitR * hitR) {
      if (game.dashTime > 0) {
        destroyAsteroid(i);
        continue;
      }
      if (invulnerable) continue;
      die(px, py);
      return;
    }
  }

  /* ---- Collisions: orbs ---- */
  for (let i = game.orbs.length - 1; i >= 0; i--) {
    const o = game.orbs[i];
    const ox = Math.cos(o.angle) * o.orbitR;
    const oy = Math.sin(o.angle) * o.orbitR;
    const dx = ox - px;
    const dy = oy - py;
    if (dx * dx + dy * dy < ORB_COLLECT_R * ORB_COLLECT_R) {
      collectOrb(ox, oy);
      game.orbs.splice(i, 1);
    }
  }

  /* ---- Combo decay ---- */
  if (game.comboTimer > 0) {
    game.comboTimer -= dt;
    if (game.comboTimer <= 0) {
      game.comboTimer = 0;
      game.combo = 1;
    }
  }

  updateSpawning(dt);
  syncHUD();
}

/* ------------------------- HUD / UI refs ------------------------- */
const scoreEl = document.getElementById('scoreEl');
const levelEl = document.getElementById('levelEl');
const comboEl = document.getElementById('comboEl');
const finalScoreEl = document.getElementById('finalScoreEl');
const bestScoreEl = document.getElementById('bestScoreEl');
const finalLevelEl = document.getElementById('finalLevelEl');
const newBestEl = document.getElementById('newBestEl');

const startScreen = document.getElementById('startScreen');
const overScreen = document.getElementById('overScreen');
const pauseScreen = document.getElementById('pauseScreen');
const settingsScreen = document.getElementById('settingsScreen');
const touchControls = document.getElementById('touchControls');

const abFire = document.getElementById('abFire');
const abJump = document.getElementById('abJump');
const abDash = document.getElementById('abDash');
const abPulse = document.getElementById('abPulse');

let lastScore = -1;
let lastLevel = -1;
let lastCombo = -1;
let lastAimActive = null;

function syncHUD(force) {
  if (force || game.score !== lastScore) {
    scoreEl.textContent = String(game.score);
    lastScore = game.score;
  }
  if (force || game.level !== lastLevel) {
    levelEl.textContent = String(game.level);
    lastLevel = game.level;
  }
  if (force || game.combo !== lastCombo) {
    comboEl.textContent = 'x' + game.combo;
    comboEl.classList.toggle('show', game.combo > 1 && game.mode === 'playing');
    lastCombo = game.combo;
  }
}

function bumpCombo() {
  comboEl.classList.remove('bump');
  void comboEl.offsetWidth;
  comboEl.classList.add('bump');
}

/* ------------------------- Cooldown UI ------------------------- */
const touchBtnMap = {};

function cacheTouchButtons() {
  document.querySelectorAll('.tbtn[data-action]').forEach(function (btn) {
    const action = btn.dataset.action;
    if (action === 'pause') return;
    touchBtnMap[action] = btn;
  });
}

function setCd(el, value) {
  if (!el) return;
  el.style.setProperty('--cd', String(clamp(value, 0, 1)));
}

function syncAbilities() {
  const fireCd  = FIRE_CD > 0 ? game.fireCooldown / FIRE_CD : 0;
  const jumpCd  = game.abilities.jump / JUMP_CD;
  const dashCd  = game.abilities.dash / DASH_CD;
  const pulseCd = game.abilities.interact / PULSE_CD;

  setCd(abFire, fireCd);
  setCd(abJump, jumpCd);
  setCd(abDash, dashCd);
  setCd(abPulse, pulseCd);

  setCd(touchBtnMap.attack, fireCd);
  setCd(touchBtnMap.jump, jumpCd);
  setCd(touchBtnMap.dash, dashCd);
  setCd(touchBtnMap.interact, pulseCd);
}

/* ------------------------- Screens ------------------------- */
function updateScreens() {
  startScreen.classList.toggle('hidden', game.mode !== 'start');
  overScreen.classList.toggle('hidden', !(game.mode === 'gameover' && ui.overVisible));
  pauseScreen.classList.toggle('hidden', game.mode !== 'paused');
  settingsScreen.classList.toggle('hidden', !ui.settingsOpen);

  const showTouch = Device.touchControlsEnabled();
  document.body.classList.toggle('touch-mode', showTouch);
  touchControls.classList.toggle('visible', game.mode === 'playing' && showTouch);
}

function openSettings(from) {
  ui.settingsFrom = from || (game.mode === 'paused' ? 'pause' : 'start');
  ui.settingsOpen = true;
  Input.resetAll();
  Sound.ensure();
  Sound.ui();
  updateScreens();
}

function closeSettings() {
  ui.settingsOpen = false;
  Input.resetAll();
  Sound.ui();
  if (ui.settingsFrom === 'pause' && game.mode === 'paused') {
    lastTime = performance.now();
  }
  updateScreens();
}

/* ------------------------- Settings UI ------------------------- */
function buildBindingRows() {
  const list = document.getElementById('bindList');
  list.innerHTML = '';

  Input.BINDING_ORDER.forEach(function (action) {
    const row = document.createElement('div');
    row.className = 'bind-row';

    const label = document.createElement('span');
    label.className = 'bind-label';
    label.textContent = Input.BINDING_LABELS[action];

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'bind-btn';
    btn.dataset.action = action;
    btn.textContent = Input.getBindingLabel(action);

    btn.addEventListener('click', function () {
      Input.captureNextKey(function (code) {
        Input.setBinding(action, code);
        Sound.ensure();
        Sound.ui();
        refreshBindingRows();
      });
      refreshBindingRows();
      btn.classList.add('listening');
      btn.textContent = 'PRESS KEY…';
    });

    row.appendChild(label);
    row.appendChild(btn);
    list.appendChild(row);
  });
}

function refreshBindingRows() {
  const buttons = document.querySelectorAll('#bindList .bind-btn');
  buttons.forEach(function (btn) {
    btn.classList.remove('listening');
    btn.textContent = Input.getBindingLabel(btn.dataset.action);
  });
  refreshKeyHints();
}

function refreshKeyHints() {
  const hints = document.querySelectorAll('[data-hint]');
  hints.forEach(function (el) {
    const action = el.dataset.hint;
    if (action === 'attack') {
      el.textContent = 'LMB / ' + Input.getBindingLabel('attack');
    } else {
      el.textContent = Input.getBindingLabel(action);
    }
  });
}

function syncSettingsUI() {
  const joy = document.getElementById('joySens');
  const joyVal = document.getElementById('joySensVal');
  const mouse = document.getElementById('mouseSens');
  const mouseVal = document.getElementById('mouseSensVal');

  joy.value = String(Settings.joystickSensitivity);
  joyVal.textContent = Settings.joystickSensitivity.toFixed(2);
  mouse.value = String(Settings.mouseSensitivity);
  mouseVal.textContent = Settings.mouseSensitivity.toFixed(2);

  document.querySelectorAll('#touchSeg button').forEach(function (b) {
    b.classList.toggle('active', b.dataset.val === Settings.showTouchControls);
  });

  const hint = document.getElementById('deviceHint');
  hint.textContent = Device.touchCapable
    ? 'Touchscreen detected — both touch and keyboard/mouse are active.'
    : 'No touchscreen detected — the on-screen pad is available for testing.';
}

/* ------------------------- Rendering ------------------------- */
function render() {
  const t = game.time;

  /* --- Background --- */
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const bg = ctx.createRadialGradient(
    view.W / 2, view.H / 2, 0,
    view.W / 2, view.H / 2, Math.max(view.W, view.H) * 0.72
  );
  bg.addColorStop(0, '#0b1424');
  bg.addColorStop(0.55, '#060a14');
  bg.addColorStop(1, '#020308');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, view.W, view.H);

  /* --- World transform --- */
  const s = view.scale * view.dpr;
  let shx = 0, shy = 0;
  if (game.shake > 0) {
    shx = (Math.random() - 0.5) * game.shake * 16;
    shy = (Math.random() - 0.5) * game.shake * 16;
  }
  ctx.setTransform(
    s, 0, 0, s,
    view.dpr * view.W / 2 + shx * s,
    view.dpr * view.H / 2 + shy * s
  );

  /* --- Stars --- */
  for (let i = 0; i < game.stars.length; i++) {
    const st = game.stars[i];
    const twinkle = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * st.tw + st.phase));
    ctx.globalAlpha = st.a * twinkle;
    ctx.fillStyle = '#cfe6ff';
    ctx.beginPath();
    ctx.arc(st.x, st.y, st.r, 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  /* --- Field boundary --- */
  ctx.strokeStyle = 'rgba(90,160,255,0.16)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, 0, FIELD_R, 0, TAU);
  ctx.stroke();

  /* --- Orbit guides --- */
  ctx.strokeStyle = 'rgba(90,160,255,0.07)';
  ctx.lineWidth = 1;
  for (let i = 1; i <= 3; i++) {
    ctx.beginPath();
    ctx.arc(0, 0, (FIELD_R * i) / 4, 0, TAU);
    ctx.stroke();
  }

  /* --- Core --- */
  const pulse = 1 + Math.sin(t * 2.6) * 0.05;
  const coreGlow = ctx.createRadialGradient(0, 0, 0, 0, 0, CORE_R * 3.2 * pulse);
  coreGlow.addColorStop(0, 'rgba(140,235,255,0.55)');
  coreGlow.addColorStop(0.35, 'rgba(60,150,255,0.24)');
  coreGlow.addColorStop(1, 'rgba(20,60,160,0)');
  ctx.fillStyle = coreGlow;
  ctx.beginPath();
  ctx.arc(0, 0, CORE_R * 3.2 * pulse, 0, TAU);
  ctx.fill();

  const coreBody = ctx.createRadialGradient(-CORE_R * 0.3, -CORE_R * 0.3, 0, 0, 0, CORE_R * pulse);
  coreBody.addColorStop(0, '#eafcff');
  coreBody.addColorStop(0.5, '#63c9ff');
  coreBody.addColorStop(1, '#1b4fa8');
  ctx.fillStyle = coreBody;
  ctx.beginPath();
  ctx.arc(0, 0, CORE_R * pulse, 0, TAU);
  ctx.fill();

  /* --- Player orbit ring --- */
  if (game.mode === 'playing') {
    ctx.strokeStyle = 'rgba(125,255,216,0.10)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(0, 0, game.player.radius, 0, TAU);
    ctx.stroke();
  }

  /* --- Orbs --- */
  for (let i = 0; i < game.orbs.length; i++) {
    const o = game.orbs[i];
    const op = toXY(o.orbitR, o.angle);
    const opulse = 1 + Math.sin(t * 4 + o.phase) * 0.16;

    ctx.save();
    ctx.translate(op.x, op.y);

    const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, ORB_R * 4.5 * opulse);
    glow.addColorStop(0, 'rgba(125,255,216,0.5)');
    glow.addColorStop(1, 'rgba(60,255,200,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, 0, ORB_R * 4.5 * opulse, 0, TAU);
    ctx.fill();

    ctx.fillStyle = '#c8fff2';
    ctx.beginPath();
    ctx.arc(0, 0, ORB_R * opulse, 0, TAU);
    ctx.fill();

    ctx.restore();
  }

  /* --- Asteroids --- */
  for (let i = 0; i < game.asteroids.length; i++) {
    const a = game.asteroids[i];
    const ap = toXY(a.orbitR, a.angle);
    ctx.save();
    ctx.translate(ap.x, ap.y);
    ctx.rotate(a.spin);

    ctx.beginPath();
    for (let k = 0; k < a.shape.length; k++) {
      const pt = a.shape[k];
      const x = Math.cos(pt.a) * pt.r;
      const y = Math.sin(pt.a) * pt.r;
      if (k === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();

    ctx.fillStyle = a.flash > 0 ? '#b8c8dc' : '#4a5568';
    ctx.fill();
    ctx.strokeStyle = a.flash > 0 ? '#ffffff' : '#8fa3bd';
    ctx.lineWidth = 1.6;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(-a.size * 0.25, -a.size * 0.25, a.size * 0.22, 0, TAU);
    ctx.fillStyle = 'rgba(190,210,235,0.22)';
    ctx.fill();

    ctx.restore();
  }

  /* --- Bullets --- */
  for (let i = 0; i < game.bullets.length; i++) {
    const b = game.bullets[i];
    ctx.fillStyle = 'rgba(255,220,140,0.35)';
    ctx.beginPath();
    ctx.arc(b.x, b.y, 7, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#ffe9a8';
    ctx.beginPath();
    ctx.arc(b.x, b.y, 3.2, 0, TAU);
    ctx.fill();
  }

  /* --- Pulse rings --- */
  for (let i = 0; i < game.pulseRings.length; i++) {
    const r = game.pulseRings[i];
    const f = 1 - r.life / r.maxLife;
    ctx.globalAlpha = Math.max(0, 1 - f) * 0.85;
    ctx.strokeStyle = '#7dffd8';
    ctx.lineWidth = 4 * (1 - f) + 1;
    ctx.beginPath();
    ctx.arc(r.x, r.y, PULSE_RADIUS * f, 0, TAU);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  /* --- Player --- */
  if (game.mode === 'playing' || game.mode === 'gameover') {
    const p = game.player;
    const pp = toXY(p.radius, p.angle);

    if (game.trail.length > 1) {
      for (let i = 1; i < game.trail.length; i++) {
        const f = i / game.trail.length;
        ctx.strokeStyle = game.dashTime > 0
          ? 'rgba(255,210,130,' + (f * 0.7).toFixed(3) + ')'
          : 'rgba(90,210,255,' + (f * 0.5).toFixed(3) + ')';
        ctx.lineWidth = f * (game.dashTime > 0 ? 6.5 : 4.5);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(game.trail[i - 1].x, game.trail[i - 1].y);
        ctx.lineTo(game.trail[i].x, game.trail[i].y);
        ctx.stroke();
      }
    }

    ctx.save();
    ctx.translate(pp.x, pp.y);
    ctx.rotate(game.playerHeading);

    if (game.invuln > 0 || game.dashTime > 0) {
      ctx.globalAlpha = 0.45 + 0.55 * Math.abs(Math.sin(t * 22));
    }

    ctx.shadowBlur = 18;
    ctx.shadowColor = game.dashTime > 0 ? '#ffd479' : '#4fd2ff';
    ctx.fillStyle = game.dashTime > 0 ? '#fff0c9' : '#eaf9ff';
    ctx.beginPath();
    ctx.moveTo(14, 0);
    ctx.lineTo(-9, -8);
    ctx.lineTo(-5, 0);
    ctx.lineTo(-9, 8);
    ctx.closePath();
    ctx.fill();

    if (game.holding || game.dashTime > 0) {
      ctx.fillStyle = 'rgba(125,255,216,0.85)';
      ctx.beginPath();
      ctx.moveTo(-6, -3.5);
      ctx.lineTo(-16 - Math.random() * 8, 0);
      ctx.lineTo(-6, 3.5);
      ctx.closePath();
      ctx.fill();
    }

    ctx.restore();
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
  }

  /* --- Particles --- */
  for (let i = 0; i < game.particles.length; i++) {
    const pt = game.particles[i];
    const alpha = Math.max(0, pt.life / pt.maxLife);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = pt.color;
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, pt.r * alpha, 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/* ------------------------- Main loop ------------------------- */
let lastTime = performance.now();

function loop(now) {
  const dt = Math.min((now - lastTime) / 1000, 0.05);
  lastTime = now;

  Input.refresh();
  update(dt);
  render();
  syncAbilities();

  requestAnimationFrame(loop);
}

/* Catalog: auto-pause saat tab disembunyikan */
document.addEventListener('visibilitychange', function () {
  if (document.hidden && game.mode === 'playing') {
    game.mode = 'paused';
    updateScreens();
  }
});

/* ------------------------- Wiring ------------------------- */
function wireUI() {
  document.getElementById('startBtn').addEventListener('click', startGame);
  document.getElementById('restartBtn').addEventListener('click', startGame);
  document.getElementById('resumeBtn').addEventListener('click', function () { setPaused(false); });
  document.getElementById('restartFromPauseBtn').addEventListener('click', startGame);

  document.getElementById('settingsFromStartBtn').addEventListener('click', function () { openSettings('start'); });
  document.getElementById('settingsFromOverBtn').addEventListener('click', function () { openSettings('over'); });
  document.getElementById('settingsFromPauseBtn').addEventListener('click', function () { openSettings('pause'); });

  document.getElementById('settingsBackBtn').addEventListener('click', closeSettings);
  document.getElementById('resetBindingsBtn').addEventListener('click', function () {
    Input.resetBindings();
    refreshBindingRows();
    Sound.ui();
  });

  const joy = document.getElementById('joySens');
  joy.addEventListener('input', function () {
    Settings.joystickSensitivity = parseFloat(joy.value);
    document.getElementById('joySensVal').textContent = Settings.joystickSensitivity.toFixed(2);
    Settings.save();
  });

  const mouse = document.getElementById('mouseSens');
  mouse.addEventListener('input', function () {
    Settings.mouseSensitivity = parseFloat(mouse.value);
    document.getElementById('mouseSensVal').textContent = Settings.mouseSensitivity.toFixed(2);
    Settings.save();
  });

  document.querySelectorAll('#touchSeg button').forEach(function (b) {
    b.addEventListener('click', function () {
      Settings.showTouchControls = b.dataset.val;
      Settings.save();
      syncSettingsUI();
      updateScreens();
      Sound.ui();
    });
  });

  // Menu buttons should be keyboard-reachable and respond to Enter/Space natively.
  document.querySelectorAll('.btn, .bind-btn').forEach(function (b) {
    b.addEventListener('pointerenter', function () {
      if (b.classList.contains('bind-btn') && b.classList.contains('listening')) return;
    });
  });

  // Block browser context menus on the play surface
  canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  document.addEventListener('contextmenu', function (e) {
    if (game.mode === 'playing') e.preventDefault();
  });
}

/* ------------------------- Boot ------------------------- */
function boot() {
  Input.attach(canvas);
  cacheTouchButtons();
  buildBindingRows();
  refreshKeyHints();
  syncSettingsUI();
  wireUI();

  Input.onBindingsChanged = function () {
    refreshBindingRows();
  };

  window.addEventListener('resize', function () {
    resize();
  });

  window.addEventListener('orientationchange', function () {
    setTimeout(resize, 150);
  });

  // React to input-capability changes (e.g. a stylus/touchscreen being used)
  window.addEventListener('pointerdown', function (e) {
    if (e.pointerType === 'touch') {
      document.body.classList.add('touch-mode');
    }
  }, { passive: true, capture: true });

  try {
    const saved = localStorage.getItem('orbitWeaverBest');
    if (saved) game.best = parseInt(saved, 10) || 0;
  } catch (e) { /* ignore */ }

  resize();

  resetRun();
  game.mode = 'start';
  syncHUD(true);
  updateScreens();

  requestAnimationFrame(loop);
}

boot();

})();
