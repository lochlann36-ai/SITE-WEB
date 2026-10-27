'use strict';
// ===== Rocket Ball : sons synthétisés en direct (Web Audio) — bruitages placés autour de la caméra, moteur, public, réverb du stade =====
const AU = { ctx: null, on: true };
function initAudio(a) { // sons → bus → filtre (étouffé au ralenti, au replay, en pause) → compresseur → sortie ; réverb du stade en parallèle
  const gain = v => { const g = a.createGain(); g.gain.value = v; return g; }, comp = a.createDynamicsCompressor();
  comp.threshold.value = -18; comp.ratio.value = 5; comp.attack.value = .003; comp.release.value = .25;
  Object.assign(AU, { ctx: a, bus: gain(1), out: gain(AU.on ? .9 : 0), lp: a.createBiquadFilter(), rev: a.createConvolver(), noise: a.createBuffer(1, a.sampleRate * 2, a.sampleRate) });
  AU.lp.frequency.value = 20000; AU.bus.connect(AU.lp).connect(comp).connect(AU.out).connect(a.destination);
  const n = a.sampleRate * 2.6, ir = a.createBuffer(2, n, a.sampleRate); // réponse du stade : bruit qui s'éteint en 2,6 s
  for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n) ** 4; }
  AU.rev.buffer = ir; AU.rev.connect(gain(.5)).connect(AU.lp);
  const nd = AU.noise.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
  const loop = (type, f, q) => { const s = a.createBufferSource(), fl = a.createBiquadFilter(), v = gain(0); s.buffer = AU.noise; s.loop = true; fl.type = type; fl.frequency.value = f; fl.Q.value = q; s.connect(fl).connect(v).connect(AU.bus); s.start(); return { f: fl, v }; };
  Object.assign(AU, { boost: loop('bandpass', 800, .7), roar: loop('lowpass', 160, 1), wind: loop('highpass', 2600, .5), crowd: loop('bandpass', 600, .7), chat: loop('bandpass', 1500, 1.5), rain: loop('highpass', 3500, .3) });
  const ef = a.createBiquadFilter(), ev = gain(0); ef.type = 'lowpass'; ef.Q.value = 4; ef.connect(ev).connect(AU.bus); // moteur : dents de scie désaccordées + carré, filtrées
  AU.eng = { f: ef, v: ev, o: [['sawtooth', 1], ['sawtooth', 1.012], ['square', .5]].map(([t, m]) => { const o = a.createOscillator(); o.type = t; o.m = m; o.frequency.value = 40 * m; o.connect(ef); o.start(); return o; }) };
  return a;
}
const ready = () => { try { return AU.ctx || (window.AudioContext && initAudio(new AudioContext())); } catch { return null; } };
['pointerdown', 'keydown', 'touchstart'].forEach(e => addEventListener(e, () => ready()?.state === 'suspended' && AU.ctx.resume(), true)); // le navigateur attend un geste du joueur

// Briques : oscillateur et bruit filtré avec enveloppe, envoyés vers une sortie placée dans l'espace
const T0 = () => AU.ctx.currentTime;
function spot(pos, rev = .2) { // volume selon la distance, panoramique selon la position à l'écran, envoi vers la réverb
  const a = AU.ctx, g = a.createGain(), p = a.createStereoPanner(), s = a.createGain();
  if (pos && pos[0] != null) {
    const d = new V3(...pos).sub(camera.position), r = d.length() || 1;
    p.pan.value = clamp(d.dot(new V3(1, 0, 0).applyQuaternion(camera.quaternion)) / r * .85); g.gain.value = 1 / (1 + Math.max(0, r - 5) / 14);
  }
  s.gain.value = rev; g.connect(p).connect(AU.bus); p.connect(s).connect(AU.rev); return g;
}
function tone(to, f, d, { type = 'sine', v = .2, f2, at = 0, a = .004, vib } = {}) {
  const c = AU.ctx, o = c.createOscillator(), g = c.createGain(), t = T0() + at;
  o.type = type; o.frequency.setValueAtTime(f, t); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + d);
  if (vib) { const l = c.createOscillator(), lg = c.createGain(); l.frequency.value = vib[0]; lg.gain.value = vib[1]; l.connect(lg).connect(o.frequency); l.start(t); l.stop(t + d + .05); }
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + a); g.gain.exponentialRampToValueAtTime(.0001, t + d);
  o.connect(g).connect(to); o.start(t); o.stop(t + d + .05);
}
function hiss(to, d, { type = 'bandpass', f = 1000, f2, q = 1, v = .2, at = 0, a = .004 } = {}) {
  const c = AU.ctx, s = c.createBufferSource(), fl = c.createBiquadFilter(), g = c.createGain(), t = T0() + at;
  s.buffer = AU.noise; s.loop = true; fl.type = type; fl.Q.value = q; fl.frequency.setValueAtTime(f, t); if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t + d);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + a); g.gain.exponentialRampToValueAtTime(.0001, t + d);
  s.connect(fl).connect(g).connect(to); s.start(t, Math.random() * 1.8); s.stop(t + d + .05);
}
const crackle = (to, n, d, v, at = 0) => { for (let i = 0; i < n; i++) hiss(to, .03 + Math.random() * .04, { type: 'highpass', f: 2500 + Math.random() * 3000, v: v * (.4 + Math.random() * .6), at: at + Math.random() * d }); };

// Bruitages (positions : x, y, z dans le stade ; sans position = son « dans la tête »)
const RAW = {
  hit(s, x, y, z) { const o = spot([x, y, z], .25), k = Math.min(1, s / 30); // frappe de balle : coup sourd + claquement (+ craquement si très fort)
    tone(o, 160, .22, { v: .2 + .7 * k, f2: 48 }); hiss(o, .07, { f: 2400, q: .8, v: .12 + .5 * k });
    if (s > 20) hiss(o, .3, { type: 'highpass', f: 3500, f2: 1500, v: .3 }); },
  bounce(s, x, y, z) { const o = spot([x, y, z], .2), k = Math.min(1, s / 20); tone(o, 100, .25, { v: .45 * k, f2: 42 }); hiss(o, .12, { type: 'lowpass', f: 900, v: .28 * k }); },
  bump(s, x, y, z) { const o = spot([x, y, z], .25), k = Math.min(1, s / 12); // tôle qui s'entrechoque
    [190, 311, 497, 783, 1210].forEach((f, i) => tone(o, f, .32 - i * .045, { type: i % 2 ? 'square' : 'triangle', v: .1 * k })); hiss(o, .14, { f: 1700, q: 1.4, v: .45 * k }); },
  demo(x, y, z) { const o = spot([x, y, z], .55); // démolition
    hiss(o, 1.5, { type: 'lowpass', f: 3000, f2: 70, v: .7 }); tone(o, 75, 1.2, { v: .55, f2: 22 }); crackle(o, 26, 1, .12, .05); },
  jump(x, y, z) { const o = spot([x, y, z], .05); hiss(o, .16, { type: 'lowpass', f: 1100, f2: 300, v: .22 }); tone(o, 180, .13, { v: .11, f2: 95 }); },
  flip(x, y, z) { hiss(spot([x, y, z], .08), .34, { f: 450, f2: 2800, q: 2.2, v: .26, a: .06 }); },
  land(s, x, y, z) { const o = spot([x, y, z], .05), k = Math.min(1, s / 8); tone(o, 85, .16, { v: .3 * k, f2: 45 }); hiss(o, .09, { type: 'lowpass', f: 600, v: .18 * k }); },
  pad(big, x, y, z) { const o = spot([x, y, z], .25);
    if (!big) return [1250, 1875].forEach((f, i) => tone(o, f, .16, { v: .06, at: i * .05 }));
    tone(o, 300, .45, { type: 'triangle', v: .14, f2: 1100 }); tone(o, 600, .55, { v: .06, f2: 2200, at: .06 }); hiss(o, .45, { type: 'highpass', f: 5000, v: .06, a: .12 }); },
  sonic(x, y, z) { const o = spot([x, y, z], .3); hiss(o, .55, { type: 'lowpass', f: 1800, f2: 90, v: .4 }); tone(o, 95, .45, { v: .3, f2: 34 }); hiss(o, .06, { type: 'highpass', f: 4500, v: .25 }); },
  beep(n) { const o = spot(null, .35); // compte à rebours, puis coup de sifflet + public au « GO »
    if (!n) { RAW.whistle([.35]); return RAW.cheer(.5); }
    tone(o, 660, .35, { type: 'triangle', v: .4 }); tone(o, 1320, .3, { v: .12 }); },
  whistle(ds = [.25, .25, .9]) { const o = spot(null, .4); let at = 0; // sifflet d'arbitre (la bille qui vibre = modulation rapide)
    ds.forEach(d => { tone(o, 2750, d, { v: .16, a: .015, at, vib: [38, 150] }); hiss(o, d, { f: 2800, q: 3, v: .07, at }); at += d + .12; }); },
  cheer(k = 1) { const o = spot(null, .6); // le public se lève : grondement, applaudissements, sifflets
    hiss(o, 3.2, { f: 800, q: .6, v: .3 * k, a: .35 }); hiss(o, 2.6, { f: 2300, q: 1, v: .12 * k, a: .25 }); crackle(o, 60 * k | 0, 2.2, .07 * k);
    for (let i = 0; i < 4 * k; i++) tone(o, 1700 + Math.random() * 600, .5, { v: .02, f2: 2600 + Math.random() * 800, at: Math.random() * 1.5 }); },
  ooh() { hiss(spot(null, .5), 1.3, { f: 330, f2: 520, q: 5, v: 1, a: .3 }); }, // « ooooh » du public sur un arrêt
  horn() { const o = spot(null, .5); [110, 138.6, 164.8, 220].forEach(f => tone(o, f, 2.3, { type: 'sawtooth', v: .13, a: .06, vib: [5, 1.5] })); }, // klaxon du but
  boom(kind = 'Classique', x, y, z) { const o = spot([x, y, z], .6), at = (n, d, f) => { for (let i = 0; i < n; i++) f(i, i * d); }; // explosion du but, selon le style
    hiss(o, 2.2, { type: 'lowpass', f: 3200, f2: 55, v: 1.1 }); tone(o, 58, 1.8, { v: .9, f2: 22 });
    pickOf({ Classique: () => crackle(o, 40, 1.4, .1, .15),
      Galaxie: () => { at(8, .07, (i, t) => tone(o, [523, 659, 784, 1047, 1319, 1568, 2093, 2637][i], .9, { type: 'triangle', v: .06, at: t })); hiss(o, 2.4, { type: 'highpass', f: 6000, v: .07, a: .3 }); },
      Volcan: () => { hiss(o, 3.5, { type: 'lowpass', f: 220, v: .5, a: .2 }); tone(o, 38, 3, { v: .35, a: .2 }); crackle(o, 30, 2.5, .07, .3); },
      Glace: () => { at(16, .05, (i, t) => tone(o, 2000 + Math.random() * 4500, .3 + Math.random() * .5, { v: .04, at: t })); hiss(o, .6, { type: 'highpass', f: 5000, v: .3 }); },
      Foudre: () => { hiss(o, .35, { type: 'highpass', f: 1600, f2: 400, v: .6 }); hiss(o, 3.2, { type: 'lowpass', f: 420, f2: 50, v: .55, at: .05 }); },
      Royale: () => { at(4, .13, (i, t) => tone(o, [523, 659, 784, 1047][i], i < 3 ? .3 : 1.2, { type: 'sawtooth', v: .05, at: t, vib: i > 2 && [6, 4] })); at(10, .09, (i, t) => tone(o, 3000 + i * 120, .25, { v: .03, at: .5 + t })); },
    }, kind, 'Classique')(); },
  goal(kind, x, y, z) { RAW.boom(kind, x, y, z); RAW.horn(); RAW.cheer(1); },
  thunder() { const o = spot(null, .7), at = .4 + Math.random(); hiss(o, .5, { type: 'highpass', f: 1500, f2: 500, v: .18, at }); hiss(o, 3.6, { type: 'lowpass', f: 380, f2: 45, v: .6, a: .05, at }); },
  launch(x, y, z) { tone(spot([x, y, z], .3), 500, 1, { v: .025, f2: 1700 }); },             // fusée de feu d'artifice qui monte
  pop(x, y, z) { const o = spot([x, y, z], .5); hiss(o, .7, { type: 'lowpass', f: 2200, f2: 180, v: .5 }); crackle(o, 14, .6, .09, .1); },
  whoosh() { const o = spot(null, .3); hiss(o, .6, { f: 3200, f2: 300, q: 1.5, v: .6 }); tone(o, 1200, .3, { v: .06, f2: 300 }); }, // transition du replay
  chime() { const o = spot(null, .3); [1320, 1980, 2640].forEach((f, i) => tone(o, f, .6 - i * .1, { v: .11 / (i + 1), at: i * .06 })); }, // points gagnés
  ui() { tone(spot(null, 0), 1700, .05, { type: 'triangle', v: .14 }); },
};
const SFX = {}; // chaque son ne fait rien tant que l'audio n'est pas prêt
for (const k in RAW) SFX[k] = (...a) => { try { if (ready() && AU.on) RAW[k](...a); } catch { } };
SFX.mute = () => { AU.on = !AU.on; if (ready()) AU.out.gain.setTargetAtTime(AU.on ? .9 : 0, T0(), .05); return AU.on; };

// Sons continus réglés à chaque image : moteur et boost du joueur, vent supersonique, public, pluie, son étouffé
function ambience({ eng = -1, th = 0, boost = false, sup = false, crowd = .2, rain = 0, muffle = 0 }) {
  if (!AU.ctx) return;
  const t = T0(), set = (p, v, k = .08) => p.setTargetAtTime(v, t, k), on = eng >= 0, sp = Math.max(0, eng);
  AU.eng.o.forEach(o => set(o.frequency, (34 + sp * 5.2 + (th > 0 ? 14 : 0)) * o.m, .06));
  set(AU.eng.f.frequency, 260 + sp * 75 + (th > 0) * 450); set(AU.eng.v.gain, on ? .02 + .018 * Math.abs(th) : 0, .12);
  set(AU.boost.v.gain, on && boost ? .3 : 0, .05); set(AU.boost.f.frequency, 600 + sp * 30); set(AU.roar.v.gain, on && boost ? .5 : 0, .06);
  set(AU.wind.v.gain, on && sup ? .06 : 0, .25);
  set(AU.crowd.v.gain, .04 + crowd * .2, .5); set(AU.crowd.f.frequency, 450 + crowd * 500, .6); set(AU.chat.v.gain, .015 + crowd * .05 * (1 + Math.sin(t * 1.7) * Math.sin(t * .63)), .3);
  set(AU.rain.v.gain, rain * .07, .5);
  set(AU.lp.frequency, [20000, 2600, 650][muffle], .12);
}
