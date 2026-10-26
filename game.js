'use strict';
// ===== Rocket Ball : moteur du jeu (rendu, physique, IA, match, replay, garage) =====
const V3 = THREE.Vector3, Q = THREE.Quaternion, $ = id => document.getElementById(id);
const clamp = (v, a = -1, b = 1) => Math.max(a, Math.min(b, v));
const rnd = a => (Math.random() - .5) * a, pick = a => a[Math.random() * a.length | 0];
addEventListener('error', e => { $('err').textContent = '⚠️ ' + e.message; $('err').classList.remove('hidden'); }); // bug visible à l'écran

// ===== Dimensions & physique (1 unité = 1 m, d'après les valeurs de Rocket League) =====
const W = 41, L = 51.2, H = 20.4, CUT = 11, GW = 8.9, GH = 6.4, GD = 8.8; // terrain, coins coupés, cages
const BR = .93, G = 6.5, DT = 1 / 120, MAXS = 23, SUPER = 22, REST = .38, CR = .6;
const HB = new V3(.42, .18, .59), HBN = HB.clone().negate(), UP = new V3(0, 1, 0), GRAV = new V3(0, -G, 0), COL = [0x1e7bff, 0xff7a1a];
const KO = [[-20.48, -25.6], [20.48, -25.6], [-2.56, -38.4], [2.56, -38.4], [0, -46.08]]; // places d'engagement (bleu)
const CURV = [[0, .69], [5, .398], [10, .235], [15, .1375], [17.5, .11], [23, .088]];       // courbure selon la vitesse
const NAMES = ['Viper', 'Blaze', 'Turbo', 'Comet', 'Nitro', 'Rex', 'Flash', 'Storm'];
const MODELS = { // pièces [largeur, hauteur, longueur, x, y, z, b = carrosserie / a = accent / g = vitres], wr = rayon des roues
  'Éclair': { wr: .17, parts: [[.84, .2, 1.18, 0, 0, 0, 'b'], [.68, .17, .5, 0, .18, -.1, 'g'], [.2, .02, 1.19, 0, .1, 0, 'a'], [.9, .05, .18, 0, .17, -.55, 'a']] },
  'Requin': { wr: .16, parts: [[.86, .16, 1.3, 0, -.03, 0, 'b'], [.6, .12, .45, 0, .1, -.22, 'g'], [.86, .03, .32, 0, .06, .5, 'a'], [.98, .05, .26, 0, .24, -.58, 'a'], [.05, .16, .05, .32, .13, -.58, 'a'], [.05, .16, .05, -.32, .13, -.58, 'a']] },
  'Bloc': { wr: .2, parts: [[.88, .3, 1.15, 0, .04, 0, 'b'], [.78, .22, .55, 0, .29, .02, 'g'], [.92, .07, .07, 0, .1, .6, 'a'], [.8, .04, .42, 0, .42, .02, 'a']] },
};
const ACCENTS = ['#f4f4f4', '#ffd400', '#00e5ff', '#ff3d7f', '#7cff4f', '#222222'], TRAILS = ['#ff8a20', '#33ccff', '#ff40ff', '#7cff4f', '#ffffff'];
const TOUCH_DEV = matchMedia('(pointer: coarse)').matches;

// Garage sauvegardé dans le navigateur
const store = v => { try { return v ? localStorage.setItem('rocketball', JSON.stringify(v)) : JSON.parse(localStorage.getItem('rocketball')) || {}; } catch { return {}; } };
const GAR = Object.assign({ name: 'Joueur', model: 'Éclair', accent: ACCENTS[0], trail: TRAILS[0] }, store());
const save = () => store(GAR);

// ===== Rendu =====
const renderer = new THREE.WebGLRenderer({ antialias: !TOUCH_DEV });
renderer.setPixelRatio(Math.min(devicePixelRatio, TOUCH_DEV ? 1.5 : 2));
renderer.shadowMap.enabled = true;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.prepend(renderer.domElement);
const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(78, 1, .1, 500);
scene.background = new THREE.Color(0x0b1020);
scene.fog = new THREE.Fog(0x0b1020, 120, 260);
const resize = () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); };
addEventListener('resize', resize); resize();

scene.add(new THREE.HemisphereLight(0xcfe2ff, 0x203018, 1.4));
const sun = new THREE.DirectionalLight(0xffffff, 1.6), key = new THREE.DirectionalLight(0xffffff, 1);
sun.position.set(2, 80, 1); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
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
const wallTex = canvasTex(128, 128, x => { x.fillStyle = '#ffffff40'; x.fillRect(0, 0, 128, 128); x.strokeStyle = '#fff'; x.lineWidth = 4; x.strokeRect(0, 0, 128, 128); });
wallTex.repeat.set(.25, .25); // une dalle tous les 4 m (les UV des murs sont en mètres)
OCT.forEach(([x1, z1], i) => {
  const [x2, z2] = OCT[(i + 1) % 8], dx = x2 - x1, dz = z2 - z1, len = Math.hypot(dx, dz), h = len / 2, zm = (z1 + z2) / 2;
  const col = zm < -1 ? COL[0] : zm > 1 ? COL[1] : 0xffffff, g = new THREE.Group();
  const pts = Math.abs(zm) === L ? [[-h, 0], [-GW, 0], [-GW, GH], [GW, GH], [GW, 0], [h, 0], [h, H], [-h, H]] : [[-h, 0], [h, 0], [h, H], [-h, H]];
  g.add(new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape(pts.map(p => new THREE.Vector2(...p)))),
    new THREE.MeshStandardMaterial({ color: col, map: wallTex, transparent: true, opacity: .45, side: THREE.DoubleSide, depthWrite: false })));
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
const resetBall = () => { B.p.set(0, BR, 0); B.v.set(0, 0, 0); B.mesh.position.copy(B.p); B.mesh.visible = true; };

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

// Effets joués ici et renvoyés aux joueurs en ligne quand on est l'hôte
const NET = { on: false, host: false, guest: false, ev: [] };
const FX = {
  snd, msg: (...a) => msg(...a),
  burst: (x, y, z, c, n, sp) => burst(new V3(x, y, z), c, n, sp),
  demo: i => cars[i] === me && msg('DÉMOLI !', 1.5),
  pad: i => cars[i] === me && snd(900, .12, 'sine', .05, 1500),
};
function fx(name, ...a) { FX[name](...a); if (NET.host) NET.ev.push([name, ...a]); }

// ===== Collisions avec le stade (sol, murs, coins, plafond, cages) =====
const plane = (x, y, z, d, goal) => ({ n: new V3(x, y, z).normalize(), d, goal });
const DC = -(W + L - CUT) * Math.SQRT1_2;
const PLANES = [plane(0, 1, 0, 0), plane(0, -1, 0, -H), plane(-1, 0, 0, -W), plane(1, 0, 0, -W), plane(0, 0, -1, -L, 1), plane(0, 0, 1, -L, 1),
  plane(-1, 0, -1, DC), plane(1, 0, -1, DC), plane(-1, 0, 1, DC), plane(1, 0, 1, DC)];
const GOALP = [-1, 1].map(s => [plane(-1, 0, 0, -GW), plane(1, 0, 0, -GW), plane(0, -1, 0, -GH), plane(0, 0, -s, -(L + GD))]);
const FLOOR = PLANES[0];
function surfaces(p, r) { // surfaces présentes autour de p (le mur du fond est percé par la cage)
  const mouth = Math.abs(p.x) <= GW - r && p.y <= GH - r, list = PLANES.filter(pl => !(pl.goal && mouth));
  return Math.abs(p.z) > L ? list.concat(GOALP[p.z > 0 ? 1 : 0]) : list;
}
function arena(p, v, r, e) {
  let hit = 0;
  for (const pl of surfaces(p, r)) {
    const dist = p.dot(pl.n) - pl.d;
    if (dist >= r) continue;
    p.addScaledVector(pl.n, r - dist);
    const vn = v.dot(pl.n);
    if (vn < 0) { v.addScaledVector(pl.n, -(1 + (vn < -1 ? e : 0)) * vn); hit = Math.max(hit, -vn); }
  }
  return hit;
}

// ===== Voitures =====
const fwd = (c, q = c.q) => new V3(0, 0, 1).applyQuaternion(q), upv = c => new V3(0, 1, 0).applyQuaternion(c.q);
const curv = s => {
  for (let i = 1; i < CURV.length; i++) if (s <= CURV[i][0]) { const [a, ca] = CURV[i - 1], [b, cb] = CURV[i]; return ca + (cb - ca) * (s - a) / (b - a); }
  return .088;
};

function makeCar(r) { // r : { team, name, model, accent, trail, me?, bot?, conn? }
  const g = new THREE.Group(), M = MODELS[r.model] || MODELS['Éclair'];
  const mat = (color, o) => new THREE.MeshStandardMaterial({ color, metalness: .5, roughness: .4, ...o });
  const m = { b: mat(COL[r.team]), a: mat(r.accent || ACCENTS[0]), g: mat(0x0d1320, { metalness: .9, roughness: .15 }) };
  const add = (geo, mt, x, y, z) => { const o = new THREE.Mesh(geo, mt); o.position.set(x, y, z); o.castShadow = true; g.add(o); return o; };
  M.parts.forEach(([w, h, d, x, y, z, k]) => add(new THREE.BoxGeometry(w, h, d), m[k], x, y, z));
  const tire = new THREE.CylinderGeometry(M.wr, M.wr, .14, 16).rotateZ(Math.PI / 2), rim = new THREE.CylinderGeometry(M.wr * .55, M.wr * .55, .15, 10).rotateZ(Math.PI / 2);
  const tm = mat(0x111111, { metalness: 0 });
  for (const x of [-.42, .42]) for (const z of [-.36, .38]) { add(tire, tm, x, M.wr - REST, z); add(rim, m.a, x, M.wr - REST, z); }
  const flame = add(new THREE.ConeGeometry(.13, .7, 12).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: r.trail || TRAILS[0], transparent: true, opacity: .9, blending: THREE.AdditiveBlending, depthWrite: false }), 0, 0, -.95);
  flame.castShadow = false; flame.visible = false; scene.add(g);
  return { ...r, trail: r.trail || TRAILS[0], mesh: g, flame, p: new V3(), v: new V3(), q: new Q(), w: new V3(), in: {}, ai: {}, boost: 33, dead: 0 };
}

function place(c, x, z) {
  Object.assign(c, { ground: true, n: FLOOR.n, sp: FLOOR, flip: 0, jt: 0, dj: false, stick: 0, boosting: false, dead: 0, ai: {} });
  c.p.set(x, REST, z); c.v.set(0, 0, 0); c.w.set(0, 0, 0);
  c.q.setFromAxisAngle(UP, Math.atan2(-x, -z)); // face au centre
  c.mesh.position.copy(c.p); c.mesh.quaternion.copy(c.q); c.mesh.visible = true;
}
const detach = c => Object.assign(c, { ground: false, sp: null, jt: 0, dj: false, stick: .3 });
function attach(c, pl) { // roues posées sur pl (sol, mur, coin, plafond)
  if (c.ground) { const r = new Q().setFromUnitVectors(c.n, pl.n); c.q.premultiply(r); c.v.applyQuaternion(r); } // on passe d'une surface à l'autre
  Object.assign(c, { ground: true, sp: pl, n: pl.n, flip: 0, hold: false });
  c.v.addScaledVector(pl.n, -c.v.dot(pl.n)); c.w.set(0, 0, 0);
}

function updCar(c, dt) {
  if (c.dead > 0) { if ((c.dead -= dt) <= 0) respawn(c); return; }
  const I = c.in, f = fwd(c), up = upv(c), q = new Q(), jump = I.jump && !c.pj;
  c.pj = I.jump; c.stick -= dt; c.boosting = I.boost && c.boost > 0;
  if (c.boosting) { c.v.addScaledVector(f, 9.92 * dt); c.boost = Math.max(0, c.boost - 33.3 * dt); }
  // On décroche du plafond, d'un mur pris trop lentement, ou quand la surface disparaît (ouverture de cage)
  if (c.ground && (c.n.y < -.5 || (c.n.y < .7 && c.v.length() < 2.5) || !surfaces(c.p, REST).includes(c.sp))) detach(c);
  if (c.ground) {
    // Sur une surface : braquage, gravité, accélération / freinage, drift
    const n = c.n, s0 = c.v.dot(f);
    c.q.premultiply(q.setFromAxisAngle(n, -I.st * curv(Math.abs(s0)) * s0 * dt * (I.drift ? 1.4 : 1)));
    f.applyQuaternion(q); if (!I.drift) c.v.applyQuaternion(q);
    f.addScaledVector(n, -f.dot(n));
    if (f.lengthSq() < 1e-4) f.copy(up).addScaledVector(n, -up.dot(n));
    f.normalize();
    c.v.addScaledVector(GRAV, dt);
    const th = c.boosting ? 1 : I.th; let s = c.v.dot(f);
    s += th * s < 0 ? th * 35 * dt : th ? th * Math.max(0, 16 - 1.03 * Math.abs(s)) * dt : -Math.sign(s) * Math.min(Math.abs(s), 5.25 * dt);
    c.v.addScaledVector(f, -c.v.dot(f)).addScaledVector(n, -c.v.dot(n)).multiplyScalar(Math.exp(-(I.drift ? 1 : 10) * dt)).addScaledVector(f, s);
    c.q.slerp(q.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new V3().crossVectors(n, f), n, f)), 1 - Math.exp(-25 * dt)); // roues à plat
    c.w.set(0, 0, 0);
    if (jump) { c.v.addScaledVector(n, 2.92); detach(c); c.hold = true; }
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
  if (c.ground) c.p.addScaledVector(c.n, REST - c.p.dot(c.n) + c.sp.d);
  // Contacts : on monte sur un mur, on atterrit, ou simple choc
  for (const pl of surfaces(c.p, REST)) {
    const dist = c.p.dot(pl.n) - pl.d, vin = -c.v.dot(pl.n);
    if (dist >= REST || pl === c.sp) continue;
    if ((c.stick <= 0 || pl === FLOOR) && (c.ground ? vin > 2 || (f.dot(pl.n) < -.7 && c.v.length() > 4) : vin > 0 && (pl === FLOOR || up.dot(pl.n) > .3))) attach(c, pl);
    c.p.addScaledVector(pl.n, REST - dist);
    if (c.v.dot(pl.n) < 0) c.v.addScaledVector(pl.n, -c.v.dot(pl.n));
  }
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
  if (s > 2) fx('snd', 200, .15, 'triangle', Math.min(.35, s / 40), 60);
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
    if (rel > 6) [a, b].forEach(c => { c.v.y += rel * .25; detach(c); });
    fx('snd', 90, .2, 'square', .08);
  }));
}
function demo(c) {
  c.dead = 3; c.boosting = false;
  fx('burst', c.p.x, c.p.y, c.p.z, 0xffaa33, 120, 15); fx('snd', 80, .6, 'sawtooth', .2, 30); fx('demo', cars.indexOf(c));
}
function respawn(c) { place(c, rnd(2 * GW), (c.team ? 1 : -1) * (L - 4)); c.boost = 33; }

function pickPads(dt) {
  pads.forEach(p => {
    if (p.t > 0) return void (p.t -= dt);
    const c = cars.find(c => !c.dead && c.boost < 100 && c.p.y < (p.big ? 2.5 : 1.5) && Math.hypot(c.p.x - p.x, c.p.z - p.z) < (p.big ? 2.1 : 1.45));
    if (!c) return;
    c.boost = Math.min(100, c.boost + (p.big ? 100 : 12)); p.t = p.big ? 10 : 4;
    fx('pad', cars.indexOf(c));
  });
}

// ===== Contrôles (clavier, souris, manette ; le tactile est dans touch.js) =====
const keys = {};
let pad = null, padPrev = [], ballCam = true;
addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') return;
  keys[e.code] = true;
  if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
  if (e.repeat) return;
  if (e.code === 'KeyC') ballCam = !ballCam;
  if (e.code === 'Escape') pause();
});
addEventListener('keyup', e => keys[e.code] = false);
addEventListener('mousedown', e => e.target === renderer.domElement && (keys['Mouse' + e.button] = true));
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
  const k = (...codes) => codes.some(x => keys[x]) ? 1 : 0, I = c.in, dz = v => Math.abs(v) > .15 ? v : 0;
  I.th = I.pitch = k('KeyW', 'ArrowUp') - k('KeyS', 'ArrowDown');
  I.st = k('KeyD', 'ArrowRight') - k('KeyA', 'ArrowLeft');
  I.roll = k('KeyE') - k('KeyQ');
  I.jump = !!k('Space', 'Mouse2'); I.boost = !!k('ShiftLeft', 'ShiftRight', 'Mouse0'); I.drift = !!k('KeyX');
  I.st ||= dz(TOUCH.x); I.th ||= -dz(TOUCH.y); I.pitch ||= -dz(TOUCH.y);                    // joystick tactile
  I.jump ||= TOUCH.jump; I.boost ||= TOUCH.boost; I.drift ||= TOUCH.drift;
  if (pad) {
    const a = pad.axes, b = i => !!pad.buttons[i]?.pressed, val = i => pad.buttons[i]?.value || 0;
    I.st ||= dz(a[0]); I.pitch ||= -dz(a[1]); I.th ||= val(7) - val(6);           // stick, RT / LT
    I.jump ||= b(0); I.boost ||= b(1); I.drift ||= b(2); I.roll ||= b(5) - b(4); // A, B, X, LB / RB
  }
  if (!c.ground && I.drift && !I.roll) { I.roll = I.st; I.st = 0; } // en l'air : drift + direction = air roll
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
  // Conduite (aussi sur les murs : on vise dans le plan de la surface)
  if (c.ground && c.n.y < .7) tgt.y -= 15; // sur un mur : on redescend vite
  const n = c.ground ? c.n : UP, to = tgt.sub(c.p);
  to.addScaledVector(n, -to.dot(n));
  const d = to.length(), ang = Math.atan2(n.dot(new V3().crossVectors(f, to)), f.dot(to));
  I.st = clamp(-ang * 3); I.th = role && d < 3 ? 0 : sk ? 1 : .8; I.drift = Math.abs(ang) > 1.7 && c.v.length() > 8;
  I.boost = sk > 0 && c.ground && Math.abs(ang) < .3 && c.boost > (sk > 1 ? 0 : 10) && d > (role ? 25 : 4);
  A.stuck = c.ground && I.th && c.v.length() < 2 ? (A.stuck || 0) + dt : 0; // coincé contre un mur → marche arrière
  if (A.stuck > .8) A.rev = .8;
  if (A.rev > 0) { A.rev -= dt; I.th = -1; I.st = -I.st; I.boost = false; }
  // Sauts, flips et aériennes
  if (!A.seq && c.ground && c.n.y > .9 && !role) {
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
const S = { phase: 'menu', mode: 1, diff: 1, score: [0, 0], time: 300, ot: false, clock: false, timer: 0, paused: false, shake: 0, msgT: 0, last: null, gs: 1, rt: 0 };
let cars = [], me = null, preview = null, acc = 0, last = performance.now(), clockT = 0;

function msg(big, t, small = '') { $('mb').textContent = big; $('ms').textContent = small; $('msg').classList.add('show'); S.msgT = t; }
function overlay(t, x, a, fa, b, fb) {
  $('ot').textContent = t; $('ox').textContent = x;
  Object.assign($('oa'), { textContent: a, onclick: fa }); Object.assign($('ob'), { textContent: b || '', onclick: fb });
  $('ob').classList.toggle('hidden', !b); $('over').classList.remove('hidden');
}

const botRoster = (team, name) => ({ team, name, model: pick(Object.keys(MODELS)), accent: pick(ACCENTS), trail: pick(TRAILS), bot: true });
function localRoster() {
  const names = NAMES.slice().sort(() => Math.random() - .5), r = [];
  for (let t = 0; t < 2; t++) for (let i = 0; i < S.mode; i++) r.push(t || i ? botRoster(t, names.pop()) : { ...GAR, team: 0, me: true });
  return r;
}

function start(roster = localRoster()) {
  document.activeElement?.blur?.();
  if (TOUCH_DEV) document.documentElement.requestFullscreen?.()?.catch?.(() => { });
  cars.forEach(c => scene.remove(c.mesh));
  if (preview) { scene.remove(preview.mesh); preview = null; }
  cars = roster.map(makeCar); me = cars.find(c => c.me) || cars[0];
  Object.assign(S, { score: [0, 0], time: 300, ot: false, paused: false, phase: 'count', timer: 3 });
  acc = 0; REC.length = 0; REPLAY = [];
  ['menu', 'over', 'online'].forEach(i => $(i).classList.add('hidden'));
  $('hud').classList.remove('hidden'); $('touch').classList.toggle('hidden', !TOUCH_DEV); document.body.classList.add('playing');
  camera.clearViewOffset();
  if (NET.guest) resetBall(); else kickoff();
}

function kickoff() {
  const spots = KO.slice().sort(() => Math.random() - .5);
  cars.forEach(c => {
    const [x, z] = spots[cars.filter(m => m.team === c.team).indexOf(c)], s = c.team ? -1 : 1;
    place(c, x * s, z * s); c.boost = 33;
  });
  resetBall(); pads.forEach(p => p.t = 0); REC.length = 0;
  Object.assign(S, { phase: 'count', timer: 3, clock: false, last: null });
  fx('msg', 3, 1, S.ot ? 'PROLONGATIONS' : ''); fx('snd', 440, .2, 'square', .08);
}

function goal(t) {
  S.score[t]++; Object.assign(S, { phase: 'goal', timer: 2.5, shake: .8, gs: Math.sign(B.p.z) }); B.mesh.visible = false;
  REPLAY = REC.splice(0);
  fx('burst', B.p.x, B.p.y, B.p.z, COL[t], 300, 30); [523, 659, 784].forEach(f => fx('snd', f, 1.5, 'sawtooth', .05));
  fx('msg', 'BUT !', 2.5, S.last?.team === t ? S.last.name.toUpperCase() : '');
}
const overtime = () => { S.ot = true; S.time = 0; kickoff(); };
const afterGoal = () => S.ot ? end() : S.time > 0 ? kickoff() : S.score[0] === S.score[1] ? overtime() : end();
function end() { S.phase = 'end'; if (NET.host) sendSnap(); showEnd(); }
function showEnd() {
  const a = S.score[me.team], b = S.score[1 - me.team], again = () => NET.host ? hostStart() : start();
  overlay(a > b ? 'VICTOIRE !' : 'DÉFAITE', `${S.score[0]} - ${S.score[1]}`, ...(NET.guest ? ['Quitter', quit] : ['Rejouer', again, 'Menu', quit]));
}
function menu() {
  Object.assign(S, { phase: 'menu', paused: false });
  ['over', 'hud', 'touch', 'online'].forEach(i => $(i).classList.add('hidden')); $('menu').classList.remove('hidden');
  document.body.classList.remove('playing');
  cars.forEach(c => scene.remove(c.mesh)); cars = []; me = null; B.mesh.visible = false; showPreview();
}
const quit = () => { if (NET.peer) netClose(); menu(); };
function pause() {
  if (!['count', 'play', 'goal', 'replay'].includes(S.phase)) return;
  if ($('over').classList.toggle('hidden')) return void (S.paused = false);
  S.paused = !NET.on; // en ligne, la partie continue
  overlay(NET.on ? 'MENU' : 'PAUSE', '', 'Reprendre', pause, 'Quitter', quit);
}

function tick(dt) {
  if (S.phase === 'count') { // compte à rebours : tout est figé
    const n = Math.ceil(S.timer);
    if ((S.timer -= dt) <= 0) { S.phase = 'play'; fx('msg', 'GO !', .8); fx('snd', 880, .5, 'square', .1); }
    else if (Math.ceil(S.timer) < n) { fx('msg', Math.ceil(S.timer), 1, S.ot ? 'PROLONGATIONS' : ''); fx('snd', 440, .2, 'square', .08); }
    return;
  }
  if (S.phase === 'replay') { playerInput(me); if (me.in.jump && !me.pj) S.rt = 1e9; me.pj = me.in.jump; return; } // saut = passer
  cars.forEach(c => c === me ? playerInput(c) : c.bot && botInput(c, dt));
  cars.forEach(c => updCar(c, dt));
  bumps(); pickPads(dt);
  if (S.phase === 'goal') {
    if ((S.timer -= dt) <= 0) REPLAY.length > 30 ? Object.assign(S, { phase: 'replay', rt: 0 }) : afterGoal();
    return;
  }
  B.v.y -= G * dt; B.v.multiplyScalar(1 - .03 * dt); B.p.addScaledVector(B.v, dt);
  const hit = arena(B.p, B.v, BR, .6);
  if (hit > 3) fx('snd', 120, .12, 'triangle', Math.min(.25, hit / 80));
  cars.forEach(hitBall);
  if (B.v.length() > 60) B.v.setLength(60);
  if (Math.abs(B.p.z) > L + BR) return goal(B.p.z > 0 ? 0 : 1);
  if (!S.clock) return; // le chrono démarre à la première touche
  if (S.ot) S.time += dt;
  else if ((S.time = Math.max(0, S.time - dt)) <= 0 && B.p.y < BR + .2) S.score[0] === S.score[1] ? overtime() : end(); // fin quand la balle touche le sol
}

// ===== Replay (3 dernières secondes avant le but, au ralenti) =====
const REC = [];
let REPLAY = [], recT = 0;
function record(dt) {
  if ((recT += dt) < 1 / 60) return;
  recT = 0;
  const fr = [...B.mesh.position.toArray(), ...B.mesh.quaternion.toArray(), +B.mesh.visible];
  cars.forEach(c => fr.push(...c.mesh.position.toArray(), ...c.mesh.quaternion.toArray(), c.mesh.visible | c.flame.visible << 1 | c.sup << 2));
  REC.push(fr); if (REC.length > 180) REC.shift();
}
function playReplay(dt) {
  const i = Math.floor((S.rt += dt * .6) * 60);
  if (i >= REPLAY.length) return NET.guest || afterGoal();
  const fr = REPLAY[i], put = (m, k) => (m.position.fromArray(fr, k), m.quaternion.fromArray(fr, k + 3), fr[k + 7]);
  B.mesh.visible = !!put(B.mesh, 0);
  cars.forEach((c, j) => { const b = put(c.mesh, 8 * j + 8); c.mesh.visible = !!(b & 1); c.flame.visible = !!(b & 2); c.sup = !!(b & 4); });
}

// ===== Affichage =====
const camP = new V3(0, 20, -70), camL = new V3(), back = new V3(0, 0, -1), camUp = UP.clone();
function updCam(dt) {
  const c = me, k = 1 - Math.exp(-12 * dt);
  if (S.phase === 'replay') { // caméra de replay : derrière la balle, tournée vers la cage
    const bp = B.mesh.position;
    camP.lerp(new V3(bp.x * .8, Math.max(bp.y, 1) + 3.5, bp.z - S.gs * 10), k * .5); camL.lerp(bp, k);
  } else if (!c.dead) {
    const nb = ballCam ? c.p.clone().sub(B.p).setY(0) : c.ground ? fwd(c).negate() : c.v.clone().negate().setY(0);
    if (nb.lengthSq() > .1) back.copy(nb.normalize());
    camUp.lerp(c.ground && !ballCam ? upv(c) : UP, k).normalize(); // sur un mur, la caméra se décale du mur
    camP.lerp(c.p.clone().addScaledVector(back, 3.6).addScaledVector(camUp, 1.4), k);
    camL.lerp(ballCam ? B.p : c.p.clone().addScaledVector(camUp, .9), k);
  } else camL.lerp(B.p, k);
  camP.y = clamp(camP.y, .3, H + 4); // la caméra peut passer derrière les murs transparents
  camera.position.copy(camP).add(new V3(rnd(S.shake), rnd(S.shake), rnd(S.shake)));
  camera.lookAt(camL);
  S.shake = Math.max(0, S.shake - dt);
}

function frame(dt) {
  clockT += dt;
  if (S.phase === 'replay') playReplay(dt);
  else {
    const k = 1 - Math.exp(-30 * dt);
    cars.forEach(c => {
      c.mesh.position.copy(c.p); c.mesh.quaternion.slerp(c.q, k); c.mesh.visible = !c.dead;
      c.flame.visible = c.boosting && !c.dead; c.sup = !c.dead && c.v.length() >= SUPER;
    });
    B.mesh.position.copy(B.p);
    const hv = Math.hypot(B.v.x, B.v.z);
    if (hv > .01) B.mesh.rotateOnWorldAxis(new V3(B.v.z, 0, -B.v.x).divideScalar(hv), hv / BR * dt);
    if (S.phase === 'play') record(dt);
  }
  cars.forEach(c => {
    const f = fwd(c, c.mesh.quaternion), p = c.mesh.position;
    c.flame.scale.z = .7 + Math.random() * .6;
    if (c.flame.visible) emit(p.clone().addScaledVector(f, -.8), f.clone().multiplyScalar(-6).add(new V3(rnd(1), rnd(1), rnd(1))), c.trail, .35);
    if (c.sup && c.mesh.visible) emit(p.clone().addScaledVector(f, -.6), new V3(), COL[c.team], .5); // traînée supersonique
  });
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
  $('replay').classList.toggle('hidden', S.phase !== 'replay'); $('skip').classList.toggle('hidden', NET.guest);
  if (S.msgT > 0 && (S.msgT -= dt) <= 0) $('msg').classList.remove('show');
}

// Menu : la voiture du garage tourne sur elle-même
function showPreview() {
  if (preview) scene.remove(preview.mesh);
  preview = makeCar({ ...GAR, team: 0 }); place(preview, 0, 0); preview.flame.visible = true;
}
function menuView(dt) {
  const m = preview.mesh, f = fwd(preview, m.quaternion.multiply(new Q().setFromAxisAngle(UP, dt * .6)));
  preview.flame.scale.z = .7 + Math.random() * .6;
  emit(m.position.clone().addScaledVector(f, -.8), f.multiplyScalar(-4).add(new V3(rnd(1), rnd(1), rnd(1))), preview.trail, .4);
  updParts(dt);
  camera.position.set(2.4, 1.2, 3.2); camera.lookAt(0, .15, 0);
  if (innerWidth >= 700) camera.setViewOffset(innerWidth, innerHeight, -innerWidth * .2, 0, innerWidth, innerHeight); else camera.clearViewOffset();
}

function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min((now - last) / 1000, .1); last = now;
  pollPad();
  if (S.phase === 'menu') menuView(dt);
  else if (!S.paused && S.phase !== 'end') {
    if (NET.guest) netGuestFrame(dt); // l'invité affiche ce que l'hôte simule
    else {
      acc += dt;
      while (acc >= DT && S.phase !== 'end') { tick(DT); acc -= DT; }
      if (NET.host) netHostFrame(dt);
    }
    if (S.phase !== 'menu') frame(dt);
  }
  renderer.render(scene, camera);
}

// ===== Menu & garage =====
document.querySelectorAll('[data-m],[data-d]').forEach(b => b.onclick = () => {
  const k = b.dataset.m ? 'm' : 'd';
  document.querySelectorAll(`[data-${k}]`).forEach(x => x.classList.toggle('on', x.dataset[k] === b.dataset[k]));
  if (k === 'm') S.mode = +b.dataset.m; else S.diff = +b.dataset.d;
});
[['models', Object.keys(MODELS), 'model'], ['accents', ACCENTS, 'accent'], ['trails', TRAILS, 'trail']].forEach(([id, list, key]) => list.forEach(v => {
  const b = $(id).appendChild(document.createElement('button'));
  if (key === 'model') b.textContent = v; else { b.className = 'swatch'; b.style.background = v; b.setAttribute('aria-label', v); }
  b.classList.toggle('on', GAR[key] === v);
  b.onclick = () => { GAR[key] = v; save(); $(id).querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); showPreview(); };
}));
$('play').onclick = () => start();
menu();
addEventListener('DOMContentLoaded', () => requestAnimationFrame(loop));
