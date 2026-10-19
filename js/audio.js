// Suoni sintetizzati con WebAudio (nessun file esterno): colpi, rimbalzi e pubblico
// (brusio di sottofondo, applausi, "oooh", boati).
let actx = null, master = null, noiseBuf = null, crowdGain = null, enabled = false;

export function unlockAudio() {
  try {
    if (!actx) {
      actx = new (window.AudioContext || window.webkitAudioContext)();
      master = actx.createGain();
      master.gain.value = 0.9;
      master.connect(actx.destination);
    }
    if (actx.state === 'suspended') actx.resume();
  } catch (e) { /* audio non disponibile */ }
}

// I suoni si sentono solo durante la partita (non nella demo dietro la lobby)
export function setEnabled(v) {
  enabled = v;
  crowdLevel(v ? 0.07 : 0, 1.2);
}

const ready = () => enabled && actx && actx.state === 'running';

function noise() {
  if (!noiseBuf) {
    noiseBuf = actx.createBuffer(1, actx.sampleRate, actx.sampleRate);
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
  o.connect(g).connect(master);
  o.start(t); o.stop(t + dur + 0.02);
}

function burst(t, dur, freq, vol, q = 0.9) {
  const s = actx.createBufferSource(), f = actx.createBiquadFilter(), g = actx.createGain();
  s.buffer = noise();
  f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
  g.gain.setValueAtTime(Math.max(vol, 0.002), t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  s.connect(f).connect(g).connect(master);
  s.start(t, Math.random() * 0.8); s.stop(t + dur + 0.02);
}

// Tante voci sintetiche filtrate con le formanti di una vocale ("ooo", "aaa")
function voices(t, n, dur, f0, f1, glide, formants, vol, attack = 0.12) {
  const out = actx.createGain(), mix = actx.createGain();
  out.gain.setValueAtTime(0.0001, t);
  out.gain.exponentialRampToValueAtTime(vol, t + attack);
  out.gain.setValueAtTime(vol, t + dur * 0.45);
  out.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  out.connect(master);
  for (const [freq, q, gain] of formants) {
    const bp = actx.createBiquadFilter(), g = actx.createGain();
    bp.type = 'bandpass'; bp.frequency.value = freq; bp.Q.value = q;
    g.gain.value = gain;
    mix.connect(bp).connect(g).connect(out);
  }
  for (let i = 0; i < n; i++) {
    const o = actx.createOscillator(), g = actx.createGain();
    const f = f0 + Math.random() * (f1 - f0), st = t + Math.random() * 0.15;
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(f, st);
    o.frequency.linearRampToValueAtTime(f * glide, st + dur);
    g.gain.value = 1.4 / Math.sqrt(n);
    o.connect(g).connect(mix);
    o.start(st); o.stop(t + dur + 0.2);
  }
}

// --- Brusio del pubblico in sottofondo -------------------------------------
function makeMurmur() {
  const sr = actx.sampleRate, len = Math.floor(sr * 5), fade = Math.floor(sr * 0.5);
  const buf = actx.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let v = 0; v < 16; v++) {
      // una "persona" che parla: rumore filtrato modulato a sillabe, con pause
      let phase = Math.random() * 6.28, lp = 0, on = Math.random() < 0.6, next = Math.random() * sr;
      const f = 3 + Math.random() * 4, a = 0.04 + Math.random() * 0.12;
      for (let i = 0; i < len; i++) {
        if (--next <= 0) { on = Math.random() < 0.6; next = sr * (0.3 + Math.random() * 1.5); }
        lp += a * ((Math.random() * 2 - 1) - lp);
        if (!on) continue;
        phase += 6.283 * f / sr;
        const env = Math.max(0, Math.sin(phase));
        d[i] += lp * env * env * 1.2;
      }
    }
    // dissolvenza incrociata per un loop senza scatti
    for (let i = 0; i < fade; i++) d[i] = d[i] * (i / fade) + d[len - fade + i] * (1 - i / fade);
  }
  return { buf, loopEnd: (len - fade) / sr };
}

function ensureAmbient() {
  if (crowdGain) return;
  const { buf, loopEnd } = makeMurmur();
  const src = actx.createBufferSource(), bp = actx.createBiquadFilter();
  src.buffer = buf; src.loop = true; src.loopEnd = loopEnd;
  bp.type = 'bandpass'; bp.frequency.value = 650; bp.Q.value = 0.6;
  crowdGain = actx.createGain();
  crowdGain.gain.value = 0;
  src.connect(bp).connect(crowdGain).connect(master);
  src.start();
}

// Volume del brusio: alto tra un punto e l'altro, quasi silenzio durante lo scambio
export function crowdLevel(v, secs = 0.8) {
  if (!actx || actx.state !== 'running') return;
  ensureAmbient();
  const t = actx.currentTime;
  crowdGain.gain.cancelScheduledValues(t);
  crowdGain.gain.setTargetAtTime(enabled ? v * 3 : 0, t, secs / 3);
}

// --- Effetti ---------------------------------------------------------------
export function hit(k) {
  if (!ready()) return;
  const t = actx.currentTime;
  tone(t, 'sine', 1250, 650, 0.05, 0.15 + 0.3 * k);
  tone(t, 'triangle', 300, 110, 0.08, 0.12 + 0.35 * k);
  burst(t, 0.025, 3200, 0.12 + 0.3 * k, 2);
}

export function bounce(k) {
  if (!ready()) return;
  const t = actx.currentTime;
  tone(t, 'sine', 190, 85, 0.07, 0.08 + 0.3 * k);
  burst(t, 0.02, 1100, 0.05 + 0.12 * k, 1.5);
}

export function netHit() {
  if (!ready()) return;
  const t = actx.currentTime;
  burst(t, 0.18, 420, 0.45, 0.8);
  tone(t, 'sine', 120, 70, 0.15, 0.2);
}

export function toss() {
  if (!ready()) return;
  tone(actx.currentTime, 'sine', 320, 460, 0.06, 0.08);
}

export function squeak() {
  if (!ready()) return;
  tone(actx.currentTime, 'sine', 2300, 2800, 0.07, 0.06);
}

export function grunt(k) {
  if (!ready()) return;
  voices(actx.currentTime, 1, 0.22, 170, 200, 0.75, [[650, 3, 1], [1100, 4, 0.5]], 0.3 + 0.2 * k, 0.02);
}

export function applause(intensity = 1, dur = 2.5) {
  if (!ready()) return;
  const t0 = actx.currentTime, n = Math.round(55 * intensity * dur);
  for (let i = 0; i < n; i++) {
    const tt = t0 + 0.08 + dur * Math.pow(Math.random(), 1.6);
    const vol = (0.12 + Math.random() * 0.2) * intensity * (1 - ((tt - t0) / dur) * 0.6);
    burst(tt, 0.012 + Math.random() * 0.02, 900 + Math.random() * 1800, vol, 1.2);
  }
}

// "Oooh" del pubblico: palla vicina alla riga, nastro, occasione sprecata
export function ooh(k = 1) {
  if (!ready()) return;
  voices(actx.currentTime, 16, 1.4, 130, 300, 0.8, [[420, 4, 1], [800, 6, 0.5]], 0.3 * k);
}

// Boato: ace, scambio lungo, vittoria
export function cheer(k = 1) {
  if (!ready()) return;
  voices(actx.currentTime, 18, 2.0, 180, 380, 1.25, [[750, 4, 1], [1250, 5, 0.6]], 0.26 * k);
  applause(1.2 * k, 3);
}

// Sospiro deluso: doppio fallo
export function groan(k = 1) {
  if (!ready()) return;
  voices(actx.currentTime, 14, 1.2, 150, 300, 0.7, [[600, 4, 1], [1000, 5, 0.4]], 0.24 * k);
}

// --- Voci "parlate": un oscillatore con intonazione e vocali (formanti) che cambiano nel tempo ---------
// freqs: [[secondi, Hz], ...]  forms: [[secondi, [F1, F2]], ...]
function voice(t, dur, freqs, forms, vol, { vib = 0, vibRate = 6, type = 'sawtooth', q = 5 } = {}) {
  const o = actx.createOscillator(), out = actx.createGain();
  o.type = type;
  freqs.forEach(([dt, f], i) => (i ? o.frequency.linearRampToValueAtTime(f, t + dt) : o.frequency.setValueAtTime(f, t + dt)));
  if (vib) {
    const l = actx.createOscillator(), lg = actx.createGain();
    l.frequency.value = vibRate; lg.gain.value = vib;
    l.connect(lg).connect(o.frequency);
    l.start(t); l.stop(t + dur + 0.1);
  }
  out.gain.setValueAtTime(0.0001, t);
  out.gain.exponentialRampToValueAtTime(vol, t + 0.04);
  out.gain.setValueAtTime(vol, t + dur * 0.7);
  out.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  for (let k = 0; k < 2; k++) {
    const bp = actx.createBiquadFilter(), g = actx.createGain();
    bp.type = 'bandpass'; bp.Q.value = q;
    forms.forEach(([dt, fs], i) => (i ? bp.frequency.linearRampToValueAtTime(fs[k], t + dt) : bp.frequency.setValueAtTime(fs[k], t + dt)));
    g.gain.value = k ? 0.6 : 1.4;
    o.connect(bp).connect(g).connect(out);
  }
  out.connect(master);
  o.start(t); o.stop(t + dur + 0.05);
}

// Versi di animali (ogni tanto, quando si colpisce la palla). Ritorna l'etichetta da mostrare.
const ANIMALS = {
  mucca: ['🐄 Muuu!', t => voice(t, 1.3, [[0, 105], [0.3, 118], [1.3, 95]], [[0, [250, 600]], [0.35, [330, 760]], [1.3, [300, 700]]], 0.9, { vib: 3 })],
  pecora: ['🐑 Beeee!', t => voice(t, 0.9, [[0, 330], [0.9, 290]], [[0, [600, 1900]], [0.9, [560, 1800]]], 0.6, { vib: 30, vibRate: 9 })],
  gatto: ['🐱 Miao!', t => voice(t, 0.8, [[0, 450], [0.3, 820], [0.8, 500]], [[0, [400, 1000]], [0.25, [900, 1600]], [0.8, [500, 900]]], 0.5)],
  cane: ['🐶 Bau bau!', t => {
    for (const d of [0, 0.24]) { voice(t + d, 0.15, [[0, 340], [0.15, 220]], [[0, [700, 1600]]], 0.9, { q: 3 }); burst(t + d, 0.06, 1200, 0.25); }
  }],
  anatra: ['🦆 Qua qua qua!', t => { for (let i = 0; i < 3; i++) voice(t + i * 0.17, 0.12, [[0, 240], [0.12, 200]], [[0, [1000, 2400]]], 0.6, { q: 3, type: 'square' }); }],
  gallo: ['🐓 Chicchirichì!', t => voice(t, 1.3, [[0, 500], [0.15, 720], [0.3, 650], [0.5, 760], [1.0, 720], [1.3, 520]], [[0, [700, 1500]], [1.3, [600, 1300]]], 0.6, { vib: 8 })],
  asino: ['🫏 Hi-hooo!', t => {
    for (const d of [0, 0.9]) {
      voice(t + d, 0.35, [[0, 650], [0.35, 720]], [[0, [900, 2000]]], 0.55, { q: 4 });
      voice(t + d + 0.4, 0.45, [[0, 250], [0.45, 200]], [[0, [500, 900]]], 0.8);
    }
  }],
  leone: ['🦁 Roooar!', t => {
    voice(t, 1.2, [[0, 85], [0.3, 110], [1.2, 70]], [[0, [350, 800]], [1.2, [300, 700]]], 0.9, { vib: 12, vibRate: 22, q: 2 });
    burst(t, 1.0, 500, 0.35, 0.5);
  }],
  rana: ['🐸 Cra cra!', t => { for (let i = 0; i < 2; i++) voice(t + i * 0.25, 0.16, [[0, 180], [0.16, 150]], [[0, [700, 1400]]], 0.7, { type: 'square', vib: 40, vibRate: 30 }); }],
};
export function animal() {
  if (!ready()) return null;
  const keys = Object.keys(ANIMALS), [label, play] = ANIMALS[keys[(Math.random() * keys.length) | 0]];
  play(actx.currentTime + 0.05);
  return label;
}

// Grido "PACIULLOOOOO" sintetizzato (se il browser non ha la voce del sistema)
export function paciullo() {
  if (!ready()) return;
  const t = actx.currentTime;
  burst(t, 0.03, 1500, 0.5, 1);                   // "p"
  burst(t + 0.15, 0.07, 4000, 0.4, 1);            // "ci"
  voice(t, 1.7, [[0, 230], [0.12, 260], [0.3, 310], [0.5, 330], [1.7, 280]],
    [[0, [800, 1250]], [0.14, [800, 1250]], [0.2, [330, 850]], [0.36, [330, 850]], [0.45, [520, 900]], [1.7, [480, 850]]],
    0.9, { vib: 10, vibRate: 5.5 });
}

// Fruscio del colpo speciale
export function swoosh() {
  if (!ready()) return;
  const t = actx.currentTime;
  for (let i = 0; i < 6; i++) burst(t + i * 0.05, 0.25, 600 + i * 500, 0.25, 1.5);
  tone(t, 'sawtooth', 120, 900, 0.5, 0.15);
}
