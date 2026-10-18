// Tennista "realistico": proporzioni umane, gambe con ginocchia, braccia con gomiti
// (posizionati con cinematica inversa), busto che ruota, racchetta con corde.
// Coordinate locali: il giocatore guarda verso -z, la sua destra è +x.
import * as THREE from '../vendor/three.module.min.js';

export const SKIN_TONES = [0xf1c9a5, 0xe3b08a, 0xc68a62, 0x8d5a3b, 0xf6d7bf, 0xa96f48];
export const HAIR_COLORS = [0x2b1d14, 0x5a3a22, 0x141414, 0xb9874b, 0x8a4b2a, 0x3b2a1e];

const std = (color, roughness = 0.75, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness, metalness: 0, ...extra });
const Y_DOWN = new THREE.Vector3(0, -1, 0);
const UPPER_ARM = 0.29, FOREARM = 0.27, THIGH = 0.44, SHIN = 0.42;

// Segmento (braccio, gamba): cilindro che parte dall'origine e scende lungo -y, con una sfera all'estremità
function segment(rTop, rBottom, len, mat) {
  const g = new THREE.Group();
  const geo = new THREE.CylinderGeometry(rTop, rBottom, len, 12);
  geo.translate(0, -len / 2, 0);
  g.add(new THREE.Mesh(geo, mat));
  const joint = new THREE.Mesh(new THREE.SphereGeometry(rBottom, 12, 8), mat);
  joint.position.y = -len;
  g.add(joint);
  return g;
}

let stringTex = null;
function stringsTexture() {
  if (stringTex) return stringTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.strokeStyle = 'rgba(245,245,235,0.95)';
  g.lineWidth = 2;
  for (let i = 4; i < 128; i += 8) {
    g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 128); g.stroke();
    g.beginPath(); g.moveTo(0, i); g.lineTo(128, i); g.stroke();
  }
  stringTex = new THREE.CanvasTexture(c);
  stringTex.colorSpace = THREE.SRGBColorSpace;
  return stringTex;
}

function makeRacket(frameColor) {
  const r = new THREE.Group();
  const black = std(0x1b1b1b, 0.6), frame = std(frameColor, 0.35, { metalness: 0.2 });
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.019, 0.2, 8), black);
  grip.rotation.x = Math.PI / 2;
  grip.position.z = -0.08;
  r.add(grip);
  // gola a "V"
  for (const s of [-1, 1]) {
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.16, 6), frame);
    beam.rotation.x = Math.PI / 2;
    beam.rotation.y = s * 0.32;
    beam.position.set(s * 0.025, 0, -0.25);
    r.add(beam);
  }
  const head = new THREE.Group();
  head.position.z = -0.48;
  head.scale.set(1, 1, 1.32);
  r.add(head);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.125, 0.011, 8, 32), frame);
  ring.rotation.x = Math.PI / 2;
  head.add(ring);
  const strings = new THREE.Mesh(new THREE.CircleGeometry(0.122, 28),
    new THREE.MeshStandardMaterial({ map: stringsTexture(), transparent: true, side: THREE.DoubleSide, roughness: 0.6, depthWrite: false }));
  strings.rotation.x = -Math.PI / 2;
  head.add(strings);
  return r;
}

// Cinematica inversa a due segmenti: dato la spalla S e il punto da raggiungere T,
// trova il gomito E (piegato verso "pole") e orienta i due segmenti.
const _d = new THREE.Vector3(), _p = new THREE.Vector3(), _e = new THREE.Vector3(), _t = new THREE.Vector3();
function solveIK(S, T, a, b, pole, upper, lower) {
  _d.subVectors(T, S);
  let dist = _d.length();
  dist = Math.min(Math.max(dist, Math.abs(a - b) + 0.01), a + b - 0.001);
  _d.normalize();
  const along = (a * a - b * b + dist * dist) / (2 * dist);
  const h = Math.sqrt(Math.max(0, a * a - along * along));
  _p.copy(pole).addScaledVector(_d, -pole.dot(_d)).normalize();
  _e.copy(S).addScaledVector(_d, along).addScaledVector(_p, h);
  upper.position.copy(S);
  upper.quaternion.setFromUnitVectors(Y_DOWN, _t.subVectors(_e, S).normalize());
  lower.position.copy(_e);
  _t.copy(S).addScaledVector(_d, dist);   // punto effettivamente raggiunto
  lower.quaternion.setFromUnitVectors(Y_DOWN, _t.sub(_e).normalize());
}

export class Athlete {
  constructor({ shirt, shorts = 0xf2f2f2, skin = SKIN_TONES[0], hair = HAIR_COLORS[0], band = null, shoeSole = 0x333333, scale = 1 }) {
    this.root = new THREE.Group();
    this.root.scale.setScalar(scale);
    this.hand = 1;
    this.walk = Math.random() * 6;
    this.crouch = 0.35;

    const mSkin = std(skin, 0.7), mShirt = std(shirt, 0.85), mShorts = std(shorts, 0.85),
      mWhite = std(0xf7f7f7, 0.8), mSole = std(shoeSole, 0.6), mHair = std(hair, 0.9), mDark = std(0x1a1a1a, 0.5);

    // Bacino e gambe
    this.hips = new THREE.Group();
    this.hips.position.y = 0.98;
    this.root.add(this.hips);
    const pelvis = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10), mShorts);
    pelvis.scale.set(0.19, 0.13, 0.13);
    this.hips.add(pelvis);
    this.legs = [-1, 1].map(s => {
      const hip = new THREE.Group();
      hip.position.set(s * 0.1, -0.03, 0);
      this.hips.add(hip);
      const thigh = segment(0.08, 0.06, THIGH, mSkin);
      hip.add(thigh);
      const shortsLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.095, 0.24, 12), mShorts);
      shortsLeg.position.y = -0.1;
      hip.add(shortsLeg);
      const knee = new THREE.Group();
      knee.position.y = -THIGH;
      hip.add(knee);
      knee.add(segment(0.058, 0.044, SHIN, mSkin));
      const sock = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.046, 0.12, 10), mWhite);
      sock.position.y = -SHIN + 0.08;
      knee.add(sock);
      const ankle = new THREE.Group();
      ankle.position.y = -SHIN;
      knee.add(ankle);
      const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.07, 0.27), mWhite);
      shoe.position.set(0, -0.045, -0.06);
      ankle.add(shoe);
      const sole = new THREE.Mesh(new THREE.BoxGeometry(0.105, 0.02, 0.275), mSole);
      sole.position.set(0, -0.085, -0.06);
      ankle.add(sole);
      return { hip, knee, ankle };
    });

    // Busto
    this.torso = new THREE.Group();
    this.torso.position.y = 0.02;
    this.hips.add(this.torso);
    const chest = new THREE.Mesh(new THREE.CylinderGeometry(0.175, 0.145, 0.5, 16), mShirt);
    chest.scale.z = 0.72;
    chest.position.y = 0.27;
    this.torso.add(chest);
    const shoulders = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10), mShirt);
    shoulders.scale.set(0.235, 0.09, 0.13);
    shoulders.position.y = 0.5;
    this.torso.add(shoulders);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.055, 0.12, 10), mSkin);
    neck.position.y = 0.6;
    this.torso.add(neck);

    // Testa
    const head = new THREE.Group();
    head.position.y = 0.75;
    this.torso.add(head);
    this.head = head;
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.105, 20, 16), mSkin);
    skull.scale.set(0.92, 1.12, 1);
    head.add(skull);
    // Capelli: calotta spostata all'indietro (la fronte resta scoperta) + nuca
    const hairCap = new THREE.Mesh(new THREE.SphereGeometry(0.111, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.42), mHair);
    hairCap.scale.set(0.96, 1.14, 1.04);
    hairCap.rotation.x = 0.45;
    hairCap.position.set(0, 0.008, 0.006);
    head.add(hairCap);
    const nape = new THREE.Mesh(new THREE.SphereGeometry(0.1, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.6), mHair);
    nape.scale.set(0.97, 1.05, 0.95);
    nape.rotation.x = 1.55;
    nape.position.set(0, 0.01, 0.012);
    head.add(nape);
    const brows = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.008, 0.01), mHair);
    brows.position.set(0, 0.04, -0.097);
    head.add(brows);
    const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.006, 0.008), std(0x9a4a3a, 0.8));
    mouth.position.set(0, -0.048, -0.093);
    head.add(mouth);
    for (const s of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 6), mSkin);
      ear.scale.set(0.5, 1, 0.8);
      ear.position.set(s * 0.097, 0, 0.005);
      head.add(ear);
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.011, 8, 6), mDark);
      eye.position.set(s * 0.035, 0.018, -0.094);
      head.add(eye);
    }
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.016, 8, 6), mSkin);
    nose.scale.set(0.8, 1, 1.2);
    nose.position.set(0, -0.005, -0.105);
    head.add(nose);
    if (band != null) {
      const hb = new THREE.Mesh(new THREE.TorusGeometry(0.102, 0.014, 6, 24), std(band, 0.9));
      hb.rotation.x = Math.PI / 2 - 0.12;
      hb.position.y = 0.045;
      head.add(hb);
    }

    // Braccia (segmenti posizionati ogni fotogramma con la cinematica inversa)
    const arm = () => {
      const upper = segment(0.05, 0.04, UPPER_ARM, mSkin);
      const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.068, 0.062, 0.13, 12), mShirt);
      sleeve.position.y = -0.05;
      upper.add(sleeve);
      const lower = segment(0.04, 0.032, FOREARM, mSkin);
      const handM = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), mSkin);
      handM.scale.set(0.8, 1.1, 0.8);
      handM.position.y = -FOREARM - 0.03;
      lower.add(handM);
      this.torso.add(upper, lower);
      return { upper, lower, hand: handM };
    };
    this.racketArm = arm();
    this.freeArm = arm();

    // La racchetta ruota attorno alla spalla: la mano sta a 0.5 m lungo la direzione della racchetta
    this.pivot = new THREE.Group();
    this.torso.add(this.pivot);
    const racket = makeRacket(shirt);
    racket.position.z = -0.5;
    this.pivot.add(racket);

    this.freeTarget = new THREE.Vector3();
    this.setHand(1);
    this.root.traverse(o => { if (o.isMesh) o.castShadow = true; });
  }

  // 1 = destro, -1 = mancino
  setHand(h) {
    this.hand = h;
    this.pivot.position.set(0.21 * h, 0.5, 0);
  }

  shoulder(side, out) { return out.set(0.21 * side, 0.5, 0); }

  // Posizione del mondo della mano libera (dove sta la palla prima del servizio)
  freeHandWorld(out) { return this.freeArm.hand.getWorldPosition(out); }

  // speed: velocità di corsa, bodyYaw: rotazione del busto, freeMode: 'idle' | 'hold' | 'toss' | 'clap',
  // racket: orientamento della racchetta nel sistema del giocatore (il busto viene compensato)
  update(dt, { speed = 0, bodyYaw = 0, freeMode = 'idle', racket = null } = {}) {
    const run = Math.min(1, speed / 3);
    this.walk += speed * dt * 2.3;
    const ph = this.walk;
    // Gambe: corsa + posizione di attesa con le ginocchia piegate
    let lowest = 0;
    this.legs.forEach((l, i) => {
      const s = i === 0 ? 1 : -1, sw = Math.sin(ph) * s;
      l.hip.rotation.x = -this.crouch * 0.6 + sw * 0.75 * run;
      l.knee.rotation.x = this.crouch + Math.max(0, -Math.sin(ph + 0.6) * s) * 1.3 * run;
      l.ankle.rotation.x = -(l.hip.rotation.x + l.knee.rotation.x) * 0.6;
      const a1 = l.hip.rotation.x, a2 = a1 + l.knee.rotation.x;
      lowest = Math.max(lowest, THIGH * Math.cos(a1) + SHIN * Math.cos(a2));
    });
    // altezza del bacino tale che il piede più basso tocchi terra (anca -0.03, suola -0.095 sotto la caviglia)
    this.hips.position.y = 0.125 + lowest + Math.abs(Math.sin(ph)) * 0.04 * run;
    this.torso.rotation.y = bodyYaw;
    this.torso.rotation.x = -0.1 - run * 0.18;
    if (racket) this.pivot.quaternion.copy(this.torso.quaternion).invert().multiply(racket);

    // Braccio con la racchetta: la mano segue l'impugnatura
    const S = this.shoulder(this.hand, _s1);
    this.pivot.updateMatrix();
    const T = _s2.set(0, 0, -0.47).applyMatrix4(this.pivot.matrix);
    solveIK(S, T, UPPER_ARM, FOREARM, _pole.set(0.6 * this.hand, -1, 0.4), this.racketArm.upper, this.racketArm.lower);

    // Braccio libero
    const h = -this.hand, ft = this.freeTarget;
    if (freeMode === 'toss') ft.set(0.12 * h, 1.05, -0.32);
    else if (freeMode === 'hold') ft.set(0.16 * h, 0.32, -0.36);
    else if (freeMode === 'clap') ft.set(0.02 * h, 0.4, -0.3);
    else ft.set(0.27 * h, 0.12 + run * 0.08, -0.12 + Math.sin(ph) * 0.25 * run);
    solveIK(this.shoulder(h, _s3), ft, UPPER_ARM, FOREARM, _pole.set(0.5 * h, -1, 0.6), this.freeArm.upper, this.freeArm.lower);
  }
}
const _s1 = new THREE.Vector3(), _s2 = new THREE.Vector3(), _s3 = new THREE.Vector3(), _pole = new THREE.Vector3();
