'use strict';
// ===== Rocket Ball : effets visuels (particules, explosions, feux d'artifice, débris, traînées, traces de pneus) =====

// ----- Particules (feu et étincelles en additif, fumée et confettis en normal) -----
function particles(n, add) {
  const geo = new THREE.BufferGeometry(), pos = new Float32Array(n * 3), col = new Float32Array(n * 4), size = new Float32Array(n);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('col', new THREE.BufferAttribute(col, 4)); geo.setAttribute('size', new THREE.BufferAttribute(size, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { map: { value: radial }, ps: { value: 500 } }, transparent: true, depthWrite: false, blending: add ? THREE.AdditiveBlending : THREE.NormalBlending,
    vertexShader: 'attribute float size; attribute vec4 col; uniform float ps; varying vec4 vC; void main() { vC = col; vec4 mv = modelViewMatrix * vec4(position, 1.); gl_PointSize = size * ps / -mv.z; gl_Position = projectionMatrix * mv; }',
    fragmentShader: 'uniform sampler2D map; varying vec4 vC; void main() { gl_FragColor = vC * texture2D(map, gl_PointCoord); }',
  });
  const pts = new THREE.Points(geo, mat); pts.frustumCulled = false; pts.renderOrder = add ? 3 : 2; pts.userData.noEnv = true; scene.add(pts);
  const P = Array.from({ length: n }, () => ({ p: new V3(), v: new V3(), c: new C(), life: 0, max: 1, a: 0, s: 0, g: 0 }));
  let i = 0;
  return {
    mat,
    // o : c couleur, l durée, s taille, g grossissement, gr gravité, a opacité, k intensité (> 1 = halo), d freinage
    emit(p, v, o) { const q = P[i = (i + 1) % n]; q.p.copy(p); q.v.copy(v); q.c.set(o.c).multiplyScalar(o.k || 1); q.life = q.max = (o.l || 1) * (.6 + Math.random() * .4); Object.assign(q, { s: o.s || .4, g: o.g || 0, gr: o.gr || 0, a: o.a ?? 1, d: o.d ?? 1.5 }); },
    update(dt) {
      P.forEach((q, j) => {
        if (q.life > 0) { q.life -= dt; q.v.y -= q.gr * dt; q.v.multiplyScalar(Math.max(0, 1 - q.d * dt)); q.p.addScaledVector(q.v, dt); }
        const k = Math.max(0, q.life / q.max);
        q.p.toArray(pos, j * 3); q.c.toArray(col, j * 4); col[j * 4 + 3] = q.a * k * (add ? 1 : Math.min(1, (1 - k) * 8));
        size[j] = k > 0 ? q.s + q.g * (1 - k) : 0;
      });
      geo.attributes.position.needsUpdate = geo.attributes.col.needsUpdate = geo.attributes.size.needsUpdate = true;
    },
  };
}
const FXA = particles(HQ ? 4200 : 900, true), FXN = particles(HQ ? 1200 : 300, false);

// ----- Poussières qui flottent dans la lumière des projecteurs -----
const haze = HQ && (() => {
  const n = 700, pos = new Float32Array(n * 3), seed = new Float32Array(n);
  for (let i = 0; i < n; i++) { pos.set([rnd(2 * W), 1 + Math.random() * 22, rnd(2 * L)], i * 3); seed[i] = Math.random() * 100; }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
  const m = new THREE.ShaderMaterial({
    uniforms: { t: { value: 0 }, k: { value: 1 }, ps: FXA.mat.uniforms.ps, map: { value: radial } }, ...additive(),
    vertexShader: `attribute float seed; uniform float t, ps; varying float vA;
      void main() { vec3 p = position + vec3(sin(t * .2 + seed), sin(t * .15 + seed * 1.3) * .8, cos(t * .17 + seed)) * 1.5;
        vec4 mv = modelViewMatrix * vec4(p, 1.); vA = .5 + .5 * sin(t * 1.5 + seed * 7.); gl_PointSize = .09 * ps / -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: 'uniform sampler2D map; uniform float k; varying float vA; void main() { gl_FragColor = vec4(vec3(1., .93, .8) * .6 * k * vA * texture2D(map, gl_PointCoord).a, 1.); }',
  });
  const p = new THREE.Points(g, m); p.frustumCulled = false; p.userData.noEnv = true; scene.add(p); return m;
})();

// ----- Ondes de choc, flash lumineux, débris, fusées de feu d'artifice -----
const SPH = new THREE.SphereGeometry(1, 32, 16), RING = new THREE.RingGeometry(.84, 1, 64).rotateX(-Math.PI / 2); // onde en bulle ou en anneau au sol
const waves = Array.from({ length: 6 }, () => { const m = new THREE.Mesh(SPH, new THREE.MeshBasicMaterial(additive())); m.visible = false; m.userData.noEnv = true; scene.add(m); return { m, t: 1 }; });
const flash = new THREE.PointLight(0xffffff, 0, 70, 1.4); scene.add(flash);
const debris = Array.from({ length: 30 }, () => { const m = new THREE.Mesh(new THREE.BoxGeometry(.2, .1, .26), new THREE.MeshStandardMaterial({ metalness: .6, roughness: .4 })); m.castShadow = true; m.visible = false; m.userData.noEnv = true; scene.add(m); return { m, v: new V3(), w: new V3(), t: 0 }; });
const rockets = [];
let wi = 0, di = 0, hype = 0, hypeTeam = 0;

const bolts = [];
function bolt(a, b, w = .14, life = .5, col = 0xbfd8ff) { // éclair : tube en zigzag
  const d = b.clone().sub(a), n = 14, pts = [a.clone()];
  for (let i = 1; i < n; i++) pts.push(a.clone().addScaledVector(d, i / n).add(rdir(d.length() * .045)));
  pts.push(b.clone());
  const m = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, false, 'catmullrom', .1), n * 3, w, 5), new THREE.MeshBasicMaterial({ color: new C(col).multiplyScalar(8), ...additive() }));
  m.userData.noEnv = true; scene.add(m); bolts.push({ m, t: life });
}
function debrisBurst(p, cols, n, size = 1, glowCol = 0) { // morceaux qui volent et rebondissent
  for (let i = 0; i < n; i++) {
    const d = debris[di = (di + 1) % debris.length], mt = d.m.material;
    d.m.position.copy(p); mt.color.set(cols[i % cols.length]); mt.emissive.set(i % 2 ? glowCol : 0); d.m.scale.setScalar(size * (.6 + Math.random() * .8)); d.m.visible = true;
    d.v.copy(rdir(3 + Math.random() * 6)).y += 5; d.w.set(rnd(20), rnd(20), rnd(20)); d.t = 3;
  }
}
// Explosions de but au choix (garage) : chacune a son style
const BOOMS = {
  Classique(p, c) {
    for (let i = 0; i < (HQ ? 320 : 120); i++) FXA.emit(p, rdir(5 + Math.random() * 30), { c: Math.random() < .2 ? 0xffffff : c, l: 1.8, s: .5, k: 3, gr: 5, d: 1.2 });
    for (let i = 0; i < (HQ ? 160 : 50); i++) FXN.emit(p, rdir(3 + Math.random() * 12).add(new V3(0, 8, 0)), { c: pick([c, 0xffffff, 0xffd400]), l: 4, s: .22, gr: 4, d: .8 });
    for (let i = 0; i < 40; i++) FXN.emit(p, rdir(5), { c: 0x6a6070, l: 2.5, s: 1.5, g: 7, a: .45 });
    EFX.wave(p, c, 26); return c;
  },
  Galaxie(p) { // spirale d'étoiles
    for (let i = 0; i < (HQ ? 380 : 140); i++) {
      const a = Math.random() * 6.28, r = 4 + Math.random() * 16, v = new V3(Math.cos(a), rnd(.4), Math.sin(a)).multiplyScalar(r);
      FXA.emit(p, v.add(new V3(-Math.sin(a), 0, Math.cos(a)).multiplyScalar(r * .9)), { c: pick([0x8a4dff, 0xff4de1, 0x4dc3ff, 0xffffff]), l: 2.4, s: .45, k: 3.5, d: 1.1 });
    }
    for (let i = 0; i < 90; i++) FXA.emit(p.clone().add(rdir(7)), rdir(.4), { c: 0xffffff, l: 3, s: .22, k: 7, d: .3 });
    EFX.wave(p, 0xb45dff, 22); EFX.wave(p, 0x4dc3ff, 30, .9, true); return 0xa060ff;
  },
  Volcan(p) { // fontaine de lave, roches brûlantes, colonne de fumée
    for (let i = 0; i < (HQ ? 300 : 110); i++) FXA.emit(p, new V3(rnd(8), 10 + Math.random() * 22, rnd(8)), { c: pick([0xff3a00, 0xff8a10, 0xffd040]), l: 2.2, s: .6, k: 3.5, gr: 14, d: .4 });
    for (let i = 0; i < 70; i++) FXN.emit(p, new V3(rnd(4), 6 + Math.random() * 8, rnd(4)), { c: 0x2a2026, l: 4, s: 2, g: 9, a: .55, d: .6 });
    debrisBurst(p, [0x2b1a12, 0x3a2416], 16, 1.6, 0xff4a00); EFX.wave(p, 0xff5a10, 14, 1.2, true); return 0xff5a10;
  },
  Glace(p) { // éclats de glace, neige, onde de givre au sol
    for (let i = 0; i < (HQ ? 240 : 90); i++) FXA.emit(p, rdir(6 + Math.random() * 20), { c: pick([0x9ff0ff, 0xffffff, 0x5fc8ff]), l: 1.6, s: .35, k: 3, gr: 3 });
    for (let i = 0; i < (HQ ? 220 : 80); i++) FXN.emit(p.clone().add(new V3(rnd(30), 6 + Math.random() * 10, rnd(20))), new V3(rnd(1), -1.5, rnd(1)), { c: 0xffffff, l: 5, s: .18, d: .2 });
    debrisBurst(p, [0xcff6ff, 0x8fe0ff], 14, 1, 0x2a6a8a); EFX.wave(p, 0x8fe8ff, 24, 1, true); EFX.wave(p, 0xdff8ff, 12); return 0x8fe8ff;
  },
  Foudre(p) { // éclairs qui tombent du ciel sur la cage
    for (let i = 0; i < 6; i++) bolt(new V3(p.x + rnd(40), 70, p.z + rnd(24)), new V3(p.x + rnd(8), Math.max(0, p.y + rnd(3)), p.z + rnd(4)), .14, .55);
    for (let i = 0; i < (HQ ? 260 : 100); i++) FXA.emit(p, rdir(4 + Math.random() * 18), { c: pick([0xffffff, 0x9fd8ff, 0x6fa8ff]), l: .7, s: .18, k: 5, gr: 4 });
    EFX.wave(p, 0x9fd8ff, 20, 2.2); return 0xbfd8ff;
  },
  Royale(p) { // récompense de saison : couronne de pièces d'or, pluie dorée
    for (let i = 0; i < 5; i++) { const a = i / 5 * 6.28; for (let j = 0; j < 30; j++) FXA.emit(p, new V3(Math.cos(a) * 9, 14 + j * .5, Math.sin(a) * 9).add(rdir(1.5)), { c: pick([0xffd34d, 0xfff2b0]), l: 2.2, s: .4, k: 4, gr: 9, d: .5 }); }
    for (let i = 0; i < (HQ ? 200 : 80); i++) FXN.emit(p.clone().add(new V3(rnd(26), 8 + Math.random() * 8, rnd(18))), new V3(rnd(1), -2, rnd(1)), { c: pick([0xffd34d, 0xe8b923, 0xffffff]), l: 4.5, s: .2, d: .25 });
    debrisBurst(p, [0xffd34d, 0xe8b923], 18, .9, 0x8a6410); EFX.wave(p, 0xffd34d, 24); EFX.wave(p, 0xffe9a0, 30, 1, true); return 0xffc840;
  },
};
const EFX = {
  wave(p, c, size, sp = 1.6, flat = false) { const w = waves[wi = (wi + 1) % waves.length]; w.m.position.copy(p).y = flat ? .1 : p.y; w.m.geometry = flat ? RING : SPH; w.m.material.color.set(c).multiplyScalar(2); Object.assign(w, { t: 0, size, sp }); w.m.visible = true; },
  flash(p, c, k) { flash.position.copy(p).setY(Math.max(p.y, 2)); flash.color.set(c); flash.intensity = k; },
  boom(p, team, kind) { // explosion de but (au choix du buteur) + feu d'artifice + stade aux couleurs de l'équipe
    const c = BOOMS[Object.hasOwn(BOOMS, kind) ? kind : 'Classique'](p, COL[team]);
    this.flash(p, c, 6000); this.fireworks(team); POST.flash = .45; hype = 1; hypeTeam = team;
  },
  explode(p, team = 0) { // démolition : boule de feu, fumée, morceaux de carrosserie
    for (let i = 0; i < 120; i++) FXA.emit(p, rdir(3 + Math.random() * 14), { c: pick([0xff6a10, 0xffb030, 0xffffff]), l: .9, s: .45, k: 3, gr: 3 });
    for (let i = 0; i < 30; i++) FXN.emit(p, rdir(3), { c: 0x2a2a30, l: 2, s: 1, g: 4, a: .7 });
    debrisBurst(p, [COL[team], COL[team], 0x22252c], 10);
    this.wave(p, 0xff8a30, 7); this.flash(p, 0xff8a30, 2500);
  },
  spark(p, s) {
    for (let i = 0; i < Math.min(40, s * 1.5); i++) FXA.emit(p, rdir(2 + Math.random() * s * .6), { c: pick([0xffffff, 0x9fd8ff, 0xffd27a]), l: .4, s: .14, k: 4, gr: 6 });
    if (s > 14) this.wave(p, 0xbfe6ff, 2.5, 3);
  },
  pad(x, z, big) { for (let i = 0; i < (big ? 40 : 14); i++) FXA.emit(new V3(x + rnd(1.5), .3, z + rnd(1.5)), new V3(rnd(2), 3 + Math.random() * 5, rnd(2)), { c: 0xffc040, l: .6, s: .2, k: 3 }); },
  fireworks(team) { // fusées tirées depuis le haut des tribunes
    for (let i = 0; i < (HQ ? 12 : 5); i++) {
      const s = pick(STANDS), p = new V3(rnd(s.len), 41, -47).applyMatrix4(s.g.matrixWorld);
      rockets.push({ p, v: p.clone().setY(0).multiplyScalar(-.08).setY(26 + Math.random() * 8), d: i * .22 + Math.random() * .2, fuse: 1 + Math.random() * .4, c: pick([COL[team], COL[team], 0xffffff, 0xffd400]) });
    }
  },
};

// ----- Pluie (traits animés sur la carte graphique, autour de la caméra) -----
const rain = (() => {
  const n = HQ ? 5000 : 1200, pos = new Float32Array(n * 6), end = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) { const x = rnd(60), y = Math.random() * 30, z = rnd(60); pos.set([x, y, z, x, y, z], i * 6); end[i * 2 + 1] = 1; }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('end', new THREE.BufferAttribute(end, 1));
  const m = new THREE.ShaderMaterial({
    uniforms: { t: { value: 0 }, cam: { value: new V3() }, k: { value: .35 } }, ...additive(),
    vertexShader: `attribute float end; uniform float t; uniform vec3 cam; varying float vE;
      void main() { vec3 p = position; p.y = mod(p.y - t * 24., 30.); p.xz = mod(p.xz - cam.xz + 30., 60.) + cam.xz - 30.;
        p += vec3(.12, .9, .05) * end; vE = end; gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.); }`,
    fragmentShader: 'uniform float k; varying float vE; void main() { gl_FragColor = vec4(vec3(.65, .75, 1.) * k * (1. - vE * .8), 1.); }',
  });
  const l = new THREE.LineSegments(g, m); l.frustumCulled = false; l.visible = false; l.userData.noEnv = true; scene.add(l);
  return { l, m };
})();
let thunderT = 4;

// ----- Traînées des feux arrière (rubans lumineux) -----
function ribbon(color, n = 22) {
  const pos = new Float32Array(n * 6), col = new Float32Array(n * 8), idx = [], pts = [], c = new C(color).multiplyScalar(2.2);
  for (let i = 0; i < n - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 4)); g.setIndex(idx);
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, ...additive({ side: THREE.DoubleSide }) }));
  m.frustumCulled = false; m.userData.noEnv = true; scene.add(m);
  return {
    m,
    update(p, side, on) {
      if (on) pts.unshift([p.clone().addScaledVector(side, -.03), p.clone().addScaledVector(side, .03)]); else pts.pop();
      if (pts.length > n) pts.length = n;
      for (let i = 0; i < n; i++) {
        const q = pts[Math.min(i, pts.length - 1)], a = i < pts.length ? (1 - i / n) * .9 : 0;
        for (let j = 0; j < 2; j++) { if (q) q[j].toArray(pos, (i * 2 + j) * 3); col.set([c.r, c.g, c.b, a], (i * 2 + j) * 4); }
      }
      g.attributes.position.needsUpdate = g.attributes.color.needsUpdate = true;
    },
  };
}

// ----- Traces de pneus sur la pelouse (drift) -----
const SK = 500, skPos = new Float32Array(SK * 12), skCol = new Float32Array(SK * 16), skAge = new Float32Array(SK).fill(99), skIdx = [];
for (let k = 0; k < SK; k++) skIdx.push(k * 4, k * 4 + 1, k * 4 + 2, k * 4 + 1, k * 4 + 3, k * 4 + 2);
const skGeo = new THREE.BufferGeometry();
skGeo.setAttribute('position', new THREE.BufferAttribute(skPos, 3)); skGeo.setAttribute('color', new THREE.BufferAttribute(skCol, 4)); skGeo.setIndex(skIdx);
const skids = new THREE.Mesh(skGeo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }));
skids.frustumCulled = false; skids.renderOrder = 1; skids.userData.noEnv = true; scene.add(skids);
let ski = 0;
function skid(a, b) {
  const s = new V3(a.z - b.z, 0, b.x - a.x).normalize().multiplyScalar(.08), k = ski = (ski + 1) % SK;
  [a.clone().add(s), a.clone().sub(s), b.clone().add(s), b.clone().sub(s)].forEach((v, j) => v.toArray(skPos, k * 12 + j * 3));
  skAge[k] = 0; skGeo.attributes.position.needsUpdate = true;
}

// ----- Animation de tous les effets (appelée à chaque image) -----
function animFx(dt, t) {
  FXA.update(dt); FXN.update(dt);
  if (haze) { haze.uniforms.t.value = t; haze.uniforms.k.value = LOOK.haze; }
  CROWD.t.value = BANNER.t.value = t; CROWD.hype.value = hype; // public qui saute, bannières qui flottent
  waves.forEach(w => {
    if (!w.m.visible) return; w.t += dt * w.sp; w.m.scale.setScalar(.5 + w.size * (1 - (1 - Math.min(w.t, 1)) ** 3));
    w.m.material.opacity = .5 * (1 - w.t); w.m.visible = w.t < 1;
  });
  for (let i = bolts.length - 1; i >= 0; i--) { const b = bolts[i]; b.m.visible = Math.random() > .25; if ((b.t -= dt) < 0) { scene.remove(b.m); b.m.geometry.dispose(); bolts.splice(i, 1); } } // éclairs qui grésillent
  // Pluie : gouttes, éclaboussures au sol, éclairs au loin et tonnerre
  rain.l.visible = LOOK.rain > 0;
  if (LOOK.rain) {
    rain.m.uniforms.t.value = t; rain.m.uniforms.cam.value.copy(camera.position);
    for (let n = (HQ ? 40 : 12) * dt * 60; n > Math.random(); n--) {
      const q = camera.position.clone().add(new V3(rnd(36), 0, rnd(36))).setY(.05);
      if (Math.abs(q.x) < W && Math.abs(q.z) < L) FXA.emit(q, new V3(rnd(1), 1.5 + Math.random(), rnd(1)), { c: 0xbfd8ff, l: .22, s: .1, k: 1.6, gr: 9 });
    }
    if ((thunderT -= dt) < 0) {
      thunderT = 6 + Math.random() * 10; LOOK.light = 1;
      const a = Math.random() * 6.28, r = 160 + Math.random() * 90; bolt(new V3(Math.cos(a) * r, 170, Math.sin(a) * r), new V3(Math.cos(a) * r * .9, 40, Math.sin(a) * r * .9), 1.2, .45);
      SFX.thunder();
    }
  }
  LOOK.light = Math.max(0, LOOK.light - dt * 2.5); const lf = LOOK.light * (Math.random() > .3 ? 1 : .3); // éclair qui vacille
  skyMat.uniforms.flash.value = lf * 1.5; hemi.intensity = LOOK.hemi + lf * .8; POST.flash = Math.max(POST.flash, lf * .03);
  flash.intensity *= Math.exp(-5 * dt); POST.flash *= Math.exp(-4 * dt);
  debris.forEach(d => {
    if (!d.m.visible) return;
    const m = d.m; d.v.y -= 9.8 * dt; m.position.addScaledVector(d.v, dt);
    if (m.position.y < .06) { m.position.y = .06; d.v.y *= -.35; d.v.x *= .7; d.v.z *= .7; d.w.multiplyScalar(.6); }
    m.rotation.x += d.w.x * dt; m.rotation.y += d.w.y * dt; m.rotation.z += d.w.z * dt;
    if ((d.t -= dt) < .5) m.scale.multiplyScalar(.9); m.visible = d.t > 0;
  });
  for (let i = rockets.length - 1; i >= 0; i--) {
    const r = rockets[i];
    if ((r.d -= dt) > 0) continue;
    if (!r.up) { r.up = 1; SFX.launch(r.p.x, r.p.y, r.p.z); } // sifflement de la fusée
    r.v.y -= 9 * dt; r.p.addScaledVector(r.v, dt);
    FXA.emit(r.p, rdir(.6), { c: 0xffc070, l: .5, s: .25, k: 2 });
    if ((r.fuse -= dt) > 0) continue;
    for (let j = 0; j < (HQ ? 150 : 60); j++) FXA.emit(r.p, rdir(9 + Math.random() * 4), { c: r.c, l: 1.7, s: .6, k: 4, gr: 2.5, d: 1.3 });
    SFX.pop(r.p.x, r.p.y, r.p.z); rockets.splice(i, 1);
  }
  for (let k = 0; k < SK; k++) { skAge[k] += dt; const a = .55 * Math.max(0, 1 - skAge[k] / 10); for (let j = 0; j < 4; j++) skCol.set([.03, .05, .02, a], k * 16 + j * 4); }
  skGeo.attributes.color.needsUpdate = true;
  // Stade : écrans LED, projecteurs, anneau central et faisceaux aux couleurs de l'équipe qui vient de marquer, jets de flammes
  ledTex.offset.x = t * .04;
  const tc = new C(COL[hypeTeam]), pulse = hype * (.6 + .4 * Math.sin(t * 12));
  roofLight.color.copy(LOOK.roof).lerp(tc.clone().multiplyScalar(5), pulse); ledMat.color.copy(LOOK.led).lerp(tc.clone().multiplyScalar(2.5), hype);
  ringMat.color.copy(LOOK.ring).lerp(tc.clone().multiplyScalar(5), pulse); if (shaftMat) shaftMat.uniforms.c.value.copy(LOOK.shaft).lerp(tc, hype * .8);
  if (hype > .55) JETS.forEach(j => {
    for (let i = 0; i < (HQ ? 3 : 1); i++) FXA.emit(j, new V3(rnd(1.5), 15 + Math.random() * 9, rnd(1.5)), { c: pick([0xff5a10, 0xffa030, 0xffe080]), l: .8, s: .9, k: 3, gr: 6, g: -.3 });
    if (Math.random() < .3) FXN.emit(j.clone().setY(j.y + 6), new V3(rnd(2), 6, rnd(2)), { c: 0x3a3440, l: 2, s: 2, g: 5, a: .35 });
  });
  hype = Math.max(0, hype - dt * .2);
  for (let n = (1 + hype * 20) * dt * 30; n > Math.random(); n--) {
    const s = pick(STANDS), u = Math.random(), d = s.d0 + u * (28 - s.d0);
    FXA.emit(new V3(rnd(s.len + .8 * d), s.y0 + u * (22 - s.y0), -d).applyMatrix4(s.g.matrixWorld), new V3(), { c: 0xffffff, l: .12, s: .7, k: 5, d: 0 });
  }
}
