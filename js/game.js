// Tennis TV — gioco che gira sulla TV. Fino a 4 telefoni si collegano via WebRTC (PeerJS)
// e fanno da racchetta: inviano l'orientamento (la racchetta a schermo lo segue)
// e gli swing rilevati da giroscopio/accelerometro. Singolo (1 contro 1) o doppio (2 contro 2).
import * as THREE from '../vendor/three.module.min.js';
import { PEER_PREFIX, PEER_OPTIONS, PLAYER_COLORS, PLAYER_COLOR_NAMES, TEAM_NAMES } from './config.js';
import * as sound from './audio.js';
import { COURT, renderer, scene, camera, crowd, ballMesh, blob, setShadows, Trail } from './scene.js';
import { Athlete, SKIN_TONES, HAIR_COLORS } from './athlete.js';

// ---------------------------------------------------------------------------
// Costanti (metri, secondi). Asse x = larghezza campo, z = lunghezza, y = alto.
// La squadra 0 sta in basso (z > 0, vicino alla telecamera), la squadra 1 in fondo.
// ---------------------------------------------------------------------------
const { HALF_W, HALF_W_D, HALF_L, SERVICE_Z, NET_H, NET_HALF } = COURT;
const G = 9.81;
const SPIN_G = 5;              // effetto Magnus: il top spin fa scendere prima la palla, lo slice la fa galleggiare
const DRAG = 0.013;            // resistenza dell'aria (a = -DRAG·|v|·v)
const BALL_R = 0.033;
const STEP = 1 / 120;          // passo della fisica
// Zona di colpo attorno al giocatore: davanti, dietro, di lato e in altezza
const HIT_FRONT = 1.4, HIT_BACK = 0.6, REACH = 1.8, HIT_MAX_Y = 3.1;
const HUMAN_SPEED = 7.0, HUMAN_ACCEL = 26;
const JUMP_DUR = 0.65, JUMP_H = 0.7;   // salto: durata (s) e altezza (m)
const SPECIAL_NAMES = { fulmine: 'Fulmine', meteora: 'Meteora', zigzag: 'Serpente' };
const DIFF = [
  { name: 'Facile', speed: 5.0, accel: 16, hitProb: 0.78, err: 1.35, maxPow: 0.5, readsOut: 0.3 },
  { name: 'Normale', speed: 6.2, accel: 20, hitProb: 0.9, err: 1.1, maxPow: 0.75, readsOut: 0.7 },
  { name: 'Difficile', speed: 7.4, accel: 26, hitProb: 0.97, err: 0.7, maxPow: 0.95, readsOut: 0.95 },
];
const PTS = ['0', '15', '30', '40'];
const PTS_SPOKEN = ['zero', 'quindici', 'trenta', 'quaranta'];
const DEMO_NAMES = ['Rossi', 'Bianchi', 'Verdi', 'Neri'];

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

$('stage').appendChild(renderer.domElement);
camera.position.set(0, 5.4, HALF_L + 9);

// ---------------------------------------------------------------------------
// Stato del gioco
// ---------------------------------------------------------------------------
const ball = {
  pos: new THREE.Vector3(), vel: new THREE.Vector3(), spin: 0,
  held: true, tossed: false, tossTime: 0, serving: false, bounces: 0, lastHitter: 0, lastTeam: 0, hitNet: false,
  special: null, curve: 0, curveT: 0,
};
const ballShadow = blob(0.08, 0.3);
const trail = new Trail();

// Telefoni collegati: 4 posti. Il posto i comanda il giocatore i (0 e 2 squadra rossa, 1 e 3 squadra blu).
const controllers = [0, 1, 2, 3].map(slot => ({
  slot, conn: null, clientId: null, connected: false, name: '', hand: 'R',
  q: new THREE.Quaternion(), hasOrient: false, calibPhi: 0, needCalib: true, hist: [],
}));

const SHORTS = [0xf4f4f4, 0x1d2a44];
const players = [0, 1, 2, 3].map(i => {
  const team = i % 2;
  const mesh = new Athlete({
    shirt: new THREE.Color(PLAYER_COLORS[i]).getHex(), shorts: SHORTS[team],
    skin: SKIN_TONES[[0, 2, 4, 1][i]], hair: HAIR_COLORS[[1, 2, 3, 0][i]],
    band: i % 2 ? 0xffffff : null, shoeSole: new THREE.Color(PLAYER_COLORS[i]).getHex(),
  });
  scene.add(mesh.root);
  return {
    idx: i, team,
    f: team === 0 ? -1 : 1,              // direzione (in z) verso gli avversari
    pos: new THREE.Vector3(), vel: new THREE.Vector3(), target: new THREE.Vector3(),
    mesh, shadow: blob(0.35, 0.12), ctrl: controllers[i],
    speed: 0, anim: null, bodyYaw: 0, squeakT: 0, racketQ: new THREE.Quaternion(),
    pending: null, lastCross: null, cpuLetGo: false, attack: null,
    active: false, netRole: false, laneX: 0, homeZ: 0,
    energy: 0, jumpT: -1, armedUntil: 0, celebrate: null, sad: false, spinYaw: 0,
  };
});

const game = {
  mode: 'demo',          // 'demo' (CPU contro CPU dietro la lobby) | 'match'
  state: 'serve',        // serve | rally | pointOver | faultPause | matchOver
  paused: false,
  opts: { games: 3, diff: 1, doubles: false },
  teams: [[], []],       // giocatori in campo per squadra
  order: [], serveStart: 0, serveTurn: 0,
  points: [0, 0], games: [0, 0], server: 0, faults: 0,
  timer: 0, cpuServeT: 0, retargetT: 0, rally: 0, lastOutBy: 9, claims: [null, null],
};

const human = p => p.ctrl.connected;
const teamHasHuman = t => game.teams[t].some(human);
// Senza telefoni, il primo giocatore della squadra rossa si comanda con la tastiera
const isKeyboard = p => game.mode === 'match' && p.team === 0 && p === game.teams[0][0] && !teamHasHuman(0);
const isCPU = p => game.mode === 'demo' || (!human(p) && !isKeyboard(p));
const rightX = p => -p.f;                                   // la "destra" del giocatore, in x mondo
const handLocal = p => (human(p) && p.ctrl.hand === 'L' ? -1 : 1);
const handX = p => handLocal(p) * rightX(p);                // lato della racchetta, in x mondo
const nameOf = p => {
  if (human(p)) return p.ctrl.name;
  if (game.mode === 'demo') return DEMO_NAMES[p.idx];
  return isKeyboard(p) ? 'Giocatore 1' : 'CPU';
};
const teamName = t => game.teams[t].map(nameOf).join(' & ') || TEAM_NAMES[t];
const isDeuceSide = () => (game.points[0] + game.points[1]) % 2 === 0;
const winGames = () => Math.ceil(game.opts.games / 2);
const diff = () => DIFF[game.opts.diff];
const halfWidth = () => (game.opts.doubles ? HALF_W_D : HALF_W);
const partnerOf = p => game.teams[p.team].find(q => q !== p);

// Chi scende in campo: nel doppio tutti e 4; nel singolo un giocatore per squadra
// (quello col telefono, se c'è).
function chooseActive() {
  for (const p of players) p.active = false;
  for (const t of [0, 1]) {
    const a = players[t], b = players[t + 2];
    game.teams[t] = game.opts.doubles ? [a, b] : [!human(a) && human(b) ? b : a];
    for (const p of game.teams[t]) p.active = true;
  }
  for (const p of players) { p.mesh.root.visible = p.active; p.shadow.visible = p.active; }
  // Ordine di battuta: le squadre si alternano, e nel doppio anche i compagni
  const [t0, t1] = game.teams;
  game.order = game.opts.doubles ? [t0[0], t1[0], t0[1], t1[1]] : [t0[0], t1[0]];
}

function receiverOf(server) {
  const mates = game.teams[1 - server.team];
  return mates.length === 1 ? mates[0] : mates[isDeuceSide() ? 0 : 1];
}

// ---------------------------------------------------------------------------
// Fisica della palla
// ---------------------------------------------------------------------------
// Avanza la palla di h secondi. Ritorna una maschera: 1 = rimbalzo, 2 = rete.
function stepBall(b, h) {
  const sp = b.vel.length();
  if (sp > 0) b.vel.multiplyScalar(Math.max(0, 1 - DRAG * sp * h));
  b.vel.y -= (G + b.spin * SPIN_G) * h;
  if (b.curve) { b.curveT += h; b.vel.x += Math.cos(b.curveT * 7) * b.curve * h; }   // colpo speciale "a serpente"
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
    b.curve = 0;
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

const inCourt = (x, z) => Math.abs(x) <= halfWidth() + BALL_R && Math.abs(z) <= HALF_L + BALL_R;

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

// Il giocatore a rete può intercettare la palla al volo prima del rimbalzo?
function predictVolley(p) {
  if (ball.bounces > 0 || ball.serving) return null;
  const s = { pos: ball.pos.clone(), vel: ball.vel.clone(), spin: ball.spin };
  const maxSp = isCPU(p) ? diff().speed : HUMAN_SPEED;
  for (let i = 1; i < 300; i++) {
    const pz = s.pos.z;
    if (stepBall(s, STEP) & 1) return null;
    if ((pz - p.pos.z) * p.f > 0 && (s.pos.z - p.pos.z) * p.f <= 0) {
      const t = i * STEP, ok = s.pos.y > 0.35 && s.pos.y < 2.6 && Math.abs(s.pos.x - p.pos.x) < REACH + maxSp * t * 0.8;
      return ok ? { x: s.pos.x, z: p.pos.z, y: s.pos.y, volley: true } : null;
    }
  }
  return null;
}

// Punto in cui il giocatore può raggiungere la palla prima del rimbalzo (per gli attacchi al volo)
function predictAirIntercept(p) {
  const s = { pos: ball.pos.clone(), vel: ball.vel.clone(), spin: ball.spin };
  const maxSp = isCPU(p) ? diff().speed : HUMAN_SPEED;
  for (let i = 1; i < 400; i++) {
    if (stepBall(s, STEP) & 1) return null;
    if (s.pos.z * p.f >= 0 || s.pos.y < 0.5 || s.pos.y > HIT_MAX_Y - 0.4) continue;
    const t = i * STEP, d = Math.hypot(s.pos.x - p.pos.x, s.pos.z - p.pos.z) - REACH * 0.6;
    if (d <= maxSp * t * 0.85) return { x: s.pos.x, z: s.pos.z, y: s.pos.y };
  }
  return null;
}

// Nel doppio: quale dei due compagni va sulla palla
function claimerOf(team) {
  const mates = game.teams[team];
  if (ball.lastTeam === team || !mates.length) return null;
  if (game.rally === 1) return { p: receiverOf(players[game.server]), pt: predictContact(mates[0]) };
  for (const q of mates) if (q.netRole) { const v = predictVolley(q); if (v) return { p: q, pt: v }; }
  const c = predictContact(mates[0]);
  if (!c) return null;
  const backs = mates.filter(q => !q.netRole), pool = backs.length ? backs : mates;
  let best = pool[0];
  for (const q of pool) if (Math.abs(q.pos.x - c.x) + 0.4 * Math.abs(q.pos.z - c.z) < Math.abs(best.pos.x - c.x) + 0.4 * Math.abs(best.pos.z - c.z)) best = q;
  return { p: best, pt: c };
}

function chase(p, pt) {
  if (!pt) return;
  const fh = (pt.x - p.pos.x) * handX(p) >= -0.5;
  const z = pt.volley ? Math.abs(p.pos.z) : clamp(Math.abs(pt.z) + 0.3, 2.0, HALF_L + 4);
  p.target.set(clamp(pt.x - handX(p) * (fh ? 0.8 : -0.8), -HALF_W_D - 4, HALF_W_D + 4), 0, -p.f * z);
}

function retarget(p) {
  if (game.state !== 'rally' || !p.active) return;
  if (p.attack) { p.target.set(p.attack.pt.x - handX(p) * 0.7, 0, p.attack.pt.z); return; }
  const mates = game.teams[p.team];
  if (ball.lastTeam === p.team) {
    // Ci si rimette in posizione: al centro nel singolo, ognuno nella sua metà nel doppio
    if (mates.length === 1) p.target.set(clamp(ball.pos.x * 0.15, -1.5, 1.5), 0, -p.f * (HALF_L + 0.6));
    else if (p.netRole) p.target.set(clamp(ball.pos.x * 0.4 + p.laneX * 1.4, -HALF_W_D, HALF_W_D), 0, -p.f * p.homeZ);
    else p.target.set(p.laneX * 2.6, 0, -p.f * (HALF_L + 0.6));
    return;
  }
  if (mates.length === 1) { chase(p, predictContact(p)); return; }
  const claim = game.claims[p.team];
  if (claim && claim.p === p) chase(p, claim.pt);
  // il giocatore di dietro segue sempre la palla: se il compagno a rete la manca, ci arriva lui
  else if (!p.netRole && (!claim || claim.p.netRole)) chase(p, predictContact(p));
  else if (p.netRole) p.target.set(clamp(ball.pos.x * 0.4 + p.laneX * 1.4, -HALF_W_D, HALF_W_D), 0, -p.f * p.homeZ);
  else p.target.set(p.laneX * 2.6, 0, -p.f * (HALF_L + 0.6));
}
function retargetAll() {
  if (game.state === 'rally' && game.opts.doubles) game.claims = [claimerOf(0), claimerOf(1)];
  players.forEach(retarget);
}

// ---------------------------------------------------------------------------
// Colpi
// ---------------------------------------------------------------------------
// Posizione della palla rispetto al giocatore: rel = metri davanti (verso la rete), lat = di lato
const relOf = p => (ball.pos.z - p.pos.z) * p.f;
const approachOf = p => -ball.vel.z * p.f;

// La palla è nella zona di colpo del giocatore?
function hittable(p) {
  if (!p.active || game.state !== 'rally' || ball.lastTeam === p.team || ball.serving || ball.bounces > 1) return false;
  if (game.rally === 1 && p !== receiverOf(players[game.server])) return false;   // risponde al servizio solo chi riceve
  if (ball.pos.z * p.f >= 0) return false;              // deve essere nella propria metà campo
  const rel = relOf(p);
  return rel <= HIT_FRONT && rel >= -HIT_BACK && Math.abs(ball.pos.x - p.pos.x) <= REACH && ball.pos.y <= HIT_MAX_Y + jumpHeight(p);
}

// Salto: il giocatore si alza da terra; se la barra dell'energia è piena, il colpo successivo è speciale
const jumpHeight = p => (p.jumpT >= 0 ? 4 * JUMP_H * (p.jumpT / JUMP_DUR) * (1 - p.jumpT / JUMP_DUR) : 0);
function startJump(p) {
  if (!p.active || p.jumpT >= 0 || game.paused) return;
  p.jumpT = 0;
  if (p.energy >= 1 && game.mode === 'match') {
    p.armedUntil = now() + 1.6;
    if (!isCPU(p)) showMessage('⚡ Colpo speciale pronto!', 'Colpisci adesso!', 1.2);
    sendTo(p, { t: 'armed' });
  }
}
function addEnergy(p, v) {
  const before = p.energy;
  p.energy = clamp(p.energy + v, 0, 1);
  if (p.energy !== before) { sendTo(p, { t: 'energy', v: p.energy }); updateEnergyHud(); }
}

// timing: +1 = colpita molto davanti (in anticipo), -1 = molto indietro (in ritardo)
const timingFrom = dt => clamp((dt - 0.05) / 0.25, -1, 1);

// sw = { power 0..1, loft -1..1 (swing dall'alto in basso / dal basso in alto), face -1..1 o null (mira data dalla racchetta) }
function doHit(p, timing, sw) {
  if (p.energy >= 1 && (p.jumpT >= 0 || p.armedUntil > now())) { doSpecial(p, sw); return; }
  const phone = sw.face != null;
  // col telefono si sbaglia meno (la direzione la decide la racchetta), e il "punto dolce" premia
  const cpu = isCPU(p), errMul = (cpu ? diff().err : phone ? 0.6 : 1) * (Math.abs(timing) < 0.3 ? 0.75 : 1);
  const hl = handLocal(p), fh = (ball.pos.x - p.pos.x) * handX(p) >= 0;
  const P = clamp(sw.power, 0, 1), L = clamp(sw.loft, -1, 1);
  const high = ball.pos.y > 2.0;
  const volley = ball.bounces === 0 && Math.abs(p.pos.z) < SERVICE_Z + 1;
  let type = 'drive';
  if ((high || p.jumpT >= 0) && L < 0.3 && P > 0.2) type = 'smash';
  else if (P < 0.3 && L > 0.35) type = 'lob';
  else if (P < 0.2 && L < -0.25) type = 'drop';

  // Direzione: in anticipo = incrociato, in ritardo = lungo linea; col telefono conta soprattutto l'angolo della racchetta
  let aim = timing * (fh ? -hl : hl);
  if (phone) aim = 0.2 * aim + 0.8 * sw.face;
  const err = (0.25 + 1.0 * Math.abs(timing) ** 3 + 0.7 * P * P + (type === 'smash' ? 0.25 : 0)) * errMul;
  const tx = rightX(p) * aim * (halfWidth() - 0.4) + gauss() * err * (phone ? 0.35 : 0.5);

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
      if (volley) { depth -= 1.2; vh *= 0.85; clear = 0.15; }
  }
  const tz = p.f * (depth + gauss() * err * (phone ? 0.3 : 0.45));

  ball.vel.copy(solveShot(ball.pos, tx, tz, vh, spin, clear));
  // Colpi sbagliati di brutto possono finire in rete
  if (type !== 'lob' && Math.abs(timing) > 0.4 && Math.random() < 0.04 * errMul * (timing * timing + P * P)) ball.vel.y -= 0.8 + Math.random();
  ball.spin = spin;
  ball.lastHitter = p.idx;
  ball.lastTeam = p.team;
  ball.bounces = 0;
  ball.serving = false;
  ball.hitNet = false;
  ball.special = null;
  ball.curve = 0;
  if (!human(p) || !p.ctrl.hasOrient) startAnim(p, type === 'smash' ? 'serve' : fh ? 'fh' : 'bh');
  if (P > 0.8 || type === 'smash') sound.grunt(P);
  addEnergy(p, 0.2 + (P > 0.7 ? 0.05 : 0));
  afterHit(p, P);
}

// Colpi speciali (salto con la barra dell'energia piena): scia viola e grido "PACIULLOOO".
// Swing normale/forte = Fulmine (velocissimo e radente), dal basso in alto = Meteora (sale altissima
// e precipita), dall'alto in basso = Serpente (fa lo slalom in aria).
function doSpecial(p, sw) {
  const kind = sw.loft > 0.35 ? 'meteora' : sw.loft < -0.3 ? 'zigzag' : 'fulmine';
  const aim = sw.face != null ? sw.face : (Math.random() < 0.5 ? -0.8 : 0.8);
  const hw = halfWidth() - 0.5;
  let tx, tz, vh, spin, clear;
  if (kind === 'fulmine') { tx = aim * hw; tz = HALF_L - 0.8; vh = 44; spin = 0.3; clear = 0.08; }
  else if (kind === 'meteora') { tx = aim * hw * 0.7; tz = HALF_L - 1.5; vh = 15; spin = 2.2; clear = 4; }
  else { tx = aim * hw * 0.4; tz = HALF_L - 2.5; vh = 30; spin = 0.4; clear = 0.25; }
  tx *= rightX(p);
  ball.vel.copy(solveShot(ball.pos, tx, p.f * tz, vh, spin, clear));
  Object.assign(ball, { spin, lastHitter: p.idx, lastTeam: p.team, bounces: 0, serving: false, hitNet: false,
    special: kind, curve: kind === 'zigzag' ? 32 : 0, curveT: 0 });
  p.energy = 0;
  p.armedUntil = 0;
  sendTo(p, { t: 'energy', v: 0 });
  updateEnergyHud();
  if (!human(p) || !p.ctrl.hasOrient) startAnim(p, 'serve');
  showMessage('PACIULLOOOO!', `⚡ ${nameOf(p)}: ${SPECIAL_NAMES[kind]}`, 1.8);
  $('message').classList.add('special');
  shout();
  sound.swoosh();
  crowd.excite(0.8);
  afterHit(p, 1);
}

// "PACIULLOOOOO!" gridato con la voce del sistema, oppure sintetizzato
function shout() {
  if (game.mode !== 'match') return;
  let spoken = false;
  try {
    if ('speechSynthesis' in window && speechSynthesis.getVoices().length) {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance('Paciulloooooo!');
      u.lang = 'it-IT'; u.rate = 0.8; u.pitch = 1.5; u.volume = 1;
      speechSynthesis.speak(u);
      spoken = true;
    }
  } catch (e) { /* niente voce */ }
  if (!spoken) sound.paciullo();
}

function afterHit(p, power) {
  for (const q of players) { q.pending = null; q.lastCross = null; q.attack = null; }
  ballMesh.material.emissive.setHex(ball.special ? 0x7a20c0 : 0x3a4200);   // palla viola durante i colpi speciali
  game.rally++;
  sound.hit(0.35 + power * 0.65);
  // Ogni tanto, quando un giocatore vero colpisce, si sente il verso di un animale
  if (!isCPU(p) && Math.random() < 0.15) { const label = sound.animal(); if (label) popAnimal(label); }
  sound.crowdLevel(0.015, 0.6);
  sendTo(p, { t: 'hit', s: power });
  retargetAll();
  // La CPU, se è brava, lascia andare le palle che finiranno fuori
  for (const o of game.teams[1 - p.team]) {
    o.cpuLetGo = false;
    if (isCPU(o) && !ball.serving) {
      const c = predictContact(o);
      o.cpuLetGo = !!(c && c.first && c.first.out && Math.random() < diff().readsOut);
    }
  }
}

function serveToss(p) {
  ball.held = false;
  ball.tossed = true;
  ball.tossTime = now();
  ball.pos.set(p.pos.x + handX(p) * 0.25, 1.6, p.pos.z + p.f * 0.35);
  ball.vel.set(0, 5.4, 0);
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
  ball.lastTeam = p.team;
  ball.bounces = 0;
  ball.hitNet = false;
  if (!human(p) || !p.ctrl.hasOrient) startAnim(p, 'serve');
  game.state = 'rally';
  setHint();
  showSpeed(ball.vel.length());
  if (pf > 0.75) sound.grunt(pf);
  afterHit(p, pf);
}

// Swing arrivato da un telefono (o dalla tastiera)
function onSwing(p, sw) {
  const t = now();
  if (!(human(p) && p.ctrl.hasOrient)) startAnim(p, ball.pos.y > 2.1 ? 'serve' : (ball.pos.x - p.pos.x) * handX(p) >= 0 ? 'fh' : 'bh');
  if (game.mode !== 'match' || game.paused || !p.active) return;
  if (game.state === 'serve' && game.server === p.idx) {
    if (ball.held) serveToss(p);
    else if (ball.tossed && t - ball.tossTime > 0.18 && ball.pos.y > 1.5) serveHit(p, sw);
    return;
  }
  if (game.state !== 'rally' || ball.lastTeam === p.team) return;
  const rel = relOf(p), appr = approachOf(p);
  const dt = appr > 0.5 ? rel / appr : 0;
  if (hittable(p)) {
    // La palla è già a portata (anche alta o prima del rimbalzo): si colpisce subito
    doHit(p, timingFrom(dt), sw);
  } else if (rel > 0 && appr > 0.5 && dt <= 0.5) {
    // Swing un po' in anticipo: il colpo parte quando la palla entra nella zona
    p.pending = { time: t, timing: timingFrom(dt), sw };
  } else if (rel > 0 && appr > 0.5 && ball.bounces === 0 && !ball.serving && game.rally > 1) {
    // Swing molto in anticipo con la palla ancora in volo: il giocatore scatta e la prende al volo
    const pt = predictAirIntercept(p);
    if (pt) { p.attack = { time: t, sw, pt }; p.target.set(pt.x - handX(p) * 0.7, 0, pt.z); }
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
  if (!p.active || ball.lastTeam === p.team || game.state !== 'rally') return;
  const t = now();
  if (!isCPU(p) && p.attack) {
    if (ball.bounces > 0 || t - p.attack.time > 3) p.attack = null;
    else if (hittable(p) && relOf(p) <= 0.3) { const sw = p.attack.sw; p.attack = null; doHit(p, 0, sw); return; }
  }
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
    // La CPU colpisce quando la palla le passa accanto (anche alta: smash; prima del rimbalzo: volée)
    // contro un colpo speciale anche la CPU fa fatica
    if (crossing && hittable(p) && !p.cpuLetGo && Math.random() < diff().hitProb * (ball.special ? 0.5 : 1)) {
      if (p.energy >= 1 && game.mode === 'match' && Math.random() < 0.5) startJump(p);
      doHit(p, (Math.random() * 2 - 1) * 0.8, cpuSwing());
    }
  } else if (crossing && Math.abs(ball.pos.x - p.pos.x) <= REACH && ball.pos.y <= HIT_MAX_Y) {
    p.lastCross = { time: t, pos: ball.pos.clone() };
  }
}

// ---------------------------------------------------------------------------
// Regole e punteggio (per squadra)
// ---------------------------------------------------------------------------
function onBounce() {
  if (game.state !== 'rally') return;
  const side = ball.pos.z > 0 ? 0 : 1;
  const h = ball.lastTeam, o = 1 - h;
  if (ball.serving) {
    const sideSign = -rightX(players[game.server]) * (isDeuceSide() ? 1 : -1);
    const inBox = side === o && Math.abs(ball.pos.z) <= SERVICE_Z + BALL_R &&
      ball.pos.x * sideSign >= -BALL_R && Math.abs(ball.pos.x) <= HALF_W + BALL_R;
    game.lastOutBy = Math.max(Math.abs(ball.pos.z) - SERVICE_Z, Math.abs(ball.pos.x) - HALF_W, -ball.pos.x * sideSign);
    if (inBox) { ball.serving = false; ball.bounces = 1; }
    else fault(ball.hitNet ? 'Rete!' : 'Fallo!');
    return;
  }
  if (ball.bounces === 0) {
    game.lastOutBy = Math.max(Math.abs(ball.pos.z) - HALF_L, Math.abs(ball.pos.x) - halfWidth());
    if (side === o && inCourt(ball.pos.x, ball.pos.z)) ball.bounces = 1;
    else pointTo(o, side === h && ball.hitNet ? 'Rete!' : 'Fuori!');
  } else if (game.rally === 1) {
    pointTo(h, 'Ace!');
  } else {
    pointTo(h, game.mode === 'match' && human(players[ball.lastHitter]) ? 'Vincente!' : 'Punto!');
  }
}

function fault(reason) {
  game.faults++;
  if (game.faults >= 2) { pointTo(1 - players[game.server].team, 'Doppio fallo!'); return; }
  game.state = 'faultPause';
  game.timer = 1.6;
  if (game.lastOutBy < 0.3 || reason === 'Rete!') sound.ooh(0.7);
  sound.crowdLevel(0.05, 1);
  showMessage(reason, 'Seconda di servizio');
  say(reason === 'Rete!' ? 'Rete. Seconda' : 'Fallo');
}

function scoreLine() {
  const s = players[game.server].team, a = game.points[s], b = game.points[1 - s];
  if (a >= 3 && b >= 3) {
    if (a === b) return { text: 'Parità', spoken: 'Parità' };
    const lead = teamName(a > b ? s : 1 - s);
    return { text: `Vantaggio ${lead}`, spoken: `Vantaggio ${lead}` };
  }
  if (a === b) return { text: `${PTS[a]} pari`, spoken: `${PTS_SPOKEN[a]} pari` };
  return { text: `${PTS[a]} - ${PTS[b]}`, spoken: `${PTS_SPOKEN[a]} ${PTS_SPOKEN[b]}` };
}

// Reazione del pubblico a fine punto
function crowdReaction(reason) {
  sound.crowdLevel(0.08, 1.5);
  if (reason === 'Doppio fallo!') { sound.groan(); crowd.excite(0.2); return; }
  if (reason === 'Ace!' || game.rally >= 9) { sound.cheer(game.rally >= 14 ? 1.3 : 1); crowd.excite(1); return; }
  if ((reason === 'Fuori!' && game.lastOutBy < 0.35) || reason === 'Rete!') sound.ooh(reason === 'Rete!' ? 0.6 : 1);
  sound.applause(0.6 + Math.min(game.rally, 10) * 0.06, 2 + Math.min(game.rally, 10) * 0.12);
  crowd.excite(0.3 + Math.min(game.rally, 10) * 0.05);
}

function pointTo(w, reason) {
  if (game.state !== 'rally' && game.state !== 'serve' && game.state !== 'faultPause') return;
  game.points[w]++;
  game.timer = 2.8;
  game.state = 'pointOver';
  for (const p of players) {
    p.target.copy(p.pos);
    p.attack = null;
    if (!p.active) continue;
    if (p.team === w) p.celebrate = { type: CELEBRATIONS[(Math.random() * CELEBRATIONS.length) | 0], t: 0 };
    else p.sad = true;
  }
  crowdReaction(reason);
  const call = reason === 'Fuori!' ? 'Fuori. ' : reason === 'Ace!' ? 'Ace. ' : '';
  const [a, b] = [game.points[w], game.points[1 - w]];
  if (a >= 4 && a - b >= 2) {
    game.games[w]++;
    game.points = [0, 0];
    game.serveTurn++;
    game.server = game.order[(game.serveStart + game.serveTurn) % game.order.length].idx;
    if (game.games[w] >= winGames()) {
      if (game.mode === 'demo') { game.games = [0, 0]; }
      else {
        game.state = 'matchOver';
        game.timer = 7;
        showMessage('Partita!', `Vince ${teamName(w)} ${game.games[w]}-${game.games[1 - w]}`, 6.5);
        say(`${call}Gioco, partita e incontro: ${teamName(w)}`);
        sound.cheer(1.5);
        sound.applause(1.6, 5);
        crowd.excite(1.3);
        updateHud();
        notifyPhones();
        return;
      }
    }
    showMessage(reason, `Gioco ${teamName(w)} · ${game.games[0]}-${game.games[1]}`);
    say(`${call}Gioco ${teamName(w)}`);
    sound.applause(1.1, 3);
    crowd.excite(0.7);
  } else {
    const sc = scoreLine();
    showMessage(reason, sc.text);
    say(call + sc.spoken);
  }
  updateHud();
  notifyPhones();
}

const CELEBRATIONS = ['braccia', 'pugno', 'giravolta', 'inchino', 'salto'];

function nextPoint(keepFaults = false) {
  game.state = 'serve';
  Object.assign(ball, { special: null, curve: 0 });
  ballMesh.material.emissive.setHex(0x3a4200);
  game.rally = 0;
  if (!keepFaults) game.faults = 0;
  const s = players[game.server], r = receiverOf(s);
  const side = isDeuceSide() ? 1 : -1;
  for (const p of players) {
    p.netRole = false;
    p.pending = null; p.lastCross = null; p.cpuLetGo = false; p.anim = null; p.attack = null;
    p.celebrate = null; p.sad = false; p.spinYaw = 0; p.jumpT = -1; p.armedUntil = 0;
    p.vel.set(0, 0, 0);
  }
  s.pos.set(rightX(s) * side * (game.opts.doubles ? 1.6 : 0.9), 0, -s.f * (HALF_L + 0.35));
  r.pos.set(rightX(r) * side * (game.opts.doubles ? 3.4 : 2.8), 0, -r.f * (HALF_L + 0.5));
  if (game.opts.doubles) {
    // Il compagno di chi serve sta a rete, quello di chi risponde sulla linea del servizio
    const sp = partnerOf(s), rp = partnerOf(r);
    sp.netRole = true; sp.homeZ = 3.6;
    sp.pos.set(-rightX(s) * side * 2.6, 0, -s.f * sp.homeZ);
    rp.netRole = true; rp.homeZ = 6.2;
    rp.pos.set(-rightX(r) * side * 2.6, 0, -r.f * rp.homeZ);
  }
  for (const p of players) {
    if (!p.active) p.pos.set((p.idx < 2 ? 1 : -1) * 3, 0, (p.team ? -1 : 1) * (HALF_L + 2));
    p.laneX = Math.sign(p.pos.x) || 1;
    p.target.copy(p.pos);
  }
  Object.assign(ball, { held: true, tossed: false, serving: false, bounces: 0, lastHitter: s.idx, lastTeam: s.team, hitNet: false, spin: 0 });
  ball.vel.set(0, 0, 0);
  game.cpuServeT = game.mode === 'demo' ? 1.0 : 1.5;
  setHint();
  updateHud();
  notifyPhones();
}

function resetScore() {
  chooseActive();
  for (const p of players) p.energy = 0;
  game.points = [0, 0];
  game.games = [0, 0];
  game.serveStart = Math.random() < 0.5 ? 0 : 1;
  game.serveTurn = 0;
  game.server = game.order[game.serveStart].idx;
}

function startMatch() {
  game.mode = 'match';
  setPaused(false);
  sound.setEnabled(true);
  resetScore();
  $('lobby').hidden = true;
  $('hud').hidden = false;
  nextPoint();
  showMessage('Si gioca!', `Al servizio: ${nameOf(players[game.server])}`);
  say(`Si gioca! Al servizio ${nameOf(players[game.server])}`);
  sound.applause(1, 3);
  crowd.excite(0.6);
  sendLobby();
}

function goLobby() {
  game.mode = 'demo';
  setPaused(false);
  sound.setEnabled(false);
  resetScore();
  $('lobby').hidden = false;
  $('hud').hidden = true;
  $('message').classList.remove('show');
  nextPoint();
  updateLobby();
  sendLobby();
}

// ---------------------------------------------------------------------------
// Pausa
// ---------------------------------------------------------------------------
function setPaused(v, why = '') {
  v = v && game.mode === 'match' && game.state !== 'matchOver';
  game.paused = v;
  $('pause').hidden = !v;
  $('pauseWhy').textContent = why || `Codice stanza: ${roomCode}`;
  if (v) { try { speechSynthesis.cancel(); } catch (e) { /* niente voce */ } }
  sound.crowdLevel(v ? 0.03 : 0.07, 1);
  for (const c of controllers) sendTo(c, { t: 'paused', v });
  notifyPhones();
}

$('resumeBtn').addEventListener('click', () => setPaused(false));
$('restartBtn').addEventListener('click', () => startMatch());
$('quitBtn').addEventListener('click', () => goLobby());

// ---------------------------------------------------------------------------
// Animazioni
// ---------------------------------------------------------------------------
function startAnim(p, type) { p.anim = { type, t: 0, dur: type === 'serve' ? 0.42 : 0.32 }; }

const Y_AXIS = new THREE.Vector3(0, 1, 0);
const tmpQ = new THREE.Quaternion(), tmpE = new THREE.Euler(), tmpV = new THREE.Vector3();

function calibratedQuat(c, out, q = c.q) {
  return out.setFromAxisAngle(Y_AXIS, c.calibPhi).multiply(q);
}

// Orientamento della racchetta nel sistema del giocatore: dal telefono o da un'animazione
function updateRacket(p, dt) {
  if (human(p) && p.ctrl.hasOrient) {
    calibratedQuat(p.ctrl, tmpQ);
    p.racketQ.slerp(tmpQ, 0.85);
  } else {
    const h = handLocal(p);
    let yaw = -0.5 * h, pitch = 0.45, k = 0.25;
    if (p.anim) {
      p.anim.t += dt;
      const e = ease(Math.min(1, p.anim.t / p.anim.dur));
      if (p.anim.type === 'fh') { yaw = lerp(-2.3, 1.4, e) * h; pitch = lerp(0.1, 0.8, e); }
      else if (p.anim.type === 'bh') { yaw = lerp(2.4, -1.3, e) * h; pitch = lerp(0.2, 0.8, e); }
      else { yaw = -0.3 * h; pitch = lerp(3.4, -0.6, e); }
      k = 1;
      if (p.anim.t > p.anim.dur + 0.15) p.anim = null;
    } else if (game.state === 'serve' && game.server === p.idx && ball.tossed) {
      yaw = -0.3 * h; pitch = 2.6;
    }
    tmpQ.setFromEuler(tmpE.set(pitch, yaw, 0, 'YXZ'));
    p.racketQ.slerp(tmpQ, k);
  }
  // Il busto ruota seguendo la racchetta
  tmpV.set(0, 0, -1).applyQuaternion(p.racketQ);
  p.bodyYaw = lerp(p.bodyYaw, clamp(-tmpV.x * 0.6, -0.75, 0.75), 0.25);
}

function updatePlayer(p, dt) {
  if (!p.active) return;
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
  if (cpu && !p.anim && game.state === 'rally' && ball.lastTeam !== p.team && !ball.serving && !p.cpuLetGo) {
    const rel = relOf(p), appr = approachOf(p);
    if (rel > 0 && appr > 0 && rel / appr < 0.16 && ball.pos.z * p.f < 0 && Math.abs(ball.pos.x - p.pos.x) < REACH + 0.5) {
      startAnim(p, ball.pos.y > 2.1 ? 'serve' : (ball.pos.x - p.pos.x) * handX(p) >= 0 ? 'fh' : 'bh');
    }
  }

  updateRacket(p, dt);
  const m = p.mesh;
  if (m.hand !== handLocal(p)) m.setHand(handLocal(p));

  // Salto
  let jumpY = 0, air = 0;
  if (p.jumpT >= 0) {
    p.jumpT += dt;
    if (p.jumpT >= JUMP_DUR) p.jumpT = -1;
    else { jumpY = jumpHeight(p); air = Math.sin(Math.PI * p.jumpT / JUMP_DUR); }
  }
  const serving = game.state === 'serve' && game.server === p.idx;
  let freeMode = serving && ball.held ? 'hold' : serving && ball.tossed ? 'toss' : 'idle';
  let headDown = 0, bow = 0;
  m.crouch = game.state === 'rally' || (game.state === 'serve' && !serving) ? 0.45 : 0.2;

  // Esultanze dopo un punto vinto, testa bassa dopo un punto perso
  const c = p.celebrate;
  if (c) {
    c.t += dt;
    const up = tmpQ.setFromEuler(tmpE.set(Math.PI / 2 + Math.sin(c.t * 8) * 0.25, 0, 0, 'YXZ'));
    p.racketQ.slerp(up, 0.3);
    p.bodyYaw = lerp(p.bodyYaw, 0, 0.2);
    m.crouch = 0.15;
    if (c.type === 'braccia') { freeMode = 'up'; jumpY = Math.max(0, Math.sin(c.t * 9)) * 0.18; }
    else if (c.type === 'pugno') { freeMode = 'fist'; m.crouch = 0.5; p.racketQ.slerp(tmpQ.setFromEuler(tmpE.set(0.3, -0.6 * handLocal(p), 0, 'YXZ')), 0.3); }
    else if (c.type === 'giravolta') { freeMode = 'up'; p.spinYaw = Math.min(1, c.t / 0.8) * Math.PI * 2; }
    else if (c.type === 'inchino') { freeMode = 'bow'; bow = c.t > 0.4 ? Math.min(1, (c.t - 0.4) * 3) * (c.t < 1.8 ? 1 : Math.max(0, 1 - (c.t - 1.8) * 3)) : 0; }
    else if (c.type === 'salto') { freeMode = 'up'; const k = c.t / 0.8; if (k < 1) { jumpY = 4 * 0.75 * k * (1 - k); air = Math.sin(Math.PI * k); } }
  } else if (p.sad) {
    headDown = 1;
    m.crouch = 0.1;
  }
  m.root.position.copy(p.pos);
  m.root.position.y = jumpY;
  m.root.rotation.y = (p.team === 0 ? 0 : Math.PI) + p.spinYaw;
  m.update(dt, { speed: p.speed, bodyYaw: p.bodyYaw, racket: p.racketQ, freeMode, air, headDown, bow });
  p.shadow.position.set(p.pos.x, 0.02, p.pos.z);
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
  if (game.state === 'serve' && ball.tossed && ball.vel.y < 0 && ball.pos.y < 1.2) {
    ball.tossed = false;      // palla non colpita: si rilancia
    ball.held = true;
    setHint();
  }
  for (const p of players) playerStep(p, prevZ);
}

const spinAxis = new THREE.Vector3();
let clock = 0;
function update(dt, steps) {
  clock += dt;
  crowd.update(dt, clock, ball.pos);
  if (game.paused) return;

  game.retargetT -= dt;
  if (game.retargetT <= 0) { game.retargetT = 0.1; retargetAll(); }

  if (game.state === 'serve') {
    const s = players[game.server];
    if (isCPU(s)) {
      game.cpuServeT -= dt;
      if (ball.held && game.cpuServeT <= 0) serveToss(s);
      else if (ball.tossed && ball.vel.y < 0.4 && ball.pos.y > 1.7) {
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
    players[game.server].mesh.freeHandWorld(ball.pos);
  } else {
    // La palla ruota su se stessa: in avanti col top spin, all'indietro con lo slice
    const sp = Math.hypot(ball.vel.x, ball.vel.z);
    if (sp > 0.5) {
      spinAxis.set(ball.vel.z, 0, -ball.vel.x).normalize();
      ballMesh.rotateOnWorldAxis(spinAxis, (ball.spin * 35 + sp * 0.8) * dt);
    }
  }
  ballMesh.position.copy(ball.pos);
  trail.update(ball.pos, !!ball.special && !ball.held);
  ballShadow.position.set(ball.pos.x, 0.02, ball.pos.z);
  ballShadow.scale.setScalar(1 + Math.min(ball.pos.y, 5) * 0.15);

  // Telecamera alle spalle della squadra rossa, come in TV; a schermo diviso anche una per la squadra blu
  const split = isSplit();
  followCamera(camera, 0, split);
  if (split) followCamera(camera2, 1, true);
}

// Schermo diviso quando ci sono giocatori veri in entrambe le squadre:
// a sinistra la squadra rossa, a destra la blu, ognuna vista dalla propria metà campo
const camera2 = new THREE.PerspectiveCamera(58, 1, 0.5, 400);
camera2.position.set(0, 7.5, -(HALF_L + 11));
const isReal = p => human(p) || isKeyboard(p);
const isSplit = () => game.mode === 'match' && game.teams[0].some(isReal) && game.teams[1].some(isReal);

function followCamera(cam, team, split) {
  const s = team === 0 ? 1 : -1;                 // la squadra rossa sta dal lato z > 0
  const near = game.teams[team];
  const nx = near.reduce((a, p) => a + p.pos.x, 0) / (near.length || 1);
  const nz = Math.max(...near.map(p => p.pos.z * s), HALF_L);
  // con metà schermo l'inquadratura è più stretta: la telecamera sale e arretra un po'
  const back = split ? 11 : 9, up = split ? 7.2 : game.opts.doubles ? 5.9 : 5.4;
  cam.fov = split ? 58 : 46;
  cam.position.x = lerp(cam.position.x, nx * 0.4 + ball.pos.x * 0.1, 0.05);
  cam.position.z = lerp(cam.position.z, s * Math.max(HALF_L + back, nz + back - 1.5), 0.05);
  cam.position.y = up;
  cam.lookAt(cam.position.x * 0.5, 0.2, cam.position.z - s * 23);
}

let wasSplit = false;
function render() {
  const w = innerWidth, h = innerHeight, split = isSplit();
  if (split !== wasSplit) { document.body.classList.toggle('split', split); wasSplit = split; }
  if (!split) {
    renderer.shadowMap.autoUpdate = true;
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
    return;
  }
  // le ombre si calcolano una volta sola per entrambe le metà
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;
  renderer.setScissorTest(true);
  const half = Math.floor(w / 2);
  for (const [cam, x, cw] of [[camera, 0, half], [camera2, half, w - half]]) {
    cam.aspect = cw / h;
    cam.updateProjectionMatrix();
    renderer.setViewport(x, 0, cw, h);
    renderer.setScissor(x, 0, cw, h);
    renderer.render(scene, cam);
  }
  renderer.setScissorTest(false);
}

// Qualità automatica: se la TV fatica (meno di ~35 fotogrammi al secondo) si spengono prima le ombre,
// poi i dettagli del pubblico
let last = now(), physAcc = 0, perfFrames = 0, perfTime = 0, quality = 2;
function adaptQuality(rawDt) {
  if (quality === 0) return;
  perfFrames++; perfTime += rawDt;
  if (perfFrames < 90) return;
  if (perfTime / perfFrames > 1 / 35) {
    quality--;
    if (quality === 1) setShadows(false);
    else crowd.setLite(true);
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
  render();
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------
// Interfaccia (lobby, tabellone, messaggi)
// ---------------------------------------------------------------------------
let msgTimer = 0, toastTimer = 0, speedTimer = 0;
function showMessage(big, small = '', secs = 2.2) {
  if (game.mode !== 'match') return;
  $('message').classList.remove('special');
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
  updateEnergyHud();
  for (const t of [0, 1]) {
    const row = $('sb' + t), a = game.points[t], b = game.points[1 - t];
    row.querySelector('.name').textContent = teamName(t);
    row.querySelector('.games').textContent = game.games[t];
    row.querySelector('.pts').textContent = a >= 3 && b >= 3 ? (a > b ? 'V' : '40') : PTS[Math.min(a, 3)];
    row.querySelector('.serve').classList.toggle('on', players[game.server].team === t);
  }
}

// Barre dell'energia (colpo speciale) dei giocatori in campo
function updateEnergyHud() {
  const el = $('energy');
  if (!el) return;
  const rows = [...game.teams[0], ...game.teams[1]].map(p => {
    const full = p.energy >= 1;
    return `<div class="erow${full ? ' full' : ''}"><span class="edot" style="background:${PLAYER_COLORS[p.idx]}"></span>` +
      `<span class="ebar"><span style="width:${Math.round(p.energy * 100)}%"></span></span>${full ? '⚡' : ''}</div>`;
  });
  el.innerHTML = rows.join('');
}

let animalTimer = 0;
function popAnimal(label) {
  $('animal').textContent = label;
  $('animal').classList.add('show');
  clearTimeout(animalTimer);
  animalTimer = setTimeout(() => $('animal').classList.remove('show'), 1600);
}

function setHint() {
  let text = '';
  if (game.mode === 'match' && game.state === 'serve') {
    const s = players[game.server];
    if (!isCPU(s)) {
      const key = human(s) ? 'swing' : 'SPAZIO';
      text = ball.tossed ? `${nameOf(s)}: ${key} per servire!` : `${nameOf(s)} al servizio: ${key} per lanciare la palla`;
    }
  }
  $('hint').textContent = text;
}

function updateLobby() {
  const dbl = game.opts.doubles;
  for (const c of controllers) {
    const el = $('slot' + c.slot);
    el.classList.toggle('on', c.connected);
    el.classList.toggle('off', !dbl && c.slot >= 2 && !c.connected);
    let st;
    if (c.connected) st = `📱 ${c.name} — ${c.hand === 'L' ? 'mancino' : 'destro'}${c.hasOrient ? '' : ' (sensori in attesa…)'}`;
    else if (c.slot === 0) st = 'Libero: tastiera (SPAZIO) o CPU';
    else if (c.slot >= 2 && !dbl) st = 'Libero (si usa solo nel doppio)';
    else st = 'Libero: gioca la CPU';
    el.querySelector('.st').textContent = st;
  }
  for (const [id, key] of [['optGames', 'games'], ['optDiff', 'diff'], ['optMode', 'doubles']]) {
    for (const b of $(id).querySelectorAll('button')) b.classList.toggle('on', +b.dataset.v === +game.opts[key]);
  }
}

function setOpt(key, v) {
  if (key === 'games' && [1, 3, 5].includes(v)) game.opts.games = v;
  if (key === 'diff' && [0, 1, 2].includes(v)) game.opts.diff = v;
  if (key === 'doubles') {
    game.opts.doubles = !!v;
    if (game.mode === 'demo') { resetScore(); nextPoint(); }
  }
  updateLobby();
  sendLobby();
}

$('optGames').addEventListener('click', e => { if (e.target.dataset.v) setOpt('games', +e.target.dataset.v); });
$('optDiff').addEventListener('click', e => { if (e.target.dataset.v) setOpt('diff', +e.target.dataset.v); });
$('optMode').addEventListener('click', e => { if (e.target.dataset.v) setOpt('doubles', +e.target.dataset.v); });
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
    const p = game.teams[0][0];
    if (p && isKeyboard(p) && !e.repeat) {
      const sw = { ...KEY_SWINGS[e.code] };
      if (e.shiftKey) sw.power = 0.95;
      onSwing(p, sw);
    }
  } else if (e.code === 'KeyJ') {
    const p = game.teams[0][0];
    if (p && isKeyboard(p)) startJump(p);
  } else if (e.code === 'Enter') {
    if (game.mode === 'demo') startMatch();
    else if (game.paused) setPaused(false);
  } else if ((e.code === 'Escape' || e.code === 'KeyP') && game.mode === 'match') {
    setPaused(!game.paused);
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

function sendTo(c, msg) {
  if (c.ctrl) c = c.ctrl;
  if (c.conn && c.conn.open) { try { c.conn.send(msg); } catch (e) { /* connessione chiusa */ } }
}

function phoneStatus(c) {
  const p = players[c.slot];
  if (game.mode !== 'match') {
    if (c.slot >= 2 && !game.opts.doubles) return 'Sei in panchina: nel singolo giocano G1 e G2. Nel doppio giochi anche tu!';
    return c.slot === 0 ? 'Scegli le opzioni e premi “Inizia partita”.' : 'In attesa che il Giocatore 1 avvii la partita…';
  }
  if (!p.active) return 'Questa partita è un singolo: guardala dalla TV!';
  if (game.paused) return 'Partita in pausa.';
  switch (game.state) {
    case 'serve': {
      const s = players[game.server];
      if (s === p) return 'Al servizio! Swing per lanciare la palla, poi un altro swing quando è in alto.';
      if (receiverOf(s) === p) return 'In risposta: preparati!';
      return s.team === p.team ? 'Serve il tuo compagno: tu sei a rete, pronto per la volée.' : 'Risponde il tuo compagno: preparati.';
    }
    case 'matchOver':
      return 'Partita finita! Si torna alla lobby…';
    default:
      return 'Gioca! Swing quando la palla arriva.';
  }
}

function notifyPhones() {
  const sc = scoreLine().text;
  for (const c of controllers) {
    const t = c.slot % 2;
    sendTo(c, {
      t: 'status',
      text: phoneStatus(c),
      score: game.mode === 'match' ? `Giochi ${game.games[t]}-${game.games[1 - t]} · ${sc}` : '',
    });
  }
}

function sendLobby() {
  for (const c of controllers) {
    sendTo(c, { t: 'lobby', inLobby: game.mode !== 'match', host: c.slot === 0, opts: game.opts, paused: game.paused });
  }
  notifyPhones();
}

function welcome(c) {
  sendTo(c, { t: 'welcome', slot: c.slot, color: PLAYER_COLORS[c.slot], colorName: PLAYER_COLOR_NAMES[c.slot], team: TEAM_NAMES[c.slot % 2] });
}

function onData(conn, d) {
  if (!d || typeof d !== 'object') return;
  if (d.t === 'hello') return onHello(conn, d);
  const c = controllers[conn.slot];
  if (!c || c.conn !== conn) return;
  const p = players[c.slot];
  switch (d.t) {
    case 'o': onOrientation(c, d); break;
    case 'swing': onSwing(p, phoneSwing(c, d)); break;
    case 'jump': startJump(p); break;
    case 'calib': c.needCalib = true; if (c.hasOrient) calibrate(c); break;
    case 'hand': c.hand = d.h === 'L' ? 'L' : 'R'; updateLobby(); break;
    case 'team': if (game.mode !== 'match') switchTeam(c); break;
    case 'opt': if (c.slot === 0 && game.mode !== 'match') setOpt(d.k, +d.v); break;
    case 'start': if (c.slot === 0 && game.mode !== 'match') startMatch(); break;
    case 'pause': setPaused(true, `In pausa da ${c.name}`); break;
    case 'resume': setPaused(false); break;
    case 'restart': if (game.mode === 'match') startMatch(); break;
    case 'quit': if (game.mode === 'match') goLobby(); break;
  }
}

// Sposta il telefono nell'altra squadra (se c'è un posto libero)
function switchTeam(c) {
  const free = controllers.find(o => o.slot % 2 !== c.slot % 2 && !o.connected);
  if (!free) { sendTo(c, { t: 'status', text: 'L\'altra squadra è al completo.', score: '' }); return; }
  const from = c.slot, to = free.slot;
  controllers[to] = c; controllers[from] = free;
  c.slot = to; free.slot = from;
  c.conn.slot = to;
  players[to].ctrl = c; players[from].ctrl = free;
  welcome(c);
  toast(`📱 ${c.name} passa alla ${TEAM_NAMES[to % 2].toLowerCase()}`);
  if (game.mode === 'demo') { resetScore(); nextPoint(); }
  updateLobby();
  sendLobby();
}

function onHello(conn, d) {
  let c = controllers.find(o => o.clientId && o.clientId === d.id);
  if (!c) c = controllers.find(o => !o.connected);
  if (!c) { conn.send({ t: 'full' }); setTimeout(() => conn.close(), 500); return; }
  if (c.conn && c.conn !== conn) { try { c.conn.close(); } catch (e) { /* già chiusa */ } }
  conn.slot = c.slot;
  Object.assign(c, {
    conn, clientId: d.id, connected: true, hasOrient: false, needCalib: true, hist: [],
    name: String(d.name || '').trim().slice(0, 12) || `Giocatore ${c.slot + 1}`,
    hand: d.hand === 'L' ? 'L' : 'R',
  });
  welcome(c);
  toast(`📱 ${c.name} collegato (${PLAYER_COLOR_NAMES[c.slot]})`);
  if (game.mode === 'demo') { resetScore(); nextPoint(); }
  else if (game.paused && players[c.slot].active) setPaused(true, `${c.name} è tornato! Premi Riprendi.`);
  updateLobby();
  updateHud();
  setHint();
  sendLobby();
}

function onClose(conn) {
  const c = controllers[conn.slot];
  if (!c || c.conn !== conn) return;
  c.conn = null;
  c.connected = false;
  c.hasOrient = false;
  if (game.mode === 'match' && players[c.slot].active) {
    setPaused(true, `📱 ${c.name} si è disconnesso. Ricollegalo con il codice ${roomCode}, oppure premi Riprendi: giocherà la CPU.`);
  } else {
    toast(`📱 ${c.name} disconnesso`);
    if (game.mode === 'demo') { resetScore(); nextPoint(); }
  }
  updateLobby();
  updateHud();
  setHint();
}

// Orientamento del telefono → quaternione (convenzione di three.js DeviceOrientationControls).
// Nel sistema locale risultante la parte alta del telefono punta verso -z e lo schermo verso +y.
const D2R = Math.PI / 180;
function onOrientation(c, d) {
  if (d.a == null || d.b == null || d.g == null) return;
  c.q.setFromEuler(tmpE.set(d.b * D2R, d.a * D2R, -d.g * D2R, 'YXZ'));
  const first = !c.hasOrient;
  c.hasOrient = true;
  if (c.needCalib) calibrate(c);
  if (first) updateLobby();
  // Storia degli orientamenti (mezzo secondo): serve per la direzione e l'effetto del colpo
  const t = now();
  c.hist.push({ t, q: c.q.clone() });
  while (c.hist.length && t - c.hist[0].t > 0.5) c.hist.shift();
}

// Ruota il riferimento in modo che la direzione in cui punta ora il telefono corrisponda a "verso la rete"
function calibrate(c) {
  tmpV.set(0, 0, -1).applyQuaternion(c.q);
  c.calibPhi = Math.PI - Math.atan2(tmpV.x, tmpV.z);
  c.needCalib = false;
}

// Orientamento registrato "ago" secondi fa
function pastQuat(c, ago) {
  const t = now() - ago;
  let best = c.hist[c.hist.length - 1];
  for (const s of c.hist) if (s.t <= t) best = s;
  return best ? best.q : c.q;
}

// Direzione del colpo data dalla racchetta al momento dell'impatto: la faccia è perpendicolare al manico,
// quindi se la punta è "avanti" la palla va incrociata, se è "indietro" va dall'altra parte.
// Ritorna -1 (tutto a sinistra) .. +1 (tutto a destra) rispetto al giocatore, oppure null se incerto.
function racketAim(c, ago) {
  if (!c.hasOrient || !c.hist.length) return null;
  tmpV.set(0, 0, -1).applyQuaternion(calibratedQuat(c, tmpQ, pastQuat(c, ago)));
  const len = Math.hypot(tmpV.x, tmpV.z);
  if (len < 0.35) return null;                 // racchetta quasi verticale: direzione incerta
  let nx = tmpV.z / len, nz = -tmpV.x / len;   // normale orizzontale della faccia
  if (nz > 0) { nx = -nx; nz = -nz; }          // quella rivolta verso la rete
  return clamp(Math.atan2(nx, -nz) / 0.55, -1, 1);
}

// Movimento verticale della punta della racchetta negli ultimi 150 ms (dal basso in alto = +1)
function tipLoft(c) {
  const h = c.hist;
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
function phoneSwing(c, d) {
  const tl = tipLoft(c);
  const loft = typeof d.u === 'number' ? 0.7 * clamp(d.u, -1, 1) + 0.3 * tl : tl;
  const ago = clamp((+d.dt || 0) / 1000, 0, 0.2);
  // media di alcuni campioni attorno al momento dell'impatto: la mira è più stabile
  const aims = [ago + 0.03, ago + 0.015, ago, Math.max(0, ago - 0.015)].map(a => racketAim(c, a)).filter(a => a != null);
  const face = aims.length ? aims.reduce((x, y) => x + y, 0) / aims.length : null;
  return { power: clamp(+d.p || 0, 0, 1), loft, face };
}

// ---------------------------------------------------------------------------
// Avvio
// ---------------------------------------------------------------------------
resetScore();
updateLobby();
updateHud();
nextPoint();
startPeer();
requestAnimationFrame(frame);

// Per il debug dalla console del browser
window.tennis = {
  game, ball, players, controllers, camera, renderer, startMatch, goLobby, onSwing, onData, onClose, hittable, setOpt, setPaused,
  simulate(secs, onTick) { for (let i = 0; i < secs * 60; i++) { update(1 / 60, 2); if (onTick) onTick(); } },
};
