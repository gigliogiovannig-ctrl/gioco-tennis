// Pubblico 3D: migliaia di spettatori disegnati con poche "InstancedMesh".
// Ognuno ha busto, braccia (a riposo, ad applaudire o alzate), testa che segue la palla,
// capelli o cappellino; alcuni sventolano una bandiera.
import * as THREE from '../vendor/three.module.min.js';
import { mergeGeometries } from '../vendor/BufferGeometryUtils.js';
import { SKIN_TONES, HAIR_COLORS } from './athlete.js';

const SHIRTS = [0xc0392b, 0xe8c547, 0x2f6fae, 0xf2f2f2, 0xf2f2f2, 0x4f8a4a, 0x6c3d8f, 0xd9822b, 0x2a2a2a, 0x2a2a2a,
  0x9fc5e8, 0xe7a2b8, 0x6d4c41, 0x1f6f6a, 0x8a8f99, 0x1d2a44, 0xb7b09c];
const CAPS = [0xffffff, 0x1d2a44, 0xc0392b, 0xe8c547, 0x2f6fae, 0x2a2a2a];
const FLAGS = [0xe53935, 0x1e88e5, 0x2e9e4f, 0xffffff, 0xfdd835];
const std = (roughness = 0.85) => new THREE.MeshStandardMaterial({ color: 0xffffff, roughness, metalness: 0 });

// Segmento (braccio) da "a" a "b" come capsula
function limb(a, b, r) {
  const dir = new THREE.Vector3().subVectors(b, a), len = dir.length();
  const g = new THREE.CapsuleGeometry(r, len, 1, 5);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize()));
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return g;
}
const v = (x, y, z) => new THREE.Vector3(x, y, z);

// Coppia di braccia: dalla spalla al gomito alla mano, simmetriche
function arms(elbow, hand) {
  const parts = [];
  for (const s of [-1, 1]) {
    const sh = v(0.19 * s, 0.5, 0), el = v(elbow.x * s, elbow.y, elbow.z), ha = v(hand.x * s, hand.y, hand.z);
    parts.push(limb(sh, el, 0.05), limb(el, ha, 0.042));
  }
  return mergeGeometries(parts);
}

// Geometrie in coordinate locali: lo spettatore guarda verso -z, seduto con il bacino in y = 0
function buildGeometries() {
  const torso = new THREE.LatheGeometry([
    v(0.001, 0, 0), v(0.19, 0, 0), v(0.17, 0.22, 0), v(0.19, 0.42, 0),
    v(0.2, 0.5, 0), v(0.15, 0.58, 0), v(0.05, 0.62, 0), v(0.001, 0.62, 0),
  ].map(p => new THREE.Vector2(p.x, p.y)), 8);
  torso.scale(1, 1, 0.7);
  const thighs = [-1, 1].map(s => limb(v(0.1 * s, 0.05, 0), v(0.1 * s, 0.08, -0.38), 0.075));
  const body = mergeGeometries([torso, ...thighs]);

  const head = new THREE.SphereGeometry(0.1, 9, 7);
  head.scale(0.92, 1.1, 1);
  head.translate(0, 0.74, 0);
  const neck = new THREE.CylinderGeometry(0.045, 0.05, 0.1, 6, 1, true);
  neck.translate(0, 0.63, 0);
  const nose = new THREE.SphereGeometry(0.02, 4, 3);
  nose.translate(0, 0.72, -0.1);
  const ears = [-1, 1].map(s => { const e = new THREE.SphereGeometry(0.022, 4, 3); e.translate(0.093 * s, 0.73, 0); return e; });
  const skin = mergeGeometries([head, neck, nose, ...ears]);

  const hair = new THREE.SphereGeometry(0.106, 9, 4, 0, Math.PI * 2, 0, Math.PI * 0.45);
  hair.scale(0.96, 1.12, 1.04);
  hair.rotateX(0.45);
  hair.translate(0, 0.745, 0.008);

  const crown = new THREE.CylinderGeometry(0.1, 0.105, 0.07, 8);
  crown.translate(0, 0.83, 0.005);
  const brim = new THREE.BoxGeometry(0.15, 0.012, 0.11);
  brim.translate(0, 0.8, -0.12);
  const cap = mergeGeometries([crown, brim].map(g => g.toNonIndexed()));

  const flagPole = new THREE.CylinderGeometry(0.008, 0.008, 1.0, 5);
  flagPole.translate(0, 0.5, 0);
  const cloth = new THREE.PlaneGeometry(0.55, 0.36);
  cloth.translate(0.29, 0.82, 0);
  const flag = mergeGeometries([flagPole.toNonIndexed(), cloth.toNonIndexed()]);

  // Braccia: una sola geometria (a riposo) più due pose (applauso, braccia alzate) mescolate nello shader
  const armsGeo = arms(v(0.22, 0.27, -0.04), v(0.13, 0.2, -0.24));
  const clap = arms(v(0.25, 0.4, -0.15), v(0.03, 0.6, -0.3)), up = arms(v(0.32, 0.8, -0.02), v(0.36, 1.08, -0.06));
  armsGeo.setAttribute('posClap', clap.attributes.position);
  armsGeo.setAttribute('posUp', up.attributes.position);
  armsGeo.setAttribute('norClap', clap.attributes.normal);
  armsGeo.setAttribute('norUp', up.attributes.normal);
  return { body, skin, hair, cap, flag, arms: armsGeo };
}

// Materiale delle braccia: ogni spettatore ha la sua posa (attributo "pose": applauso, braccia alzate)
function armsMaterial() {
  const m = std(0.85);
  m.onBeforeCompile = sh => {
    sh.vertexShader = 'attribute vec3 posClap;\nattribute vec3 posUp;\nattribute vec3 norClap;\nattribute vec3 norUp;\nattribute vec2 pose;\n' +
      sh.vertexShader
        .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = normalize(mix(mix(normal, norClap, pose.x), norUp, pose.y));')
        .replace('#include <begin_vertex>', 'vec3 transformed = mix(mix(position, posClap, pose.x), posUp, pose.y);');
  };
  return m;
}

const Y = new THREE.Vector3(0, 1, 0);

export class Crowd {
  constructor(scene, seats) {
    const n = seats.length;
    this.n = n;
    this.seats = seats;
    this.level = 0;
    this.phase = new Float32Array(n);
    this.freq = new Float32Array(n);
    this.fan = new Uint8Array(n);
    this.size = new Float32Array(n);
    this.bodyYaw = new Float32Array(n);
    this.headYaw = new Float32Array(n);
    this.react = new Float32Array(n);           // prontezza nel seguire la palla
    this.hasCap = new Uint8Array(n);
    this.slot = new Int32Array(n);               // posto nella mesh dei capelli o in quella dei cappellini
    this.flagOf = [];                            // indici degli spettatori con la bandiera
    this.pose = new Float32Array(n * 2);         // applauso, braccia alzate (0..1)
    for (let i = 0; i < n; i++) this.hasCap[i] = Math.random() < 0.18 ? 1 : 0;
    const nCaps = this.hasCap.reduce((a, b) => a + b, 0);

    const geo = buildGeometries();
    const mk = (g, rough = 0.85, count = n) => {
      const m = new THREE.InstancedMesh(g, std(rough), count);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      scene.add(m);
      return m;
    };
    this.body = mk(geo.body);
    this.skin = mk(geo.skin, 0.7);
    this.hair = mk(geo.hair, 0.95, n - nCaps);
    this.cap = mk(geo.cap, 0.7, nCaps);
    this.arms = mk(geo.arms);
    this.arms.material = armsMaterial();
    this.poseAttr = new THREE.InstancedBufferAttribute(new Float32Array(n * 2), 2);
    this.poseAttr.setUsage(THREE.DynamicDrawUsage);
    geo.arms.setAttribute('pose', this.poseAttr);

    const c = new THREE.Color();
    let capK = 0, hairK = 0;
    for (let i = 0; i < n; i++) {
      const s = seats[i];
      this.phase[i] = Math.random() * Math.PI * 2;
      this.freq[i] = 7 + Math.random() * 5;
      this.fan[i] = Math.random() < 0.55 ? 1 : 0;
      this.size[i] = 0.9 + Math.random() * 0.2;
      this.react[i] = 3 + Math.random() * 5;
      // guardano verso il centro del campo
      this.bodyYaw[i] = Math.atan2(s.x, s.z * 0.9);
      this.headYaw[i] = this.bodyYaw[i];
      this.slot[i] = this.hasCap[i] ? capK++ : hairK++;
      const shirt = SHIRTS[(Math.random() * SHIRTS.length) | 0];
      const skin = SKIN_TONES[(Math.random() * SKIN_TONES.length) | 0];
      const longSleeves = Math.random() < 0.35;
      this.body.setColorAt(i, c.setHex(shirt));
      this.skin.setColorAt(i, c.setHex(skin));
      this.arms.setColorAt(i, c.setHex(longSleeves ? shirt : skin));
      if (this.hasCap[i]) this.cap.setColorAt(this.slot[i], c.setHex(CAPS[(Math.random() * CAPS.length) | 0]));
      else this.hair.setColorAt(this.slot[i], c.setHex(HAIR_COLORS[(Math.random() * HAIR_COLORS.length) | 0]));
      if (Math.random() < 0.035) this.flagOf.push(i);
    }
    this.flag = new THREE.InstancedMesh(geo.flag, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, side: THREE.DoubleSide }), this.flagOf.length);
    this.flag.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.flag.frustumCulled = false;
    this.flagOf.forEach((_, k) => this.flag.setColorAt(k, c.setHex(FLAGS[(Math.random() * FLAGS.length) | 0])));
    scene.add(this.flag);

    this.all = [this.body, this.skin, this.hair, this.cap, this.arms, this.flag];
    this.headT = 0;
    this.fullT = 0;
    this.settle = true;
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._p = new THREE.Vector3(); this._s = new THREE.Vector3();
    this.update(0, 0, null, true);
  }

  // Versione leggera per dispositivi lenti: niente braccia, capelli e bandiere
  setLite(on) { for (const m of [this.arms, this.hair, this.cap, this.flag]) m.visible = !on; }

  // Il pubblico si scalda: 0.3 = applauso, 1 = in piedi a esultare
  excite(level) { this.level = Math.max(this.level, level); this.settle = true; }

  set(mesh, i, p, yaw, s) {
    this._q.setFromAxisAngle(Y, yaw);
    this._m.compose(p, this._q, s);
    mesh.setMatrixAt(i, this._m);
  }

  update(dt, t, ball, force = false) {
    this.level = Math.max(0, this.level - dt * 0.3);
    this.headT += dt; this.fullT += dt;
    const full = force || ((this.level > 0 || this.settle) && this.fullT >= 1 / 30);
    const heads = full || this.headT >= 0.1;
    if (!heads) return;
    const hdt = this.headT;
    this.headT = 0;
    if (full) { this.fullT = 0; if (this.level <= 0) this.settle = false; }

    const L = this.level, p = this._p, s = this._s;
    for (let i = 0; i < this.n; i++) {
      const base = this.seats[i], k = this.size[i];
      // la testa si gira verso la palla (con un po' di ritardo, diverso per ognuno)
      if (ball) {
        const want = Math.atan2(base.x - ball.x, base.z - ball.z);
        let d = want - this.headYaw[i];
        d = Math.atan2(Math.sin(d), Math.cos(d));
        this.headYaw[i] += d * Math.min(1, hdt * this.react[i]);
        let rel = this.headYaw[i] - this.bodyYaw[i];
        rel = Math.atan2(Math.sin(rel), Math.cos(rel));
        if (Math.abs(rel) > 1.1) this.headYaw[i] = this.bodyYaw[i] + Math.sign(rel) * 1.1;
      }
      const standing = this.fan[i] && L > 0.45;
      const wave = Math.sin(t * this.freq[i] + this.phase[i]);
      const dy = full ? (standing ? 0.32 + Math.max(0, wave) * 0.12 * L : Math.max(0, wave) * 0.03 * L) : this.lastDy?.[i] || 0;
      if (full) (this.lastDy || (this.lastDy = new Float32Array(this.n)))[i] = dy;
      p.set(base.x, base.y + dy, base.z);
      s.setScalar(k);
      const hy = this.headYaw[i];
      this.set(this.skin, i, p, hy, s);
      this.set(this.hasCap[i] ? this.cap : this.hair, this.slot[i], p, hy, s);
      if (!full) continue;
      const by = this.bodyYaw[i];
      this.set(this.body, i, p, by, s);
      this.set(this.arms, i, p, by, s);
      // braccia: alzate (in piedi a esultare), ad applaudire, oppure a riposo (passaggio graduale)
      const clap = !standing && L > 0.12 ? 0.5 + 0.5 * Math.sin(t * 14 + this.phase[i]) : 0;
      const up = standing ? (wave > -0.3 ? 1 : 0.4) : 0;
      const k2 = i * 2, pa = this.poseAttr.array;
      pa[k2] = this.pose[k2] += (clap - this.pose[k2]) * 0.5;
      pa[k2 + 1] = this.pose[k2 + 1] += (up - this.pose[k2 + 1]) * 0.3;
    }
    if (full) this.poseAttr.needsUpdate = true;
    if (full) {
      this.flagOf.forEach((i, k) => {
        const base = this.seats[i];
        p.set(base.x, base.y + 0.55 + (this.fan[i] && L > 0.45 ? 0.32 : 0), base.z);
        s.setScalar(1);
        this.set(this.flag, k, p, this.bodyYaw[i] + Math.sin(t * 6 + this.phase[i]) * (0.25 + L * 0.8), s);
      });
    }
    for (const m of full ? this.all : [this.skin, this.hair, this.cap]) m.instanceMatrix.needsUpdate = true;
  }
}
