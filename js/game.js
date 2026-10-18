// Tennis TV — gioco che gira sulla TV. I telefoni si collegano via WebRTC (PeerJS)
// e fanno da racchetta: inviano l'orientamento (la racchetta a schermo lo segue)
// e gli swing rilevati da giroscopio/accelerometro.
import * as THREE from '../vendor/three.module.min.js';
import { PEER_PREFIX, PEER_OPTIONS, PLAYER_COLORS, PLAYER_COLOR_NAMES } from './config.js';
import * as sound from './audio.js';

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
const SPIN_G = 5;              // effetto Magnus: il top spin fa scendere prima la palla, lo slice la fa galleggiare
const DRAG = 0.013;            // resistenza dell'aria (a = -DRAG·|v|·v)
const BALL_R = 0.033;
const STEP = 1 / 120;          // passo della fisica
// Zona di colpo attorno al giocatore: davanti, dietro, di lato e in altezza
const HIT_FRONT = 1.4, HIT_BACK = 0.6, REACH = 1.8, HIT_MAX_Y = 3.1;
const HUMAN_SPEED = 7.0, HUMAN_ACCEL = 26;
const DIFF = [
  { name: 'Facile', speed: 5.0, accel: 16, hitProb: 0.78, err: 1.35, maxPow: 0.5, readsOut: 0.3 },
  { name: 'Normale', speed: 6.2, accel: 20, hitProb: 0.9, err: 1.1, maxPow: 0.75, readsOut: 0.7 },
  { name: 'Difficile', speed: 7.4, accel: 26, hitProb: 0.97, err: 0.7, maxPow: 0.95, readsOut: 0.95 },
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
// Audio e voce dell'arbitro
// ---------------------------------------------------------------------------
function unlockAudio() {
  sound.unlockAudio();
  sound.setEnabled(game.mode === 'match');
  $('audioHint').hidden = true;
}
addEventListener('pointerdown', unlockAudio);
addEventListener('keydown', unlockAudio);

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
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
$('stage').appendChild(renderer.domElement);

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
// Superficie con una leggera grana (cemento, erba)
function grainTex(color, rx, ry, amount = 0.06) {
  const t = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = color; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 12000; i++) {
      g.fillStyle = Math.random() < 0.5 ? `rgba(255,255,255,${amount})` : `rgba(0,0,0,${amount * 1.2})`;
      g.fillRect(Math.random() * w, Math.random() * h, 1.6, 1.6);
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx, ry);
  return t;
}

const scene = new THREE.Scene();
scene.background = canvasTex(2, 256, (g, w, h) => {
  const grd = g.createLinearGradient(0, 0, 0, h);
  grd.addColorStop(0, '#3f9be0'); grd.addColorStop(0.6, '#8fd0fb'); grd.addColorStop(1, '#d6efff');
  g.fillStyle = grd; g.fillRect(0, 0, w, h);
});
scene.fog = new THREE.Fog(0xcbe9fb, 70, 150);
const camera = new THREE.PerspectiveCamera(48, innerWidth / innerHeight, 0.5, 300);
camera.position.set(0, 5.2, HALF_L + 8.5);
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});

scene.add(new THREE.HemisphereLight(0xffffff, 0x51804a, 1.5));
const sun = new THREE.DirectionalLight(0xfff4e0, 2.2);
sun.position.set(-10, 25, 12);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 24, bottom: -24, near: 1, far: 80 });
sun.shadow.bias = -0.0008;
scene.add(sun);

const lambert = (color, map = null) => new THREE.MeshLambertMaterial({ color, map });
function flat(w, d, mat, x, y, z) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, y, z);
  m.receiveShadow = true;
  scene.add(m);
  return m;
}
const shadowed = obj => { obj.traverse(o => { if (o.isMesh) { o.castShadow = true; } }); return obj; };

function buildCourt() {
  flat(220, 220, lambert(0xffffff, grainTex('#5aa548', 60, 60, 0.08)), 0, 0, 0);
  flat(2 * HALF_W + 9, 2 * HALF_L + 13, lambert(0xffffff, grainTex('#3d8a5a', 6, 12)), 0, 0.004, 0);
  flat(2 * HALF_W, 2 * HALF_L, lambert(0xffffff, grainTex('#2f6fb3', 4, 10)), 0, 0.008, 0);
  const white = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x333333 });
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
  const tape = shadowed(new THREE.Mesh(new THREE.BoxGeometry(2 * NET_HALF, 0.07, 0.03), lambert(0xffffff)));
  tape.position.set(0, NET_H, 0);
  scene.add(tape);
  for (const s of [-1, 1]) {
    const post = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.07, 10), lambert(0x30343a)));
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

  // Sedia dell'arbitro, a bordo campo all'altezza della rete
  const chair = new THREE.Group();
  const wood = lambert(0x2d4a63);
  const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); chair.add(m); return m; };
  for (const sx of [-0.35, 0.35]) for (const sz of [-0.35, 0.35]) add(new THREE.BoxGeometry(0.07, 1.9, 0.07), wood, sx, 0.95, sz);
  add(new THREE.BoxGeometry(0.9, 0.08, 0.9), wood, 0, 1.9, 0);
  add(new THREE.BoxGeometry(0.9, 0.7, 0.08), wood, 0, 2.3, 0.42);
  add(new THREE.CapsuleGeometry(0.2, 0.35, 4, 10), lambert(0x1c2a4a), 0, 2.3, 0.1);
  add(new THREE.SphereGeometry(0.17, 14, 10), lambert(0xe8c39e), 0, 2.78, 0.08);
  add(new THREE.CylinderGeometry(0.18, 0.18, 0.08, 14), lambert(0xf5f5f5), 0, 2.9, 0.08);
  chair.position.set(-(NET_HALF + 1.1), 0, 0);
  chair.rotation.y = -Math.PI / 2;
  scene.add(shadowed(chair));
}
buildCourt();

const blob = (r, opacity) => {
  const m = new THREE.Mesh(new THREE.CircleGeometry(r, 20),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.02;
  scene.add(m);
  return m;
};

// Omino stile "Mii": testa grande, mani fluttuanti, racchetta che ruota attorno alla spalla.
// La racchetta punta lungo -z locale (come la parte alta del telefono) e la sua faccia è perpendicolare a y locale (lo schermo).
// Il busto ("torso") ruota seguendo la racchetta, le gambe restano rivolte verso la rete.
function makePlayerMesh(color, hairColor) {
  const g = new THREE.Group(), torso = new THREE.Group();
  g.add(torso);
  const skin = lambert(0xf3cfa8), shirt = lambert(color), white = lambert(0xf5f5f5), dark = lambert(0x262626);
  const add = (geo, mat, x, y, z, parent = torso) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); parent.add(m); return m; };

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
  torso.add(pivot);
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

  scene.add(shadowed(g));
  return { group: g, torso, pivot, freeHand, legs, shadow: blob(0.4, 0.12) };
}

// Palla con la cucitura disegnata, così si vede girare (più grande del vero per vederla sulla TV)
const ballMesh = new THREE.Mesh(new THREE.SphereGeometry(0.075, 18, 14), new THREE.MeshLambertMaterial({
  emissive: 0x2a3000,
  map: canvasTex(128, 64, (g, w, h) => {
    g.fillStyle = '#d9ef3a'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#f7fbe8'; g.lineWidth = 4; g.beginPath();
    for (let x = 0; x <= w; x++) { const y = h / 2 + Math.sin((x / w) * Math.PI * 4) * h * 0.28; x ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.stroke();
  }),
}));
ballMesh.castShadow = true;
scene.add(ballMesh);
const ballShadow = blob(0.08, 0.3);

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
  vel: new THREE.Vector3(),
  target: new THREE.Vector3(0, 0, i === 0 ? HALF_L + 0.5 : -HALF_L - 0.5),
  mesh: makePlayerMesh(PLAYER_COLORS[i], i === 0 ? 0x5d3a1a : 0x222222),
  hand: 'R', speed: 0, walk: 0, anim: null, bodyYaw: 0, squeakT: 0,
  pending: null, lastCross: null, cpuLetGo: false,
  // rete / telefono
  conn: null, clientId: null, connected: false, name: '',
  q: new THREE.Quaternion(), hasOrient: false, calibPhi: 0, needCalib: true, hist: [],
}));
players[1].mesh.group.rotation.y = Math.PI;

const game = {
  mode: 'demo',          // 'demo' (CPU contro CPU dietro la lobby) | 'match'
  state: 'serve',        // serve | rally | pointOver | faultPause | matchOver
  opts: { games: 3, diff: 1 },
  points: [0, 0], games: [0, 0], server: 0, faults: 0,
  timer: 0, cpuServeT: 0, retargetT: 0, rally: 0, lastOutBy: 9,
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
  const sp = b.vel.length();
  if (sp > 0) b.vel.multiplyScalar(Math.max(0, 1 - DRAG * sp * h));
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
    // Il top spin fa schizzare la palla alta e veloce, lo slice la tiene bassa e la frena
    b.vel.y = impact > 0.5 ? impact * (0.73 + 0.07 * s) : 0;
    const k = impact > 0.5 ? 0.8 + 0.08 * s : 0.985;
    b.vel.x *= k; b.vel.z *= k;
    b.spin = 0;
    if (impact > 0.5) ev |= 1;
  }
  return ev;
}

// Velocità iniziale (senza aria) per atterrare in (tx, tz) con velocità orizzontale vh,
// abbassando la velocità finché la traiettoria non supera la rete di almeno "clear" metri.
function launch(from, tx, tz, vh, spin, clear) {
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

const sim = { pos: new THREE.Vector3(), vel: new THREE.Vector3(), spin: 0 };
function simulateLanding(from, vel, spin) {
  sim.pos.copy(from); sim.vel.copy(vel); sim.spin = spin;
  for (let i = 0; i < 900; i++) {
    const ev = stepBall(sim, STEP);
    if (ev & 2) return { net: true };
    if (ev & 1) return { x: sim.pos.x, z: sim.pos.z };
  }
  return null;
}

// Come launch(), ma corregge la mira simulando il volo con la resistenza dell'aria
function solveShot(from, tx, tz, vh, spin, clear) {
  let ax = tx, az = tz, vel = launch(from, ax, az, vh, spin, clear);
  for (let k = 0; k < 6; k++) {
    const land = simulateLanding(from, vel, spin);
    if (!land) break;
    if (land.net) clear += 0.25;
    else {
      const ex = tx - land.x, ez = tz - land.z;
      if (Math.abs(ex) + Math.abs(ez) < 0.12) break;
      ax += ex; az += ez;
    }
    vel = launch(from, ax, az, vh, spin, clear);
  }
  return vel;
}

const inCourt = (x, z) => Math.abs(x) <= HALF_W + BALL_R && Math.abs(z) <= HALF_L + BALL_R;

// Dove farsi trovare per colpire. Di norma dopo il rimbalzo, quando la palla scende sotto 1.4 m;
// se però così si finirebbe troppo dietro la linea di fondo (palle alte e cariche), si colpisce in salita.
function predictContact(p) {
  const s = { pos: ball.pos.clone(), vel: ball.vel.clone(), spin: ball.spin };
  // Se la palla ha già rimbalzato nella metà campo del giocatore, quel rimbalzo conta
  let own = ball.pos.z * p.f < 0 ? ball.bounces : 0, first = null, rise = null;
  for (let i = 0; i < 480; i++) {
    const ev = stepBall(s, STEP);
    const mine = s.pos.z * p.f < 0;
    if (ev & 1) {
      if (!first) first = { x: s.pos.x, z: s.pos.z, out: !mine || !inCourt(s.pos.x, s.pos.z) };
      if (mine && ++own >= 2) break;
    }
    if (!mine || own !== 1) continue;
    const deep = Math.abs(s.pos.z) - HALF_L;          // > 0: dietro la linea di fondo
    const pt = { x: s.pos.x, z: s.pos.z, y: s.pos.y, first };
    if (!rise && s.vel.y > 0 && s.pos.y >= 0.8) rise = pt;
    if (s.vel.y < 0 && s.pos.y < 1.4) return deep > 1.5 && rise ? rise : pt;
    if (deep > 2.5) return rise || pt;
  }
  return first ? { x: first.x, z: first.z, y: 0, first } : null;
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
    clamp(c.x - handX(p) * (fh ? 0.8 : -0.8), -HALF_W - 4, HALF_W + 4),
    0,
    -p.f * clamp(Math.abs(c.z) + 0.3, 2.0, HALF_L + 4),
  );
}
const retargetAll = () => players.forEach(retarget);

// ---------------------------------------------------------------------------
// Colpi
// ---------------------------------------------------------------------------
// Posizione della palla rispetto al giocatore: rel = metri davanti (verso la rete), lat = di lato
const relOf = p => (ball.pos.z - p.pos.z) * p.f;
const approachOf = p => -ball.vel.z * p.f;

// La palla è nella zona di colpo del giocatore?
function hittable(p) {
  if (game.state !== 'rally' || ball.lastHitter === p.idx || ball.serving || ball.bounces > 1) return false;
  if (ball.pos.z * p.f >= 0) return false;              // deve essere nella propria metà campo
  const rel = relOf(p);
  return rel <= HIT_FRONT && rel >= -HIT_BACK && Math.abs(ball.pos.x - p.pos.x) <= REACH && ball.pos.y <= HIT_MAX_Y;
}

// timing: +1 = colpita molto davanti (in anticipo), -1 = molto indietro (in ritardo)
const timingFrom = dt => clamp((dt - 0.05) / 0.25, -1, 1);

// sw = { power 0..1, loft -1..1 (swing dall'alto in basso / dal basso in alto), face -1..1 o null (mira data dalla racchetta) }
function doHit(p, timing, sw) {
  const cpu = isCPU(p), errMul = cpu ? diff().err : 1;
  const hl = handLocal(p), fh = (ball.pos.x - p.pos.x) * handX(p) >= 0;
  const P = clamp(sw.power, 0, 1), L = clamp(sw.loft, -1, 1);
  const high = ball.pos.y > 2.0;
  let type = 'drive';
  if (high && L < 0.3 && P > 0.2) type = 'smash';
  else if (P < 0.3 && L > 0.35) type = 'lob';
  else if (P < 0.2 && L < -0.25) type = 'drop';

  // Direzione: in anticipo = incrociato, in ritardo = lungo linea; col telefono conta soprattutto l'angolo della racchetta
  let aim = timing * (fh ? -hl : hl);
  if (sw.face != null) aim = 0.35 * aim + 0.65 * sw.face;
  const err = (0.25 + 1.0 * Math.abs(timing) ** 3 + 0.7 * P * P + (type === 'smash' ? 0.25 : 0)) * errMul;
  const tx = rightX(p) * aim * 3.7 + gauss() * err * 0.5;

  let depth, vh, spin, clear;
  switch (type) {
    case 'lob': depth = 9.6 + P * 3; vh = 13 + P * 6; spin = 0.3; clear = 3; break;
    case 'drop': depth = 2.3 + P * 4; vh = 13 + P * 5; spin = -0.4; clear = 0.2; break;
    case 'smash': depth = 7.5 + P * 3.2; vh = 24 + P * 16; spin = 0.1; clear = 0.05; break;
    default:
      spin = clamp(L * 0.9 + 0.1, -0.9, 1);
      depth = 6.8 + P * 3.9 - Math.max(0, -spin) * 0.6;
      vh = 13 + P * 20 + Math.max(0, spin) * 1.5;
      clear = 0.2 + Math.max(0, spin) * 0.6 + (1 - P) * 0.5;
  }
  const tz = p.f * (depth + gauss() * err * 0.45);

  ball.vel.copy(solveShot(ball.pos, tx, tz, vh, spin, clear));
  // Colpi sbagliati di brutto possono finire in rete
  if (type !== 'lob' && Math.random() < 0.04 * errMul * (timing * timing + P * P)) ball.vel.y -= 0.8 + Math.random();
  ball.spin = spin;
  ball.lastHitter = p.idx;
  ball.bounces = 0;
  ball.serving = false;
  ball.hitNet = false;
  if (cpu || !p.connected) startAnim(p, type === 'smash' ? 'serve' : fh ? 'fh' : 'bh');
  if (P > 0.8 || type === 'smash') sound.grunt(P);
  afterHit(p, P);
}

function afterHit(p, power) {
  for (const q of players) { q.pending = null; q.lastCross = null; }
  game.rally++;
  sound.hit(0.35 + power * 0.65);
  sound.crowdLevel(0.015, 0.6);
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
  sound.toss();
  sound.crowdLevel(0.01, 0.5);
  setHint();
}

function serveHit(p, sw) {
  const apexQ = 1 - Math.min(1, Math.abs(ball.vel.y) / 4.5);
  const pf = clamp(0.6 * sw.power + 0.4 * apexQ, 0, 1);
  const sideSign = -rightX(p) * (isDeuceSide() ? 1 : -1);
  const err = (0.25 + 0.55 * (1 - apexQ) + 0.4 * pf * pf) * (isCPU(p) ? diff().err : 1);
  // Mira: col telefono si sceglie l'angolo (al centro o all'esterno), altrimenti dipende dal tempismo
  const aim = sw.face != null ? sw.face * 1.5 * rightX(p) : sideSign * (ball.vel.y / 4.5) * 1.2;
  const tx = sideSign * 2.05 + aim + gauss() * err * 0.5;
  const tz = p.f * (4.6 + 1.4 * pf + gauss() * err * 0.4);
  const spin = clamp(0.1 + (sw.loft || 0) * 0.5, -0.4, 0.6);
  ball.vel.copy(solveShot(ball.pos, tx, tz, 21 + pf * 21, spin, 0.1));
  ball.spin = spin;
  ball.tossed = false;
  ball.serving = true;
  ball.lastHitter = p.idx;
  ball.bounces = 0;
  ball.hitNet = false;
  if (!p.hasOrient || !p.connected) startAnim(p, 'serve');
  game.state = 'rally';
  setHint();
  showSpeed(ball.vel.length());
  if (pf > 0.75) sound.grunt(pf);
  afterHit(p, pf);
}

// Swing arrivato da un telefono (o dalla tastiera)
function onSwing(p, sw) {
  const t = now();
  if (!(p.connected && p.hasOrient)) startAnim(p, ball.pos.y > 2.1 ? 'serve' : (ball.pos.x - p.pos.x) * handX(p) >= 0 ? 'fh' : 'bh');
  if (game.mode !== 'match') return;
  if (game.state === 'serve' && game.server === p.idx) {
    if (ball.held) serveToss(p);
    else if (ball.tossed && t - ball.tossTime > 0.18 && ball.pos.y > 1.5) serveHit(p, sw);
    return;
  }
  if (game.state !== 'rally' || ball.lastHitter === p.idx) return;
  const rel = relOf(p), appr = approachOf(p);
  const dt = appr > 0.5 ? rel / appr : 0;
  if (hittable(p)) {
    // La palla è già a portata (anche alta o prima del rimbalzo): si colpisce subito
    doHit(p, timingFrom(dt), sw);
  } else if (rel > 0 && appr > 0.5 && dt <= 0.5) {
    // Swing un po' in anticipo: il colpo parte quando la palla entra nella zona
    p.pending = { time: t, timing: timingFrom(dt), sw };
  } else if (rel <= 0 && p.lastCross && t - p.lastCross.time <= 0.15) {
    // Swing un po' in ritardo: colpisci dal punto in cui la palla era all'altezza del giocatore
    ball.pos.copy(p.lastCross.pos);
    doHit(p, timingFrom(-(t - p.lastCross.time)), sw);
  }
}

function cpuSwing() {
  const d = diff(), r = Math.random();
  if (ball.pos.y > 2.1) return { power: 0.6 + Math.random() * 0.35, loft: -0.4, face: null };
  if (r < 0.05) return { power: 0.15, loft: 0.7, face: null };                       // pallonetto
  if (r < 0.08 && game.opts.diff > 0) return { power: 0.1, loft: -0.6, face: null };  // palla corta
  return { power: 0.25 + Math.random() * d.maxPow * 0.75, loft: Math.random() * 1.3 - 0.35, face: null };
}

// A ogni passo di fisica: swing anticipati in attesa, colpi della CPU, passaggio della palla accanto al giocatore
function playerStep(p, prevZ) {
  if (ball.lastHitter === p.idx || game.state !== 'rally') return;
  const t = now();
  if (!isCPU(p) && p.pending) {
    if (t - p.pending.time > 0.6) p.pending = null;
    else if (hittable(p) && (relOf(p) <= 0.15 || t - p.pending.time > 0.25)) {
      const pd = p.pending;
      doHit(p, pd.timing, pd.sw);
      return;
    }
  }
  const r0 = (prevZ - p.pos.z) * p.f, r1 = relOf(p);
  const crossing = r0 > 0 && r1 <= 0;
  if (isCPU(p)) {
    // La CPU colpisce quando la palla le passa accanto (anche alta: smash)
    if (crossing && hittable(p) && !p.cpuLetGo && Math.random() < diff().hitProb) {
      doHit(p, (Math.random() * 2 - 1) * 0.8, cpuSwing());
    }
  } else if (crossing && Math.abs(ball.pos.x - p.pos.x) <= REACH && ball.pos.y <= HIT_MAX_Y) {
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
    game.lastOutBy = Math.max(Math.abs(ball.pos.z) - SERVICE_Z, Math.abs(ball.pos.x) - HALF_W, -ball.pos.x * sideSign);
    if (inBox) { ball.serving = false; ball.bounces = 1; }
    else fault(ball.hitNet ? 'Rete!' : 'Fallo!');
    return;
  }
  if (ball.bounces === 0) {
    game.lastOutBy = Math.max(Math.abs(ball.pos.z) - HALF_L, Math.abs(ball.pos.x) - HALF_W);
    if (side === o && inCourt(ball.pos.x, ball.pos.z)) ball.bounces = 1;
    else pointTo(o, side === h && ball.hitNet ? 'Rete!' : 'Fuori!');
  } else if (game.rally === 1) {
    pointTo(h, 'Ace!');
  } else {
    pointTo(h, game.mode === 'match' && players[h].connected ? 'Vincente!' : 'Punto!');
  }
}

function fault(reason) {
  game.faults++;
  if (game.faults >= 2) { pointTo(1 - game.server, 'Doppio fallo!'); return; }
  game.state = 'faultPause';
  game.timer = 1.6;
  if (game.lastOutBy < 0.3 || reason === 'Rete!') sound.ooh(0.7);
  sound.crowdLevel(0.05, 1);
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

// Reazione del pubblico a fine punto
function crowdReaction(reason) {
  sound.crowdLevel(0.08, 1.5);
  if (reason === 'Doppio fallo!') { sound.groan(); return; }
  if (reason === 'Ace!' || game.rally >= 9) { sound.cheer(game.rally >= 14 ? 1.3 : 1); return; }
  if ((reason === 'Fuori!' && game.lastOutBy < 0.35) || reason === 'Rete!') sound.ooh(reason === 'Rete!' ? 0.6 : 1);
  sound.applause(0.6 + Math.min(game.rally, 10) * 0.06, 2 + Math.min(game.rally, 10) * 0.12);
}

function pointTo(w, reason) {
  if (game.state !== 'rally' && game.state !== 'serve' && game.state !== 'faultPause') return;
  game.points[w]++;
  game.timer = 2.8;
  game.state = 'pointOver';
  for (const p of players) p.target.copy(p.pos);
  crowdReaction(reason);
  const call = reason === 'Fuori!' ? 'Fuori. ' : reason === 'Ace!' ? 'Ace. ' : '';
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
        say(`${call}Gioco, partita e incontro: ${nameOf(w)}`);
        sound.cheer(1.5);
        sound.applause(1.6, 5);
        updateHud();
        notifyPhones();
        return;
      }
    }
    showMessage(reason, `Gioco ${nameOf(w)} · ${game.games[0]}-${game.games[1]}`);
    say(`${call}Gioco ${nameOf(w)}`);
    sound.applause(1.1, 3);
  } else {
    const sc = scoreLine();
    showMessage(reason, sc.text);
    say(call + sc.spoken);
  }
  updateHud();
  notifyPhones();
}

function nextPoint(keepFaults = false) {
  game.state = 'serve';
  game.rally = 0;
  if (!keepFaults) game.faults = 0;
  const s = players[game.server], r = players[1 - game.server];
  const side = isDeuceSide() ? 1 : -1;
  s.pos.set(rightX(s) * side * 0.9, 0, -s.f * (HALF_L + 0.35));
  r.pos.set(rightX(r) * side * 2.8, 0, -r.f * (HALF_L + 0.5));
  for (const p of players) {
    p.target.copy(p.pos);
    p.vel.set(0, 0, 0);
    p.pending = null; p.lastCross = null; p.cpuLetGo = false; p.anim = null;
  }
  Object.assign(ball, { held: true, tossed: false, serving: false, bounces: 0, lastHitter: game.server, hitNet: false, spin: 0 });
  ball.vel.set(0, 0, 0);
  game.cpuServeT = game.mode === 'demo' ? 1.0 : 1.5;
  setHint();
  updateHud();
  notifyPhones();
}

function startMatch() {
  game.mode = 'match';
  sound.setEnabled(true);
  game.points = [0, 0];
  game.games = [0, 0];
  game.server = Math.random() < 0.5 ? 0 : 1;
  $('lobby').hidden = true;
  $('hud').hidden = false;
  nextPoint();
  showMessage('Si gioca!', `Al servizio: ${nameOf(game.server)}`);
  say(`Si gioca! Al servizio ${nameOf(game.server)}`);
  sound.applause(1, 3);
  sendLobby();
}

function goLobby() {
  game.mode = 'demo';
  sound.setEnabled(false);
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
const tmpQ = new THREE.Quaternion(), tmpQ2 = new THREE.Quaternion(), tmpE = new THREE.Euler(), tmpV = new THREE.Vector3();

function calibratedQuat(p, out, q = p.q) {
  return out.setFromAxisAngle(Y_AXIS, p.calibPhi).multiply(q);
}

function updateRacket(p, dt) {
  const piv = p.mesh.pivot;
  let bodyTarget;
  if (p.connected && p.hasOrient) {
    // La racchetta segue il telefono; il busto ruota un po' nella stessa direzione
    calibratedQuat(p, tmpQ);
    tmpV.set(0, 0, -1).applyQuaternion(tmpQ);
    bodyTarget = clamp(-tmpV.x * 0.6, -0.7, 0.7);
    p.bodyYaw = lerp(p.bodyYaw, bodyTarget, 0.25);
    tmpQ2.setFromAxisAngle(Y_AXIS, -p.bodyYaw).multiply(tmpQ);
    piv.quaternion.slerp(tmpQ2, 0.85);
  } else {
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
    tmpV.set(0, 0, -1).applyQuaternion(piv.quaternion);
    p.bodyYaw = lerp(p.bodyYaw, clamp(-tmpV.x * 0.35, -0.6, 0.6), 0.2);
  }
  p.mesh.torso.rotation.y = p.bodyYaw;
}

function updatePlayer(p, dt) {
  // Corsa con accelerazione e frenata (niente scatti istantanei)
  const cpu = isCPU(p);
  const maxSp = cpu ? diff().speed : HUMAN_SPEED, acc = cpu ? diff().accel : HUMAN_ACCEL;
  const dx = p.target.x - p.pos.x, dz = p.target.z - p.pos.z, d = Math.hypot(dx, dz);
  const want = d > 0.03 ? Math.min(maxSp, Math.sqrt(2 * acc * d)) : 0;
  tmpV.set(d > 0 ? (dx / d) * want : 0, 0, d > 0 ? (dz / d) * want : 0).sub(p.vel);
  const dvMax = acc * dt;
  if (tmpV.length() > dvMax) tmpV.setLength(dvMax);
  const before = p.vel.length();
  p.vel.add(tmpV);
  p.pos.addScaledVector(p.vel, dt);
  p.speed = p.vel.length();
  p.squeakT -= dt;
  if (before > 4.5 && p.speed < before - 0.6 * dt * acc && p.squeakT <= 0 && game.state === 'rally') {
    sound.squeak();
    p.squeakT = 0.6;
  }

  // La CPU inizia lo swing poco prima che arrivi la palla
  if (cpu && !p.anim && game.state === 'rally' && ball.lastHitter !== p.idx && !ball.serving && !p.cpuLetGo) {
    const rel = relOf(p), appr = approachOf(p);
    if (rel > 0 && appr > 0 && rel / appr < 0.16 && ball.pos.z * p.f < 0 && Math.abs(ball.pos.x - p.pos.x) < REACH + 0.5) {
      startAnim(p, ball.pos.y > 2.1 ? 'serve' : (ball.pos.x - p.pos.x) * handX(p) >= 0 ? 'fh' : 'bh');
    }
  }

  const m = p.mesh;
  m.group.position.copy(p.pos);
  p.walk += p.speed * dt * 2.2;
  const amp = Math.min(1, p.speed / 3) * 0.7;
  m.legs[0].rotation.x = Math.sin(p.walk) * amp;
  m.legs[1].rotation.x = -Math.sin(p.walk) * amp;
  m.group.position.y = Math.abs(Math.sin(p.walk)) * amp * 0.08;
  m.torso.rotation.x = -Math.min(1, p.speed / maxSp) * 0.15;   // si piega in avanti quando corre
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
  if (ev & 2) { ball.hitNet = true; sound.netHit(); }
  if (ev & 1) {
    sound.bounce(Math.min(1, Math.abs(ball.vel.y) / 6));
    onBounce();
    if (game.state === 'rally') retargetAll();
  }
  if (game.state === 'serve' && ball.tossed && ball.vel.y < 0 && ball.pos.y < 1.0) {
    ball.tossed = false;      // palla non colpita: si rilancia
    ball.held = true;
    setHint();
  }
  for (const p of players) playerStep(p, prevZ);
}

const spinAxis = new THREE.Vector3();
function update(dt, steps) {
  game.retargetT -= dt;
  if (game.retargetT <= 0) { game.retargetT = 0.1; retargetAll(); }

  if (game.state === 'serve') {
    const s = players[game.server];
    if (isCPU(s)) {
      game.cpuServeT -= dt;
      if (ball.held && game.cpuServeT <= 0) serveToss(s);
      else if (ball.tossed && ball.vel.y < 0.4 && ball.pos.y > 1.5) {
        serveHit(s, { power: 0.3 + Math.random() * diff().maxPow * 0.7, loft: Math.random() * 0.6 - 0.2, face: null });
      }
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
  } else {
    // La palla ruota su se stessa: in avanti col top spin, all'indietro con lo slice
    const sp = Math.hypot(ball.vel.x, ball.vel.z);
    if (sp > 0.5) {
      spinAxis.set(ball.vel.z, 0, -ball.vel.x).normalize();
      ballMesh.rotateOnWorldAxis(spinAxis, (ball.spin * 35 + sp * 0.8) * dt);
    }
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

// Qualità automatica: se la TV fatica (meno di ~35 fotogrammi al secondo) si spengono le ombre
let last = now(), physAcc = 0, perfFrames = 0, perfTime = 0;
function adaptQuality(rawDt) {
  if (!sun.castShadow) return;
  perfFrames++; perfTime += rawDt;
  if (perfFrames < 90) return;
  if (perfTime / perfFrames > 1 / 35) {
    sun.castShadow = false;
    renderer.setPixelRatio(1);
  }
  perfFrames = 0; perfTime = 0;
}
function frame() {
  const t = now();
  adaptQuality(Math.min(0.5, t - last));
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
let msgTimer = 0, toastTimer = 0, speedTimer = 0;
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
// Velocità del servizio, come nelle dirette TV
function showSpeed(ms) {
  if (game.mode !== 'match') return;
  $('speed').textContent = `Servizio ${Math.round(ms * 3.6)} km/h`;
  $('speed').classList.add('show');
  clearTimeout(speedTimer);
  speedTimer = setTimeout(() => $('speed').classList.remove('show'), 2500);
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

// Tastiera (per provare senza telefono): Spazio = colpo normale, Shift+Spazio = forte,
// Freccia su = pallonetto, Freccia giù = slice, Frecce sinistra/destra = colpo a sinistra/destra
const KEY_SWINGS = {
  Space: { power: 0.6, loft: 0.3, face: null },
  ArrowUp: { power: 0.15, loft: 0.8, face: null },
  ArrowDown: { power: 0.5, loft: -0.7, face: null },
  ArrowLeft: { power: 0.6, loft: 0.3, face: -0.8 },
  ArrowRight: { power: 0.6, loft: 0.3, face: 0.8 },
};
addEventListener('keydown', e => {
  if (KEY_SWINGS[e.code]) {
    e.preventDefault();
    if (game.mode === 'match' && !players[0].connected && !e.repeat) {
      const sw = { ...KEY_SWINGS[e.code] };
      if (e.shiftKey) sw.power = 0.95;
      onSwing(players[0], sw);
    }
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
    case 'swing': onSwing(p, phoneSwing(p, d)); break;
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
    conn, clientId: d.id, connected: true, hasOrient: false, needCalib: true, hist: [],
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
  // Storia degli orientamenti (mezzo secondo): serve per la direzione e l'effetto del colpo
  const t = now();
  p.hist.push({ t, q: p.q.clone() });
  while (p.hist.length && t - p.hist[0].t > 0.5) p.hist.shift();
}

// Ruota il riferimento in modo che la direzione in cui punta ora il telefono corrisponda a "verso la rete"
function calibrate(p) {
  tmpV.set(0, 0, -1).applyQuaternion(p.q);
  p.calibPhi = Math.PI - Math.atan2(tmpV.x, tmpV.z);
  p.needCalib = false;
}

// Orientamento registrato "ago" secondi fa
function pastQuat(p, ago) {
  const t = now() - ago;
  let best = p.hist[p.hist.length - 1];
  for (const s of p.hist) if (s.t <= t) best = s;
  return best ? best.q : p.q;
}

// Direzione del colpo data dalla racchetta al momento dell'impatto: la faccia è perpendicolare al manico,
// quindi se la punta è "avanti" la palla va incrociata, se è "indietro" va dall'altra parte.
// Ritorna -1 (tutto a sinistra) .. +1 (tutto a destra) rispetto al giocatore, oppure null se incerto.
function racketAim(p, ago) {
  if (!p.hasOrient || !p.hist.length) return null;
  tmpV.set(0, 0, -1).applyQuaternion(calibratedQuat(p, tmpQ, pastQuat(p, ago)));
  const len = Math.hypot(tmpV.x, tmpV.z);
  if (len < 0.35) return null;                 // racchetta quasi verticale: direzione incerta
  let nx = tmpV.z / len, nz = -tmpV.x / len;   // normale orizzontale della faccia
  if (nz > 0) { nx = -nx; nz = -nz; }          // quella rivolta verso la rete
  return clamp(Math.atan2(nx, -nz) / 0.55, -1, 1);
}

// Movimento verticale della punta della racchetta negli ultimi 150 ms (dal basso in alto = +1)
function tipLoft(p) {
  const h = p.hist;
  if (h.length < 2) return 0;
  const lastS = h[h.length - 1];
  let old = h[0];
  for (const s of h) if (lastS.t - s.t >= 0.15) old = s;
  const y1 = tmpV.set(0, 0, -1).applyQuaternion(lastS.q).y;
  const y0 = tmpV.set(0, 0, -1).applyQuaternion(old.q).y;
  return clamp((y1 - y0) / Math.max(0.05, lastS.t - old.t) / 3, -1, 1);
}

// Dati dello swing inviati dal telefono: p = potenza, u = traiettoria verticale (dal giroscopio),
// dt = ms trascorsi dal picco dello swing (≈ momento dell'impatto)
function phoneSwing(p, d) {
  const tl = tipLoft(p);
  const loft = typeof d.u === 'number' ? 0.7 * clamp(d.u, -1, 1) + 0.3 * tl : tl;
  const ago = clamp((+d.dt || 0) / 1000, 0, 0.2);
  return { power: clamp(+d.p || 0, 0, 1), loft, face: racketAim(p, ago) };
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
window.tennis = {
  game, ball, players, startMatch, goLobby, onSwing, onData, hittable,
  simulate(secs, onTick) { for (let i = 0; i < secs * 60; i++) { update(1 / 60, 2); if (onTick) onTick(); } },
};
