// Tennis TV — gioco che gira sulla TV. I telefoni si collegano via WebRTC (PeerJS)
// e fanno da racchetta: inviano l'orientamento (la racchetta a schermo lo segue)
// e gli swing rilevati da giroscopio/accelerometro.
import * as THREE from '../vendor/three.module.min.js';
import { PEER_PREFIX, PEER_OPTIONS, PLAYER_COLORS, PLAYER_COLOR_NAMES } from './config.js';

// ---------------------------------------------------------------------------
// Costanti (metri, secondi). Asse x = larghezza campo, z = lunghezza, y = alto.
// Il giocatore 0 sta in basso (z > 0, vicino alla telecamera), il giocatore 1 in fondo.
// ---------------------------------------------------------------------------
const HALF_W = 4.115;          // metà larghezza campo singolo
const HALF_L = 11.885;         // metà lunghezza campo
const SERVICE_Z = 6.40;        // distanza della linea del servizio dalla rete
const NET_H = 0.95;            // altezza rete
const NET_HALF = HALF_W + 0.914;
const G = 9.81;
const SPIN_G = 5;              // accelerazione extra verso il basso per il top spin
const BALL_R = 0.033;
const STEP = 1 / 120;          // passo della fisica
const REACH = 1.8;             // distanza laterale massima palla-giocatore per colpire
const HUMAN_SPEED = 7.2;
const DIFF = [
  { name: 'Facile', speed: 5.0, hitProb: 0.8, err: 1.35, maxPow: 0.5, readsOut: 0.3 },
  { name: 'Normale', speed: 6.2, hitProb: 0.92, err: 1.0, maxPow: 0.75, readsOut: 0.7 },
  { name: 'Difficile', speed: 7.4, hitProb: 0.985, err: 0.7, maxPow: 0.95, readsOut: 0.95 },
];
const PTS = ['0', '15', '30', '40'];
const PTS_SPOKEN = ['zero', 'quindici', 'trenta', 'quaranta'];

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, k) => a + (b - a) * k;
const ease = k => k * k * (3 - 2 * k);
const gauss = () => (Math.random() + Math.random() + Math.random() + Math.random() - 2) * 1.73;
const now = () => performance.now() / 1000;
const $ = id => document.getElementById(id);

// ---------------------------------------------------------------------------
// Audio (sintetizzato, nessun file esterno) e voce dell'arbitro
// ---------------------------------------------------------------------------
let actx = null, noiseBuf = null;
function unlockAudio() {
  try {
    if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
  } catch (e) { /* audio non disponibile */ }
  $('audioHint').hidden = true;
}
addEventListener('pointerdown', unlockAudio);
addEventListener('keydown', unlockAudio);

function noise() {
  if (!noiseBuf) {
    noiseBuf = actx.createBuffer(1, actx.sampleRate * 0.6, actx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return noiseBuf;
}
function tone(t, type, f0, f1, dur, vol) {
  const o = actx.createOscillator(), g = actx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  g.gain.setValueAtTime(Math.max(vol, 0.002), t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(actx.destination);
  o.start(t); o.stop(t + dur + 0.02);
}
function burst(t, dur, freq, vol) {
  const s = actx.createBufferSource(), f = actx.createBiquadFilter(), g = actx.createGain();
  s.buffer = noise();
  f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 0.9;
  g.gain.setValueAtTime(Math.max(vol, 0.002), t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  s.connect(f).connect(g).connect(actx.destination);
  s.start(t, Math.random() * 0.3); s.stop(t + dur + 0.02);
}
function sfx(type, k = 1) {
  if (!actx || actx.state !== 'running' || game.mode !== 'match') return;
  const t = actx.currentTime;
  if (type === 'hit') { tone(t, 'triangle', 600, 150, 0.09, 0.25 + 0.35 * k); burst(t, 0.04, 2600, 0.35); }
  else if (type === 'bounce') tone(t, 'sine', 210, 80, 0.07, 0.35 * k);
  else if (type === 'net') burst(t, 0.15, 500, 0.5);
  else if (type === 'toss') tone(t, 'sine', 320, 460, 0.06, 0.12);
  else if (type === 'applause') {
    for (let i = 0; i < 90; i++) burst(t + Math.random() * 1.8 * Math.sqrt(Math.random()), 0.025, 1500 + Math.random() * 1500, 0.08 + Math.random() * 0.12 * k);
  }
}
function say(text) {
  if (game.mode !== 'match' || !('speechSynthesis' in window)) return;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'it-IT'; u.rate = 1.05;
    speechSynthesis.speak(u);
  } catch (e) { /* voce non disponibile */ }
}

// ---------------------------------------------------------------------------
// Scena 3D
// ---------------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
$('stage').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8fd3ff);
scene.fog = new THREE.Fog(0x8fd3ff, 60, 140);
const camera = new THREE.PerspectiveCamera(48, innerWidth / innerHeight, 0.5, 300);
camera.position.set(0, 5.2, HALF_L + 8.5);
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});

scene.add(new THREE.HemisphereLight(0xffffff, 0x51804a, 1.7));
const sun = new THREE.DirectionalLight(0xffffff, 1.9);
sun.position.set(-10, 25, 12);
scene.add(sun);

const lambert = color => new THREE.MeshLambertMaterial({ color });
function flat(w, d, mat, x, y, z) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, y, z);
  scene.add(m);
  return m;
}
function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function buildCourt() {
  flat(220, 220, lambert(0x5aa548), 0, 0, 0);
  flat(2 * HALF_W + 9, 2 * HALF_L + 13, lambert(0x3d8a5a), 0, 0.004, 0);
  flat(2 * HALF_W, 2 * HALF_L, lambert(0x2f6fb3), 0, 0.008, 0);
  const white = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const LW = 0.06;
  for (const s of [-1, 1]) {
    flat(2 * HALF_W + LW, LW * 1.6, white, 0, 0.012, s * HALF_L);   // linee di fondo
    flat(LW, 2 * HALF_L, white, s * HALF_W, 0.012, 0);              // linee laterali
    flat(2 * HALF_W, LW, white, 0, 0.012, s * SERVICE_Z);           // linee del servizio
    flat(LW, 0.25, white, 0, 0.012, s * (HALF_L - 0.12));           // segni centrali
  }
  flat(LW, 2 * SERVICE_Z, white, 0, 0.012, 0);                      // linea centrale del servizio

  // Rete
  const netTex = canvasTex(256, 64, (g, w, h) => {
    g.strokeStyle = 'rgba(25,25,25,0.9)';
    g.lineWidth = 2;
    for (let x = 0; x <= w; x += 8) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
    for (let y = 0; y <= h; y += 8) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
  });
  netTex.wrapS = THREE.RepeatWrapping;
  netTex.repeat.set(5, 1);
  const net = new THREE.Mesh(new THREE.PlaneGeometry(2 * NET_HALF, NET_H),
    new THREE.MeshBasicMaterial({ map: netTex, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
  net.position.set(0, NET_H / 2, 0);
  scene.add(net);
  const tape = new THREE.Mesh(new THREE.BoxGeometry(2 * NET_HALF, 0.07, 0.03), lambert(0xffffff));
  tape.position.set(0, NET_H, 0);
  scene.add(tape);
  for (const s of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.07, 10), lambert(0x30343a));
    post.position.set(s * NET_HALF, 0.535, 0);
    scene.add(post);
  }

  // Tribune col pubblico
  const crowd = canvasTex(512, 128, (g, w, h) => {
    g.fillStyle = '#3a4250'; g.fillRect(0, 0, w, h);
    const cols = ['#e53935', '#fdd835', '#1e88e5', '#fafafa', '#43a047', '#8e24aa', '#fb8c00', '#f2c9a0', '#6d4c41'];
    for (let y = 5; y < h; y += 10) for (let x = 3; x < w; x += 8) {
      g.fillStyle = cols[(Math.random() * cols.length) | 0];
      g.beginPath(); g.arc(x + Math.random() * 2, y + Math.random() * 2, 3.2, 0, 7); g.fill();
    }
  });
  crowd.wrapS = crowd.wrapT = THREE.RepeatWrapping;
  crowd.repeat.set(7, 3);
  const standMat = new THREE.MeshLambertMaterial({ map: crowd });
  const addStand = (x, z, rotY, len) => {
    const grp = new THREE.Group();
    const p = new THREE.Mesh(new THREE.PlaneGeometry(len, 16), standMat);
    p.rotation.x = -Math.PI / 4;
    grp.add(p);
    grp.position.set(x, 6.8, z);
    grp.rotation.y = rotY;
    scene.add(grp);
  };
  addStand(0, -(HALF_L + 15), 0, 60);
  addStand(-(HALF_W + 13), 0, Math.PI / 2, 70);
  addStand(HALF_W + 13, 0, -Math.PI / 2, 70);

  const ads = canvasTex(1024, 64, (g, w, h) => {
    g.fillStyle = '#1f5f3a'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#e8f5e9'; g.font = 'bold 40px Trebuchet MS, sans-serif'; g.textBaseline = 'middle';
    for (let x = 20; x < w; x += 256) g.fillText('TENNIS TV', x, h / 2);
  });
  ads.wrapS = THREE.RepeatWrapping;
  const wallMat = new THREE.MeshLambertMaterial({ map: ads });
  const wall = (w, x, z, rotY) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, 1.1), wallMat);
    m.position.set(x, 0.55, z);
    m.rotation.y = rotY;
    scene.add(m);
  };
  wall(2 * HALF_W + 9, 0, -(HALF_L + 6.5), 0);
  wall(2 * HALF_L + 13, -(HALF_W + 4.5), 0, Math.PI / 2);
  wall(2 * HALF_L + 13, HALF_W + 4.5, 0, -Math.PI / 2);
}
buildCourt();

const shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false });
function blob(r) {
  const m = new THREE.Mesh(new THREE.CircleGeometry(r, 20), shadowMat);
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.02;
  scene.add(m);
  return m;
}

// Omino stile "Mii": testa grande, mani fluttuanti, racchetta che ruota attorno alla spalla.
// La racchetta punta lungo -z locale (come la parte alta del telefono) e la sua faccia è perpendicolare a y locale (lo schermo).
function makePlayerMesh(color, hairColor) {
  const g = new THREE.Group();
  const skin = lambert(0xf3cfa8), shirt = lambert(color), white = lambert(0xf5f5f5), dark = lambert(0x262626);
  const add = (geo, mat, x, y, z, parent = g) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); parent.add(m); return m; };

  add(new THREE.CapsuleGeometry(0.24, 0.42, 6, 14), shirt, 0, 1.02, 0);
  const legs = [-1, 1].map(s => {
    const pivot = new THREE.Group();
    pivot.position.set(s * 0.11, 0.72, 0);
    g.add(pivot);
    add(new THREE.CapsuleGeometry(0.085, 0.42, 4, 8), white, 0, -0.32, 0, pivot);
    add(new THREE.BoxGeometry(0.14, 0.08, 0.24), dark, 0, -0.66, -0.04, pivot);
    return pivot;
  });
  add(new THREE.SphereGeometry(0.21, 20, 14), skin, 0, 1.63, 0);
  const hair = add(new THREE.SphereGeometry(0.225, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.52), lambert(hairColor), 0, 1.64, 0.015);
  hair.rotation.x = -0.25;
  for (const s of [-1, 1]) add(new THREE.SphereGeometry(0.026, 8, 6), dark, s * 0.075, 1.66, -0.19);
  add(new THREE.SphereGeometry(0.03, 8, 6), skin, 0, 1.6, -0.215);
  const freeHand = add(new THREE.SphereGeometry(0.065, 10, 8), skin, -0.36, 1.0, -0.1);

  const pivot = new THREE.Group();
  pivot.position.set(0.3, 1.2, -0.05);
  g.add(pivot);
  add(new THREE.SphereGeometry(0.07, 10, 8), skin, 0, 0, -0.32, pivot);
  const handle = add(new THREE.CylinderGeometry(0.02, 0.022, 0.26, 8), dark, 0, 0, -0.48, pivot);
  handle.rotation.x = Math.PI / 2;
  const head = new THREE.Group();
  head.position.set(0, 0, -0.78);
  head.scale.set(1, 1, 1.3);
  pivot.add(head);
  const frame = add(new THREE.TorusGeometry(0.135, 0.016, 8, 28), lambert(color), 0, 0, 0, head);
  frame.rotation.x = Math.PI / 2;
  const strings = add(new THREE.CircleGeometry(0.135, 24),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45, side: THREE.DoubleSide }), 0, 0, 0, head);
  strings.rotation.x = -Math.PI / 2;

  scene.add(g);
  return { group: g, pivot, freeHand, legs, shadow: blob(0.45) };
}

// Palla (disegnata più grande del vero per vederla bene sulla TV)
const ballMesh = new THREE.Mesh(new THREE.SphereGeometry(0.075, 16, 12),
  new THREE.MeshLambertMaterial({ color: 0xdcf23a, emissive: 0x2a3000 }));
scene.add(ballMesh);
const ballShadow = blob(0.08);

// ---------------------------------------------------------------------------
// Stato del gioco
// ---------------------------------------------------------------------------
const ball = {
  pos: new THREE.Vector3(), vel: new THREE.Vector3(), spin: 0,
  held: true, tossed: false, tossTime: 0, serving: false, bounces: 0, lastHitter: 0, hitNet: false,
};

const players = [0, 1].map(i => ({
  idx: i,
  f: i === 0 ? -1 : 1,                 // direzione (in z) verso l'avversario
  pos: new THREE.Vector3(0, 0, i === 0 ? HALF_L + 0.5 : -HALF_L - 0.5),
  target: new THREE.Vector3(0, 0, i === 0 ? HALF_L + 0.5 : -HALF_L - 0.5),
  mesh: makePlayerMesh(PLAYER_COLORS[i], i === 0 ? 0x5d3a1a : 0x222222),
  hand: 'R', speed: 0, walk: 0, anim: null,
  pending: null, lastCross: null, cpuLetGo: false,
  // rete / telefono
  conn: null, clientId: null, connected: false, name: '',
  q: new THREE.Quaternion(), hasOrient: false, calibPhi: 0, needCalib: true, tipHist: [],
}));
players[1].mesh.group.rotation.y = Math.PI;

const game = {
  mode: 'demo',          // 'demo' (CPU contro CPU dietro la lobby) | 'match'
  state: 'serve',        // serve | rally | pointOver | faultPause | matchOver
  opts: { games: 3, diff: 1 },
  points: [0, 0], games: [0, 0], server: 0, faults: 0,
  timer: 0, cpuServeT: 0, retargetT: 0,
};

const isCPU = p => game.mode === 'demo' || (p.idx === 1 && !p.connected);
const rightX = p => -p.f;                                   // la "destra" del giocatore, in x mondo
const handLocal = p => (p.hand === 'L' ? -1 : 1);
const handX = p => handLocal(p) * rightX(p);                // lato della racchetta, in x mondo
const nameOf = i => {
  const p = players[i];
  if (p.connected) return p.name;
  if (game.mode === 'demo') return i === 0 ? 'Rossi' : 'Bianchi';
  return i === 0 ? 'Giocatore 1' : 'CPU';
};
const isDeuceSide = () => (game.points[0] + game.points[1]) % 2 === 0;
const winGames = () => Math.ceil(game.opts.games / 2);
const diff = () => DIFF[game.opts.diff];

function setHand(p, h) {
  p.hand = h === 'L' ? 'L' : 'R';
  const s = handLocal(p);
  p.mesh.pivot.position.x = 0.3 * s;
  p.mesh.freeHand.position.x = -0.36 * s;
}

// ---------------------------------------------------------------------------
// Fisica della palla
// ---------------------------------------------------------------------------
// Avanza la palla di h secondi. Ritorna una maschera: 1 = rimbalzo, 2 = rete.
function stepBall(b, h) {
  b.vel.y -= (G + b.spin * SPIN_G) * h;
  const pz = b.pos.z;
  b.pos.addScaledVector(b.vel, h);
  let ev = 0;
  if (pz !== 0 && Math.sign(pz) !== Math.sign(b.pos.z) && Math.abs(b.pos.x) < NET_HALF && b.pos.y < NET_H + BALL_R) {
    b.pos.z = Math.sign(pz) * 0.08;
    b.vel.set(b.vel.x * 0.3, Math.min(b.vel.y, 0) * 0.3, -b.vel.z * 0.12);
    ev |= 2;
  }
  if (b.pos.y < BALL_R && b.vel.y < 0) {
    const impact = -b.vel.y, s = b.spin;
    b.pos.y = BALL_R;
    b.vel.y = impact > 0.5 ? impact * (0.72 + 0.06 * s) : 0;
    const k = impact > 0.5 ? 0.84 + 0.07 * s : 0.985;
    b.vel.x *= k; b.vel.z *= k;
    b.spin = 0;
    if (impact > 0.5) ev |= 1;
  }
  return ev;
}

// Velocità iniziale per far atterrare la palla in (tx, tz) con velocità orizzontale vh,
// abbassando la velocità finché la traiettoria non supera la rete di almeno "clear" metri.
function solveShot(from, tx, tz, vh, spin, clear) {
  const ge = G + spin * SPIN_G, vel = new THREE.Vector3();
  for (let i = 0; i < 30; i++) {
    const dx = tx - from.x, dz = tz - from.z, T = Math.hypot(dx, dz) / vh;
    const vy = (BALL_R - from.y + 0.5 * ge * T * T) / T;
    vel.set(dx / T, vy, dz / T);
    if (from.z * tz < 0) {
      const tn = Math.abs(from.z / vel.z);
      if (from.y + vy * tn - 0.5 * ge * tn * tn < NET_H + clear && vh > 7) { vh *= 0.94; continue; }
    }
    break;
  }
  return vel;
}

const inCourt = (x, z) => Math.abs(x) <= HALF_W + BALL_R && Math.abs(z) <= HALF_L + BALL_R;

// Dove conviene farsi trovare per colpire: dopo il primo rimbalzo nella propria metà,
// quando la palla scende sotto 1.35 m (oppure molto dietro la linea di fondo).
function predictContact(p) {
  const s = { pos: ball.pos.clone(), vel: ball.vel.clone(), spin: ball.spin };
  let own = 0, first = null;
  for (let i = 0; i < 480; i++) {
    const ev = stepBall(s, STEP);
    const mine = s.pos.z * p.f < 0;
    if (ev & 1) {
      if (!first) first = { x: s.pos.x, z: s.pos.z, out: !mine || !inCourt(s.pos.x, s.pos.z) };
      if (mine && ++own >= 2) break;
    }
    if (mine && own === 1 && s.vel.y < 0 && s.pos.y < 1.35) return { x: s.pos.x, z: s.pos.z, first };
    if (mine && Math.abs(s.pos.z) > HALF_L + 3) return { x: s.pos.x, z: s.pos.z, first };
  }
  return first ? { x: first.x, z: first.z, first } : null;
}

function retarget(p) {
  if (game.state !== 'rally') return;
  if (ball.lastHitter === p.idx) {
    // Torna al centro, dietro la linea di fondo
    p.target.set(clamp(ball.pos.x * 0.15, -1.5, 1.5), 0, -p.f * (HALF_L + 0.6));
    return;
  }
  const c = predictContact(p);
  if (!c) return;
  const fh = (c.x - p.pos.x) * handX(p) >= -0.5;
  p.target.set(
    clamp(c.x - handX(p) * (fh ? 0.85 : -0.85), -HALF_W - 4, HALF_W + 4),
    0,
    -p.f * clamp(Math.abs(c.z), 2.5, HALF_L + 4.5),
  );
}
const retargetAll = () => players.forEach(retarget);

// ---------------------------------------------------------------------------
// Colpi
// ---------------------------------------------------------------------------
// timing: +1 = molto in anticipo (palla incrociata), -1 = molto in ritardo (lungo linea)
// power: 0..1, spin: -1 (slice) .. +1 (top spin)
function doHit(p, timing, power, spin) {
  const errMul = isCPU(p) ? diff().err : 1;
  const hx = handX(p);
  const fh = (ball.pos.x - p.pos.x) * hx >= 0;
  const lob = power < 0.06;
  const err = (0.3 + 1.1 * Math.abs(timing) ** 3 + 0.6 * power * power) * errMul;
  const tx = timing * (fh ? -hx : hx) * 3.3 + gauss() * err * 0.5;
  const depth = lob ? 10.2 : 7.2 + power * 3.2 - Math.max(0, -spin) * 0.8;
  const tz = p.f * (depth + gauss() * err * 0.5);
  const s = lob ? 0.15 : spin;
  const vh = lob ? 11 : 12 + power * 13 + Math.max(0, spin) * 1.5;
  const clear = lob ? 3.2 : 0.25 + Math.max(0, spin) * 0.5 + (1 - power) * 0.4;

  ball.vel.copy(solveShot(ball.pos, tx, tz, vh, s, clear));
  ball.spin = s;
  ball.lastHitter = p.idx;
  ball.bounces = 0;
  ball.serving = false;
  ball.hitNet = false;
  afterHit(p, power);
}

function afterHit(p, power) {
  for (const q of players) { q.pending = null; q.lastCross = null; }
  sfx('hit', 0.4 + power * 0.6);
  sendTo(p, { t: 'hit', s: power });
  retargetAll();
  // La CPU, se è brava, lascia andare le palle che finiranno fuori
  const o = players[1 - p.idx];
  o.cpuLetGo = false;
  if (isCPU(o) && !ball.serving) {
    const c = predictContact(o);
    o.cpuLetGo = !!(c && c.first && c.first.out && Math.random() < diff().readsOut);
  }
}

function serveToss(p) {
  ball.held = false;
  ball.tossed = true;
  ball.tossTime = now();
  ball.pos.set(p.pos.x + handX(p) * 0.25, 1.3, p.pos.z + p.f * 0.35);
  ball.vel.set(0, 5.6, 0);
  ball.spin = 0;
  sfx('toss');
  setHint();
}

function serveHit(p, power) {
  const apexQ = 1 - Math.min(1, Math.abs(ball.vel.y) / 4.5);
  const pf = clamp(0.55 * power + 0.45 * apexQ, 0, 1);
  const sideSign = -rightX(p) * (isDeuceSide() ? 1 : -1);
  const err = (0.25 + 0.55 * (1 - apexQ) + 0.35 * pf * pf) * (isCPU(p) ? diff().err : 1);
  const tx = sideSign * (2.0 + (ball.vel.y / 4.5) * 1.2) + gauss() * err * 0.5;
  const tz = p.f * (4.4 + 1.5 * pf + gauss() * err * 0.4);
  ball.vel.copy(solveShot(ball.pos, tx, tz, 17 + pf * 15, 0.1, 0.12));
  ball.spin = 0.1;
  ball.tossed = false;
  ball.serving = true;
  ball.lastHitter = p.idx;
  ball.bounces = 0;
  ball.hitNet = false;
  if (!p.hasOrient || !p.connected) startAnim(p, 'serve');
  game.state = 'rally';
  setHint();
  afterHit(p, pf);
}

// Swing arrivato da un telefono (o dalla tastiera)
function onSwing(p, power, spin) {
  const t = now();
  if (!(p.connected && p.hasOrient)) startAnim(p, (ball.pos.x - p.pos.x) * handX(p) >= 0 ? 'fh' : 'bh');
  if (game.mode !== 'match') return;
  if (game.state === 'serve' && game.server === p.idx) {
    if (ball.held) serveToss(p);
    else if (ball.tossed && t - ball.tossTime > 0.18 && ball.pos.y > 1.5) serveHit(p, power);
    return;
  }
  if (game.state !== 'rally' || ball.lastHitter === p.idx) return;
  const timingFrom = dt => clamp((dt - 0.06) / 0.26, -1, 1);
  const rel = (ball.pos.z - p.pos.z) * p.f;   // > 0: la palla deve ancora arrivare
  const appr = -ball.vel.z * p.f;
  if (rel > 0) {
    if (appr > 0.5 && rel / appr <= 0.45) p.pending = { time: t, timing: timingFrom(rel / appr), power, spin };
  } else if (p.lastCross && t - p.lastCross.time <= 0.13) {
    // Swing un po' in ritardo: colpisci dal punto in cui la palla era all'altezza del giocatore
    ball.pos.copy(p.lastCross.pos);
    doHit(p, timingFrom(-(t - p.lastCross.time)), power, spin);
  }
}

// Controllo, a ogni passo di fisica, se la palla attraversa il "piano" del giocatore
function checkCrossing(p, prevZ) {
  if (ball.lastHitter === p.idx || game.state !== 'rally') return;
  const r0 = (prevZ - p.pos.z) * p.f, r1 = (ball.pos.z - p.pos.z) * p.f;
  if (!(r0 > 0 && r1 <= 0)) return;
  const reachable = Math.abs(ball.pos.x - p.pos.x) <= REACH && ball.pos.y < 2.7 &&
    ball.pos.z * p.f < 0 && ball.bounces <= 1 && !ball.serving;
  if (!reachable) return;
  if (isCPU(p)) {
    if (p.cpuLetGo || Math.random() > diff().hitProb) return;
    const d = diff();
    doHit(p, (Math.random() * 2 - 1) * 0.8, 0.2 + Math.random() * d.maxPow * 0.8, Math.random() * 1.2 - 0.3);
    return;
  }
  const t = now();
  if (p.pending && t - p.pending.time < 0.6) {
    const pd = p.pending;
    doHit(p, pd.timing, pd.power, pd.spin);
  } else {
    p.lastCross = { time: t, pos: ball.pos.clone() };
  }
}

// ---------------------------------------------------------------------------
// Regole e punteggio
// ---------------------------------------------------------------------------
function onBounce() {
  if (game.state !== 'rally') return;
  const side = ball.pos.z > 0 ? 0 : 1;
  const h = ball.lastHitter, o = 1 - h;
  if (ball.serving) {
    const sideSign = -rightX(players[h]) * (isDeuceSide() ? 1 : -1);
    const inBox = side === o && Math.abs(ball.pos.z) <= SERVICE_Z + BALL_R &&
      ball.pos.x * sideSign >= -BALL_R && Math.abs(ball.pos.x) <= HALF_W + BALL_R;
    if (inBox) { ball.serving = false; ball.bounces = 1; }
    else fault(ball.hitNet ? 'Rete!' : 'Fallo!');
    return;
  }
  if (ball.bounces === 0) {
    if (side === o && inCourt(ball.pos.x, ball.pos.z)) ball.bounces = 1;
    else pointTo(o, side === h && ball.hitNet ? 'Rete!' : 'Fuori!');
  } else {
    pointTo(h, game.mode === 'match' && players[h].connected ? 'Vincente!' : 'Punto!');
  }
}

function fault(reason) {
  game.faults++;
  if (game.faults >= 2) { pointTo(1 - game.server, 'Doppio fallo!'); return; }
  game.state = 'faultPause';
  game.timer = 1.6;
  showMessage(reason, 'Seconda di servizio');
  say(reason === 'Rete!' ? 'Rete. Seconda' : 'Fallo');
}

function scoreLine() {
  const s = game.server, a = game.points[s], b = game.points[1 - s];
  if (a >= 3 && b >= 3) {
    if (a === b) return { text: 'Parità', spoken: 'Parità' };
    const lead = nameOf(a > b ? s : 1 - s);
    return { text: `Vantaggio ${lead}`, spoken: `Vantaggio ${lead}` };
  }
  if (a === b) return { text: `${PTS[a]} pari`, spoken: `${PTS_SPOKEN[a]} pari` };
  return { text: `${PTS[a]} - ${PTS[b]}`, spoken: `${PTS_SPOKEN[a]} ${PTS_SPOKEN[b]}` };
}

function pointTo(w, reason) {
  if (game.state !== 'rally' && game.state !== 'serve' && game.state !== 'faultPause') return;
  game.points[w]++;
  game.timer = 2.6;
  game.state = 'pointOver';
  for (const p of players) p.target.copy(p.pos);
  sfx('applause', 0.8);
  const [a, b] = [game.points[w], game.points[1 - w]];
  if (a >= 4 && a - b >= 2) {
    game.games[w]++;
    game.points = [0, 0];
    game.server = 1 - game.server;
    if (game.games[w] >= winGames()) {
      if (game.mode === 'demo') { game.games = [0, 0]; }
      else {
        game.state = 'matchOver';
        game.timer = 7;
        showMessage('Partita!', `Vince ${nameOf(w)} ${game.games[w]}-${game.games[1 - w]}`, 6.5);
        say(`Partita! Vince ${nameOf(w)}`);
        sfx('applause', 1.4);
        updateHud();
        notifyPhones();
        return;
      }
    }
    showMessage(reason, `Gioco ${nameOf(w)} · ${game.games[0]}-${game.games[1]}`);
    say(`Gioco ${nameOf(w)}`);
  } else {
    const sc = scoreLine();
    showMessage(reason, sc.text);
    say(sc.spoken);
  }
  updateHud();
  notifyPhones();
}

function nextPoint(keepFaults = false) {
  game.state = 'serve';
  if (!keepFaults) game.faults = 0;
  const s = players[game.server], r = players[1 - game.server];
  const side = isDeuceSide() ? 1 : -1;
  s.pos.set(rightX(s) * side * 0.9, 0, -s.f * (HALF_L + 0.35));
  r.pos.set(rightX(r) * side * 2.8, 0, -r.f * (HALF_L + 0.5));
  for (const p of players) {
    p.target.copy(p.pos);
    p.pending = null; p.lastCross = null; p.cpuLetGo = false; p.anim = null;
  }
  Object.assign(ball, { held: true, tossed: false, serving: false, bounces: 0, lastHitter: game.server, hitNet: false, spin: 0 });
  ball.vel.set(0, 0, 0);
  game.cpuServeT = game.mode === 'demo' ? 1.0 : 1.3;
  setHint();
  updateHud();
  notifyPhones();
}

function startMatch() {
  game.mode = 'match';
  game.points = [0, 0];
  game.games = [0, 0];
  game.server = Math.random() < 0.5 ? 0 : 1;
  $('lobby').hidden = true;
  $('hud').hidden = false;
  nextPoint();
  showMessage('Si gioca!', `Al servizio: ${nameOf(game.server)}`);
  say(`Si gioca! Al servizio ${nameOf(game.server)}`);
  sendLobby();
}

function goLobby() {
  game.mode = 'demo';
  game.points = [0, 0];
  game.games = [0, 0];
  $('lobby').hidden = false;
  $('hud').hidden = true;
  $('message').classList.remove('show');
  nextPoint();
  updateLobby();
  sendLobby();
}

// ---------------------------------------------------------------------------
// Animazioni
// ---------------------------------------------------------------------------
function startAnim(p, type) { p.anim = { type, t: 0, dur: type === 'serve' ? 0.42 : 0.32 }; }

const Y_AXIS = new THREE.Vector3(0, 1, 0);
const tmpQ = new THREE.Quaternion(), tmpE = new THREE.Euler(), tmpV = new THREE.Vector3();

function calibratedQuat(p, out) {
  return out.setFromAxisAngle(Y_AXIS, p.calibPhi).multiply(p.q);
}

function updateRacket(p, dt) {
  const piv = p.mesh.pivot;
  if (p.connected && p.hasOrient) {
    piv.quaternion.slerp(calibratedQuat(p, tmpQ), 0.6);
    return;
  }
  const h = handLocal(p);
  let yaw = -0.5 * h, pitch = 0.5, k = 0.25;
  if (p.anim) {
    p.anim.t += dt;
    const e = ease(Math.min(1, p.anim.t / p.anim.dur));
    if (p.anim.type === 'fh') { yaw = lerp(-2.2, 1.3, e) * h; pitch = lerp(0.15, 0.7, e); }
    else if (p.anim.type === 'bh') { yaw = lerp(2.4, -1.2, e) * h; pitch = lerp(0.2, 0.7, e); }
    else { yaw = -0.3 * h; pitch = lerp(3.4, -0.5, e); }
    k = 1;
    if (p.anim.t > p.anim.dur + 0.15) p.anim = null;
  } else if (game.state === 'serve' && game.server === p.idx && ball.tossed) {
    yaw = -0.3 * h; pitch = 3.0;
  }
  tmpQ.setFromEuler(tmpE.set(pitch, yaw, 0, 'YXZ'));
  piv.quaternion.slerp(tmpQ, k);
}

function updatePlayer(p, dt) {
  const sp = isCPU(p) ? diff().speed : HUMAN_SPEED;
  const dx = p.target.x - p.pos.x, dz = p.target.z - p.pos.z, d = Math.hypot(dx, dz);
  const step = Math.min(d, sp * dt);
  if (d > 1e-4) { p.pos.x += (dx / d) * step; p.pos.z += (dz / d) * step; }
  p.speed = lerp(p.speed, step / Math.max(dt, 1e-3), 0.2);

  // La CPU inizia lo swing poco prima che arrivi la palla
  if (isCPU(p) && !p.anim && game.state === 'rally' && ball.lastHitter !== p.idx && !ball.serving && !p.cpuLetGo) {
    const rel = (ball.pos.z - p.pos.z) * p.f, appr = -ball.vel.z * p.f;
    if (rel > 0 && appr > 0 && rel / appr < 0.16 && ball.pos.z * p.f < 0 && Math.abs(ball.pos.x - p.pos.x) < REACH + 0.5) {
      startAnim(p, (ball.pos.x - p.pos.x) * handX(p) >= 0 ? 'fh' : 'bh');
    }
  }

  const m = p.mesh;
  m.group.position.copy(p.pos);
  p.walk += p.speed * dt * 2.2;
  const amp = Math.min(1, p.speed / 3) * 0.7;
  m.legs[0].rotation.x = Math.sin(p.walk) * amp;
  m.legs[1].rotation.x = -Math.sin(p.walk) * amp;
  m.group.position.y = Math.abs(Math.sin(p.walk)) * amp * 0.08;
  m.shadow.position.set(p.pos.x, 0.02, p.pos.z);
  updateRacket(p, dt);
}

// ---------------------------------------------------------------------------
// Ciclo principale
// ---------------------------------------------------------------------------
function physicsStep() {
  if (ball.held) return;
  const prevZ = ball.pos.z;
  const ev = stepBall(ball, STEP);
  if (ev & 2) { ball.hitNet = true; sfx('net'); }
  if (ev & 1) {
    sfx('bounce', Math.min(1, Math.abs(ball.vel.y) / 6));
    onBounce();
    if (game.state === 'rally') retargetAll();
  }
  if (game.state === 'serve' && ball.tossed && ball.vel.y < 0 && ball.pos.y < 1.0) {
    ball.tossed = false;      // palla non colpita: si rilancia
    ball.held = true;
    setHint();
  }
  for (const p of players) checkCrossing(p, prevZ);
}

function update(dt, steps) {
  game.retargetT -= dt;
  if (game.retargetT <= 0) { game.retargetT = 0.1; retargetAll(); }

  if (game.state === 'serve') {
    const s = players[game.server];
    if (isCPU(s)) {
      game.cpuServeT -= dt;
      if (ball.held && game.cpuServeT <= 0) serveToss(s);
      else if (ball.tossed && ball.vel.y < 0.4 && ball.pos.y > 1.5) serveHit(s, 0.3 + Math.random() * diff().maxPow * 0.7);
    }
  } else if (game.state === 'pointOver' || game.state === 'faultPause' || game.state === 'matchOver') {
    game.timer -= dt;
    if (game.timer <= 0) {
      if (game.state === 'matchOver') goLobby();
      else nextPoint(game.state === 'faultPause');
    }
  }

  for (let i = 0; i < steps; i++) physicsStep();
  for (const p of players) updatePlayer(p, dt);

  // Palla in mano al battitore
  if (ball.held) {
    const s = players[game.server];
    s.mesh.freeHand.getWorldPosition(ball.pos);
  }
  ballMesh.position.copy(ball.pos);
  ballShadow.position.set(ball.pos.x, 0.02, ball.pos.z);
  ballShadow.scale.setScalar(1 + Math.min(ball.pos.y, 5) * 0.15);

  // Telecamera alle spalle del giocatore 1, come in TV
  const p0 = players[0];
  camera.position.x = lerp(camera.position.x, p0.pos.x * 0.4 + ball.pos.x * 0.1, 0.05);
  camera.position.z = lerp(camera.position.z, Math.max(HALF_L + 8.5, p0.pos.z + 7.5), 0.05);
  camera.position.y = 5.2;
  camera.lookAt(camera.position.x * 0.5, 0.2, camera.position.z - 23);
}

let last = now(), physAcc = 0;
function frame() {
  const t = now();
  const dt = Math.min(0.05, t - last);
  last = t;
  physAcc += dt;
  const steps = Math.floor(physAcc / STEP);
  physAcc -= steps * STEP;
  update(dt, steps);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------
// Interfaccia (lobby, tabellone, messaggi)
// ---------------------------------------------------------------------------
let msgTimer = 0, toastTimer = 0;
function showMessage(big, small = '', secs = 2.2) {
  if (game.mode !== 'match') return;
  $('msgBig').textContent = big;
  $('msgSmall').textContent = small;
  $('message').classList.add('show');
  clearTimeout(msgTimer);
  msgTimer = setTimeout(() => $('message').classList.remove('show'), secs * 1000);
}
function toast(text) {
  $('toast').textContent = text;
  $('toast').classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('toast').classList.remove('show'), 3500);
}

function updateHud() {
  for (const i of [0, 1]) {
    const row = $('sb' + i), a = game.points[i], b = game.points[1 - i];
    row.querySelector('.name').textContent = nameOf(i);
    row.querySelector('.games').textContent = game.games[i];
    row.querySelector('.pts').textContent = a >= 3 && b >= 3 ? (a > b ? 'V' : '40') : PTS[Math.min(a, 3)];
    row.querySelector('.serve').classList.toggle('on', game.server === i);
  }
}

function setHint() {
  let text = '';
  if (game.mode === 'match' && game.state === 'serve') {
    const s = players[game.server];
    if (!isCPU(s)) {
      const key = s.connected ? 'swing' : 'SPAZIO';
      text = ball.tossed ? `${nameOf(s.idx)}: ${key} per servire!` : `${nameOf(s.idx)} al servizio: ${key} per lanciare la palla`;
    }
  }
  $('hint').textContent = text;
}

function updateLobby() {
  for (const i of [0, 1]) {
    const p = players[i], el = $('slot' + i);
    el.classList.toggle('on', p.connected);
    let st;
    if (p.connected) st = `📱 ${p.name} — ${p.hand === 'L' ? 'mancino' : 'destro'}${p.hasOrient ? '' : ' (sensori in attesa…)'}`;
    else st = i === 0 ? 'In attesa di un telefono… (tastiera: SPAZIO)' : 'CPU (collega un 2° telefono per giocare in due)';
    el.querySelector('.st').textContent = st;
  }
  for (const [id, key] of [['optGames', 'games'], ['optDiff', 'diff']]) {
    for (const b of $(id).querySelectorAll('button')) b.classList.toggle('on', +b.dataset.v === game.opts[key]);
  }
}

function setOpt(key, v) {
  if (key === 'games' && [1, 3, 5].includes(v)) game.opts.games = v;
  if (key === 'diff' && [0, 1, 2].includes(v)) game.opts.diff = v;
  updateLobby();
  sendLobby();
}

$('optGames').addEventListener('click', e => { if (e.target.dataset.v) setOpt('games', +e.target.dataset.v); });
$('optDiff').addEventListener('click', e => { if (e.target.dataset.v) setOpt('diff', +e.target.dataset.v); });
$('startBtn').addEventListener('click', () => startMatch());

addEventListener('keydown', e => {
  if (e.code === 'Space') {
    e.preventDefault();
    if (game.mode === 'match' && !players[0].connected) onSwing(players[0], 0.7, 0.3);
  } else if (e.code === 'Enter' && game.mode === 'demo') {
    startMatch();
  } else if (e.code === 'Escape' && game.mode === 'match') {
    goLobby();
  }
});

// ---------------------------------------------------------------------------
// Rete: PeerJS (WebRTC). La TV fa da "host", i telefoni si collegano al suo ID.
// ---------------------------------------------------------------------------
let peer = null, roomCode = '';
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function startPeer() {
  if (!window.Peer) { $('qr').innerHTML = '<div class="loading">Errore: PeerJS non caricato</div>'; return; }
  roomCode = Array.from({ length: 4 }, () => CODE_CHARS[(Math.random() * CODE_CHARS.length) | 0]).join('');
  peer = new window.Peer(PEER_PREFIX + roomCode, PEER_OPTIONS);
  peer.on('open', showJoinInfo);
  peer.on('connection', conn => {
    conn.on('data', d => onData(conn, d));
    conn.on('close', () => onClose(conn));
    conn.on('error', () => onClose(conn));
  });
  peer.on('disconnected', () => setTimeout(() => { if (!peer.destroyed) peer.reconnect(); }, 2000));
  peer.on('error', e => {
    if (e.type === 'unavailable-id') { peer.destroy(); startPeer(); return; }
    if (['network', 'server-error', 'socket-error', 'socket-closed'].includes(e.type) && !peer.open) {
      $('qr').innerHTML = '<div class="loading">Impossibile contattare il server di connessione.<br>Controlla internet e ricarica la pagina.</div>';
    }
    console.warn('PeerJS', e.type, e);
  });
}

function showJoinInfo() {
  const url = new URL('controller.html?room=' + roomCode, location.href).href;
  $('roomCode').textContent = roomCode;
  $('ctrlUrl').textContent = url.replace(/^https?:\/\//, '');
  try {
    const qr = window.qrcode(0, 'M');
    qr.addData(url);
    qr.make();
    $('qr').innerHTML = qr.createSvgTag(6, 2);
  } catch (e) {
    $('qr').innerHTML = '<div class="loading">QR non disponibile</div>';
  }
  if (location.protocol === 'file:') toast('Attenzione: apri il gioco da un indirizzo https (es. GitHub Pages), non come file locale.');
}

function sendTo(p, msg) {
  if (p.conn && p.conn.open) { try { p.conn.send(msg); } catch (e) { /* connessione chiusa */ } }
}

function phoneStatus(p) {
  if (game.mode !== 'match') {
    return p.idx === 0 ? 'Scegli le opzioni e premi “Inizia partita”.' : 'In attesa che il Giocatore 1 avvii la partita…';
  }
  switch (game.state) {
    case 'serve':
      return game.server === p.idx
        ? 'Al servizio! Swing per lanciare la palla, poi un altro swing quando è in alto.'
        : 'In risposta: preparati!';
    case 'matchOver':
      return 'Partita finita! Si torna alla lobby…';
    default:
      return 'Gioca! Swing quando la palla arriva.';
  }
}

function notifyPhones() {
  const sc = scoreLine().text;
  for (const p of players) {
    sendTo(p, {
      t: 'status',
      text: phoneStatus(p),
      score: game.mode === 'match' ? `Giochi ${game.games[p.idx]}-${game.games[1 - p.idx]} · ${sc}` : '',
    });
  }
}

function sendLobby() {
  for (const p of players) sendTo(p, { t: 'lobby', inLobby: game.mode !== 'match', host: p.idx === 0, opts: game.opts });
  notifyPhones();
}

function onData(conn, d) {
  if (!d || typeof d !== 'object') return;
  if (d.t === 'hello') return onHello(conn, d);
  const p = players[conn.playerIdx];
  if (!p || p.conn !== conn) return;
  switch (d.t) {
    case 'o': onOrientation(p, d); break;
    case 'swing': onSwing(p, clamp(+d.p || 0, 0, 1), p.hasOrient ? spinFromTip(p) : 0.3); break;
    case 'calib': p.needCalib = true; if (p.hasOrient) calibrate(p); break;
    case 'hand': setHand(p, d.h); updateLobby(); break;
    case 'opt': if (p.idx === 0 && game.mode !== 'match') setOpt(d.k, +d.v); break;
    case 'start': if (p.idx === 0 && game.mode !== 'match') startMatch(); break;
  }
}

function onHello(conn, d) {
  let i = players.findIndex(p => p.clientId && p.clientId === d.id);
  if (i < 0) i = players.findIndex(p => !p.connected);
  if (i < 0) { conn.send({ t: 'full' }); setTimeout(() => conn.close(), 500); return; }
  const p = players[i];
  if (p.conn && p.conn !== conn) { try { p.conn.close(); } catch (e) { /* già chiusa */ } }
  conn.playerIdx = i;
  Object.assign(p, {
    conn, clientId: d.id, connected: true, hasOrient: false, needCalib: true, tipHist: [],
    name: String(d.name || '').trim().slice(0, 12) || `Giocatore ${i + 1}`,
  });
  setHand(p, d.hand);
  conn.send({ t: 'welcome', slot: i, color: PLAYER_COLORS[i], colorName: PLAYER_COLOR_NAMES[i] });
  toast(`📱 ${p.name} collegato (${PLAYER_COLOR_NAMES[i]})`);
  updateLobby();
  updateHud();
  setHint();
  sendLobby();
}

function onClose(conn) {
  const p = players[conn.playerIdx];
  if (!p || p.conn !== conn) return;
  p.conn = null;
  p.connected = false;
  p.hasOrient = false;
  toast(`📱 ${p.name} disconnesso — ${p.idx === 0 ? 'si può usare la tastiera' : 'gioca la CPU'}`);
  updateLobby();
  updateHud();
  setHint();
}

// Orientamento del telefono → quaternione (convenzione di three.js DeviceOrientationControls).
// Nel sistema locale risultante la parte alta del telefono punta verso -z e lo schermo verso +y.
const D2R = Math.PI / 180;
function onOrientation(p, d) {
  if (d.a == null || d.b == null || d.g == null) return;
  p.q.setFromEuler(tmpE.set(d.b * D2R, d.a * D2R, -d.g * D2R, 'YXZ'));
  const first = !p.hasOrient;
  p.hasOrient = true;
  if (p.needCalib) calibrate(p);
  if (first) updateLobby();
  // Storia della punta della racchetta, per capire se lo swing va verso l'alto (top) o il basso (slice)
  tmpV.set(0, 0, -1).applyQuaternion(calibratedQuat(p, tmpQ));
  const t = now();
  p.tipHist.push({ t, y: tmpV.y });
  while (p.tipHist.length && t - p.tipHist[0].t > 0.4) p.tipHist.shift();
}

// Ruota il riferimento in modo che la direzione in cui punta ora il telefono corrisponda a "verso la rete"
function calibrate(p) {
  tmpV.set(0, 0, -1).applyQuaternion(p.q);
  p.calibPhi = Math.PI - Math.atan2(tmpV.x, tmpV.z);
  p.needCalib = false;
}

function spinFromTip(p) {
  const h = p.tipHist;
  if (h.length < 2) return 0.2;
  const lastS = h[h.length - 1];
  let old = h[0];
  for (const s of h) if (lastS.t - s.t >= 0.15) old = s;
  const vy = (lastS.y - old.y) / Math.max(0.05, lastS.t - old.t);
  return Math.abs(vy) < 0.8 ? 0.2 : clamp(vy / 4, -1, 1);
}

// ---------------------------------------------------------------------------
// Avvio
// ---------------------------------------------------------------------------
updateLobby();
updateHud();
nextPoint();
startPeer();
requestAnimationFrame(frame);

// Per il debug dalla console del browser
window.tennis = { game, ball, players, startMatch, goLobby, onSwing, onData };
