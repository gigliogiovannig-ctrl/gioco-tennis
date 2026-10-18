// Telefono = racchetta. Invia alla TV l'orientamento (per muovere la racchetta a schermo)
// e gli swing rilevati dal giroscopio, con la loro forza.
import { PEER_PREFIX, PEER_OPTIONS } from './config.js';

const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const store = {
  get(k, d) { try { return localStorage.getItem(k) ?? d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage non disponibile */ } },
};

let clientId = store.get('tennis.id', '');
if (!clientId) { clientId = Math.random().toString(36).slice(2, 10); store.set('tennis.id', clientId); }

const params = new URLSearchParams(location.search);
$('room').value = (params.get('room') || store.get('tennis.room', '')).toUpperCase();
$('name').value = store.get('tennis.name', '');
let hand = store.get('tennis.hand', 'R');
$('sens').value = store.get('tennis.sens', '50');

function showHand() {
  for (const id of ['handSel', 'handSel2']) for (const b of $(id).querySelectorAll('button')) b.classList.toggle('on', b.dataset.h === hand);
}
showHand();
for (const id of ['handSel', 'handSel2']) {
  $(id).addEventListener('click', e => {
    if (!e.target.dataset.h) return;
    hand = e.target.dataset.h;
    store.set('tennis.hand', hand);
    showHand();
    send({ t: 'hand', h: hand });
  });
}
$('sens').addEventListener('input', () => store.set('tennis.sens', $('sens').value));

// ---------------------------------------------------------------------------
// Audio e vibrazione (feedback quando colpisci la palla)
// ---------------------------------------------------------------------------
let actx = null;
function unlockAudio() {
  try {
    if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
  } catch (e) { /* niente audio */ }
}
function pok(k) {
  if (!actx || actx.state !== 'running') return;
  const t = actx.currentTime, o = actx.createOscillator(), g = actx.createGain();
  o.type = 'triangle';
  o.frequency.setValueAtTime(700, t);
  o.frequency.exponentialRampToValueAtTime(160, t + 0.08);
  g.gain.setValueAtTime(0.3 + 0.4 * k, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
  o.connect(g).connect(actx.destination);
  o.start(t); o.stop(t + 0.12);
}

// ---------------------------------------------------------------------------
// Sensori
// ---------------------------------------------------------------------------
let motionSeen = false, orientSeen = false;

async function enableSensors() {
  // iOS richiede un permesso esplicito, chiesto dentro il tocco dell'utente
  const DM = window.DeviceMotionEvent, DO = window.DeviceOrientationEvent;
  if (DM && typeof DM.requestPermission === 'function') {
    if (await DM.requestPermission() !== 'granted') throw new Error('Permesso sensori di movimento negato');
  }
  if (DO && typeof DO.requestPermission === 'function') {
    if (await DO.requestPermission() !== 'granted') throw new Error('Permesso orientamento negato');
  }
  addEventListener('devicemotion', onMotion);
  addEventListener('deviceorientation', onOrient);
}

let lastOrientSent = 0;
function onOrient(e) {
  if (e.alpha == null) return;
  orientSeen = true;
  const t = performance.now();
  if (t - lastOrientSent < 15) return;
  lastOrientSent = t;
  const r = v => Math.round(v * 10) / 10;
  send({ t: 'o', a: r(e.alpha), b: r(e.beta), g: r(e.gamma) });
}

// Rilevamento dello swing: picco della velocità di rotazione (gradi/s) e dell'accelerazione
let swing = null, lastSwing = 0;
function threshold() { return 650 - (+$('sens').value / 100) * 370; }   // 650..280 °/s

function onMotion(e) {
  const r = e.rotationRate;
  if (!r || r.alpha == null) return;
  motionSeen = true;
  const w = Math.hypot(r.alpha || 0, r.beta || 0, r.gamma || 0);
  const a = e.acceleration && e.acceleration.x != null
    ? Math.hypot(e.acceleration.x, e.acceleration.y, e.acceleration.z) : 0;
  const t = performance.now(), th = threshold();
  if (!swing) {
    if (w > th && t - lastSwing > 420) swing = { start: t, peakW: w, peakA: a };
    return;
  }
  swing.peakW = Math.max(swing.peakW, w);
  swing.peakA = Math.max(swing.peakA, a);
  // Invia appena la rotazione inizia a calare (o dopo 90 ms) per ridurre il ritardo
  if (w < swing.peakW * 0.85 || t - swing.start > 90) {
    const pw = clamp((swing.peakW - th) / 1000, 0, 1);
    const pa = swing.peakA ? clamp((swing.peakA - 8) / 30, 0, 1) : pw;
    const power = clamp(0.65 * pw + 0.35 * pa, 0, 1);
    send({ t: 'swing', p: Math.round(power * 100) / 100 });
    lastSwing = t;
    swing = null;
    showSwing(power);
  }
}

let swingFlashTimer = 0;
function showSwing(power) {
  $('meterFill').style.width = Math.round(15 + power * 85) + '%';
  $('swingLabel').textContent = power < 0.06 ? 'Swing lento (pallonetto)' : power > 0.75 ? 'Swing potente!' : 'Swing!';
  $('swingBox').classList.add('flash');
  clearTimeout(swingFlashTimer);
  swingFlashTimer = setTimeout(() => {
    $('swingBox').classList.remove('flash', 'hit');
    $('meterFill').style.width = '0';
    $('swingLabel').textContent = 'Fai uno swing!';
  }, 700);
}

// Tieni lo schermo acceso
let wakeLock = null;
async function keepAwake() {
  try { if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); } catch (e) { /* non supportato */ }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && conn) keepAwake(); });

// ---------------------------------------------------------------------------
// Connessione alla TV
// ---------------------------------------------------------------------------
let peer = null, conn = null;

function send(msg) {
  if (conn && conn.open) { try { conn.send(msg); } catch (e) { /* connessione chiusa */ } }
}

function joinMsg(text, ok = false) {
  $('joinMsg').textContent = text;
  $('joinMsg').classList.toggle('ok', ok);
}

$('connectBtn').addEventListener('click', async () => {
  unlockAudio();
  const room = $('room').value.trim().toUpperCase();
  if (!/^[A-Z0-9]{4}$/.test(room)) { joinMsg('Inserisci il codice di 4 caratteri mostrato sulla TV.'); return; }
  store.set('tennis.room', room);
  store.set('tennis.name', $('name').value.trim());
  try {
    await enableSensors();
  } catch (e) {
    joinMsg(e.message + '. Ricarica la pagina e consenti l\'accesso ai sensori.');
    return;
  }
  if (!window.isSecureContext) joinMsg('Attenzione: senza https il browser potrebbe bloccare i sensori.');
  connect(room);
});

function connect(room) {
  if (!window.Peer) { joinMsg('Errore: PeerJS non caricato.'); return; }
  $('connectBtn').disabled = true;
  joinMsg('Connessione in corso…', true);
  if (peer) { try { peer.destroy(); } catch (e) { /* ignora */ } }
  peer = new window.Peer(PEER_OPTIONS);
  peer.on('open', () => {
    conn = peer.connect(PEER_PREFIX + room, { serialization: 'json', reliable: true });
    conn.on('open', () => {
      send({ t: 'hello', id: clientId, name: $('name').value.trim(), hand });
      keepAwake();
    });
    conn.on('data', onData);
    conn.on('close', () => backToJoin('Connessione con la TV chiusa.'));
    conn.on('error', () => backToJoin('Errore di connessione con la TV.'));
  });
  peer.on('error', e => {
    if (e.type === 'peer-unavailable') backToJoin('Nessuna TV con questo codice. Controlla il codice sullo schermo.');
    else backToJoin('Errore di rete (' + e.type + '). Riprova.');
  });
}

function backToJoin(msg) {
  conn = null;
  $('connectBtn').disabled = false;
  $('join').hidden = false;
  $('play').hidden = true;
  joinMsg(msg);
  if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
}

function onData(d) {
  if (!d || typeof d !== 'object') return;
  switch (d.t) {
    case 'welcome':
      document.documentElement.style.setProperty('--pc', d.color);
      $('badgeText').textContent = `Giocatore ${d.slot + 1} · ${d.colorName}`;
      $('join').hidden = true;
      $('play').hidden = false;
      setTimeout(checkSensors, 2500);
      break;
    case 'full':
      backToJoin('La partita è piena (massimo 2 telefoni).');
      break;
    case 'status':
      $('status').textContent = d.text;
      $('score').textContent = d.score || '';
      break;
    case 'lobby':
      $('host').hidden = !(d.inLobby && d.host);
      for (const [id, key] of [['hostGames', 'games'], ['hostDiff', 'diff']]) {
        for (const b of $(id).querySelectorAll('button')) b.classList.toggle('on', +b.dataset.v === d.opts[key]);
      }
      break;
    case 'hit':
      pok(d.s || 0.5);
      if (navigator.vibrate) navigator.vibrate(30 + Math.round(50 * (d.s || 0.5)));
      $('swingBox').classList.add('hit');
      $('swingLabel').textContent = 'Colpita! 🎾';
      break;
  }
}

function checkSensors() {
  if (!motionSeen || !orientSeen) {
    $('warn').textContent = 'Non ricevo dati dai sensori del telefono. Serve una pagina https e un telefono con giroscopio; su iPhone consenti l\'accesso a “Movimento e orientamento”.';
  }
}

$('calibBtn').addEventListener('click', () => {
  send({ t: 'calib' });
  if (navigator.vibrate) navigator.vibrate(40);
  $('calibBtn').firstChild.textContent = '✅ Calibrato ';
  setTimeout(() => { $('calibBtn').firstChild.textContent = '🎯 Calibra'; }, 1200);
});
$('hostGames').addEventListener('click', e => { if (e.target.dataset.v) send({ t: 'opt', k: 'games', v: +e.target.dataset.v }); });
$('hostDiff').addEventListener('click', e => { if (e.target.dataset.v) send({ t: 'opt', k: 'diff', v: +e.target.dataset.v }); });
$('startBtn').addEventListener('click', () => send({ t: 'start' }));
