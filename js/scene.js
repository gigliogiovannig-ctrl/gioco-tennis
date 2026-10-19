// Scena 3D: campo, stadio, pubblico, luci e telecamera.
import * as THREE from '../vendor/three.module.min.js';
import { Athlete, SKIN_TONES, HAIR_COLORS } from './athlete.js';
import { Crowd } from './crowd.js';

// Misure del campo (metri). x = larghezza, z = lunghezza, y = altezza.
export const COURT = {
  HALF_W: 4.115,          // metà larghezza campo singolo
  HALF_W_D: 5.485,        // metà larghezza campo doppio (corridoi)
  HALF_L: 11.885,         // metà lunghezza
  SERVICE_Z: 6.40,        // linea del servizio
  NET_H: 0.95,
  NET_HALF: 5.485 + 0.914,
};
const { HALF_W, HALF_W_D, HALF_L, SERVICE_Z, NET_H, NET_HALF } = COURT;

export const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

export const scene = new THREE.Scene();
export const camera = new THREE.PerspectiveCamera(46, innerWidth / innerHeight, 0.5, 400);
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});

const std = (color, roughness = 0.85, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness, metalness: 0, ...extra });

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function grainTex(color, rx, ry, amount = 0.06) {
  const t = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = color; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 14000; i++) {
      g.fillStyle = Math.random() < 0.5 ? `rgba(255,255,255,${amount})` : `rgba(0,0,0,${amount * 1.2})`;
      g.fillRect(Math.random() * w, Math.random() * h, 1.5, 1.5);
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx, ry);
  t.anisotropy = 4;
  return t;
}

// Cielo con qualche nuvola
scene.background = canvasTex(512, 512, (g, w, h) => {
  const grd = g.createLinearGradient(0, 0, 0, h);
  grd.addColorStop(0, '#2f86d6'); grd.addColorStop(0.55, '#7ec3f2'); grd.addColorStop(1, '#d9effc');
  g.fillStyle = grd; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 14; i++) {
    const cx = Math.random() * w, cy = 30 + Math.random() * h * 0.4, r = 30 + Math.random() * 60;
    for (let k = 0; k < 6; k++) {
      const x = cx + (Math.random() - 0.5) * r * 1.6, y = cy + (Math.random() - 0.5) * r * 0.4, rr = r * (0.4 + Math.random() * 0.5);
      const cg = g.createRadialGradient(x, y, 0, x, y, rr);
      cg.addColorStop(0, 'rgba(255,255,255,0.55)'); cg.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = cg; g.fillRect(x - rr, y - rr, rr * 2, rr * 2);
    }
  }
});
scene.fog = new THREE.Fog(0xcfe8f8, 90, 200);

scene.add(new THREE.HemisphereLight(0xe6f2ff, 0x4d6b3c, 1.15));
export const sun = new THREE.DirectionalLight(0xfff1dc, 2.6);
sun.position.set(-12, 28, 14);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -18, right: 18, top: 26, bottom: -26, near: 1, far: 90 });
sun.shadow.bias = -0.0006;
sun.shadow.normalBias = 0.02;
scene.add(sun);

export function setShadows(on) {
  sun.castShadow = on;
  renderer.setPixelRatio(on ? Math.min(devicePixelRatio, 1.5) : 1);
}

function flat(w, d, mat, x, y, z) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, y, z);
  m.receiveShadow = true;
  scene.add(m);
  return m;
}
const addShadowed = obj => { obj.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } }); scene.add(obj); return obj; };

// ---------------------------------------------------------------------------
// Campo
// ---------------------------------------------------------------------------
function buildCourt() {
  flat(400, 400, std(0xffffff, 0.95, { map: grainTex('#4f8f3f', 90, 90, 0.08) }), 0, 0, 0);
  flat(2 * HALF_W_D + 7.2, 2 * HALF_L + 12.8, std(0xffffff, 0.9, { map: grainTex('#3c8a5c', 6, 12) }), 0, 0.004, 0);
  flat(2 * HALF_W_D, 2 * HALF_L, std(0xffffff, 0.8, { map: grainTex('#2e6cb0', 5, 10) }), 0, 0.008, 0);

  const paint = std(0xffffff, 0.6, { emissive: 0x222222 });
  const LW = 0.05;
  for (const s of [-1, 1]) {
    flat(2 * HALF_W_D + LW, LW * 2, paint, 0, 0.012, s * HALF_L);        // linee di fondo
    flat(LW, 2 * HALF_L, paint, s * HALF_W, 0.012, 0);                    // laterali del singolo
    flat(LW, 2 * HALF_L, paint, s * HALF_W_D, 0.012, 0);                  // laterali del doppio
    flat(2 * HALF_W, LW, paint, 0, 0.012, s * SERVICE_Z);                 // linee del servizio
    flat(LW, 0.2, paint, 0, 0.012, s * (HALF_L - 0.1));                   // segni centrali
  }
  flat(LW, 2 * SERVICE_Z, paint, 0, 0.012, 0);

  // Rete con nastro, fascia centrale e pali
  const netTex = canvasTex(512, 64, (g, w, h) => {
    g.strokeStyle = 'rgba(20,20,20,0.85)';
    g.lineWidth = 1.5;
    for (let x = 0; x <= w; x += 6) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
    for (let y = 0; y <= h; y += 6) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
  });
  netTex.wrapS = THREE.RepeatWrapping;
  netTex.repeat.set(4, 1);
  const net = new THREE.Mesh(new THREE.PlaneGeometry(2 * NET_HALF, NET_H - 0.04),
    new THREE.MeshStandardMaterial({ map: netTex, transparent: true, side: THREE.DoubleSide, depthWrite: false, roughness: 1 }));
  net.position.set(0, (NET_H - 0.04) / 2, 0);
  scene.add(net);
  const white = std(0xffffff, 0.6);
  const tape = new THREE.Mesh(new THREE.BoxGeometry(2 * NET_HALF, 0.06, 0.025), white);
  tape.position.set(0, NET_H - 0.03, 0);
  addShadowed(tape);
  const strap = new THREE.Mesh(new THREE.BoxGeometry(0.05, NET_H, 0.02), white);
  strap.position.set(0, NET_H / 2, 0);
  addShadowed(strap);
  const postMat = std(0x1f3d2c, 0.5, { metalness: 0.3 });
  for (const s of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 1.07, 12), postMat);
    post.position.set(s * NET_HALF, 0.535, 0);
    addShadowed(post);
  }

  // Cartelloni pubblicitari a bordo campo
  const ads = canvasTex(1024, 64, (g, w, h) => {
    const names = ['TENNIS TV', 'ACE SPORT', 'SMASH', 'GAME SET', 'MATCH POINT'];
    const cols = ['#0f4f8a', '#1f5f3a', '#7a1f2b', '#20303f'];
    for (let i = 0; i < 4; i++) {
      g.fillStyle = cols[i]; g.fillRect(i * 256, 0, 256, h);
      g.fillStyle = '#f2f6fa'; g.font = 'bold 34px Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(names[(i + 1) % names.length], i * 256 + 128, h / 2);
    }
  });
  ads.wrapS = THREE.RepeatWrapping;
  const adMat = std(0xffffff, 0.5, { map: ads, emissive: 0xffffff, emissiveMap: ads, emissiveIntensity: 0.25 });
  const board = (w, x, z, rotY) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 1.0, 0.12), adMat);
    m.position.set(x, 0.5, z);
    m.rotation.y = rotY;
    ads.repeat.set(1, 1);
    addShadowed(m);
  };
  board(2 * HALF_W_D + 7.2, 0, -(HALF_L + 6.4), 0);
  board(2 * HALF_L + 12.8, -(HALF_W_D + 3.6), 0, Math.PI / 2);
  board(2 * HALF_L + 12.8, HALF_W_D + 3.6, 0, -Math.PI / 2);

  // Sedia dell'arbitro con l'arbitro
  const chair = new THREE.Group();
  const frame = std(0x2d4a63, 0.5, { metalness: 0.4 });
  const box = (w, h, d, mat, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); chair.add(m); };
  for (const sx of [-0.35, 0.35]) for (const sz of [-0.35, 0.35]) box(0.06, 1.9, 0.06, frame, sx, 0.95, sz);
  box(0.9, 0.08, 0.9, frame, 0, 1.9, 0);
  box(0.9, 0.7, 0.06, frame, 0, 2.3, 0.42);
  for (const y of [0.5, 1.0, 1.5]) box(0.8, 0.04, 0.06, frame, 0, y, -0.38);
  const umpire = new Athlete({ shirt: 0x1c2a4a, shorts: 0x2a2a2a, skin: SKIN_TONES[1], hair: HAIR_COLORS[2] });
  umpire.crouch = 1.55;
  umpire.update(0, {});
  umpire.root.position.set(0, 0.95, 0.12);
  chair.add(umpire.root);
  chair.position.set(-(NET_HALF + 1.0), 0, 0);
  chair.rotation.y = -Math.PI / 2;
  addShadowed(chair);

  // Raccattapalle accovacciati ai lati della rete
  for (const s of [-1, 1]) {
    const kid = new Athlete({ shirt: 0x5b2a86, shorts: 0x5b2a86, skin: SKIN_TONES[(Math.random() * SKIN_TONES.length) | 0], hair: HAIR_COLORS[1], scale: 0.8 });
    kid.crouch = 1.4;
    kid.update(0, {});
    kid.root.position.set(s * (HALF_W_D + 2.6), 0, 0.6);
    kid.root.rotation.y = s * Math.PI / 2;
    scene.add(kid.root);
  }
}

// ---------------------------------------------------------------------------
// Stadio e pubblico
// ---------------------------------------------------------------------------
const SEAT_COLORS = [0x1b4f8a, 0x2e7d32];

// Una tribuna a gradoni: lunga "length", sale allontanandosi dal campo (verso -z locale)
function buildStand(group, length, rows, seats) {
  const concrete = [std(0xb9b4aa, 0.95), std(0xa8a398, 0.95)];
  const seatMat = std(SEAT_COLORS[seats.length % 2], 0.6);
  for (let r = 0; r < rows; r++) {
    const y = 1.3 + r * 0.45, z = -r * 0.85;
    const step = new THREE.Mesh(new THREE.BoxGeometry(length, y, 0.85), concrete[r % 2]);
    step.position.set(0, y / 2, z - 0.425);
    step.receiveShadow = true;
    group.add(step);
    const seat = new THREE.Mesh(new THREE.BoxGeometry(length, 0.1, 0.3), seatMat);
    seat.position.set(0, y + 0.05, z - 0.55);
    group.add(seat);
  }
  const top = 1.3 + rows * 0.45;
  const back = new THREE.Mesh(new THREE.BoxGeometry(length + 0.6, 2.6, 0.5), std(0x6b7480, 0.8));
  back.position.set(0, top + 1.0, -rows * 0.85 - 0.25);
  group.add(back);
  const rail = new THREE.Mesh(new THREE.BoxGeometry(length, 0.05, 0.05), std(0xdddddd, 0.3, { metalness: 0.6 }));
  rail.position.set(0, 2.25, 0.05);
  group.add(rail);
  scene.add(group);
  group.updateMatrixWorld(true);
  const v = new THREE.Vector3();
  for (let r = 0; r < rows; r++) {
    for (let x = -length / 2 + 0.35; x < length / 2 - 0.2; x += 0.56) {
      if (Math.random() < 0.07) continue;   // qualche posto vuoto
      v.set(x + (Math.random() - 0.5) * 0.08, 1.3 + r * 0.45 + 0.08, -r * 0.85 - 0.5).applyMatrix4(group.matrixWorld);
      seats.push(v.clone());
    }
  }
}

function buildLightTower(x, z) {
  const g = new THREE.Group();
  const steel = std(0x8a929c, 0.4, { metalness: 0.7 });
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.4, 24, 10), steel);
  pole.position.y = 12;
  g.add(pole);
  const panel = new THREE.Mesh(new THREE.BoxGeometry(4, 2.2, 0.4), steel);
  panel.position.set(0, 24.5, 0);
  g.add(panel);
  const lamps = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 1.8), new THREE.MeshBasicMaterial({ color: 0xfffbe8 }));
  lamps.position.set(0, 24.5, 0.21);
  g.add(lamps);
  g.position.set(x, 0, z);
  g.lookAt(0, 0, 0);
  scene.add(g);
}


function buildStadium() {
  const seats = [];
  const back = new THREE.Group();
  back.position.set(0, 0, -(HALF_L + 7.2));
  buildStand(back, 2 * HALF_W_D + 20, 14, seats);
  for (const s of [-1, 1]) {
    const side = new THREE.Group();
    side.position.set(s * (HALF_W_D + 4.6), 0, 0);
    side.rotation.y = s * Math.PI / 2 * -1;
    buildStand(side, 2 * HALF_L + 18, 13, seats);
  }
  for (const [x, z] of [[-24, -30], [24, -30], [-24, 22], [24, 22]]) buildLightTower(x, z);
  return new Crowd(scene, seats);
}

buildCourt();
export const crowd = buildStadium();

// Palla con la cucitura disegnata, così si vede girare (un po' più grande del vero per vederla sulla TV)
export const ballMesh = new THREE.Mesh(new THREE.SphereGeometry(0.07, 20, 14), new THREE.MeshStandardMaterial({
  roughness: 0.9,
  emissive: 0x3a4200,
  map: canvasTex(128, 64, (g, w, h) => {
    g.fillStyle = '#d9ef3a'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#f7fbe8'; g.lineWidth = 4; g.beginPath();
    for (let x = 0; x <= w; x++) { const y = h / 2 + Math.sin((x / w) * Math.PI * 4) * h * 0.28; x ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.stroke();
  }),
}));
ballMesh.castShadow = true;
scene.add(ballMesh);

// Scia viola della palla durante i colpi speciali
export class Trail {
  constructor(n = 36) {
    this.n = n;
    this.pts = [];
    this.mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.075, 10, 8),
      new THREE.MeshBasicMaterial({ color: 0xb03cff, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }), n);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    scene.add(this.mesh);
    this._m = new THREE.Matrix4();
  }
  update(pos, on) {
    if (on) this.pts.unshift(pos.clone());
    else this.pts.pop();
    if (this.pts.length > this.n) this.pts.length = this.n;
    this.pts.forEach((p, i) => {
      const k = 1.6 * (1 - i / this.n);
      this._m.makeScale(k, k, k).setPosition(p);
      this.mesh.setMatrixAt(i, this._m);
    });
    this.mesh.count = this.pts.length;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

export function blob(r, opacity) {
  const m = new THREE.Mesh(new THREE.CircleGeometry(r, 20),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.02;
  scene.add(m);
  return m;
}
