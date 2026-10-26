'use strict';
// ===== Rocket Ball : graphismes (rendu HDR + bloom, ciel, stade, voitures, balle, effets) =====
const V3 = THREE.Vector3, Q = THREE.Quaternion, C = THREE.Color, $ = id => document.getElementById(id);
const clamp = (v, a = -1, b = 1) => Math.max(a, Math.min(b, v));
const rnd = a => (Math.random() - .5) * a, pick = a => a[Math.random() * a.length | 0];
const rdir = s => new V3().randomDirection().multiplyScalar(s);
const TOUCH_DEV = matchMedia('(pointer: coarse)').matches, HQ = !TOUCH_DEV; // effets complets sur ordinateur, allégés sur mobile
addEventListener('error', e => { $('err').textContent = '⚠️ ' + e.message; $('err').classList.remove('hidden'); }); // bug visible à l'écran

// ===== Dimensions (1 unité = 1 m, d'après les valeurs de Rocket League) =====
const W = 41, L = 51.2, H = 20.4, CUT = 11, GW = 8.9, GH = 6.4, GD = 8.8, BR = .93, REST = .38; // terrain, coins, cages, balle
const COL = [0x1e7bff, 0xff7a1a], UP = new V3(0, 1, 0), SUN = new V3(-.55, .1, -.83).normalize();
const OCT = [[W, CUT - L], [W, L - CUT], [W - CUT, L], [CUT - W, L], [-W, L - CUT], [-W, CUT - L], [CUT - W, -L], [W - CUT, -L]];

// ===== Rendu =====
const renderer = new THREE.WebGLRenderer({ antialias: !HQ, powerPreference: 'high-performance' });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.prepend(renderer.domElement);
const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(78, 1, .1, 1100);
scene.fog = new THREE.FogExp2(0x2b2140, .0028);
const QUALITY = { auto: true, pr: Math.min(devicePixelRatio, HQ ? 2 : 1.5) }; // résolution adaptée aux FPS

// Post-traitement : halo lumineux (bloom) + vignette, calculés en HDR
const post = HQ && (() => {
  const ext = renderer.extensions, type = ext.has('EXT_color_buffer_float') || ext.has('EXT_color_buffer_half_float') ? THREE.HalfFloatType : THREE.UnsignedByteType;
  const rt = (samples = 0) => new THREE.WebGLRenderTarget(1, 1, { type, samples });
  const main = rt(4), mips = [rt(), rt(), rt(), rt(), rt()];
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2)), cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const sh = (fs, u = {}, o = {}) => new THREE.ShaderMaterial({
    uniforms: { tex: { value: null }, px: { value: new THREE.Vector2() }, ...u }, depthTest: false, depthWrite: false, ...o,
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }',
    fragmentShader: 'uniform sampler2D tex; uniform vec2 px; varying vec2 vUv;\n#define T(o) texture2D(tex, vUv + (o) * px).rgb\n' + fs,
  });
  const bright = sh('void main() { vec3 c = T(vec2(0)); gl_FragColor = vec4(c * smoothstep(1., 2.6, max(c.r, max(c.g, c.b))), 1.); }');
  const down = sh('void main() { gl_FragColor = vec4((T(vec2(0)) * 4. + T(vec2(-1)) + T(vec2(1)) + T(vec2(1, -1)) + T(vec2(-1, 1))) / 8., 1.); }');
  const up = sh('void main() { gl_FragColor = vec4((T(vec2(-2, 0)) + T(vec2(2, 0)) + T(vec2(0, -2)) + T(vec2(0, 2)) + (T(vec2(-1, 1)) + T(vec2(1)) + T(vec2(1, -1)) + T(vec2(-1))) * 2.) / 12., 1.); }',
    {}, { blending: THREE.AdditiveBlending });
  const final = sh(`uniform sampler2D bloom; uniform float str;
    void main() {
      vec3 c = T(vec2(0)) + texture2D(bloom, vUv).rgb * str;
      gl_FragColor = vec4(c * mix(.55, 1., smoothstep(.95, .3, length(vUv - .5))), 1.);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`, { bloom: { value: null }, str: { value: .55 } });
  const pass = (m, src, dst) => {
    quad.material = m; m.uniforms.tex.value = src.texture; m.uniforms.px.value.set(1 / src.width, 1 / src.height);
    renderer.setRenderTarget(dst); renderer.autoClear = m !== up; renderer.render(quad, cam);
  };
  return {
    size(w, h) { main.setSize(w, h); mips.forEach((m, i) => m.setSize(Math.max(1, w >> i + 1), Math.max(1, h >> i + 1))); },
    render() {
      renderer.setRenderTarget(main); renderer.autoClear = true; renderer.render(scene, camera);
      pass(bright, main, mips[0]);
      for (let i = 1; i < mips.length; i++) pass(down, mips[i - 1], mips[i]);
      for (let i = mips.length - 1; i > 0; i--) pass(up, mips[i], mips[i - 1]);
      final.uniforms.bloom.value = mips[0].texture; pass(final, main, null); renderer.autoClear = true;
    },
  };
})();

function resize() {
  renderer.setPixelRatio(QUALITY.pr); renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  const s = renderer.getDrawingBufferSize(new THREE.Vector2()); if (post) post.size(s.x, s.y);
}
addEventListener('resize', resize); resize();
let ft = 1 / 60, fn = 0;
function render(dt) {
  if (QUALITY.auto && (ft += (dt - ft) * .05, ++fn > 90)) { // baisse la résolution si ça rame, la remonte sinon
    fn = 0; const max = Math.min(devicePixelRatio, HQ ? 2 : 1.5), pr = QUALITY.pr;
    QUALITY.pr = ft > 1 / 45 ? Math.max(.6, pr - .2) : ft < 1 / 57 ? Math.min(max, pr + .1) : pr;
    if (QUALITY.pr !== pr) resize();
  }
  sky.position.copy(camera.position);
  const ps = renderer.getDrawingBufferSize(new THREE.Vector2()).y / (2 * Math.tan(camera.fov * Math.PI / 360));
  FXA.mat.uniforms.ps.value = FXN.mat.uniforms.ps.value = ps;
  if (post) post.render(); else renderer.render(scene, camera);
}

// ===== Textures dessinées =====
function canvasTex(w, h, draw, srgb = true) {
  const cv = Object.assign(document.createElement('canvas'), { width: w, height: h }); draw(cv.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(cv); if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy(); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}
const glow = (c, k = 2.5, o) => new THREE.MeshBasicMaterial({ color: new C(c).multiplyScalar(k), ...o }); // couleur > 1 = halo
const hexPath = (x, cx, cy, r) => { x.beginPath(); for (let i = 0; i < 6; i++) { const a = Math.PI / 3 * i + Math.PI / 6; x.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a)); } x.closePath(); };
const hexTex = (fill, line, lw) => canvasTex(128, 222, x => { // nid d'abeille raccordable
  x.fillStyle = fill; x.strokeStyle = line; x.lineWidth = lw;
  [[0, 0], [128, 0], [64, 111], [0, 222], [128, 222]].forEach(([cx, cy]) => { hexPath(x, cx, cy, 72); x.fill(); x.stroke(); });
});
const radial = canvasTex(64, 64, x => { const g = x.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, '#fff'); g.addColorStop(.35, '#ffffff90'); g.addColorStop(1, '#fff0'); x.fillStyle = g; x.fillRect(0, 0, 64, 64); });
const fade = canvasTex(4, 128, x => { const g = x.createLinearGradient(0, 0, 0, 128); g.addColorStop(0, '#000'); g.addColorStop(1, '#fff'); x.fillStyle = g; x.fillRect(0, 0, 4, 128); }, false); // noir en haut, blanc en bas
const additive = (o = {}) => ({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, ...o });

// ===== Ciel de coucher de soleil + reflets d'environnement =====
const skyMat = new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, uniforms: { sun: { value: SUN } },
  vertexShader: 'varying vec3 vD; void main() { vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
  fragmentShader: `uniform vec3 sun; varying vec3 vD;
    void main() {
      float y = vD.y, s = max(dot(vD, sun), 0.);
      vec3 c = mix(vec3(.9, .25, .07), vec3(.07, .03, .17), smoothstep(-.05, .32, y));
      c = mix(c, vec3(.004, .007, .035), smoothstep(.28, .9, y));
      c += vec3(1., .42, .14) * (pow(s, 5.) * .55 + pow(s, 600.) * 40.);
      vec3 g = floor(vD * 260.);
      c += step(.9975, fract(sin(dot(g, vec3(12.99, 78.23, 45.16))) * 43758.5)) * smoothstep(.25, .6, y) * 2.;
      gl_FragColor = vec4(c, 1.);
    }`,
});
const sky = new THREE.Mesh(new THREE.SphereGeometry(520, 48, 24), skyMat);
sky.renderOrder = -1; scene.add(sky);
{
  const env = new THREE.Scene(), ground = new THREE.Mesh(new THREE.CircleGeometry(40, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x0c1a10 }));
  ground.position.y = -1; env.add(new THREE.Mesh(new THREE.SphereGeometry(45, 32, 16), skyMat), ground);
  for (let i = 0; i < 10; i++) { // projecteurs du toit, pour des reflets nets sur les carrosseries
    const a = i / 10 * Math.PI * 2, b = new THREE.Mesh(new THREE.BoxGeometry(8, 1.5, .5), glow(0xfff2e0, 8));
    b.position.set(Math.cos(a) * 30, 20, Math.sin(a) * 30); b.lookAt(0, 0, 0); env.add(b);
  }
  scene.environment = new THREE.PMREMGenerator(renderer).fromScene(env, .02).texture;
}

// Lumières : soleil au zénith (ombres lisibles), contre-jour orangé, ambiance
scene.add(new THREE.HemisphereLight(0x8ea6ff, 0x24401c, .9));
const sun = new THREE.DirectionalLight(0xfff1dd, 2.4), rim = new THREE.DirectionalLight(0xff8a50, .8);
sun.position.set(8, 90, 6); sun.castShadow = true; sun.shadow.mapSize.setScalar(HQ ? 4096 : 1024); sun.shadow.bias = -.0004; sun.shadow.normalBias = .03;
Object.assign(sun.shadow.camera, { left: -64, right: 64, top: 64, bottom: -64, near: 20, far: 130 }); sun.shadow.camera.updateProjectionMatrix();
rim.position.copy(SUN).multiplyScalar(100);
scene.add(sun, rim);

// ===== Terrain =====
const toPx = (x, z) => [(x + W) / (2 * W) * 1024, (z + L) / (2 * L) * 1280]; // haut de l'image = cage bleue
function markings(x, s) {
  x.strokeStyle = s; x.fillStyle = s; x.lineWidth = 6;
  x.beginPath(); OCT.forEach(([a, b]) => x.lineTo(...toPx(a * .992, b * .994))); x.closePath(); x.stroke();
  x.beginPath(); x.moveTo(0, 640); x.lineTo(1024, 640); x.stroke();
  x.beginPath(); x.arc(512, 640, 140, 0, 7); x.stroke();
  x.beginPath(); x.arc(512, 640, 10, 0, 7); x.fill();
  [[0, 1], [1280, -1]].forEach(([y, s]) => { x.strokeRect(330, y, 364, 170 * s); x.strokeRect(400, y, 224, 70 * s); x.beginPath(); x.arc(512, y + 170 * s, 70, s > 0 ? 0 : Math.PI, s > 0 ? Math.PI : 0); x.stroke(); });
}
const FS = HQ ? 2 : 1;
const fieldTex = canvasTex(1024 * FS, 1280 * FS, (x, w, h) => {
  x.scale(FS, FS);
  for (let i = 0; i < 16; i++) { x.fillStyle = i % 2 ? '#2c7b33' : '#35883b'; x.fillRect(0, i * 80, 1024, 80); }
  [[0, '#1e7bff'], [1280, '#ff7a1a']].forEach(([y, c]) => { const g = x.createLinearGradient(0, y, 0, 640); g.addColorStop(0, c + '66'); g.addColorStop(1, c + '00'); x.fillStyle = g; x.fillRect(0, 0, 1024, 1280); });
  markings(x, '#ffffffe8');
  x.font = 'italic 900 62px "Russo One", sans-serif'; x.textAlign = 'center'; x.fillStyle = '#ffffff2a'; x.fillText('ROCKET BALL', 512, 662);
  const d = x.getImageData(0, 0, w, h), a = d.data; // grain de l'herbe
  for (let i = 0; i < a.length; i += 4) { const n = (Math.random() - .5) * 16; a[i] += n * .7; a[i + 1] += n; a[i + 2] += n * .5; }
  x.putImageData(d, 0, 0);
});
const lineTex = canvasTex(512, 640, x => { x.fillStyle = '#000'; x.fillRect(0, 0, 512, 640); x.scale(.5, .5); markings(x, '#fff'); });
const grass = canvasTex(128, 128, x => { const d = x.createImageData(128, 128); for (let i = 0; i < d.data.length; i += 4) d.data.set([Math.random() * 255, 0, 0, 255].fill(Math.random() * 255, 0, 3), i); x.putImageData(d, 0, 0); }, false);
grass.repeat.set(70, 90);
const floorG = new THREE.ShapeGeometry(new THREE.Shape(OCT.map(([x, z]) => new THREE.Vector2(x, -z))));
{ const uv = floorG.attributes.uv, pos = floorG.attributes.position; for (let i = 0; i < uv.count; i++) uv.setXY(i, (pos.getX(i) + W) / (2 * W), (pos.getY(i) + L) / (2 * L)); }
const floor = new THREE.Mesh(floorG.rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({
  map: fieldTex, emissive: 0xffffff, emissiveMap: lineTex, emissiveIntensity: .45, bumpMap: grass, bumpScale: 1.2, roughness: .82, envMapIntensity: .35,
}));
const outside = new THREE.Mesh(new THREE.PlaneGeometry(600, 600).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x0d1018, roughness: .9 }));
floor.receiveShadow = outside.receiveShadow = true; outside.position.y = -.05;
scene.add(floor, outside);

// ===== Murs en nid d'abeille, bandes lumineuses, tribunes, écrans LED, anneau de projecteurs =====
const wallHex = hexTex('#ffffff10', '#fff', 3); wallHex.repeat.set(1 / 2, 1 / (2 * 222 / 128)); // une alvéole ≈ 2 m
const wallFade = canvasTex(4, 128, x => { const g = x.createLinearGradient(0, 0, 0, 128); g.addColorStop(0, '#2a2a2a'); g.addColorStop(1, '#d0d0d0'); x.fillStyle = g; x.fillRect(0, 0, 4, 128); }, false);
wallFade.repeat.set(1, 1 / H); // murs plus opaques en bas
const crowdTex = canvasTex(512, 256, x => {
  x.fillStyle = '#0d1120'; x.fillRect(0, 0, 512, 256);
  for (let r = 0; r < 16; r++) { x.fillStyle = r % 2 ? '#141a2c' : '#10152388'; x.fillRect(0, r * 16, 512, 16); }
  for (let i = 0; i < 1400; i++) {
    const px = Math.random() * 512, py = (Math.random() * 16 | 0) * 16 + 4;
    x.fillStyle = pick(['#1e7bff', '#3b8cff', '#ff7a1a', '#ff9b45', '#e8e8e8', '#8a90a6', '#ffd400']); x.fillRect(px, py + 4, 5, 7);
    x.fillStyle = pick(['#f1c7a0', '#c48a5c', '#8a5a3a']); x.fillRect(px + 1, py, 3, 4);
  }
});
const ledTex = canvasTex(1024, 64, x => {
  x.fillStyle = '#05060c'; x.fillRect(0, 0, 1024, 64); x.font = 'italic 40px "Russo One", sans-serif'; x.textBaseline = 'middle';
  ['ROCKET BALL', '★', 'BOOST', '★', 'SUPERSONIQUE', '★'].reduce((px, t, i) => { x.fillStyle = ['#ffffff', '#1e7bff', '#ff7a1a'][i % 3]; x.fillText(t, px, 34); return px + x.measureText(t).width + 30; }, 20);
});
const crowdMat = new THREE.MeshBasicMaterial({ map: crowdTex, color: 0x8a90a8 }), ledMat = new THREE.MeshBasicMaterial({ map: ledTex, color: new C(1.8, 1.8, 1.8) });
const backMat = new THREE.MeshStandardMaterial({ color: 0x0e111a, roughness: .8 });
const roofMat = new THREE.MeshStandardMaterial({ color: 0x0b0d14, metalness: .6, roughness: .5, side: THREE.DoubleSide }), roofLight = glow(0xfff0d8, 3);
const STANDS = []; // pour les flashs d'appareils photo dans le public
const strip = (len, x, y, z, col, k = 3) => { const m = new THREE.Mesh(new THREE.BoxGeometry(len, .22, .22), glow(col, k)); m.position.set(x, y, z); return m; };
function quad(l0, l1, y0, z0, y1, z1, mat, v = 1) { // trapèze dans le repère d'un mur (z < 0 = vers l'extérieur)
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-l0 / 2, y0, z0, l0 / 2, y0, z0, l1 / 2, y1, z1, -l1 / 2, y1, z1], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, l0 / 8, 0, l1 / 8, v, 0, v], 2));
  g.setIndex([0, 1, 2, 0, 2, 3]); g.computeVertexNormals();
  return new THREE.Mesh(g, mat);
}
OCT.forEach(([x1, z1], i) => {
  const [x2, z2] = OCT[(i + 1) % 8], dx = x2 - x1, dz = z2 - z1, len = Math.hypot(dx, dz), h = len / 2, zm = (z1 + z2) / 2, end = Math.abs(zm) === L;
  const side = !end && Math.abs(zm) < 1, col = zm < -1 ? COL[0] : zm > 1 ? COL[1] : 0xffffff, g = new THREE.Group(), at = d => len + .828 * d;
  const pts = end ? [[-h, 0], [-GW, 0], [-GW, GH], [GW, GH], [GW, 0], [h, 0], [h, H], [-h, H]] : [[-h, 0], [h, 0], [h, H], [-h, H]];
  g.add(new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape(pts.map(p => new THREE.Vector2(...p)))), new THREE.MeshStandardMaterial({
    color: col, map: wallHex, alphaMap: wallFade, emissive: col, emissiveMap: wallHex, emissiveIntensity: .22,
    transparent: true, side: THREE.DoubleSide, depthWrite: false, roughness: .25, metalness: .3,
  })));
  // Bandes lumineuses : en haut, au pied du mur (coupée par la cage), séparées bleu / orange sur les côtés
  if (side) [-1, 1].forEach(s => g.add(strip(h, s * h / 2, H, 0, COL[+(s * dz > 0)]), strip(h, s * h / 2, .12, 0, COL[+(s * dz > 0)]))); // moitié bleue / moitié orange
  else {
    g.add(strip(len, 0, H, 0, col));
    if (end) [-1, 1].forEach(s => g.add(strip(h - GW, s * (h + GW) / 2, .12, 0, col))); else g.add(strip(len, 0, .12, 0, col));
  }
  const pillar = new THREE.Mesh(new THREE.BoxGeometry(.3, H, .3), glow(col, 2)); pillar.position.set(-h, H / 2, 0); g.add(pillar);
  // Gradins (derrière la cage, ils démarrent plus haut), écrans LED, toit et projecteurs
  const [y0, d0] = end ? [9, 12] : [4, 3], dw = d0 - .1;
  g.add(quad(at(dw), at(dw), 0, -dw, y0, -dw, backMat), quad(at(dw - .1), at(dw - .1), 1.2, .1 - dw, 3.3, .1 - dw, ledMat)); // muret + écran LED
  g.add(quad(at(d0), at(28), y0, -d0, 22, -28, crowdMat, 4), quad(at(28.5), at(28.5), 21.8, -28.5, 24.6, -28.5, ledMat), quad(at(30), at(48), 24.5, -30, 40, -48, crowdMat, 3));
  g.add(quad(at(48), at(48), 40, -48, 47, -48, backMat));
  g.add(quad(at(56), at(18), 47, -56, 45, -18, roofMat));
  const lamp = new THREE.Mesh(new THREE.BoxGeometry(at(20) * .92, .2, .6), roofLight); lamp.position.set(0, 44.6, -20); g.add(lamp);
  g.position.set((x1 + x2) / 2, 0, zm); g.rotation.y = Math.atan2(-dz, dx); g.updateMatrixWorld(); scene.add(g);
  STANDS.push({ g, len, y0, d0 });
});

// Écran géant suspendu au-dessus du terrain (score et temps)
const boardCv = Object.assign(document.createElement('canvas'), { width: 512, height: 256 }), boardTex = new THREE.CanvasTexture(boardCv);
boardTex.colorSpace = THREE.SRGBColorSpace;
const jumbo = new THREE.Group(), screenMat = new THREE.MeshBasicMaterial({ map: boardTex, color: new C(1.5, 1.5, 1.5) });
jumbo.add(new THREE.Mesh(new THREE.BoxGeometry(14, 7.6, 14), new THREE.MeshStandardMaterial({ color: 0x0a0c12, metalness: .8, roughness: .35 })));
for (let i = 0; i < 4; i++) { const s = new THREE.Mesh(new THREE.PlaneGeometry(13, 6.6), screenMat); s.rotation.y = i * Math.PI / 2; s.position.set(Math.sin(i * Math.PI / 2) * 7.02, 0, Math.cos(i * Math.PI / 2) * 7.02); jumbo.add(s); }
[-3.9, 3.9].forEach(y => { const r = new THREE.Mesh(new THREE.BoxGeometry(14.4, .25, 14.4), glow(0x66ccff, 1.6)); r.position.y = y; jumbo.add(r); });
jumbo.position.y = 34; scene.add(jumbo);
let boardKey = '';
function setBoard(a, b, t, g) { // g = équipe qui vient de marquer (ou null)
  const k = [a, b, t, g].join(); if (k === boardKey) return; boardKey = k;
  const x = boardCv.getContext('2d'); x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillStyle = '#05070d'; x.fillRect(0, 0, 512, 256);
  if (g != null) { x.fillStyle = g ? '#ff7a1a' : '#1e7bff'; x.fillRect(0, 0, 512, 256); x.fillStyle = '#fff'; x.font = 'italic 130px "Russo One", sans-serif'; x.fillText('BUT !', 256, 132); }
  else {
    x.fillStyle = '#1e7bff'; x.fillRect(0, 0, 168, 256); x.fillStyle = '#ff7a1a'; x.fillRect(344, 0, 168, 256);
    x.fillStyle = '#fff'; x.font = '120px "Russo One", sans-serif'; x.fillText(a, 84, 134); x.fillText(b, 428, 134);
    x.font = '58px "Russo One", sans-serif'; x.fillText(t, 256, 134);
  }
  boardTex.needsUpdate = true;
}
setBoard(0, 0, '5:00', null);

// ===== Cages : filet alvéolé, fond lumineux, poteaux néon, lumière colorée =====
const netHex = hexTex('#ffffff18', '#fff', 7); netHex.repeat.set(9, 3);
[-1, 1].forEach(s => {
  const col = COL[s < 0 ? 0 : 1], none = new THREE.MeshBasicMaterial({ visible: false }), neon = glow(col, 4);
  const net = new THREE.MeshStandardMaterial({ color: col, map: netHex, emissive: col, emissiveMap: netHex, emissiveIntensity: .8, transparent: true, side: THREE.DoubleSide, depthWrite: false });
  const backGlow = new THREE.MeshBasicMaterial({ map: fade, color: new C(col).multiplyScalar(1.6), ...additive({ side: THREE.DoubleSide }) });
  const box = new THREE.Mesh(new THREE.BoxGeometry(2 * GW, GH, GD), [net, net, net, none, s > 0 ? backGlow : none, s > 0 ? none : backGlow]);
  const gf = new THREE.Mesh(new THREE.PlaneGeometry(2 * GW, GD).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x12241a, roughness: .8 }));
  box.position.set(0, GH / 2, s * (L + GD / 2)); gf.position.set(0, .004, s * (L + GD / 2)); gf.receiveShadow = true;
  scene.add(box, gf);
  [[.4, GH, GW, GH / 2], [.4, GH, -GW, GH / 2], [2 * GW + .4, .4, 0, GH], [2 * GW, .05, 0, .03]].forEach(([w, hh, x, y]) => {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(w, hh, y < .1 ? .3 : .4), neon); bar.position.set(x, y, s * L); scene.add(bar);
  });
  const light = new THREE.PointLight(col, 50, 26, 1.6); light.position.set(0, 3.5, s * (L + 4)); scene.add(light);
});

// ===== Pastilles de boost (28 petites + 6 grandes) =====
const padOn = glow(0xffb51a, 3.2), padOff = new THREE.MeshStandardMaterial({ color: 0x3a2e10, roughness: .6 });
const padBase = new THREE.MeshStandardMaterial({ color: 0x1c1f26, metalness: .85, roughness: .3 });
const beamMat = new THREE.MeshBasicMaterial({ map: fade, color: new C(0xffb51a).multiplyScalar(1.2), ...additive({ side: THREE.DoubleSide }) });
const pads = [];
[[[[0, 42.4], [17.9, 41.8], [9.4, 33.1], [0, 28.2], [35.8, 24.8], [17.9, 23], [20.5, 10.4], [0, 10.2], [10.2, 0]], false], [[[30.7, 41], [35.8, 0]], true]]
  .forEach(([list, big]) => list.forEach(([px, pz]) => (px ? [px, -px] : [0]).forEach(x => (pz ? [pz, -pz] : [0]).forEach(z => {
    const r = big ? 1 : .55, g = new THREE.Group();
    const base = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.25, r * 1.4, .1, 32), padBase);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r, .06, 8, 48).rotateX(Math.PI / 2), padOn);
    const core = new THREE.Mesh(new THREE.CircleGeometry(r * .6, 32).rotateX(-Math.PI / 2), padOn);
    base.position.y = .05; ring.position.y = .11; core.position.y = .106; base.receiveShadow = true; g.add(base, ring, core);
    let orb, beam;
    if (big) { orb = new THREE.Mesh(new THREE.SphereGeometry(.42, 24, 16), padOn); beam = new THREE.Mesh(new THREE.CylinderGeometry(.85, .85, 5, 24, 1, true), beamMat); beam.position.y = 2.5; g.add(orb, beam); }
    g.position.set(x, 0, z); scene.add(g);
    pads.push({ x, z, big, t: 0, ring, core, orb, beam });
  }))));
function animPads(t) {
  pads.forEach(p => {
    const on = p.t <= 0;
    p.ring.material = p.core.material = on ? padOn : padOff; p.ring.scale.setScalar(on ? 1 + Math.sin(t * 4 + p.x) * .07 : 1);
    if (p.orb) { p.orb.visible = p.beam.visible = on; p.orb.position.y = 1 + Math.sin(t * 2 + p.x) * .15; p.orb.rotation.y = t; }
  });
}

// ===== Balle : métal alvéolé, coutures lumineuses =====
function makeBall() {
  const tex = canvasTex(1024, 512, x => {
    x.fillStyle = '#cfd4dc'; x.fillRect(0, 0, 1024, 512); x.strokeStyle = '#59606e'; x.lineWidth = 6; x.fillStyle = '#b9bfca';
    for (let cy = 0; cy < 560; cy += 54) for (let cx = (cy / 54 % 2) * 31; cx < 1060; cx += 62) { hexPath(x, cx, cy, 34); x.fill(); x.stroke(); }
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(BR, 64, 32), new THREE.MeshPhysicalMaterial({ map: tex, metalness: .45, roughness: .32, clearcoat: 1, clearcoatRoughness: .15 }));
  m.add(new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(BR * 1.004, 1)), new THREE.LineBasicMaterial({ color: new C(0x8fd4ff).multiplyScalar(2.4) })));
  m.castShadow = true; scene.add(m); return m;
}

// ===== Voitures : carrosserie profilée, vernis, vitres, phares, roues, boost =====
const MODELS = { // profils de côté [avant, hauteur] de la caisse et du cockpit, largeurs, rayon des roues, aileron [largeur, hauteur, position]
  'Éclair': { wr: .17, w: .82, cw: .62, wing: [.88, .2, -.58], body: [[-.62, -.2], [.56, -.2], [.68, -.08], [.63, .04], [.2, .1], [-.5, .12], [-.64, .06], [-.66, -.12]], cab: [[.22, .08], [0, .3], [-.32, .3], [-.52, .1]] },
  'Requin': { wr: .16, w: .86, cw: .6, wing: [.98, .25, -.62], body: [[-.68, -.2], [.66, -.2], [.76, -.1], [.72, 0], [.25, .06], [-.55, .08], [-.7, .04], [-.72, -.12]], cab: [[.22, .05], [0, .2], [-.3, .2], [-.56, .06]] },
  'Bloc': { wr: .2, w: .88, cw: .74, wing: null, body: [[-.6, -.18], [.6, -.18], [.67, -.05], [.65, .13], [.35, .17], [-.6, .17], [-.64, 0]], cab: [[.34, .16], [.2, .42], [-.4, .42], [-.52, .16]] },
};
const glass = new THREE.MeshPhysicalMaterial({ color: 0x0a1018, metalness: .9, roughness: .05, clearcoat: 1, envMapIntensity: 2 });
const rubber = new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: .85 }), dark = new THREE.MeshStandardMaterial({ color: 0x1a1d24, metalness: .7, roughness: .4 });
const headMat = glow(0xeaf4ff, 5), tailMat = glow(0xff2030, 4);
const paint = c => new THREE.MeshPhysicalMaterial({ color: c, metalness: .25, roughness: .38, clearcoat: 1, clearcoatRoughness: .06, envMapIntensity: .8 });
const smooth = (pts, n = 2) => { // arrondit un profil (coupe des coins de Chaikin)
  for (let k = 0; k < n; k++) pts = pts.flatMap(([x, y], i, a) => { const [u, v] = a[(i + 1) % a.length]; return [[x * .75 + u * .25, y * .75 + v * .25], [x * .25 + u * .75, y * .25 + v * .75]]; });
  return pts;
};
function buildCar(r) {
  const M = MODELS[r.model] || MODELS['Éclair'], root = new THREE.Group(), body = new THREE.Group(), accent = paint(r.accent);
  const add = (geo, mat, x = 0, y = 0, z = 0, to = body) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; to.add(m); return m; };
  const ext = (pts, w, mat) => add(new THREE.ExtrudeGeometry(new THREE.Shape(smooth(pts).map(([z, y]) => new THREE.Vector2(z, y))),
    { depth: w - .08, bevelEnabled: true, bevelThickness: .04, bevelSize: .04, bevelSegments: 3 }).translate(0, 0, (.08 - w) / 2).rotateY(-Math.PI / 2), mat);
  ext(M.body, M.w, paint(COL[r.team])); ext(M.cab, M.cw, glass);
  const top = Math.max(...M.cab.map(p => p[1])), front = Math.max(...M.body.map(p => p[0])), rear = Math.min(...M.body.map(p => p[0]));
  add(new THREE.BoxGeometry(.16, .025, .3), accent, 0, top + .045, -.06); // bande sur le toit
  if (M.wing) { const [w, y, z] = M.wing; add(new THREE.BoxGeometry(w, .04, .2), accent, 0, y, z); [-.3, .3].forEach(x => add(new THREE.BoxGeometry(.04, .14, .08), dark, x, y - .08, z + .03)); }
  [-.27, .27].forEach(x => { add(new THREE.BoxGeometry(.16, .05, .06), headMat, x, -.06, front - .02); add(new THREE.BoxGeometry(.18, .045, .06), tailMat, x, -.02, rear + .03); });
  root.add(body);
  // Néon sous la voiture (couleur d'équipe)
  const under = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 2.1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: radial, color: new C(COL[r.team]).multiplyScalar(1.4), ...additive() }));
  under.position.y = .02 - REST; root.add(under);
  // Roues : pivot de direction > rotation > pneu + jante + rayons
  const wheels = [], tire = new THREE.CylinderGeometry(M.wr, M.wr, .16, 24).rotateZ(Math.PI / 2), rim = new THREE.CylinderGeometry(M.wr * .62, M.wr * .62, .17, 12).rotateZ(Math.PI / 2);
  for (const x of [-.43, .43]) for (const z of [-.38, .4]) {
    const steer = new THREE.Group(), spin = new THREE.Group(); steer.position.set(x, M.wr - REST, z); steer.add(spin); root.add(steer);
    add(tire, rubber, 0, 0, 0, spin); add(rim, accent, 0, 0, 0, spin);
    [0, Math.PI / 2].forEach(a => add(new THREE.BoxGeometry(.176, M.wr * 1.15, .045), dark, 0, 0, 0, spin).rotation.x = a);
    wheels.push({ steer, spin, front: z > 0 });
  }
  // Flamme du boost : enveloppe colorée + cœur blanc
  const flame = new THREE.Group(), tc = new C(r.trail);
  flame.add(new THREE.Mesh(new THREE.ConeGeometry(.15, .8, 16, 1, true).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: tc.clone().multiplyScalar(3), ...additive({ opacity: .8 }) })));
  flame.add(new THREE.Mesh(new THREE.ConeGeometry(.05, .3, 12, 1, true).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: tc.clone().lerp(new C(1, 1, 1), .5).multiplyScalar(3), ...additive() })));
  flame.children[1].position.z = .12; flame.position.set(0, -.02, rear - .42); flame.visible = false; root.add(flame);
  scene.add(root);
  return { root, body, wheels, flame, wr: M.wr };
}
function makeTag(name, team) { // nom au-dessus des voitures
  const t = canvasTex(256, 64, x => {
    x.font = 'italic 34px "Russo One", sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    const w = Math.min(250, x.measureText(name).width + 30); x.fillStyle = team ? '#ff7a1acc' : '#1e7bffcc';
    x.beginPath(); (x.roundRect || x.rect).call(x, 128 - w / 2, 8, w, 48, 12); x.fill(); x.fillStyle = '#fff'; x.fillText(name, 128, 34);
  });
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, sizeAttenuation: false, depthTest: false, transparent: true }));
  s.scale.set(.13, .0325, 1); s.renderOrder = 9; scene.add(s); return s;
}

// ===== Particules (feu et étincelles en additif, fumée et confettis en normal) =====
function particles(n, add) {
  const geo = new THREE.BufferGeometry(), pos = new Float32Array(n * 3), col = new Float32Array(n * 4), size = new Float32Array(n);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('col', new THREE.BufferAttribute(col, 4)); geo.setAttribute('size', new THREE.BufferAttribute(size, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { map: { value: radial }, ps: { value: 500 } }, transparent: true, depthWrite: false, blending: add ? THREE.AdditiveBlending : THREE.NormalBlending,
    vertexShader: 'attribute float size; attribute vec4 col; uniform float ps; varying vec4 vC; void main() { vC = col; vec4 mv = modelViewMatrix * vec4(position, 1.); gl_PointSize = size * ps / -mv.z; gl_Position = projectionMatrix * mv; }',
    fragmentShader: 'uniform sampler2D map; varying vec4 vC; void main() { gl_FragColor = vC * texture2D(map, gl_PointCoord); }',
  });
  const pts = new THREE.Points(geo, mat); pts.frustumCulled = false; pts.renderOrder = add ? 3 : 2; scene.add(pts);
  const P = Array.from({ length: n }, () => ({ p: new V3(), v: new V3(), c: new C(), life: 0, max: 1 }));
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
const FXA = particles(HQ ? 2600 : 800, true), FXN = particles(HQ ? 1000 : 300, false);

// Ondes de choc et flash lumineux (buts, démolitions)
const waves = Array.from({ length: 3 }, () => { const m = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), new THREE.MeshBasicMaterial(additive({ side: THREE.DoubleSide }))); m.visible = false; scene.add(m); return { m, t: 1 }; });
const flash = new THREE.PointLight(0xffffff, 0, 70, 1.4); scene.add(flash);
let wi = 0, hype = 0;
const EFX = {
  wave(p, c, size) { const w = waves[wi = (wi + 1) % 3]; w.m.position.copy(p); w.m.material.color.set(c).multiplyScalar(2); Object.assign(w, { t: 0, size }); w.m.visible = true; },
  flash(p, c, k) { flash.position.copy(p).setY(Math.max(p.y, 2)); flash.color.set(c); flash.intensity = k; },
  boom(p, team) { // explosion de but
    const c = COL[team];
    for (let i = 0; i < (HQ ? 320 : 120); i++) FXA.emit(p, rdir(5 + Math.random() * 30), { c: Math.random() < .2 ? 0xffffff : c, l: 1.8, s: .5, k: 3, gr: 5, d: 1.2 });
    for (let i = 0; i < (HQ ? 160 : 50); i++) FXN.emit(p, rdir(3 + Math.random() * 12).add(new V3(0, 8, 0)), { c: pick([c, 0xffffff, 0xffd400]), l: 4, s: .22, gr: 4, d: .8 });
    for (let i = 0; i < 40; i++) FXN.emit(p, rdir(5), { c: 0x6a6070, l: 2.5, s: 1.5, g: 7, a: .45 });
    this.wave(p, c, 26); this.flash(p, c, 6000); hype = 1;
  },
  explode(p) { // démolition
    for (let i = 0; i < 120; i++) FXA.emit(p, rdir(3 + Math.random() * 14), { c: pick([0xff6a10, 0xffb030, 0xffffff]), l: .9, s: .45, k: 3, gr: 3 });
    for (let i = 0; i < 30; i++) FXN.emit(p, rdir(3), { c: 0x2a2a30, l: 2, s: 1, g: 4, a: .7 });
    this.wave(p, 0xff8a30, 7); this.flash(p, 0xff8a30, 2500);
  },
  spark(p, s) { for (let i = 0; i < Math.min(40, s * 1.5); i++) FXA.emit(p, rdir(2 + Math.random() * s * .6), { c: pick([0xffffff, 0x9fd8ff, 0xffd27a]), l: .4, s: .14, k: 4, gr: 6 }); },
  pad(x, z, big) { for (let i = 0; i < (big ? 40 : 14); i++) FXA.emit(new V3(x + rnd(1.5), .3, z + rnd(1.5)), new V3(rnd(2), 3 + Math.random() * 5, rnd(2)), { c: 0xffc040, l: .6, s: .2, k: 3 }); },
};
function animFx(dt, t) {
  FXA.update(dt); FXN.update(dt);
  waves.forEach(w => { if (!w.m.visible) return; w.t += dt * 1.6; w.m.scale.setScalar(.5 + w.size * (1 - (1 - Math.min(w.t, 1)) ** 3)); w.m.material.opacity = .5 * (1 - w.t); w.m.visible = w.t < 1; });
  flash.intensity *= Math.exp(-5 * dt);
  // Public : écrans LED qui défilent, flashs d'appareils photo (beaucoup plus après un but)
  ledTex.offset.x = t * .04; crowdTex.offset.y = hype > .05 ? Math.abs(Math.sin(t * 9)) * .006 * hype : 0;
  hype = Math.max(0, hype - dt * .25);
  for (let n = (1 + hype * 20) * dt * 30; n > Math.random(); n--) {
    const s = pick(STANDS), u = Math.random(), d = s.d0 + u * (28 - s.d0);
    FXA.emit(new V3(rnd(s.len + .8 * d), s.y0 + u * (22 - s.y0), -d).applyMatrix4(s.g.matrixWorld), new V3(), { c: 0xffffff, l: .12, s: .7, k: 5, d: 0 });
  }
}

// ===== Vitrine du garage (menu) =====
const showroom = new THREE.Group();
{
  const plat = new THREE.Mesh(new THREE.CylinderGeometry(1.9, 2.1, .12, 64), new THREE.MeshStandardMaterial({ color: 0x14171f, metalness: .9, roughness: .25 }));
  const ring = new THREE.Mesh(new THREE.TorusGeometry(2, .035, 8, 96).rotateX(Math.PI / 2), glow(0x66ccff, 4));
  const spot = new THREE.SpotLight(0xffffff, 70, 25, .5, .7, 1.3);
  plat.position.y = .06; plat.receiveShadow = true; ring.position.y = .12; spot.position.set(2, 8, 4);
  showroom.add(plat, ring, spot, spot.target); scene.add(showroom);
}
