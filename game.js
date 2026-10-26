import * as THREE from 'three';

const V3 = THREE.Vector3, $ = id => document.getElementById(id);
const clamp = (v, a = -1, b = 1) => Math.max(a, Math.min(b, v));
const rnd = a => (Math.random() - .5) * a;

// ===== Dimensions & physique (1 unité = 1 m, d'après les valeurs de Rocket League) =====
const W = 41, L = 51.2, H = 20.4, CUT = 11, GW = 8.9, GH = 6.4, GD = 8.8; // terrain, coins coupés, cages
const BR = 0.93, G = 6.5, DT = 1 / 120, MAXS = 23, SUPER = 22, REST = 0.38, CR = 0.6;
const HB = new V3(.42, .18, .59), HBN = HB.clone().negate(), UP = new V3(0, 1, 0), COL = [0x1e7bff, 0xff7a1a];
const KO = [[-20.48, -25.6], [20.48, -25.6], [-2.56, -38.4], [2.56, -38.4], [0, -46.08]]; // places d'engagement (bleu)
const CURV = [[0, .69], [5, .398], [10, .235], [15, .1375], [17.5, .11], [23, .088]];       // courbure selon la vitesse
const NAMES = ['Viper', 'Blaze', 'Turbo', 'Comet', 'Nitro', 'Rex', 'Flash', 'Storm'];

// ===== Rendu =====
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.prepend(renderer.domElement);
const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(78, 1, .1, 500);
scene.background = new THREE.Color(0x0b1020);
scene.fog = new THREE.Fog(0x0b1020, 120, 260);
const resize = () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); };
addEventListener('resize', resize); resize();

scene.add(new THREE.HemisphereLight(0xcfe2ff, 0x203018, 1.4));
const sun = new THREE.DirectionalLight(0xffffff, 1.6), key = new THREE.DirectionalLight(0xffffff, 1);
sun.position.set(2, 80, 1); sun.castShadow = true; sun.shadow.mapSize.set(4096, 4096);
Object.assign(sun.shadow.camera, { left: -62, right: 62, top: 62, bottom: -62, far: 150 }); sun.shadow.camera.updateProjectionMatrix();
key.position.set(-30, 40, -20);
scene.add(sun, key);

const canvasTex = (w, h, draw) => {
  const cv = Object.assign(document.createElement('canvas'), { width: w, height: h }); draw(cv.getContext('2d'));
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
};

// ===== Stade =====
const OCT = [[W, CUT - L], [W, L - CUT], [W - CUT, L], [CUT - W, L], [-W, L - CUT], [-W, CUT - L], [CUT - W, -L], [W - CUT, -L]];
const fieldTex = canvasTex(1024, 1280, x => { // haut de l'image = cage bleue, bas = cage orange
  for (let i = 0; i < 16; i++) { x.fillStyle = i % 2 ? '#2c7a33' : '#33873a'; x.fillRect(0, i * 80, 1024, 80); }
  x.fillStyle = '#1e7bff2e'; x.fillRect(0, 0, 1024, 640); x.fillStyle = '#ff7a1a2e'; x.fillRect(0, 640, 1024, 640);
  x.strokeStyle = '#ffffffd0'; x.lineWidth = 6;
  x.strokeRect(3, 3, 1018, 1274); x.strokeRect(400, -10, 224, 110); x.strokeRect(400, 1180, 224, 110);
  x.beginPath(); x.moveTo(0, 640); x.lineTo(1024, 640); x.moveTo(652, 640); x.arc(512, 640, 140, 0, 7); x.stroke();
});
const floorG = new THREE.ShapeGeometry(new THREE.Shape(OCT.map(([x, z]) => new THREE.Vector2(x, -z))));
const uv = floorG.attributes.uv, pos = floorG.attributes.position;
for (let i = 0; i < uv.count; i++) uv.setXY(i, (pos.getX(i) + W) / (2 * W), (pos.getY(i) + L) / (2 * L));
const floor = new THREE.Mesh(floorG.rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: fieldTex, roughness: .9 }));
floor.receiveShadow = true;
const outside = new THREE.Mesh(new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x10151f }));
outside.position.y = -.05;
scene.add(floor, outside);

// Murs transparents + tribunes avec public
const crowd = new THREE.MeshBasicMaterial({ map: canvasTex(256, 128, x => {
  x.fillStyle = '#141a28'; x.fillRect(0, 0, 256, 128);
  for (let i = 0; i < 900; i++) { x.fillStyle = ['#1e7bff', '#ff7a1a', '#dddddd', '#555c70', '#33384a'][i % 5]; x.fillRect(Math.random() * 256, Math.random() * 128, 3, 4); }
}) });
OCT.forEach(([x1, z1], i) => {
  const [x2, z2] = OCT[(i + 1) % 8], dx = x2 - x1, dz = z2 - z1, len = Math.hypot(dx, dz), h = len / 2, zm = (z1 + z2) / 2;
  const col = zm < -1 ? COL[0] : zm > 1 ? COL[1] : 0xffffff, g = new THREE.Group();
  const pts = Math.abs(zm) === L ? [[-h, 0], [-GW, 0], [-GW, GH], [GW, GH], [GW, 0], [h, 0], [h, H], [-h, H]] : [[-h, 0], [h, 0], [h, H], [-h, H]];
  g.add(new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape(pts.map(p => new THREE.Vector2(...p)))),
    new THREE.MeshStandardMaterial({ color: col, transparent: true, opacity: .12, side: THREE.DoubleSide, depthWrite: false })));
  const strip = new THREE.Mesh(new THREE.BoxGeometry(len, .3, .3), new THREE.MeshBasicMaterial({ color: col }));
  const standG = new THREE.PlaneGeometry(len + 12, 34).rotateX(-.96);
  standG.attributes.uv.array.forEach((v, j, a) => a[j] *= j % 2 ? 4 : len / 8);
  const stand = new THREE.Mesh(standG, crowd);
  strip.position.y = H; stand.position.set(0, 13.8, -16.9); g.add(strip, stand);
  g.position.set((x1 + x2) / 2, 0, zm); g.rotation.y = Math.atan2(-dz, dx); scene.add(g);
});

// Cages (filet, poteaux lumineux, sol)
const netTex = canvasTex(64, 64, x => { x.strokeStyle = '#fff'; x.lineWidth = 3; x.strokeRect(0, 0, 64, 64); });
netTex.repeat.set(10, 5);
[-1, 1].forEach(s => {
  const col = COL[s < 0 ? 0 : 1], none = new THREE.MeshBasicMaterial({ visible: false }), glow = new THREE.MeshBasicMaterial({ color: col });
  const net = new THREE.MeshStandardMaterial({ color: col, map: netTex, transparent: true, opacity: .55, side: THREE.DoubleSide, depthWrite: false });
  const box = new THREE.Mesh(new THREE.BoxGeometry(2 * GW, GH, GD), [net, net, net, none, s > 0 ? net : none, s > 0 ? none : net]);
  const gf = new THREE.Mesh(new THREE.PlaneGeometry(2 * GW, GD).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x1d3d22 }));
  box.position.set(0, GH / 2, s * (L + GD / 2)); gf.position.set(0, .002, s * (L + GD / 2)); gf.receiveShadow = true;
  scene.add(box, gf);
  [[.35, GH, GW, GH / 2], [.35, GH, -GW, GH / 2], [2 * GW + .35, .35, 0, GH]].forEach(([w, hh, x, y]) => {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(w, hh, .35), glow); bar.position.set(x, y, s * L); scene.add(bar);
  });
});

// Pastilles de boost (28 petites + 6 grandes, positions symétriques)
const padOn = new THREE.MeshBasicMaterial({ color: 0xffc21a }), padOff = new THREE.MeshBasicMaterial({ color: 0x4a3a10 }), pads = [];
[[[[0, 42.4], [17.9, 41.8], [9.4, 33.1], [0, 28.2], [35.8, 24.8], [17.9, 23], [20.5, 10.4], [0, 10.2], [10.2, 0]], false], [[[30.7, 41], [35.8, 0]], true]]
  .forEach(([list, big]) => list.forEach(([px, pz]) => (px ? [px, -px] : [0]).forEach(x => (pz ? [pz, -pz] : [0]).forEach(z => {
    const r = big ? 1 : .55, m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, .06, 24), padOn), orb = big && new THREE.Mesh(new THREE.SphereGeometry(.45, 16, 12), padOn);
    m.position.set(x, .03, z); scene.add(m);
    if (orb) { orb.position.set(x, 1, z); scene.add(orb); }
    pads.push({ x, z, big, t: 0, m, orb });
  }))));

// ===== Balle =====
const B = { p: new V3(), v: new V3(), mesh: new THREE.Mesh(new THREE.SphereGeometry(BR, 32, 24), new THREE.MeshStandardMaterial({ color: 0xe8e8e8, roughness: .35, metalness: .2 })) };
B.mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(BR * 1.01, 1)), new THREE.LineBasicMaterial({ color: 0x333333 })));
B.mesh.castShadow = true; scene.add(B.mesh);
const resetBall = () => { B.p.set(0, BR, 0); B.v.set(0, 0, 0); B.mesh.visible = true; };

// ===== Particules (boost, supersonique, explosions) =====
const PN = 800, pPos = new Float32Array(PN * 3), pCol = new Float32Array(PN * 3), pGeo = new THREE.BufferGeometry();
const parts = Array.from({ length: PN }, () => ({ p: new V3(), v: new V3(), c: new THREE.Color(), life: 0, max: 1 }));
pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3)); pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
const dot = canvasTex(64, 64, x => { const g = x.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, '#fff'); g.addColorStop(1, '#0000'); x.fillStyle = g; x.fillRect(0, 0, 64, 64); });
const points = new THREE.Points(pGeo, new THREE.PointsMaterial({ size: .5, map: dot, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
points.frustumCulled = false; scene.add(points);
let pi = 0;
const emit = (p, v, color, life) => { const P = parts[pi = (pi + 1) % PN]; P.p.copy(p); P.v.copy(v); P.c.set(color); P.life = P.max = life * (.5 + Math.random() / 2); };
const burst = (p, color, n, sp) => { for (let i = 0; i < n; i++) emit(p, new V3().randomDirection().multiplyScalar(sp * Math.random()), color, 1.6); };
function updParts(dt) {
  parts.forEach((P, i) => {
    if (P.life > 0) { P.life -= dt; P.p.addScaledVector(P.v, dt); P.v.multiplyScalar(1 - 2 * dt); }
    const k = Math.max(0, P.life / P.max);
    P.p.toArray(pPos, i * 3); pCol[i * 3] = P.c.r * k; pCol[i * 3 + 1] = P.c.g * k; pCol[i * 3 + 2] = P.c.b * k;
  });
  pGeo.attributes.position.needsUpdate = pGeo.attributes.color.needsUpdate = true;
}

// ===== Sons (synthétisés) =====
let ac;
function snd(f, d, type = 'sine', vol = .1, f2) {
  try {
    ac ||= new AudioContext();
    const o = ac.createOscillator(), g = ac.createGain(), t = ac.currentTime;
    o.type = type; o.frequency.setValueAtTime(f, t); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + d);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.001, t + d);
    o.connect(g).connect(ac.destination); o.start(t); o.stop(t + d);
  } catch { }
}

// ===== Collisions avec le stade (sol, murs, coins, plafond, cages) =====
const plane = (x, y, z, d, goal) => ({ n: new V3(x, y, z).normalize(), d, goal });
const DC = -(W + L - CUT) * Math.SQRT1_2;
const PLANES = [plane(0, 1, 0, 0), plane(0, -1, 0, -H), plane(-1, 0, 0, -W), plane(1, 0, 0, -W), plane(0, 0, -1, -L, 1), plane(0, 0, 1, -L, 1),
  plane(-1, 0, -1, DC), plane(1, 0, -1, DC), plane(-1, 0, 1, DC), plane(1, 0, 1, DC)];
function arena(p, v, r, e, noFloor) {
  let hit = 0;
  const fix = (n, dist) => {
    if (dist >= r) return;
    p.addScaledVector(n, r - dist);
    const vn = v.dot(n);
    if (vn < 0) { v.addScaledVector(n, -(1 + (vn < -1 ? e : 0)) * vn); hit = Math.max(hit, -vn); }
  };
  const mouth = Math.abs(p.x) <= GW - r && p.y <= GH - r; // passe dans l'ouverture d'une cage
  PLANES.forEach((pl, i) => (i || !noFloor) && !(pl.goal && mouth) && fix(pl.n, p.dot(pl.n) - pl.d));
  if (Math.abs(p.z) > L) {
    const s = Math.sign(p.z);
    fix(new V3(-1, 0, 0), GW - p.x); fix(new V3(1, 0, 0), GW + p.x); fix(new V3(0, -1, 0), GH - p.y); fix(new V3(0, 0, -s), L + GD - s * p.z);
  }
  return hit;
}

// ===== Voitures =====
const fwd = c => new V3(0, 0, 1).applyQuaternion(c.q);
const curv = s => {
  for (let i = 1; i < CURV.length; i++) if (s <= CURV[i][0]) { const [a, ca] = CURV[i - 1], [b, cb] = CURV[i]; return ca + (cb - ca) * (s - a) / (b - a); }
  return .088;
};

function makeCar(team, name) {
  const g = new THREE.Group(), mat = (color, o) => new THREE.MeshStandardMaterial({ color, metalness: .5, roughness: .4, ...o });
  const add = (geo, m, x, y, z) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = true; g.add(o); return o; };
  add(new THREE.BoxGeometry(.84, .2, 1.18), mat(COL[team]), 0, 0, 0);                                      // carrosserie
  add(new THREE.BoxGeometry(.68, .17, .5), mat(0x0d1320, { metalness: .9, roughness: .15 }), 0, .18, -.1); // cockpit
  add(new THREE.BoxGeometry(.9, .05, .18), mat(0x1a1a1a), 0, .17, -.55);                                 // aileron
  const wheel = new THREE.CylinderGeometry(.17, .17, .14, 16).rotateZ(Math.PI / 2), wm = mat(0x111111, { metalness: 0 });
  for (const x of [-.42, .42]) for (const z of [-.36, .38]) add(wheel, wm, x, -.21, z);
  const flame = add(new THREE.ConeGeometry(.13, .7, 12).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xffb040, transparent: true, opacity: .9, blending: THREE.AdditiveBlending, depthWrite: false }), 0, 0, -.95);
  flame.castShadow = false; scene.add(g);
  return { team, name, mesh: g, flame, p: new V3(), v: new V3(), q: new THREE.Quaternion(), w: new V3(), in: {}, ai: {}, boost: 33, dead: 0 };
}

function place(c, x, z) {
  Object.assign(c, { ground: true, flip: 0, jt: 0, dj: false, boosting: false, dead: 0, ai: {} });
  c.p.set(x, REST, z); c.v.set(0, 0, 0); c.w.set(0, 0, 0);
  c.q.setFromAxisAngle(UP, Math.atan2(-x, -z)); // face au centre
  c.mesh.visible = true;
}

function updCar(c, dt) {
  if (c.dead > 0) { if ((c.dead -= dt) <= 0) respawn(c); return; }
  const I = c.in, f = fwd(c), up = new V3(0, 1, 0).applyQuaternion(c.q), q = new THREE.Quaternion(), jump = I.jump && !c.pj;
  c.pj = I.jump; c.boosting = I.boost && c.boost > 0;
  if (c.boosting) { c.v.addScaledVector(f, 9.92 * dt); c.boost = Math.max(0, c.boost - 33.3 * dt); }
  if (c.ground) {
    // Au sol : braquage, accélération / freinage, drift
    const s0 = c.v.dot(f);
    c.q.premultiply(q.setFromAxisAngle(UP, -I.st * curv(Math.abs(s0)) * s0 * dt * (I.drift ? 1.4 : 1)));
    f.applyQuaternion(q); if (!I.drift) c.v.applyQuaternion(q);
    const th = c.boosting ? 1 : I.th; let s = c.v.dot(f);
    s += th * s < 0 ? th * 35 * dt : th ? th * Math.max(0, 16 - 1.03 * Math.abs(s)) * dt : -Math.sign(s) * Math.min(Math.abs(s), 5.25 * dt);
    c.v.addScaledVector(f, -c.v.dot(f)).multiplyScalar(Math.exp(-(I.drift ? 1 : 10) * dt)).addScaledVector(f, s).setY(0);
    c.q.slerp(q.setFromAxisAngle(UP, Math.atan2(f.x, f.z)), 1 - Math.exp(-25 * dt)); // reste à plat
    c.w.set(0, 0, 0); c.p.y = REST;
    if (jump) { Object.assign(c, { ground: false, jt: 0, dj: false, hold: true }); c.v.y += 2.92; }
  } else {
    // En l'air : gravité, saut prolongé, double saut / flip, contrôle aérien
    c.jt += dt; c.v.y -= G * dt;
    if (c.hold && I.jump && c.jt < .2) c.v.addScaledVector(up, 14.6 * dt); else c.hold = false;
    if (jump && !c.dj && c.jt < 1.5) {
      c.dj = true;
      const m = Math.hypot(I.pitch, I.st);
      if (m > .5) {
        const hf = new V3(f.x, 0, f.z).normalize(), dp = I.pitch / m, ds = I.st / m;
        c.v.addScaledVector(hf, 5 * dp).addScaledVector(new V3(-hf.z, 0, hf.x), 5 * ds); c.v.y = Math.max(c.v.y, 0);
        c.flip = .65; c.fd = [dp, ds];
      } else c.v.addScaledVector(up, 2.92);
    }
    const w = c.w;
    if (c.flip > 0) { c.flip -= dt; w.set(c.fd[0] * 9.67, 0, c.fd[1] * 9.67); }
    else {
      w.x += (I.pitch * 12 - w.x * 3) * dt; w.y += (-I.st * 9 - w.y * 2.5) * dt; w.z += (I.roll * 36 - w.z * 5) * dt;
      if (w.length() > 5.5) w.setLength(5.5);
    }
    const a = w.length();
    if (a) c.q.multiply(q.setFromAxisAngle(w.clone().divideScalar(a), a * dt)).normalize();
  }
  if (c.v.length() > MAXS) c.v.setLength(MAXS);
  c.p.addScaledVector(c.v, dt);
  arena(c.p, c.v, CR, .1, true);
  if (!c.ground && c.p.y <= REST && c.v.y <= 0) { Object.assign(c, { ground: true, flip: 0 }); c.p.y = REST; c.v.y = 0; }
}

// Contact voiture / balle (hitbox orientée + impulsion bonus façon Rocket League)
function hitBall(c) {
  if (c.dead) return;
  const loc = B.p.clone().sub(c.p).applyQuaternion(c.q.clone().invert()), cl = loc.clone().clamp(HBN, HB), d = loc.sub(cl), dist = d.length();
  if (dist >= BR) return;
  const n = (dist > 1e-4 ? d.divideScalar(dist) : d.set(0, 1, 0)).applyQuaternion(c.q);
  B.p.addScaledVector(n, BR - dist);
  const vc = c.w.clone().applyQuaternion(c.q).cross(cl.applyQuaternion(c.q)).add(c.v), rel = B.v.clone().sub(vc), vn = rel.dot(n);
  if (vn >= 0) return;
  const s = rel.length(), dir = B.p.clone().sub(c.p).multiply(new V3(1, .35, 1)).normalize();
  B.v.addScaledVector(n, -vn * .86).addScaledVector(dir, s * (s < 5 ? .65 : s < 23 ? .65 - (s - 5) / 180 : Math.max(.3, .55 - (s - 23) / 92)));
  c.v.addScaledVector(n, vn * .14);
  S.clock = true; S.last = c;
  if (s > 2) snd(200, .15, 'triangle', Math.min(.35, s / 40), 60);
}

// Chocs entre voitures + démolitions en supersonique
function bumps() {
  cars.forEach((a, i) => cars.slice(i + 1).forEach(b => {
    if (a.dead || b.dead) return;
    const n = b.p.clone().sub(a.p), d = n.length();
    if (d >= 2 * CR || d < 1e-4) return;
    n.divideScalar(d); a.p.addScaledVector(n, d / 2 - CR); b.p.addScaledVector(n, CR - d / 2);
    const rel = a.v.clone().sub(b.v).dot(n);
    if (rel <= 0) return;
    if (a.team !== b.team && a.v.length() >= SUPER && fwd(a).dot(n) > .7) return demo(b);
    if (a.team !== b.team && b.v.length() >= SUPER && fwd(b).dot(n) < -.7) return demo(a);
    a.v.addScaledVector(n, -rel * .6); b.v.addScaledVector(n, rel * .6);
    if (rel > 6) [a, b].forEach(c => { c.v.y += rel * .25; Object.assign(c, { ground: false, jt: 0, dj: false }); });
    snd(90, .2, 'square', .08);
  }));
}
function demo(c) {
  c.dead = 3; c.boosting = false; c.mesh.visible = false;
  burst(c.p, 0xffaa33, 120, 15); snd(80, .6, 'sawtooth', .2, 30);
  if (c === me) msg('DÉMOLI !', 1.5);
}
function respawn(c) { place(c, rnd(2 * GW), (c.team ? 1 : -1) * (L - 4)); c.boost = 33; }

function pickPads(dt) {
  pads.forEach(p => {
    if (p.t > 0) return void (p.t -= dt);
    const c = cars.find(c => !c.dead && c.boost < 100 && c.p.y < (p.big ? 2.5 : 1.5) && Math.hypot(c.p.x - p.x, c.p.z - p.z) < (p.big ? 2.1 : 1.45));
    if (!c) return;
    c.boost = Math.min(100, c.boost + (p.big ? 100 : 12)); p.t = p.big ? 10 : 4;
    if (c === me) snd(900, .12, 'sine', .05, 1500);
  });
}

// ===== Contrôles (clavier, souris, manette) =====
const keys = {};
let pad = null, padPrev = [], ballCam = true;
addEventListener('keydown', e => {
  keys[e.code] = true;
  if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
  if (e.repeat) return;
  if (e.code === 'KeyC') ballCam = !ballCam;
  if (e.code === 'Escape') pause();
});
addEventListener('keyup', e => keys[e.code] = false);
addEventListener('mousedown', e => keys['Mouse' + e.button] = true);
addEventListener('mouseup', e => keys['Mouse' + e.button] = false);
addEventListener('contextmenu', e => e.preventDefault());
addEventListener('blur', () => Object.keys(keys).forEach(k => keys[k] = false));

function pollPad() {
  pad = [...(navigator.getGamepads?.() || [])].find(Boolean);
  if (!pad) return;
  const b = pad.buttons.map(x => x.pressed);
  if (b[3] && !padPrev[3]) ballCam = !ballCam; // Y
  if (b[9] && !padPrev[9]) pause();            // Start
  padPrev = b;
}

function playerInput(c) {
  const k = (...codes) => codes.some(x => keys[x]) ? 1 : 0, I = c.in;
  I.th = I.pitch = k('KeyW', 'ArrowUp') - k('KeyS', 'ArrowDown');
  I.st = k('KeyD', 'ArrowRight') - k('KeyA', 'ArrowLeft');
  I.roll = k('KeyE') - k('KeyQ');
  I.jump = !!k('Space', 'Mouse2'); I.boost = !!k('ShiftLeft', 'ShiftRight', 'Mouse0'); I.drift = !!k('KeyX');
  if (!pad) return;
  const a = pad.axes, b = i => !!pad.buttons[i]?.pressed, val = i => pad.buttons[i]?.value || 0, dz = v => Math.abs(v) > .15 ? v : 0;
  I.st ||= dz(a[0]); I.pitch ||= -dz(a[1]); I.th ||= val(7) - val(6);           // stick, RT / LT
  I.jump ||= b(0); I.boost ||= b(1); I.drift ||= b(2); I.roll ||= b(5) - b(4); // A, B, X, LB / RB
}

// ===== IA des bots =====
function aim(c, I, p) { // oriente la voiture en l'air vers p
  const l = p.clone().sub(c.p).applyQuaternion(c.q.clone().invert()).normalize();
  I.pitch = clamp(-Math.atan2(l.y, l.z) * 3 - c.w.x * .3); I.st = clamp(-Math.atan2(l.x, l.z) * 3 + c.w.y * .3);
  return l.z;
}

function botInput(c, dt) {
  const I = c.in, A = c.ai, sk = S.diff, dir = c.team ? -1 : 1, f = fwd(c);
  Object.assign(I, { th: 0, st: 0, pitch: 0, roll: 0, jump: false, boost: false, drift: false });
  // Balle prédite
  const hd = Math.hypot(B.p.x - c.p.x, B.p.z - c.p.z), t = Math.min(hd / Math.max(c.v.length(), 10), 2) * [.4, .8, 1][sk];
  const pb = B.p.clone().addScaledVector(B.v, t);
  pb.set(clamp(pb.x, 2 - W, W - 2), Math.max(BR, B.p.y + B.v.y * t - G * t * t / 2), clamp(pb.z, -L - 3, L + 3));
  // Rôles : le mieux placé attaque, le 2e soutient, le 3e garde la cage
  const rank = m => m.p.distanceTo(B.p) + ((m.p.z - B.p.z) * dir > 2 ? 15 : 0);
  const role = cars.filter(m => m.team === c.team && !m.dead).sort((a, b) => rank(a) - rank(b)).indexOf(c);
  const own = new V3(0, 0, -dir * L);
  let tgt, good = false; // good : bien placé pour frapper vers la cage adverse
  if (!role) {
    const shot = new V3(0, 0, dir * (L + 3)).sub(pb).setY(0).normalize();
    good = pb.clone().sub(c.p).setY(0).normalize().dot(shot) > .4;
    if (good) tgt = pb.clone().addScaledVector(shot, -BR - .3); // derrière la balle : on frappe
    else { // mal placé : on contourne la balle
      const side = new V3(-shot.z, 0, shot.x);
      tgt = pb.clone().addScaledVector(shot, -6).addScaledVector(side, 4 * (Math.sign(side.dot(c.p.clone().sub(pb))) || 1));
    }
  } else tgt = role === 1 ? own.clone().lerp(pb, .45) : own.clone().add(new V3(clamp(pb.x * .3, 2 - GW, GW - 2), 0, dir * 2));
  // Conduite
  const to = tgt.sub(c.p).setY(0), d = to.length(), ang = Math.atan2(f.z * to.x - f.x * to.z, f.x * to.x + f.z * to.z);
  I.st = clamp(-ang * 3); I.th = role && d < 3 ? 0 : sk ? 1 : .8; I.drift = Math.abs(ang) > 1.7 && c.v.length() > 8;
  I.boost = sk > 0 && c.ground && Math.abs(ang) < .3 && c.boost > (sk > 1 ? 0 : 10) && d > (role ? 25 : 4);
  A.stuck = c.ground && I.th && c.v.length() < 2 ? (A.stuck || 0) + dt : 0; // coincé contre un mur → marche arrière
  if (A.stuck > .8) A.rev = .8;
  if (A.rev > 0) { A.rev -= dt; I.th = -1; I.st = -I.st; I.boost = false; }
  // Sauts, flips et aériennes
  if (!A.seq && c.ground && !role) {
    if (good && sk > 1 && c.boost > 25 && B.p.y > 5 && hd < B.p.y * 1.8 && Math.abs(ang) < .25) A.seq = 'air';
    else if (B.p.y > 2.2 && B.p.y < 4 && hd < 2.8) A.seq = 'jump';
    else if (good && sk && hd < 3.5 && B.p.y < 2 && Math.abs(ang) < .3 && c.v.length() > 7) A.seq = 'flip';
    A.t = 0;
  }
  if (!A.seq) return;
  const s = A.t += dt;
  if (A.seq === 'flip') { I.jump = s < .08 || (s > .14 && s < .2); if (s > .14) I.pitch = 1; }
  else if (A.seq === 'jump') I.jump = s < .2;
  else { // saut, double saut puis boost vers la balle
    I.jump = s < .18 || (s > .24 && s < .3); I.st = 0; I.pitch = s < .24 ? -.7 : 0; I.boost = true;
    if (s > .3) I.boost = aim(c, I, pb) > .7;
  }
  if ((c.ground && s > .3) || s > 3) A.seq = null;
}

// ===== Déroulement du match =====
const S = { phase: 'menu', mode: 1, diff: 1, score: [0, 0], time: 300, ot: false, clock: false, timer: 0, paused: false, shake: 0, msgT: 0, last: null };
let cars = [], me = null, acc = 0, last = performance.now(), clockT = 0;

function msg(big, t, small = '') { $('mb').textContent = big; $('ms').textContent = small; $('msg').classList.add('show'); S.msgT = t; }
function overlay(t, x, a, fa, b, fb) {
  $('ot').textContent = t; $('ox').textContent = x;
  Object.assign($('oa'), { textContent: a, onclick: fa }); Object.assign($('ob'), { textContent: b, onclick: fb });
  $('over').classList.remove('hidden');
}

function start() {
  document.activeElement?.blur();
  cars.forEach(c => scene.remove(c.mesh));
  const names = NAMES.slice().sort(() => Math.random() - .5);
  cars = [];
  for (let t = 0; t < 2; t++) for (let i = 0; i < S.mode; i++) cars.push(makeCar(t, t || i ? names.pop() : 'Toi'));
  me = cars[0];
  Object.assign(S, { score: [0, 0], time: 300, ot: false, paused: false }); acc = 0;
  ['menu', 'over'].forEach(i => $(i).classList.add('hidden')); $('hud').classList.remove('hidden');
  kickoff();
}

function kickoff() {
  const spots = KO.slice().sort(() => Math.random() - .5);
  cars.forEach(c => {
    const [x, z] = spots[cars.filter(m => m.team === c.team).indexOf(c)], s = c.team ? -1 : 1;
    place(c, x * s, z * s); c.boost = 33;
  });
  resetBall(); pads.forEach(p => p.t = 0);
  Object.assign(S, { phase: 'count', timer: 3, clock: false, last: null });
  msg(3, 1, S.ot ? 'PROLONGATIONS' : ''); snd(440, .2, 'square', .08);
}

function goal(t) {
  S.score[t]++; Object.assign(S, { phase: 'goal', timer: 3, shake: .8 }); B.mesh.visible = false;
  burst(B.p, COL[t], 300, 30); [523, 659, 784].forEach(f => snd(f, 1.5, 'sawtooth', .05));
  msg('BUT !', 3, S.last?.team === t ? S.last.name.toUpperCase() : '');
}
const overtime = () => { S.ot = true; S.time = 0; kickoff(); };
const afterGoal = () => S.ot ? end() : S.time > 0 ? kickoff() : S.score[0] === S.score[1] ? overtime() : end();
function end() {
  S.phase = 'end';
  overlay(S.score[0] > S.score[1] ? 'VICTOIRE !' : 'DÉFAITE', `${S.score[0]} - ${S.score[1]}`, 'Rejouer', start, 'Menu', menu);
}
function menu() {
  Object.assign(S, { phase: 'menu', paused: false });
  ['over', 'hud'].forEach(i => $(i).classList.add('hidden')); $('menu').classList.remove('hidden');
  cars.forEach(c => scene.remove(c.mesh)); cars = []; me = null; resetBall();
}
function pause() {
  if (!['count', 'play', 'goal'].includes(S.phase)) return;
  S.paused = !S.paused;
  S.paused ? overlay('PAUSE', '', 'Reprendre', pause, 'Quitter', menu) : $('over').classList.add('hidden');
}

function tick(dt) {
  if (S.phase === 'count') { // compte à rebours : tout est figé
    const n = Math.ceil(S.timer);
    if ((S.timer -= dt) <= 0) { S.phase = 'play'; msg('GO !', .8); snd(880, .5, 'square', .1); }
    else if (Math.ceil(S.timer) < n) { msg(Math.ceil(S.timer), 1, S.ot ? 'PROLONGATIONS' : ''); snd(440, .2, 'square', .08); }
    return;
  }
  cars.forEach(c => c === me ? playerInput(c) : botInput(c, dt));
  cars.forEach(c => updCar(c, dt));
  bumps(); pickPads(dt);
  if (S.phase === 'goal') return (S.timer -= dt) <= 0 && afterGoal();
  B.v.y -= G * dt; B.v.multiplyScalar(1 - .03 * dt); B.p.addScaledVector(B.v, dt);
  const hit = arena(B.p, B.v, BR, .6);
  if (hit > 3) snd(120, .12, 'triangle', Math.min(.25, hit / 80));
  cars.forEach(hitBall);
  if (B.v.length() > 60) B.v.setLength(60);
  if (Math.abs(B.p.z) > L + BR) return goal(B.p.z > 0 ? 0 : 1);
  if (!S.clock) return; // le chrono démarre à la première touche
  if (S.ot) S.time += dt;
  else if ((S.time = Math.max(0, S.time - dt)) <= 0 && B.p.y < BR + .2) S.score[0] === S.score[1] ? overtime() : end(); // fin quand la balle touche le sol
}

// ===== Affichage =====
const camP = new V3(0, 20, -70), camL = new V3(), back = new V3(0, 0, -1);
function updCam(dt) {
  const c = me, k = 1 - Math.exp(-12 * dt);
  if (!c.dead) {
    const nb = ballCam ? c.p.clone().sub(B.p) : (c.ground || Math.hypot(c.v.x, c.v.z) < 3 ? fwd(c) : c.v.clone()).negate();
    if (nb.setY(0).lengthSq() > .1) back.copy(nb.normalize());
    camP.lerp(c.p.clone().addScaledVector(back, 3.6).add(new V3(0, 1.4, 0)), k);
    arena(camP, new V3(), .3, 0);
  }
  camL.lerp(ballCam || c.dead ? B.p : c.p.clone().add(new V3(0, .9, 0)), k);
  camera.position.copy(camP).add(new V3(rnd(S.shake), rnd(S.shake), rnd(S.shake)));
  camera.lookAt(camL);
  S.shake = Math.max(0, S.shake - dt);
}

function frame(dt) {
  clockT += dt;
  cars.forEach(c => {
    c.mesh.position.copy(c.p); c.mesh.quaternion.copy(c.q);
    c.flame.visible = c.boosting && !c.dead; c.flame.scale.z = .7 + Math.random() * .6;
    const f = fwd(c);
    if (c.flame.visible) emit(c.p.clone().addScaledVector(f, -.8), f.clone().multiplyScalar(-6).add(new V3(rnd(1), rnd(1), rnd(1))), 0xff8a20, .35);
    if (!c.dead && c.v.length() >= SUPER) emit(c.p.clone().addScaledVector(f, -.6), new V3(), COL[c.team], .5); // traînée supersonique
  });
  B.mesh.position.copy(B.p);
  const hv = Math.hypot(B.v.x, B.v.z);
  if (hv > .01) B.mesh.rotateOnWorldAxis(new V3(B.v.z, 0, -B.v.x).divideScalar(hv), hv / BR * dt);
  pads.forEach(p => {
    p.m.material = p.t > 0 ? padOff : padOn;
    if (p.orb) { p.orb.visible = p.t <= 0; p.orb.position.y = 1 + Math.sin(clockT * 2 + p.x) * .15; }
  });
  updParts(dt); updCam(dt);
  const t = S.ot ? Math.floor(S.time) : Math.ceil(S.time);
  $('sb').textContent = S.score[0]; $('so').textContent = S.score[1];
  $('time').textContent = (S.ot ? '+' : '') + Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0');
  $('bv').textContent = Math.floor(me.boost); $('ring').style.strokeDashoffset = 264 * (1 - me.boost / 100);
  $('cam').classList.toggle('on', ballCam);
  if (S.msgT > 0 && (S.msgT -= dt) <= 0) $('msg').classList.remove('show');
}

function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min((now - last) / 1000, .1); last = now;
  pollPad();
  if (S.phase === 'menu') { const a = now / 8000; camera.position.set(Math.sin(a) * 75, 28, Math.cos(a) * 75); camera.lookAt(0, 0, 0); }
  else if (!S.paused && S.phase !== 'end') {
    acc += dt;
    while (acc >= DT && S.phase !== 'end') { tick(DT); acc -= DT; }
    frame(dt);
  }
  renderer.render(scene, camera);
}

document.querySelectorAll('[data-m],[data-d]').forEach(b => b.onclick = () => {
  b.parentNode.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
  if (b.dataset.m) S.mode = +b.dataset.m; else S.diff = +b.dataset.d;
});
$('play').onclick = start;
resetBall();
requestAnimationFrame(loop);
