'use strict';
// ===== Rocket Ball : graphismes (rendu HDR + post-traitement, ciel, stade, voitures, balle) — les effets sont dans effets.js =====
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

// Post-traitement en HDR : halo lumineux (bloom), reflets étirés, étalonnage, aberration chromatique, flou de vitesse, grain
const POST = { speed: 0, flash: 0, t: 0, dof: 0, fx: .5, fy: .5, dr: .1 }; // réglés par le jeu (dof = flou au-delà du rayon dr autour du point fx, fy)
const RT_TYPE = renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float') ? THREE.HalfFloatType : THREE.UnsignedByteType; // rendu HDR si possible
const post = HQ && (() => {
  const type = RT_TYPE;
  const rt = (samples = 0) => new THREE.WebGLRenderTarget(1, 1, { type, samples });
  const main = rt(4), mips = [rt(), rt(), rt(), rt(), rt()], sA = rt(), sB = rt(), dA = rt(), dB = rt();
  const dirt = canvasTex(512, 256, x => { // poussière et traces sur l'objectif, révélées par les lumières fortes
    for (let i = 0; i < 40; i++) { const r = 2 + Math.random() * 10, px = Math.random() * 512, py = Math.random() * 256, g = x.createRadialGradient(px, py, 0, px, py, r);
      g.addColorStop(0, `rgba(255,255,255,${.05 + Math.random() * .2})`); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(px - r, py - r, 2 * r, 2 * r); }
  });
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
  const streak = sh('uniform float st; void main() { vec3 s = vec3(0.); for (int i = -4; i <= 4; i++) s += T(vec2(float(i) * st, 0.)) * (1. - abs(float(i)) / 5.); gl_FragColor = vec4(s / 5., 1.); }', { st: { value: 1 } });
  const drops = canvasTex(256, 256, x => { // gouttes d'eau sur l'objectif (relief en niveaux de gris)
    x.fillStyle = '#000'; x.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 26; i++) { const r = 3 + Math.random() * 8, px = Math.random() * 256, py = Math.random() * 256, g = x.createRadialGradient(px, py, 0, px, py, r);
      [[0, '#fff'], [.5, '#ddd'], [.8, '#999'], [1, '#000']].forEach(s => g.addColorStop(...s)); x.fillStyle = g; x.beginPath(); x.ellipse(px, py, r, r * (1 + Math.random() * .5), 0, 0, 7); x.fill(); } // gouttes bombées
  }, false);
  const final = sh(`uniform sampler2D bloom, streaks, blur, dirt, drops; uniform float str, speed, flash, time, dof, aspect, dr, rain; uniform vec2 focus;
    void main() {
      vec2 uv = vUv;
      if (rain > 0.) { vec2 p = vUv * vec2(aspect, 1.) * .9 + vec2(0., time * .01), e = vec2(.004, 0.); // gouttes : l'image est déviée par leur relief
        uv -= vec2(texture2D(drops, p + e).r - texture2D(drops, p - e).r, texture2D(drops, p + e.yx).r - texture2D(drops, p - e.yx).r) * .05 * rain; }
      vec2 d = uv - .5; float r = length(d);
      vec2 ca = d * (.003 + speed * .008);                                   // aberration chromatique
      vec3 c = vec3(texture2D(tex, uv + ca).r, texture2D(tex, uv).g, texture2D(tex, uv - ca).b);
      if (dof > 0.) c = mix(c, texture2D(blur, vUv).rgb, dof * smoothstep(dr, dr + .3, length((vUv - focus) * vec2(aspect, 1.)))); // flou d'arrière-plan
      if (speed > .01) {                                                     // flou radial en supersonique
        vec3 b = vec3(0.); for (int i = 1; i <= 6; i++) b += texture2D(tex, uv - d * float(i) * .014 * speed).rgb;
        c = mix(c, b / 6., smoothstep(.12, .55, r) * speed);
      }
      vec3 bl = texture2D(bloom, vUv).rgb;
      c += bl * str + bl * texture2D(dirt, vUv).rgb * .6 + texture2D(streaks, vUv).rgb * vec3(.55, .75, 1.) * .4;
      float l = dot(c, vec3(.2126, .7152, .0722));
      c = mix(vec3(l), c, 1.12) * mix(vec3(.93, .97, 1.07), vec3(1.06, 1., .93), smoothstep(0., 1.5, l)); // saturation, ombres bleutées, lumières chaudes
      gl_FragColor = vec4(c * mix(.55, 1., smoothstep(.95, .3, r)) + flash, 1.);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      gl_FragColor.rgb += (fract(sin(dot(vUv * 1000. + time, vec2(12.9898, 78.233))) * 43758.5) - .5) * .03; // grain
    }`, { bloom: { value: null }, streaks: { value: null }, blur: { value: null }, dirt: { value: dirt }, drops: { value: drops }, rain: { value: 0 }, str: { value: .55 }, speed: { value: 0 }, flash: { value: 0 }, time: { value: 0 }, dof: { value: 0 }, dr: { value: .1 }, aspect: { value: 1 }, focus: { value: new THREE.Vector2(.5, .5) } });
  const pass = (m, src, dst) => {
    quad.material = m; m.uniforms.tex.value = src.texture; m.uniforms.px.value.set(1 / src.width, 1 / src.height);
    renderer.setRenderTarget(dst); renderer.autoClear = m !== up; renderer.render(quad, cam);
  };
  return {
    size(w, h) {
      main.setSize(w, h); mips.forEach((m, i) => m.setSize(Math.max(1, w >> i + 1), Math.max(1, h >> i + 1)));
      [sA, sB].forEach(m => m.setSize(Math.max(1, w >> 2), Math.max(1, h >> 3))); dA.setSize(Math.max(1, w >> 2), Math.max(1, h >> 2)); dB.setSize(Math.max(1, w >> 3), Math.max(1, h >> 3));
      final.uniforms.aspect.value = w / h;
    },
    bloom(v) { final.uniforms.str.value = v; },
    render() {
      renderer.setRenderTarget(main); renderer.autoClear = true; renderer.render(scene, camera);
      pass(bright, main, mips[0]);
      for (let i = 1; i < mips.length; i++) pass(down, mips[i - 1], mips[i]);
      for (let i = mips.length - 1; i > 0; i--) pass(up, mips[i], mips[i - 1]);
      [[mips[1], sA, 1], [sA, sB, 4], [sB, sA, 12]].forEach(([a, b, st]) => { streak.uniforms.st.value = st; pass(streak, a, b); }); // reflets étirés façon objectif
      if (POST.dof > 0) { pass(down, main, dA); pass(down, dA, dB); }
      const u = final.uniforms; u.bloom.value = mips[0].texture; u.streaks.value = sA.texture; u.blur.value = dB.texture; u.speed.value = POST.speed; u.flash.value = POST.flash; u.time.value = POST.t;
      u.dof.value = POST.dof; u.dr.value = POST.dr; u.focus.value.set(POST.fx, POST.fy); u.rain.value = LOOK.rain;
      pass(final, main, null); renderer.autoClear = true;
    },
  };
})();

function resize() {
  renderer.setPixelRatio(QUALITY.pr); renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  const s = renderer.getDrawingBufferSize(new THREE.Vector2()); if (post) post.size(s.x, s.y);
  if (MIRROR) MIRROR.rt.setSize(s.x >> 1, s.y >> 1);
}
const WET = { value: 0 }, MIRROR = HQ && { rt: new THREE.WebGLRenderTarget(1, 1, { type: RT_TYPE }), cam: new THREE.PerspectiveCamera(), M: new THREE.Matrix4() };
const BIAS = new THREE.Matrix4().set(.5, 0, 0, .5, 0, .5, 0, .5, 0, 0, .5, .5, 0, 0, 0, 1);
function renderMirror() { // la scène vue depuis sous le sol, pour les reflets de la pelouse mouillée
  if (!MIRROR || !WET.value) return;
  const m = MIRROR.cam, c = camera, flip = v => v.setY(-v.y);
  m.copy(c); m.position.copy(flip(c.position.clone()));
  m.up.copy(flip(new V3(0, 1, 0).applyQuaternion(c.quaternion))); m.lookAt(flip(new V3(0, 0, -1).applyQuaternion(c.quaternion).add(c.position)));
  m.updateMatrixWorld(); MIRROR.M.copy(BIAS).multiply(m.projectionMatrix).multiply(m.matrixWorldInverse);
  floor.visible = outside.visible = false; renderer.shadowMap.autoUpdate = false;
  renderer.setRenderTarget(MIRROR.rt); renderer.render(scene, m); renderer.setRenderTarget(null);
  renderer.shadowMap.autoUpdate = true; floor.visible = outside.visible = true;
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
  renderMirror(); renderTV();
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

// ===== Ciel (couleurs, soleil ou lune, étoiles, nuages) : réglé par l'ambiance choisie =====
const v3u = (x, y, z) => ({ value: new V3(x, y, z) });
const skyMat = new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false,
  uniforms: { c0: v3u(.9, .25, .07), c1: v3u(.07, .03, .17), c2: v3u(.004, .007, .035), sun: { value: SUN.clone() }, sunCol: v3u(1, .42, .14), sunK: { value: 40 }, halo: { value: .55 }, stars: { value: 2 }, clouds: { value: 0 }, cloudCol: v3u(1, 1, 1), flash: { value: 0 }, t: { value: 0 } },
  vertexShader: 'varying vec3 vD; void main() { vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
  fragmentShader: `uniform vec3 c0, c1, c2, sun, sunCol, cloudCol; uniform float sunK, halo, stars, clouds, flash, t; varying vec3 vD;
    float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5); }
    float n(vec2 p) { vec2 i = floor(p), f = fract(p); f *= f * (3. - 2. * f); return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + 1.), f.x), f.y); }
    void main() {
      float y = vD.y, s = max(dot(vD, sun), 0.);
      vec3 c = mix(c0, c1, smoothstep(-.05, .32, y));
      c = mix(c, c2, smoothstep(.28, .9, y));
      c += sunCol * (pow(s, 5.) * halo + pow(s, 600.) * sunK);
      vec3 g = floor(vD * 260.);
      c += step(.9975, fract(sin(dot(g, vec3(12.99, 78.23, 45.16))) * 43758.5)) * smoothstep(.25, .6, y) * stars;
      if (clouds > 0.) { // nuages : bruit fractal projeté sur le ciel
        vec2 q = vD.xz / max(y, .06) * .5 + t * .01; float f = 0., a = .5;
        for (int i = 0; i < 5; i++) { f += a * n(q); q *= 2.1; a *= .5; }
        c = mix(c, cloudCol * (.85 + .5 * s) + flash * vec3(.6, .65, .85), smoothstep(.75 - clouds * .3, 1.05 - clouds * .3, f) * smoothstep(.02, .25, y) * min(1., clouds * .9));
      }
      c += flash * vec3(.12, .13, .18);                                       // éclair
      gl_FragColor = vec4(c, 1.);
    }`,
});
const sky = new THREE.Mesh(new THREE.SphereGeometry(520, 48, 24), skyMat);
sky.renderOrder = -1; scene.add(sky);

// Lumières : soleil au zénith (ombres lisibles), contre-jour orangé, ambiance
const hemi = new THREE.HemisphereLight(0x8ea6ff, 0x24401c, .9); scene.add(hemi);
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
floor.material.onBeforeCompile = sh => {
  if (!MIRROR) return;
  Object.assign(sh.uniforms, { reflTex: { value: MIRROR.rt.texture }, reflM: { value: MIRROR.M }, wet: WET, rt: CROWD.t });
  sh.vertexShader = 'varying vec3 vWP;\n' + sh.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n vWP = (modelMatrix * vec4(transformed, 1.)).xyz;');
  sh.fragmentShader = 'uniform sampler2D reflTex; uniform mat4 reflM; uniform float wet, rt; varying vec3 vWP;\n' + sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
    if (wet > 0.) { // reflets du stade, troublés par les gouttes
      vec2 rip = vec2(sin(vWP.x * 7. + rt * 9.) + sin(vWP.z * 5.3 - rt * 7.), cos(vWP.z * 6.1 + rt * 8.) + cos(vWP.x * 4.7 + rt * 6.)) * .003;
      vec4 rp = reflM * vec4(vWP, 1.);
      totalEmissiveRadiance += texture2D(reflTex, rp.xy / rp.w + rip).rgb * wet;
      diffuseColor.rgb *= 1. - .4 * wet;
    }`);
};
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
const drawLed = x => {
  x.fillStyle = '#05060c'; x.fillRect(0, 0, 1024, 64); x.font = 'italic 40px "Russo One", sans-serif'; x.textBaseline = 'middle';
  ['ROCKET BALL', '★', 'BOOST', '★', 'SUPERSONIQUE', '★'].reduce((px, t, i) => { x.fillStyle = ['#ffffff', '#1e7bff', '#ff7a1a'][i % 3]; x.fillText(t, px, 34); return px + x.measureText(t).width + 30; }, 20);
};
const ledTex = canvasTex(1024, 64, drawLed);
const CROWD = { t: { value: 0 }, hype: { value: 0 } };
const crowdMat = new THREE.MeshBasicMaterial({ map: crowdTex, color: 0x8a90a8 }), ledMat = new THREE.MeshBasicMaterial({ map: ledTex, color: new C(1.8, 1.8, 1.8) });
crowdMat.onBeforeCompile = sh => {
  sh.uniforms.t = CROWD.t; sh.uniforms.hype = CROWD.hype;
  sh.fragmentShader = 'uniform float t, hype;\n' + sh.fragmentShader.replace('#include <map_fragment>', `
    vec2 cu = vMapUv, cell = floor(cu * vec2(48., 16.)); float ph = fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5);
    cu.y -= max(0., sin(t * (5. + ph * 4.) + ph * 6.28)) * (.003 + hype * .02);
    diffuseColor *= texture2D(map, cu);`);
};
const backMat = new THREE.MeshStandardMaterial({ color: 0x0e111a, roughness: .8 });
const roofMat = new THREE.MeshStandardMaterial({ color: 0x0b0d14, metalness: .6, roughness: .5, side: THREE.DoubleSide }), roofLight = glow(0xfff0d8, 3);
const STANDS = [], WALLS = [], JETS = []; // tribunes (flashs photo), murs (ambiances), jets de flammes des coins
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
  const wm = new THREE.MeshStandardMaterial({
    color: col, map: wallHex, alphaMap: wallFade, emissive: col, emissiveMap: wallHex, emissiveIntensity: .22,
    transparent: true, side: THREE.DoubleSide, depthWrite: false, roughness: .25, metalness: .3,
  });
  WALLS.push(wm); g.add(new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape(pts.map(p => new THREE.Vector2(...p)))), wm));
  if (!end && !side) JETS.push(new V3(x1, H + .3, z1).lerp(new V3(x2, H + .3, z2), .5)); // jets au sommet des coins
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
  g.add(quad(at(48), at(48), 40, -48, 47, -48, backMat), quad(at(29), at(29), 0, -29, 24.6, -29, backMat)); // murs du fond : pas de ciel sous les gradins
  g.add(quad(at(56), at(18), 47, -56, 45, -18, roofMat));
  const lamp = new THREE.Mesh(new THREE.BoxGeometry(at(20) * .92, .2, .6), roofLight); lamp.position.set(0, 44.6, -20); g.add(lamp);
  g.position.set((x1 + x2) / 2, 0, zm); g.rotation.y = Math.atan2(-dz, dx); g.updateMatrixWorld(); scene.add(g);
  STANDS.push({ g, len, y0, d0 });
});
// Faisceaux lumineux des projecteurs du toit (cônes de lumière dans la brume)
let shaftMat = null;
if (HQ) {
  const beamMat = shaftMat = new THREE.ShaderMaterial({
    uniforms: { c: { value: new C(1, .9, .75) }, k: { value: .09 } }, ...additive({ side: THREE.DoubleSide }),
    vertexShader: 'varying vec3 vN, vV; varying float vY; void main() { vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position, 1.); vV = normalize(-mv.xyz); vY = uv.y; gl_Position = projectionMatrix * mv; }',
    fragmentShader: 'uniform vec3 c; uniform float k; varying vec3 vN, vV; varying float vY; void main() { float f = pow(abs(dot(normalize(vN), normalize(vV))), 3.); gl_FragColor = vec4(c * f * vY * vY * vY * k, 1.); }',
  });
  STANDS.forEach(({ g }) => [-.3, .3].forEach(u => {
    const top = g.localToWorld(new V3(u * 40, 44.4, -20)), bot = top.clone().multiplyScalar(.4).setY(9), dir = top.clone().sub(bot); // s'arrête en l'air
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(1, 6, dir.length(), 32, 1, true), beamMat);
    beam.position.copy(top).add(bot).multiplyScalar(.5); beam.quaternion.setFromUnitVectors(UP, dir.normalize()); beam.renderOrder = 4; scene.add(beam);
  }));
}

// Logo du centre (tourné vers l'équipe du joueur) et anneau néon autour du rond central
const drawLogo = x => { x.clearRect(0, 0, 1024, 205); x.font = 'italic 150px "Russo One", sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillStyle = '#fff'; x.fillText('ROCKET BALL', 512, 108); };
const logoTex = canvasTex(1024, 205, drawLogo);
const logo = new THREE.Mesh(new THREE.PlaneGeometry(22, 4.4), new THREE.MeshBasicMaterial({ map: logoTex, transparent: true, opacity: .22, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
logo.rotation.set(-Math.PI / 2, 0, Math.PI); logo.position.y = .02; scene.add(logo);
const faceLogo = team => logo.rotation.z = team ? 0 : Math.PI; // lisible depuis son camp
document.fonts?.ready.then(() => [[logoTex, drawLogo], [ledTex, drawLed]].forEach(([t, d]) => { d(t.image.getContext('2d')); t.needsUpdate = true; }));
const ringMat = glow(0x9fd0ff, 2.2), centerRing = new THREE.Mesh(new THREE.TorusGeometry(11.2, .07, 6, 160).rotateX(Math.PI / 2), ringMat);
centerRing.position.y = .04; scene.add(centerRing);
const BANNER = { t: { value: 0 } };
{
  const flag = team => canvasTex(128, 384, x => {
    const g = x.createLinearGradient(0, 0, 0, 384); g.addColorStop(0, team ? '#ff9a40' : '#4a9bff'); g.addColorStop(1, team ? '#a83800' : '#0a3a9a');
    x.fillStyle = g; x.fillRect(0, 0, 128, 384); x.fillStyle = '#ffffffd0'; x.fillRect(0, 20, 128, 8); x.fillRect(0, 356, 128, 8);
    x.save(); x.translate(64, 192); x.rotate(-Math.PI / 2); x.font = 'italic 46px "Russo One", sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('ROCKET BALL', 0, 2); x.restore();
    x.beginPath(); x.moveTo(0, 384); x.lineTo(64, 340); x.lineTo(128, 384); x.fillStyle = '#000'; x.globalCompositeOperation = 'destination-out'; x.fill();
  });
  const mats = [0, 1].map(team => { const m = new THREE.MeshStandardMaterial({ map: flag(team), side: THREE.DoubleSide, transparent: true, roughness: .8 });
    m.onBeforeCompile = sh => { sh.uniforms.t = BANNER.t; sh.vertexShader = 'uniform float t;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n transformed.z += sin(position.y * .5 + t * 2.4 + position.x) * .5 * (1. - uv.y);'); };
    return m; });
  [-1, 1].forEach(sx => [-30, -10, 10, 30].forEach(z => {
    const b = new THREE.Mesh(new THREE.PlaneGeometry(4, 13, 2, 16), mats[+(z > 0)]); b.position.set(sx * (W + 19), 37, z); // accrochées sous le bord du toit b.rotation.y = -sx * Math.PI / 2; scene.add(b);
  }));
}

// Écran géant suspendu : score sur deux faces, match en direct (caméra TV qui suit la balle) sur les deux autres
const boardCv = Object.assign(document.createElement('canvas'), { width: 512, height: 256 }), boardTex = new THREE.CanvasTexture(boardCv);
boardTex.colorSpace = THREE.SRGBColorSpace;
const TV = { target: new V3(), rt: HQ && new THREE.WebGLRenderTarget(400, 200), cam: new THREE.PerspectiveCamera(30, 2, .5, 500), n: 0 };
const jumbo = new THREE.Group(), screenMat = new THREE.MeshBasicMaterial({ map: boardTex, color: new C(1.5, 1.5, 1.5) }), tvScreens = [];
const tvMat = TV.rt ? new THREE.MeshBasicMaterial({ map: TV.rt.texture, color: new C(1.4, 1.4, 1.4) }) : screenMat;
jumbo.add(new THREE.Mesh(new THREE.BoxGeometry(14, 7.6, 14), new THREE.MeshStandardMaterial({ color: 0x0a0c12, metalness: .8, roughness: .35 })));
for (let i = 0; i < 4; i++) {
  const s = new THREE.Mesh(new THREE.PlaneGeometry(13, 6.6), i % 2 ? tvMat : screenMat); s.rotation.y = i * Math.PI / 2;
  s.position.set(Math.sin(i * Math.PI / 2) * 7.02, 0, Math.cos(i * Math.PI / 2) * 7.02); jumbo.add(s); if (i % 2) tvScreens.push(s);
}
[-3.9, 3.9].forEach(y => { const r = new THREE.Mesh(new THREE.BoxGeometry(14.4, .25, 14.4), glow(0x66ccff, 1.6)); r.position.y = y; jumbo.add(r); });
jumbo.position.y = 34; scene.add(jumbo);
function renderTV() { // une image sur trois, vue de côté façon retransmission, ombres réutilisées
  if (!TV.rt || TV.n++ % 3) return;
  TV.cam.position.set(-W - 14, 16, clamp(TV.target.z * .75, -40, 40)); TV.cam.lookAt(TV.target);
  tvScreens.forEach(s => s.visible = false); renderer.shadowMap.autoUpdate = false;
  renderer.setRenderTarget(TV.rt); renderer.render(scene, TV.cam); renderer.setRenderTarget(null);
  renderer.shadowMap.autoUpdate = true; tvScreens.forEach(s => s.visible = true);
}
let boardKey = '';
function setBoard(a, b, t, g, txt = 'BUT !') { // g = équipe mise en avant (but, victoire) ou null
  const k = [a, b, t, g, txt].join(); if (k === boardKey) return; boardKey = k;
  const x = boardCv.getContext('2d'); x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillStyle = '#05070d'; x.fillRect(0, 0, 512, 256);
  if (g != null) { x.fillStyle = g ? '#ff7a1a' : '#1e7bff'; x.fillRect(0, 0, 512, 256); x.fillStyle = '#fff'; x.font = `italic ${txt.length > 6 ? 76 : 130}px "Russo One", sans-serif`; x.fillText(txt, 256, 132); }
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
  const net = new THREE.MeshStandardMaterial({ color: col, map: netHex, emissive: col, emissiveMap: netHex, emissiveIntensity: .5, transparent: true, side: THREE.DoubleSide, depthWrite: false });
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

// ===== Balle : métal alvéolé, coutures lumineuses ; anneau au sol quand elle est en l'air =====
const ballRing = new THREE.Mesh(new THREE.RingGeometry(.9, 1.04, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: new C(.6, .85, 1).multiplyScalar(2), ...additive() }));
ballRing.position.y = .03; ballRing.visible = false; ballRing.userData.noEnv = true; scene.add(ballRing);
function makeBall() {
  const tex = canvasTex(1024, 512, x => {
    x.fillStyle = '#cfd4dc'; x.fillRect(0, 0, 1024, 512); x.strokeStyle = '#59606e'; x.lineWidth = 6; x.fillStyle = '#b9bfca';
    for (let cy = 0; cy < 560; cy += 54) for (let cx = (cy / 54 % 2) * 31; cx < 1060; cx += 62) { hexPath(x, cx, cy, 34); x.fill(); x.stroke(); }
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(BR, 64, 32), new THREE.MeshPhysicalMaterial({ map: tex, metalness: .45, roughness: .32, clearcoat: 1, clearcoatRoughness: .15 }));
  m.add(new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(BR * 1.004, 1)), new THREE.LineBasicMaterial({ color: new C(0x8fd4ff).multiplyScalar(2.4) })));
  m.castShadow = true; scene.add(m); return m;
}

// ===== Voitures : carrosserie sculptée (sections lissées), livrée peinte (motif, sticker, numéro), cockpit vitré, jantes, phares =====
const MODELS = { // sections [z, demi-largeur, bas, haut] de l'arrière vers l'avant, pour la caisse puis la bulle du cockpit ; n : forme plus ou moins carrée
  'Éclair': { wr: .17, n: 3.4, wing: [.86, .23, -.56],
    body: [[-.68, .3, -.13, .05], [-.65, .41, -.19, .13], [-.48, .43, -.2, .15], [-.15, .43, -.2, .14], [.2, .43, -.2, .1], [.48, .41, -.2, .04], [.64, .37, -.18, -.02], [.72, .27, -.14, -.07]],
    cab: [[-.52, .22, .08, .15], [-.42, .31, .08, .3], [-.15, .32, .08, .33], [.05, .3, .06, .29], [.24, .22, .04, .13], [.3, .12, .04, .07]] },
  'Requin': { wr: .16, n: 3, wing: [.98, .26, -.6],
    body: [[-.73, .3, -.13, .03], [-.7, .42, -.19, .09], [-.5, .44, -.2, .11], [-.1, .44, -.2, .09], [.3, .43, -.2, .04], [.58, .4, -.2, -.03], [.74, .33, -.17, -.09], [.81, .2, -.14, -.11]],
    cab: [[-.52, .2, .02, .09], [-.4, .29, .02, .21], [-.14, .3, .02, .23], [.06, .27, .0, .18], [.25, .17, -.02, .06], [.3, .08, -.02, .01]] },
  'Bloc': { wr: .2, n: 5.5, wing: null,
    body: [[-.65, .36, -.12, .13], [-.62, .44, -.17, .2], [-.3, .45, -.18, .21], [.2, .45, -.18, .21], [.5, .44, -.18, .17], [.65, .42, -.16, .1], [.71, .34, -.13, .04]],
    cab: [[-.6, .3, .16, .3], [-.55, .38, .16, .42], [.1, .38, .16, .43], [.3, .36, .14, .37], [.42, .3, .11, .2], [.47, .2, .11, .15]] },
};
const chaikin = (st, n = 3) => { // lisse une suite de sections (coupe des coins de Chaikin, extrémités gardées)
  for (let k = 0; k < n; k++) st = [st[0], ...st.slice(0, -1).flatMap((a, i) => [.75, .25].map(w => a.map((v, j) => v * w + st[i + 1][j] * (1 - w)))), st.at(-1)];
  return st;
};
function loft(st, n, tum, tuck, seg = 40) { // surface fermée passant par les sections ; u fait le tour (0 dessous, .25 et .75 les côtés, .5 dessus), v va de l'arrière à l'avant
  const z0 = st[0][0], z1 = st.at(-1)[0], pos = [], uv = [], idx = [], S = seg + 1, e = 2 / n, pw = (v, k) => Math.sign(v) * Math.abs(v) ** k;
  st.forEach(([z, a, yb, yt]) => {
    const ym = (yb + yt) / 2, h = (yt - yb) / 2;
    for (let i = 0; i <= seg; i++) {
      const f = i / seg * Math.PI * 2, y = ym - h * pw(Math.cos(f), e), t = (y - ym) / h;
      pos.push(a * pw(Math.sin(f), e) * (1 - tum * Math.max(0, t) ** 2 - tuck * Math.max(0, -t) ** 3), y, z); uv.push(i / seg, (z - z0) / (z1 - z0));
    }
  });
  for (let k = 0; k < st.length - 1; k++) for (let i = 0; i < seg; i++) { const a = k * S + i, b = a + S; idx.push(a, a + 1, b, a + 1, b + 1, b); }
  [0, st.length - 1].forEach((k, j) => { // bouchons à l'arrière et à l'avant
    const c = pos.length / 3, [z, , yb, yt] = st[k]; pos.push(0, (yb + yt) / 2, z); uv.push(.5, j);
    for (let i = 0; i < seg; i++) idx.push(...(j ? [c, k * S + i, k * S + i + 1] : [c, k * S + i + 1, k * S + i]));
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals(); return g;
}
const at = (st, z) => { const k = st.findIndex(s => s[0] >= z), i = k < 0 ? st.length - 1 : Math.max(1, k), a = st[i - 1], b = st[i], w = clamp((z - a[0]) / (b[0] - a[0] || 1), 0, 1); return a.map((v, j) => v + (b[j] - v) * w); }; // section à la position z
// Livrée : la caisse est peinte dans une texture (côtés, dessus, bas de caisse), le cockpit dans une autre (vitres, montants, toit)
const sides = (x, fn) => [1, -1].forEach(s => { x.save(); x.setTransform(0, 1, -s, 0, s > 0 ? 256 : 768, 0); fn(s); x.restore(); }); // repère d'un flanc : X de l'avant (0) vers l'arrière (512), Y vers le bas
const poly = (x, pts) => { x.beginPath(); pts.forEach(([a, b]) => x.lineTo(a, b)); x.closePath(); x.fill(); };
const MOTIFS = {
  Uni() { },
  Bandes(x, ac) { x.fillStyle = ac; x.fillRect(472, 0, 26, 512); x.fillRect(526, 0, 26, 512); sides(x, () => x.fillRect(0, -40, 512, 6)); },
  Flammes(x, ac) {
    sides(x, () => {
      const g = x.createLinearGradient(0, 0, 330, 0); g.addColorStop(0, '#fff3a0'); g.addColorStop(.35, '#ff9a1a'); g.addColorStop(1, ac); x.fillStyle = g;
      x.beginPath(); x.moveTo(0, -80); [330, 230, 300, 190, 270, 210].forEach((l, i) => { const y = -80 + i * 27; x.quadraticCurveTo(l * .55, y - 8, l, y + 12); x.quadraticCurveTo(l * .5, y + 16, l * .45, y + 27); }); x.lineTo(0, 82); x.fill();
    });
  },
  'Éclairs'(x, ac) { x.fillStyle = ac; sides(x, () => { poly(x, [[10, -30], [170, -55], [150, -18], [320, -45], [300, -8], [500, -40], [270, 22], [290, -14], [120, 18], [140, -18]]); }); },
  Damier(x, ac) { sides(x, () => { for (let i = 0; i < 22; i++) for (let j = 0; j < 3; j++) if ((i + j) % 2) { x.fillStyle = ac; x.globalAlpha = Math.max(0, 1 - i / 22); x.fillRect(i * 24, 30 + j * 24, 24, 24); } }); },
  Camo(x, ac, base) { for (let i = 0; i < 120; i++) { x.fillStyle = [ac, '#0006', base, '#fff3'][i % 4]; x.beginPath(); for (let k = 0; k < 4; k++) x.arc(Math.random() * 1024 + rnd(40), Math.random() * 512 + rnd(40), 14 + Math.random() * 26, 0, 7); x.fill(); } },
  Hexa(x, ac) { x.strokeStyle = ac; x.lineWidth = 4; for (let cy = 0; cy < 560; cy += 40) for (let cx = (cy / 40 % 2) * 23; cx < 1050; cx += 46) { x.globalAlpha = .25 + .75 * (cy / 512) ** 2; hexPath(x, cx, cy, 22); x.stroke(); } },
  'Légende'(x) { // récompense de saison : vague dorée et filets or
    const g = x.createLinearGradient(0, 0, 512, 0); g.addColorStop(0, '#fff2b0'); g.addColorStop(.5, '#e8b923'); g.addColorStop(1, '#8a6410');
    sides(x, () => { x.fillStyle = g; x.beginPath(); x.moveTo(0, 60); x.bezierCurveTo(180, 70, 260, -70, 512, -50); x.lineTo(512, -22); x.bezierCurveTo(280, -40, 200, 100, 0, 96); x.fill(); });
    x.fillStyle = '#e8b923'; [480, 540].forEach(c => x.fillRect(c, 0, 6, 512));
  },
};
const STICKERS = {
  Aucun() { },
  'Étoile'(x, r) { poly(x, Array.from({ length: 10 }, (_, i) => { const a = i * Math.PI / 5 - Math.PI / 2, k = i % 2 ? r * .45 : r; return [Math.cos(a) * k, Math.sin(a) * k]; })); },
  'Éclair'(x, r) { poly(x, [[.2, -1], [-.5, .1], [-.05, .1], [-.25, 1], [.55, -.2], [.1, -.2], [.35, -1]].map(([a, b]) => [a * r, b * r])); },
  'Cœur'(x, r) { x.beginPath(); x.moveTo(0, r * .9); x.bezierCurveTo(-r * 1.3, 0, -r * .7, -r, 0, -r * .35); x.bezierCurveTo(r * .7, -r, r * 1.3, 0, 0, r * .9); x.fill(); },
  'Crâne'(x, r) { x.beginPath(); x.arc(0, -r * .15, r * .8, 0, 7); x.fill(); x.fillRect(-r * .45, r * .3, r * .9, r * .55); x.fillStyle = '#111'; [-1, 1].forEach(s => { x.beginPath(); x.arc(s * r * .32, -r * .15, r * .22, 0, 7); x.fill(); }); poly(x, [[0, r * .12], [-r * .1, r * .32], [r * .1, r * .32]]); },
  Couronne(x, r) { x.fillStyle = '#ffd34d'; poly(x, [[-1, .7], [-1, -.5], [-.5, 0], [0, -.9], [.5, 0], [1, -.5], [1, .7]].map(([a, b]) => [a * r, b * r])); },
};
const pickOf = (T, k, d) => T[Object.hasOwn(T, k) ? k : d]; // choix venu du réseau : seulement les entrées connues
function sticker(x, k, cx, cy, r, ac) { x.save(); x.translate(cx, cy); x.shadowColor = '#000a'; x.shadowBlur = r * .15; x.fillStyle = '#fff'; x.strokeStyle = ac; pickOf(STICKERS, k, 'Aucun')(x, r); x.restore(); }
function livery(r, num) { // texture de la caisse
  const base = '#' + new C(COL[r.team]).getHexString();
  return canvasTex(1024, 512, x => {
    x.fillStyle = base; x.fillRect(0, 0, 1024, 512);
    pickOf(MOTIFS, r.motif, 'Uni')(x, r.accent, base); x.globalAlpha = 1;
    x.fillStyle = '#15171d'; x.fillRect(0, 0, 92, 512); x.fillRect(932, 0, 92, 512); x.fillStyle = r.accent; x.fillRect(92, 0, 5, 512); x.fillRect(927, 0, 5, 512); // bas de caisse + filet
    x.strokeStyle = '#0008'; x.lineWidth = 2; x.beginPath(); x.moveTo(400, 150); x.lineTo(624, 150); x.moveTo(400, 420); x.lineTo(624, 420); x.stroke(); // capot, coffre
    sides(x, s => {
      x.strokeStyle = '#0008'; x.lineWidth = 2; x.beginPath(); [170, 335].forEach(X => { x.moveTo(X, -100); x.lineTo(X + 6, 95); }); x.stroke(); // portière
      x.fillStyle = '#0b0d12'; poly(x, [[350, -10], [415, -22], [415, 30], [360, 30]]);                                         // prise d'air
      x.translate(252, 10); x.scale(s, 1); x.font = 'italic 92px "Russo One", sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.lineWidth = 10; x.strokeStyle = '#000c'; x.strokeText(num, 0, 0); x.fillStyle = '#fff'; x.fillText(num, 0, 0);    // numéro
    });
    sticker(x, r.sticker, 512, 92, 44, r.accent); // sticker sur le capot
  });
}
function cabTex(r, rm) { // cockpit : vitres teintées, montants et toit peints ; rm = carte rugosité/métal (vitre lisse, peinture satinée)
  const base = '#' + new C(COL[r.team]).getHexString(), [glassC, paintC] = rm ? ['rgb(0,10,235)', 'rgb(0,90,70)'] : ['#0a0f16', base];
  return canvasTex(512, 256, x => {
    x.fillStyle = glassC; x.fillRect(0, 0, 512, 256); x.fillStyle = x.strokeStyle = paintC; x.lineWidth = 12; x.lineCap = 'round';
    x.beginPath(); (x.roundRect || x.rect).call(x, 198, 70, 116, 112, 18); x.fill(); // toit
    x.beginPath(); [-1, 1].forEach(s => { x.moveTo(256 + s * 52, 76); x.lineTo(256 + s * 120, 20); x.moveTo(256 + s * 54, 128); x.lineTo(256 + s * 120, 132); x.moveTo(256 + s * 52, 176); x.lineTo(256 + s * 118, 238); }); x.stroke(); // montants
    x.fillRect(0, 0, 512, 6); x.fillRect(0, 250, 512, 6);
    if (rm) return;
    if (r.motif === 'Bandes' || r.motif === 'Légende') { x.fillStyle = r.motif === 'Bandes' ? r.accent : '#e8b923'; x.fillRect(236, 70, 12, 112); x.fillRect(264, 70, 12, 112); }
    sticker(x, r.sticker, 256, 126, 28, r.accent);
  }, !rm);
}
const carbon = new THREE.MeshStandardMaterial({ color: 0x9aa0aa, metalness: .5, roughness: .35, map: canvasTex(64, 64, x => { // fibre de carbone tissée
  x.fillStyle = '#16181d'; x.fillRect(0, 0, 64, 64); for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) { x.fillStyle = (i + j) % 2 ? '#2a2e36' : '#1c1f25'; x.fillRect(i * 8, j * 8, 8, 4); x.fillStyle = (i + j) % 2 ? '#1c1f25' : '#2a2e36'; x.fillRect(i * 8, j * 8 + 4, 8, 4); }
}) });
carbon.map.repeat.set(6, 6);
const tread = new THREE.MeshStandardMaterial({ color: 0x1a1b1f, roughness: .9, bumpScale: 2, bumpMap: canvasTex(128, 16, x => { x.fillStyle = '#fff'; x.fillRect(0, 0, 128, 16); x.fillStyle = '#000'; for (let i = 0; i < 128; i += 8) poly(x, [[i, 0], [i + 3, 0], [i + 7, 8], [i + 3, 16], [i, 16], [i + 4, 8]]); }, false) });
tread.bumpMap.repeat.set(5, 1);
const rubber = new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: .85 }), dark = new THREE.MeshStandardMaterial({ color: 0x1a1d24, metalness: .7, roughness: .4 });
const wallTex = new THREE.MeshStandardMaterial({ roughness: .8, transparent: true, alphaTest: .4, map: canvasTex(256, 256, x => { // inscriptions sur le flanc des pneus
  x.font = 'bold 21px "Exo 2", sans-serif'; x.fillStyle = '#c9ced8'; x.textAlign = 'center'; const t = 'ROCKET BALL ✦ ROCKET BALL ✦ ';
  [...t].forEach((ch, i) => { x.save(); x.translate(128, 128); x.rotate(i / t.length * Math.PI * 2); x.fillText(ch, 0, -104); x.restore(); });
}) });
const headMat = glow(0xeaf4ff, 3.5), flareMat = new THREE.SpriteMaterial({ map: radial, color: new C(.9, .95, 1).multiplyScalar(1.5), ...additive() });
const poolMat = new THREE.MeshBasicMaterial({ map: radial, color: new C(1, .92, .78), ...additive() }), poolGeo = new THREE.PlaneGeometry(1.5, 3.2).rotateX(-Math.PI / 2); // lumière des phares au sol
const paint = (c, o) => new THREE.MeshPhysicalMaterial({ color: c, metalness: .15, roughness: .4, clearcoat: 1, clearcoatRoughness: .05, envMapIntensity: .75, ...o });
const chrome = new THREE.MeshStandardMaterial({ color: 0xc9ced8, metalness: 1, roughness: .15 });
const flameMat = c => new THREE.ShaderMaterial({ // flamme animée : bruit qui défile, cœur blanc près du moteur
  uniforms: { c: { value: c }, t: { value: 0 } }, ...additive({ side: THREE.DoubleSide }),
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
  fragmentShader: `uniform vec3 c; uniform float t; varying vec2 vUv;
    float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5); }
    float n(vec2 p) { vec2 i = floor(p), f = fract(p); f *= f * (3. - 2. * f); return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + 1.), f.x), f.y); }
    void main() { float y = 1. - vUv.y, k = n(vec2(vUv.x * 9., y * 4. - t * 16.)) * .7 + .3;
      gl_FragColor = vec4(mix(c * 3., vec3(5.), smoothstep(.65, 1., y)) * smoothstep(0., .5, y) * k, 1.); }`,
});
function merge(geos) { // fusionne des géométries (positions, normales, UV) en une seule : moins d'appels de dessin
  const pos = [], nor = [], uv = [], idx = []; let off = 0;
  geos.forEach(g => {
    const a = g.attributes, n = a.position.count;
    for (const v of a.position.array) pos.push(v); for (const v of a.normal.array) nor.push(v); for (const v of a.uv.array) uv.push(v);
    if (g.index) for (const i of g.index.array) idx.push(i + off); else for (let i = 0; i < n; i++) idx.push(i + off);
    off += n;
  });
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); out.setIndex(idx); return out;
}
function buildCar(r) {
  const M = MODELS[r.model] || MODELS['Éclair'], root = new THREE.Group(), body = new THREE.Group(), accent = paint(r.accent), team = paint(COL[r.team]), tailMat = glow(0xff2030, 2);
  const bucket = () => new Map(), BODY = bucket(), ROOT = bucket();
  const put = (bk, geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => { const g = geo.clone().rotateX(rx).rotateY(ry).rotateZ(rz).translate(x, y, z); (bk.get(mat) || bk.set(mat, []).get(mat)).push(g); };
  const flush = (bk, to, sh = true) => bk.forEach((geos, mat) => { const m = new THREE.Mesh(merge(geos), mat); m.castShadow = sh; to.add(m); });
  const box = (w, h, d, mat, x, y, z, rx, ry, rz) => put(BODY, new THREE.BoxGeometry(w, h, d), mat, x, y, z, rx, ry, rz);
  const num = String(r.num ?? [...(r.name || '')].reduce((a, ch) => a + ch.charCodeAt(0), 0) % 98 + 1);
  const st = chaikin(M.body), cab = chaikin(M.cab), front = st.at(-1)[0], rear = st[0][0], S = z => at(st, z);
  put(BODY, loft(st, M.n, .22, .3), paint(0xffffff, { map: livery(r, num) }));                                                      // caisse peinte
  put(BODY, loft(cab, M.n * .8, .42, 0), new THREE.MeshPhysicalMaterial({ map: cabTex(r), roughnessMap: cabTex(r, 1), metalnessMap: cabTex(r, 1), metalness: 1, roughness: 1, clearcoat: 1, clearcoatRoughness: .04, envMapIntensity: 1.6 })); // cockpit
  const [, af, ybf, ytf] = S(front - .1), [, ar, ybr, ytr] = S(rear + .06);
  box(af * 2.1, .018, .16, carbon, 0, ybf - .01, front - .1);                                         // lame avant
  box(af * 1.1, .07, .04, dark, 0, ybf + .05, front - .045);                                          // calandre
  box(ar * 1.7, .05, .14, carbon, 0, ybr + .015, rear + .07);                                         // diffuseur
  [-.2, -.07, .07, .2].forEach(x => box(.012, .06, .1, carbon, x, ybr + .03, rear + .06));            // ailettes
  box(ar * 1.75, .028, .03, tailMat, 0, ytr - .05, rear - .005);                                     // bande de feux arrière
  [-1, 1].forEach(s => {
    const [, a] = S(front - .06);
    box(.17, .028, .05, headMat, s * a * .58, ytf - .025, front - .06, 0, s * .35);                    // phares à LED
    box(.09, .02, .04, headMat, s * a * .5, ybf + .06, front - .05, 0, s * .3);                       // feux de jour
    box(.1, .06, .035, tailMat, s * ar * .72, ytr - .075, rear - .004);                               // feux stop
    const fl = new THREE.Sprite(flareMat); fl.scale.setScalar(.22); fl.position.set(s * a * .58, ytf - .025, front + .02); body.add(fl); // halo des phares
    box(.035, .03, .62, carbon, s * (S(0)[1] - .015), S(0)[2] + .025, -.01);                          // bas de caisse carbone
    put(BODY, new THREE.CylinderGeometry(.036, .044, .12, 14, 1, true), chrome, s * .17, ybr + .04, rear + .02, Math.PI / 2); // échappements
    put(BODY, new THREE.CircleGeometry(.034, 14), dark, s * .17, ybr + .04, rear - .035, 0, Math.PI);
    box(.1, .012, .05, dark, s * .1, S(.42)[3] + .002, .42, -.12);                                    // ouïes du capot
    const [cz, ca, cyb] = at(cab, .14); box(.11, .05, .04, team, s * (ca + .06), cyb + .05, cz + .02); box(.07, .015, .02, dark, s * (ca + .01), cyb + .04, cz + .02); // rétroviseurs
  });
  if (M.wing) { // aileron profilé, dérives et supports carbone
    const [w, y, z] = M.wing, foil = new THREE.Shape(); foil.moveTo(.11, 0); foil.quadraticCurveTo(0, .045, -.12, .012); foil.quadraticCurveTo(0, -.012, .11, 0);
    put(BODY, new THREE.ExtrudeGeometry(foil, { depth: w, bevelEnabled: false }).translate(0, 0, -w / 2).rotateY(Math.PI / 2), accent, 0, y, z);
    [-1, 1].forEach(s => { box(.012, .1, .26, carbon, s * w / 2, y - .01, z); box(.025, .13, .05, carbon, s * .26, y - .07, z + .02, -.25); });
  }
  flush(BODY, body); root.add(body);
  // Néon sous la voiture (couleur d'équipe) et lumière des phares au sol
  const under = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 2.1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: radial, color: new C(COL[r.team]).multiplyScalar(1.4), ...additive() }));
  const pool = new THREE.Mesh(poolGeo, poolMat); under.position.y = .02 - REST; pool.position.set(0, .025 - REST, front + 1.5); root.add(under, pool);
  // Roues : pivot de direction (étrier fixe) > rotation > pneu sculpté, flanc marqué, jante à doubles branches, disque de frein ; ailes au-dessus
  const wheels = [], wr = M.wr, tyre = new THREE.CylinderGeometry(wr, wr, .12, 32, 1, true).rotateZ(Math.PI / 2), side = new THREE.TorusGeometry(wr - .035, .035, 8, 32).rotateY(Math.PI / 2);
  const lip = new THREE.TorusGeometry(wr * .66, .012, 6, 28).rotateY(Math.PI / 2), disc = new THREE.CylinderGeometry(wr * .52, wr * .52, .02, 24).rotateZ(Math.PI / 2);
  const spoke = new THREE.BoxGeometry(.02, wr * .56, .022).translate(0, wr * .34, 0), hub = new THREE.CylinderGeometry(.035, .035, .03, 12).rotateZ(Math.PI / 2), ring = new THREE.RingGeometry(wr * .7, wr * .98, 40);
  for (const x of [-.43, .43]) for (const z of [-.38, .4]) {
    const s = Math.sign(x), steer = new THREE.Group(), spin = new THREE.Group(), W4 = bucket(), CAL = bucket(); steer.position.set(x, wr - REST, z); steer.add(spin); root.add(steer);
    put(W4, tyre, tread); [-.06, .06].forEach(o => put(W4, side, rubber, o)); put(W4, ring, wallTex, s * .097, 0, 0, 0, s * Math.PI / 2);
    put(W4, disc, chrome, -s * .01); put(W4, lip, chrome, s * .07); put(W4, hub, accent, s * .07);
    for (let i = 0; i < 12; i++) put(W4, spoke, i % 2 ? dark : accent, s * .066, 0, 0, i * Math.PI / 6 + (i % 2 ? .08 : 0));
    put(CAL, new THREE.BoxGeometry(.04, .07, .05), accent, s * .03, wr * .38, -wr * .3, -.6); flush(W4, spin, false); flush(CAL, steer, false); // étrier (roues sans ombre portée : moins de calculs)
    put(ROOT, new THREE.CylinderGeometry(wr + .06, wr + .06, .15, 20, 1, true, 0, Math.PI).rotateZ(Math.PI / 2), team, s * .43, wr - REST, z); // passage de roue
    put(ROOT, new THREE.TorusGeometry(wr + .06, .018, 6, 20, Math.PI), carbon, s * .505, wr - REST, z, 0, Math.PI / 2);
    wheels.push({ steer, spin, front: z > 0 });
  }
  flush(ROOT, root);
  // Flamme du boost animée + cœur blanc
  const flame = new THREE.Group(), fm = flameMat(new C(r.trail));
  flame.add(new THREE.Mesh(new THREE.ConeGeometry(.16, .9, 20, 4, true).rotateX(-Math.PI / 2), fm));
  flame.add(new THREE.Mesh(new THREE.ConeGeometry(.05, .3, 12, 1, true).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: new C(r.trail).lerp(new C(1, 1, 1), .6).multiplyScalar(3), ...additive() })));
  flame.children[1].position.z = .17; flame.position.set(0, ybr + .06, rear - .47); flame.visible = false; root.add(flame);
  // Ombre de contact au sol, traînées des feux arrière
  const blob = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 2).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: radial, color: 0, transparent: true, depthWrite: false }));
  blob.renderOrder = 1; scene.add(blob, root);
  const tails = [-1, 1].map(s => ({ at: new V3(s * ar * .72, ytr - .075, rear), rb: ribbon(0xff2a40) }));
  root.userData.noEnv = blob.userData.noEnv = true;
  return { root, body, wheels, flame, fm, blob, pool, tails, tailMat, wr, extra: [blob, ...tails.map(t => t.rb.m)] };
}
function makeTag(name, team, bg) { // nom au-dessus des voitures
  const t = canvasTex(256, 64, x => {
    x.font = 'italic 34px "Russo One", sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    const w = Math.min(250, x.measureText(name).width + 30); x.fillStyle = bg || (team ? '#ff7a1acc' : '#1e7bffcc');
    x.beginPath(); (x.roundRect || x.rect).call(x, 128 - w / 2, 8, w, 48, 12); x.fill(); x.fillStyle = '#fff'; x.fillText(name, 128, 34);
  });
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, sizeAttenuation: false, depthTest: false, transparent: true }));
  s.scale.set(.13, .0325, 1); s.renderOrder = 9; s.userData.noEnv = true; scene.add(s); return s;
}

// ===== Vitrine du garage (menu) =====
const showroom = new THREE.Group();
{
  const plat = new THREE.Mesh(new THREE.CylinderGeometry(1.9, 2.1, .12, 64), new THREE.MeshStandardMaterial({ color: 0x14171f, metalness: .9, roughness: .25 }));
  const ring = new THREE.Mesh(new THREE.TorusGeometry(2, .035, 8, 96).rotateX(Math.PI / 2), glow(0x66ccff, 4));
  const spot = new THREE.SpotLight(0xffffff, 20, 25, .5, .7, 1.3);
  plat.position.y = .06; plat.receiveShadow = true; ring.position.y = .12; spot.position.set(2, 8, 4);
  showroom.add(plat, ring, spot, spot.target); showroom.userData.noEnv = true; scene.add(showroom);
}

// ===== Podium de fin de match =====
const podium = new THREE.Group(), podGlow = glow(0x1e7bff, 3), PODIUM = [[0, 1.1], [-2.7, .75], [2.7, .45]];
PODIUM.forEach(([x, h], i) => {
  const step = new THREE.Mesh(new THREE.BoxGeometry(2.5, h, 2.5), new THREE.MeshStandardMaterial({ color: 0x161a24, metalness: .85, roughness: .28 }));
  const edge = new THREE.Mesh(new THREE.BoxGeometry(2.56, .07, 2.56), podGlow), s = Math.min(.7, h * .8);
  const num = new THREE.Mesh(new THREE.PlaneGeometry(s, s), new THREE.MeshBasicMaterial({ transparent: true, color: new C(2, 2, 2), map: canvasTex(128, 128, c => {
    c.font = 'italic 110px "Russo One", sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = '#fff'; c.fillText(i + 1, 64, 70); }) }));
  step.position.set(x, h / 2, 0); edge.position.set(x, h, 0); num.position.set(x, h / 2, 1.26); step.castShadow = step.receiveShadow = true;
  podium.add(step, edge, num);
});
{ const spot = new THREE.SpotLight(0xffffff, 300, 40, .45, .6, 1.2); spot.position.set(0, 14, 8); podium.add(spot, spot.target); }
podium.visible = false; podium.userData.noEnv = true; scene.add(podium);
const showPodium = team => { podGlow.color.set(COL[team]).multiplyScalar(3); podium.visible = true; };

// ===== Ambiances du stade + reflets du vrai stade sur les carrosseries =====
const LOOK = { roof: roofLight.color.clone(), led: ledMat.color.clone(), shaft: new C(1, .9, .75), ring: ringMat.color.clone(), haze: 1, rain: 0, hemi: .9, light: 0 };
const THEMES = {
  'Coucher de soleil': { c: [[.9, .25, .07], [.07, .03, .17], [.004, .007, .035]], sun: [-.55, .1, -.83], sunCol: [1, .42, .14], sunK: 40, halo: .55, stars: 2, clouds: 0,
    fog: [0x2b2140, .0028], hemi: [0x8ea6ff, 0x24401c, .9], key: [0xfff1dd, 2.4], rim: [0xff8a50, .8], exp: 1, roof: 3, wall: .22, crowd: 0x8a90a8, shaft: [[1, .9, .75], .09], haze: 1, bloom: .55, ring: 2.2 },
  'Nuit néon': { c: [[.12, .02, .22], [.03, .01, .08], [.002, .002, .012]], sun: [.35, .5, .6], sunCol: [.55, .65, 1], sunK: 14, halo: .12, stars: 3.5, clouds: 0,
    fog: [0x120828, .004], hemi: [0x4038d0, 0x0a1024, .32], key: [0xb8c8ff, 1.15], rim: [0xff3cc0, 1.1], exp: .95, roof: 3.5, roofCol: 0xbcd0ff, wall: .6, crowd: 0x707596, shaft: [[.55, .7, 1], .17], haze: 1.6, bloom: .8, ring: 3.5 },
  'Plein jour': { c: [[.72, .84, .95], [.3, .52, .9], [.1, .25, .65]], sun: [.35, .78, .3], sunCol: [1, .95, .85], sunK: 30, halo: .35, stars: 0, clouds: 1,
    fog: [0xa8c8ea, .0016], hemi: [0xd6e8ff, 0x3a5a2a, 1.7], key: [0xfff6e8, 3.4], rim: [0xffffff, .5], exp: .82, roof: 1.2, wall: .1, crowd: 0xcdd1dc, shaft: [[1, 1, 1], 0], haze: 0, bloom: .32, ring: 1 },
  'Pluie de nuit': { c: [[.06, .07, .1], [.03, .035, .05], [.012, .014, .02]], sun: [.2, .8, .3], sunCol: [.5, .6, .8], sunK: 0, halo: .04, stars: 0, clouds: 1.6, cloudCol: [.05, .055, .07],
    fog: [0x0b0f16, .0055], hemi: [0x4a5a80, 0x0c1014, .4], key: [0xb0c4ff, 1.2], rim: [0x6080ff, .6], exp: 1, roof: 4, roofCol: 0xd8e4ff, wall: .45, crowd: 0x5a6078, shaft: [[.7, .8, 1], .24], haze: 2.4, bloom: .85, ring: 2.5, rain: 1 },
};
const pmrem = new THREE.PMREMGenerator(renderer);
let THEME = 'Coucher de soleil', envRT = null;
function makeEnv() { // le stade vu depuis le centre du terrain, sans les objets qui bougent
  const hid = []; scene.traverse(o => { if (o.userData.noEnv && o.visible) { o.visible = false; hid.push(o); } });
  scene.environment = null; scene.position.y = -6; scene.updateMatrixWorld(true);
  envRT?.dispose(); envRT = pmrem.fromScene(scene, .015, .1, 700);
  scene.position.y = 0; scene.updateMatrixWorld(true); scene.environment = envRT.texture; hid.forEach(o => o.visible = true);
}
function applyTheme(name) {
  THEME = THEMES[name] ? name : 'Coucher de soleil';
  const T = THEMES[THEME], u = skyMat.uniforms;
  ['c0', 'c1', 'c2'].forEach((k, i) => u[k].value.set(...T.c[i]));
  u.sun.value.set(...T.sun).normalize(); u.sunCol.value.set(...T.sunCol); u.sunK.value = T.sunK; u.halo.value = T.halo; u.stars.value = T.stars; u.clouds.value = T.clouds;
  u.cloudCol.value.set(...(T.cloudCol || [1, 1, 1])); LOOK.rain = T.rain || 0; LOOK.hemi = T.hemi[2]; WET.value = LOOK.rain * .6;
  scene.fog.color.set(T.fog[0]); scene.fog.density = T.fog[1];
  hemi.color.set(T.hemi[0]); hemi.groundColor.set(T.hemi[1]); hemi.intensity = T.hemi[2];
  sun.color.set(T.key[0]); sun.intensity = T.key[1]; rim.color.set(T.rim[0]); rim.intensity = T.rim[1]; rim.position.copy(u.sun.value).multiplyScalar(100);
  poolMat.color.setRGB(1, .92, .78).multiplyScalar(clamp(1.15 - T.hemi[2], 0, 1) * .8); // phares visibles au sol la nuit
  renderer.toneMappingExposure = T.exp; WALLS.forEach(m => m.emissiveIntensity = T.wall); crowdMat.color.set(T.crowd);
  LOOK.roof.set(T.roofCol || 0xfff0d8).multiplyScalar(T.roof); LOOK.shaft.set(...T.shaft[0]); LOOK.ring.set(0x9fd0ff).multiplyScalar(T.ring); LOOK.haze = T.haze;
  roofLight.color.copy(LOOK.roof); ringMat.color.copy(LOOK.ring);
  if (shaftMat) { shaftMat.uniforms.c.value.copy(LOOK.shaft); shaftMat.uniforms.k.value = T.shaft[1]; }
  if (post) post.bloom(T.bloom);
  makeEnv();
}
