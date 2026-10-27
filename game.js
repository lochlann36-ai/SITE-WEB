'use strict';
// ===== Rocket Ball : moteur du jeu (physique, IA, match, replay, garage) — les graphismes sont dans scene.js =====

// ===== Physique (1 unité = 1 m, d'après les valeurs de Rocket League) =====
const G = 6.5, DT = 1 / 120, MAXS = 23, SUPER = 22, CR = .6;
const HB = new V3(.42, .18, .59), HBN = HB.clone().negate(), GRAV = new V3(0, -G, 0);
const KO = [[-20.48, -25.6], [20.48, -25.6], [-2.56, -38.4], [2.56, -38.4], [0, -46.08]]; // places d'engagement (bleu)
const CURV = [[0, .69], [5, .398], [10, .235], [15, .1375], [17.5, .11], [23, .088]];       // courbure selon la vitesse
const NAMES = ['Viper', 'Blaze', 'Turbo', 'Comet', 'Nitro', 'Rex', 'Flash', 'Storm'];
const ACCENTS = ['#f4f4f4', '#ffd400', '#00e5ff', '#ff3d7f', '#7cff4f', '#222222', '#e8b923'], TRAILS = ['#ff8a20', '#33ccff', '#ff40ff', '#7cff4f', '#ffffff'];

// Garage sauvegardé dans le navigateur
const store = v => { try { return v ? localStorage.setItem('rocketball', JSON.stringify(v)) : JSON.parse(localStorage.getItem('rocketball')) || {}; } catch { return {}; } };
const GAR = Object.assign({ name: 'Joueur', model: 'Éclair', accent: ACCENTS[0], trail: TRAILS[0], theme: 'Coucher de soleil', boom: 'Classique', motif: 'Bandes', sticker: 'Étoile', best: 9, trophies: 0 }, store());
const LOCK = { '#e8b923': [1, 'couleur Or'], Royale: [1, 'explosion Royale'], 'Légende': [2, 'motif Légende'], Couronne: [3, 'sticker Couronne'] }; // récompenses de saison : [classement requis, nom]
const locked = v => Object.hasOwn(LOCK, v) && GAR.best > LOCK[v][0];
const save = () => store(GAR);

// ===== Balle =====
const B = { p: new V3(), v: new V3(), mesh: makeBall() };
const resetBall = () => { B.p.set(0, BR, 0); B.v.set(0, 0, 0); B.mesh.position.copy(B.p); B.mesh.visible = true; };

// Effets joués ici et renvoyés aux joueurs en ligne quand on est l'hôte
const NET = { on: false, host: false, guest: false, ev: [] };
const FX = {
  sfx: (n, ...a) => Object.hasOwn(SFX, n) && SFX[n](...a), msg: (...a) => msg(...a), say: t => say(t),
  boom: (x, y, z, t, k) => EFX.boom(new V3(x, y, z), t, k),
  explode: (x, y, z, t) => EFX.explode(new V3(x, y, z), t),
  spark: (x, y, z, s) => EFX.spark(new V3(x, y, z), s),
  demo: i => cars[i] === me && msg('DÉMOLI !', 1.5),
  pad: (i, k) => { const p = pads[k]; if (p) { EFX.pad(p.x, p.z, p.big); SFX.pad(p.big, p.x, .3, p.z); } },
  toast: (i, t) => cars[i] === me && toast(t),
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
  const trail = r.trail || TRAILS[0], parts = buildCar({ ...r, accent: r.accent || ACCENTS[0], trail });
  return { ...r, trail, parts, mesh: parts.root, flame: parts.flame, tag: makeTag(r.name || '?', r.team), p: new V3(), v: new V3(), q: new Q(), w: new V3(), in: {}, ai: {}, boost: 33, dead: 0, spin: 0, st: [0, 0, 0, 0] }; // st : buts, tirs, arrêts, points
}

function place(c, x, z) {
  Object.assign(c, { ground: true, n: FLOOR.n, sp: FLOOR, flip: 0, jt: 0, dj: false, stick: 0, boosting: false, dead: 0, ai: {} });
  c.p.set(x, REST, z); c.v.set(0, 0, 0); c.w.set(0, 0, 0);
  c.q.setFromAxisAngle(UP, Math.atan2(-x, -z)); // face au centre
  c.mesh.position.copy(c.p); c.mesh.quaternion.copy(c.q); c.mesh.visible = true; c.wp = c.p.clone();
}
const detach = c => Object.assign(c, { ground: false, sp: null, jt: 0, dj: false, stick: .3 });
function attach(c, pl) { // roues posées sur pl (sol, mur, coin, plafond)
  if (!c.ground && -c.v.dot(pl.n) > 2) fx('sfx', 'land', -c.v.dot(pl.n), ...c.p.toArray());
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
    if (jump) { c.v.addScaledVector(n, 2.92); detach(c); c.hold = true; fx('sfx', 'jump', ...c.p.toArray()); }
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
        c.flip = .65; c.fd = [dp, ds]; fx('sfx', 'flip', ...c.p.toArray());
      } else { c.v.addScaledVector(up, 2.92); fx('sfx', 'jump', ...c.p.toArray()); }
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

// Stats : la balle file-t-elle vers la cage du côté s (z = s·L) dans les 2,5 s ?
const heading = s => { const t = (s * L - B.p.z) / B.v.z; return t > 0 && t < 2.5 && Math.abs(B.p.x + B.v.x * t) < GW && B.p.y + B.v.y * t - G * t * t / 2 < GH; };
function award(c, k, n, t) { c.st[k]++; c.st[3] += n; fx('toast', cars.indexOf(c), `${t} +${n}`); }

// Contact voiture / balle (hitbox orientée + impulsion bonus façon Rocket League)
function hitBall(c) {
  if (c.dead) return;
  const loc = B.p.clone().sub(c.p).applyQuaternion(c.q.clone().invert()), cl = loc.clone().clamp(HBN, HB), d = loc.sub(cl), dist = d.length();
  if (dist >= BR) return;
  const n = (dist > 1e-4 ? d.divideScalar(dist) : d.set(0, 1, 0)).applyQuaternion(c.q);
  B.p.addScaledVector(n, BR - dist);
  const vc = c.w.clone().applyQuaternion(c.q).cross(cl.applyQuaternion(c.q)).add(c.v), rel = B.v.clone().sub(vc), vn = rel.dot(n);
  if (vn >= 0) return;
  const at = c.team ? -1 : 1, was = [heading(at), heading(-at)], s = rel.length(), dir = B.p.clone().sub(c.p).multiply(new V3(1, .35, 1)).normalize();
  B.v.addScaledVector(n, -vn * .86).addScaledVector(dir, s * (s < 5 ? .65 : s < 23 ? .65 - (s - 5) / 180 : Math.max(.3, .55 - (s - 23) / 92)));
  c.v.addScaledVector(n, vn * .14);
  S.clock = true; S.last = c;
  if (was[1] && !heading(-at)) { award(c, 2, 50, 'ARRÊT'); fx('sfx', 'ooh'); comment(pick([`Quel arrêt de ${c.name} !`, `${c.name} sauve son équipe !`, `Énorme parade de ${c.name} !`])); }
  else if (!was[0] && heading(at)) award(c, 1, 20, 'TIR CADRÉ');
  if (!c.ground && c.p.y > 4.5) comment(pick([`Superbe aérienne de ${c.name} !`, `${c.name} s'envole !`]));
  else if (clockT - (c.ht ?? -9) > 1) { c.ht = clockT; c.st[3] += 2; } // simple touche
  if (s > 6) fx('spark', B.p.x - n.x * BR, B.p.y - n.y * BR, B.p.z - n.z * BR, s);
  if (s > 2) fx('sfx', 'hit', s, ...B.p.toArray());
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
    if (a.team !== b.team && a.v.length() >= SUPER && fwd(a).dot(n) > .7) return demo(b, a);
    if (a.team !== b.team && b.v.length() >= SUPER && fwd(b).dot(n) < -.7) return demo(a, b);
    a.v.addScaledVector(n, -rel * .6); b.v.addScaledVector(n, rel * .6);
    if (rel > 6) [a, b].forEach(c => { c.v.y += rel * .25; detach(c); });
    const m = a.p.clone().add(b.p).multiplyScalar(.5); if (rel > 4) fx('spark', m.x, m.y, m.z, rel * 2); // étincelles de carrosserie
    fx('sfx', 'bump', rel, m.x, m.y, m.z);
  }));
}
function demo(c, by) {
  c.dead = 3; c.boosting = false;
  fx('explode', c.p.x, c.p.y, c.p.z, c.team); fx('sfx', 'demo', ...c.p.toArray()); fx('demo', cars.indexOf(c)); comment(`${by.name} démolit ${c.name} ! 💥`);
}
function respawn(c) { place(c, rnd(2 * GW), (c.team ? 1 : -1) * (L - 4)); c.boost = 33; }

function pickPads(dt) {
  pads.forEach((p, k) => {
    if (p.t > 0) return void (p.t -= dt);
    const c = cars.find(c => !c.dead && c.boost < 100 && c.p.y < (p.big ? 2.5 : 1.5) && Math.hypot(c.p.x - p.x, c.p.z - p.z) < (p.big ? 2.1 : 1.45));
    if (!c) return;
    c.boost = Math.min(100, c.boost + (p.big ? 100 : 12)); p.t = p.big ? 10 : 4;
    fx('pad', cars.indexOf(c), k);
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
  if (e.code === 'KeyM') SFX.mute();
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
  const I = c.in, A = c.ai, sk = c.lvl ?? S.diff, dir = c.team ? -1 : 1, f = fwd(c);
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
const S = { phase: 'menu', mode: 1, diff: 1, score: [0, 0], time: 300, ot: false, clock: false, timer: 0, paused: false, shake: 0, msgT: 0, last: null, gs: 1, rt: 0, slow: 0 };
let cars = [], me = null, preview = null, acc = 0, last = performance.now(), clockT = 0;

function msg(big, t, small = '', team) { // texte au centre de l'écran (relancé à chaque fois pour l'animation)
  const m = $('msg'); $('mb').textContent = big; $('ms').textContent = small;
  m.style.setProperty('--mc', team == null ? '#ffffff' : team ? '#ff7a1a' : '#1e7bff');
  m.classList.toggle('band', team != null); m.classList.remove('show'); void m.offsetWidth; m.classList.add('show'); S.msgT = t;
}
function toast(t) { const e = $('toast'); e.textContent = t; e.classList.remove('show'); void e.offsetWidth; e.classList.add('show'); SFX.chime(); }
function say(t) { const e = $('comment'); $('ct').textContent = t; e.classList.add('show'); clearTimeout(say.t); say.t = setTimeout(() => e.classList.remove('show'), 3400); } // commentateur
function comment(t, force) { if (force || clockT - (S.sayAt ?? -9) > 4) { S.sayAt = clockT; fx('say', t); } }
function overlay(t, x, a, fa, b, fb) {
  $('ot').textContent = t; $('ox').textContent = x; $('stats').replaceChildren();
  Object.assign($('oa'), { textContent: a, onclick: fa }); Object.assign($('ob'), { textContent: b || '', onclick: fb });
  $('ob').classList.toggle('hidden', !b); $('over').classList.remove('hidden', 'podium');
}

const botRoster = (team, name) => ({ team, name, model: pick(Object.keys(MODELS)), accent: pick(ACCENTS), trail: pick(TRAILS), boom: pick(Object.keys(BOOMS)), motif: pick(Object.keys(MOTIFS)), sticker: pick(Object.keys(STICKERS)), bot: true });
function localRoster(opp) { // opp : équipe adverse en saison (niveau de ses bots)
  const names = NAMES.slice().sort(() => Math.random() - .5), r = [];
  for (let t = 0; t < 2; t++) for (let i = 0; i < S.mode; i++) r.push(t || i ? { ...botRoster(t, names.pop()), lvl: t && opp ? opp.l : S.diff } : { ...GAR, team: 0, me: true });
  return r;
}

function start(roster = localRoster(), season = null) {
  document.activeElement?.blur?.();
  if (TOUCH_DEV) document.documentElement.requestFullscreen?.()?.catch?.(() => { });
  cars.forEach(removeCar);
  if (preview) { removeCar(preview); preview = null; }
  showroom.visible = podium.visible = false; POST.dof = 0;
  cars = roster.map(makeCar); me = cars.find(c => c.me) || cars[0]; faceLogo(me.team);
  Object.assign(S, { score: [0, 0], time: 300, ot: false, paused: false, phase: 'count', timer: 3, season });
  [['blue', 'BLEU', 'TOI'], ['orange', 'ORANGE', season?.n.toUpperCase()]].forEach(([k, a, b]) => $('score').querySelector(`.${k} small`).textContent = season ? b : a);
  acc = 0; REC.length = 0; REPLAY = [];
  ['menu', 'over', 'online', 'garage', 'season'].forEach(i => $(i).classList.add('hidden'));
  $('hud').classList.remove('hidden'); $('touch').classList.toggle('hidden', !TOUCH_DEV); document.body.classList.add('playing');
  camera.clearViewOffset();
  if (NET.guest) resetBall(); else kickoff(true);
}

function kickoff(intro) { // intro : survol du stade avant le premier coup d'envoi
  const spots = KO.slice().sort(() => Math.random() - .5);
  cars.forEach(c => {
    const [x, z] = spots[cars.filter(m => m.team === c.team).indexOf(c)], s = c.team ? -1 : 1;
    place(c, x * s, z * s); c.boost = 33;
  });
  resetBall(); pads.forEach(p => p.t = 0); REC.length = 0;
  Object.assign(S, { phase: intro ? 'intro' : 'count', timer: intro ? 4.5 : 3, clock: false, last: null });
  if (intro) { fx('msg', 'ROCKET BALL', 4, `${S.mode} CONTRE ${S.mode}`); comment(S.season ? `Journée ${GAR.season.r + 1} : on affronte les ${S.season.n} !` : 'Bienvenue au stade ! Que le meilleur gagne.', true); } else countdown();
}
const countdown = () => { Object.assign(S, { phase: 'count', timer: 3 }); fx('msg', 3, 1, S.ot ? 'PROLONGATIONS' : ''); fx('sfx', 'beep', 3); };

function goal(t) {
  const by = S.last?.team === t ? S.last : null; // buteur (pas de but contre son camp)
  S.score[t]++; Object.assign(S, { phase: 'goal', timer: 2.5, shake: .8, gs: Math.sign(B.p.z), slow: 1.6 }); B.mesh.visible = false; // ralenti
  REPLAY = REC.splice(0);
  fx('boom', B.p.x, B.p.y, B.p.z, t, by?.boom || 'Classique'); fx('sfx', 'goal', by?.boom || 'Classique', ...B.p.toArray());
  fx('msg', 'BUT !', 2.5, by ? by.name.toUpperCase() : '', t); if (by) award(by, 0, 100, 'BUT');
  const n = by?.st[0], gap = Math.abs(S.score[0] - S.score[1]); // le commentateur réagit
  comment(pick(!by ? [`Contre son camp${S.last ? ' de ' + S.last.name : ''}… aïe !`] : S.ot ? [`BUT EN OR ! ${by.name} offre la victoire !`] : n === 3 ? [`Coup du chapeau pour ${by.name} ! 🎩`]
    : n === 2 ? [`Doublé de ${by.name} !`] : B.p.y > 3 ? [`Quelle reprise aérienne de ${by.name} !`] : !gap ? ['Égalisation ! Tout est à refaire.'] : S.time < 30 ? ['À la dernière seconde ! Incroyable !']
    : gap > 2 ? [`${t ? 'Les Orange' : 'Les Bleus'} déroulent !`] : B.v.length() > 28 ? [`Quelle frappe de ${by.name} !`] : [`Superbe but de ${by.name} !`, `${by.name} trouve le chemin des filets !`, `Imparable ! Bravo ${by.name}.`]), true);
}
const overtime = () => { S.ot = true; S.time = 0; kickoff(); comment('Prolongations ! Le prochain but gagne.', true); };
const afterGoal = () => S.ot ? end() : S.time > 0 ? kickoff() : S.score[0] === S.score[1] ? overtime() : end();
function end() { S.phase = 'end'; if (NET.host) sendSnap(); showEnd(); }
function showEnd() { // podium : l'équipe gagnante sur les marches, boost allumé, feux d'artifice
  const a = S.score[me.team], b = S.score[1 - me.team], win = +(S.score[1] > S.score[0]), again = () => NET.host ? hostStart() : start();
  const champs = cars.filter(c => c.team === win).sort((x, y) => y.st[3] - x.st[3] || (y === me) - (x === me)), mvp = champs[0]; // MVP sur la plus haute marche
  cars.forEach(c => { c.mesh.visible = c.team === win; c.parts.extra.forEach(o => o.visible = c.team === win); });
  champs.forEach((c, i) => { c.mesh.position.set(PODIUM[i][0], PODIUM[i][1] + REST, 0); c.mesh.quaternion.identity(); c.v.set(0, 0, 0); Object.assign(c, { in: {}, wp: null, sup: false }); c.flame.visible = true; });
  const tag = makeTag('★ MVP', win, '#ffb400e6'); tag.position.set(PODIUM[0][0], PODIUM[0][1] + REST + 1.65, 0); mvp.parts.extra.push(tag);
  B.mesh.visible = ballRing.visible = false; showPodium(win); EFX.fireworks(win); hype = 1; hypeTeam = win; S.podT = 0;
  setBoard(S.score[0], S.score[1], '', win, win ? 'VICTOIRE ORANGE' : 'VICTOIRE BLEUE');
  const sea = S.season && !NET.on ? ' · ' + seasonResult(S.score[0], S.score[1], S.ot) : '';
  overlay(a > b ? 'VICTOIRE !' : 'DÉFAITE', `${S.score[0]} - ${S.score[1]}${sea}`, ...(NET.guest ? ['Quitter', quit] : sea ? ['Classement', showSeason, 'Menu', quit] : ['Rejouer', again, 'Menu', quit]));
  $('over').classList.add('podium'); ['hud', 'touch'].forEach(i => $(i).classList.add('hidden')); SFX.whistle(); SFX.cheer(.8);
  const rows = cars.slice().sort((x, y) => x.team - y.team || y.st[3] - x.st[3]); // tableau des stats
  fillTable('stats', ['Joueur', 'Pts', 'Buts', 'Tirs', 'Arrêts'], rows.map(c => [(c === mvp ? '★ ' : '') + c.name, c.st[3], ...c.st.slice(0, 3)]), i => (rows[i].team ? 'orange' : 'blue') + (rows[i] === me ? ' me' : ''));
}
function fillTable(id, head, rows, cls) { // tableau HTML (texte seulement)
  $(id).replaceChildren(...[head, ...rows].map((r, i) => { const tr = document.createElement('tr'); r.forEach(v => tr.appendChild(document.createElement(i ? 'td' : 'th')).textContent = v); if (i) tr.className = cls(i - 1); return tr; }));
}
function podiumView(dt) {
  clockT += dt;
  cars.filter(c => c.mesh.visible).forEach(c => { animCar(c, dt); c.tag.visible = true; });
  if ((S.podT += dt) > 3) { S.podT = 0; EFX.fireworks(hypeTeam); hype = Math.max(hype, .7); }
  animPads(clockT); animFx(dt, clockT);
  const a = Math.sin(clockT * .25) * .6; camera.position.set(Math.sin(a) * 8.5, 2.8, Math.cos(a) * 8.5); camera.lookAt(0, .3, 0); // podium en haut de l'écran, au-dessus des stats
  camera.fov = 50; camera.updateProjectionMatrix(); focusOn(new V3(0, 1.2, 0), .8, .28);
}
const focusOn = (p, k, dr = .1) => { const v = p.clone().project(camera); Object.assign(POST, { dof: k, dr, fx: (v.x + 1) / 2, fy: (v.y + 1) / 2, speed: 0, t: clockT }); }; // flou autour de p
function menu() {
  Object.assign(S, { phase: 'menu', paused: false });
  ['over', 'hud', 'touch', 'online', 'garage', 'season'].forEach(i => $(i).classList.add('hidden')); $('menu').classList.remove('hidden');
  $('trophies').textContent = GAR.trophies ? '🏆 ×' + GAR.trophies : '';
  document.body.classList.remove('playing');
  cars.forEach(removeCar); cars = []; me = null; B.mesh.visible = podium.visible = ballRing.visible = false; showroom.visible = true; showPreview();
  if (THEME !== GAR.theme) applyTheme(GAR.theme); faceLogo(0);
}
const removeCar = c => scene.remove(c.mesh, c.tag, ...c.parts.extra);
const quit = () => { if (NET.peer) netClose(); menu(); };
function pause() {
  if (!['intro', 'count', 'play', 'goal', 'replay'].includes(S.phase)) return;
  if ($('over').classList.toggle('hidden')) return void (S.paused = false);
  S.paused = !NET.on; // en ligne, la partie continue
  overlay(NET.on ? 'MENU' : 'PAUSE', '', 'Reprendre', pause, 'Quitter', quit);
}

function tick(dt) {
  if (S.phase === 'intro') { playerInput(me); if ((S.timer -= dt) <= 0 || (me.in.jump && !me.pj)) countdown(); me.pj = me.in.jump; return; } // saut = passer
  if (S.phase === 'count') { // compte à rebours : tout est figé
    const n = Math.ceil(S.timer);
    if ((S.timer -= dt) <= 0) { S.phase = 'play'; fx('msg', 'GO !', .8); fx('sfx', 'beep', 0); }
    else if (Math.ceil(S.timer) < n) { fx('msg', Math.ceil(S.timer), 1, S.ot ? 'PROLONGATIONS' : ''); fx('sfx', 'beep', Math.ceil(S.timer)); }
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
  if (hit > 3) fx('sfx', 'bounce', hit, ...B.p.toArray());
  cars.forEach(hitBall);
  if (B.v.length() > 60) B.v.setLength(60);
  if (Math.abs(B.p.z) > L + BR) return goal(B.p.z > 0 ? 0 : 1);
  if (!S.clock) return; // le chrono démarre à la première touche
  if (S.time > 60 && S.time - dt <= 60 && !S.ot) comment('Dernière minute de jeu !', true);
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
  const u = S.rt * 60 / Math.max(1, REPLAY.length);
  if (S.phase === 'intro') { // survol : on tourne autour du stade et on descend derrière sa voiture
    const e = 1 - (S.timer / 4.5) ** 3, end = c.p.clone().add(c.p.clone().sub(B.p).setY(0).normalize().multiplyScalar(3.6)).setY(c.p.y + 1.4);
    const a = Math.atan2(end.x, end.z) + 2.4 * (1 - e), r = 36 + (Math.hypot(end.x, end.z) - 36) * e; // reste dans le stade
    camP.set(Math.sin(a) * r, 17 + (end.y - 17) * e, Math.cos(a) * r); camL.set(0, 1, 0);
  } else if (S.phase === 'replay') { // replay : derrière la balle, puis vue depuis le fond de la cage
    const bp = B.mesh.position;
    if (u < .55) camP.lerp(new V3(bp.x * .8, Math.max(bp.y, 1) + 3.5, bp.z - S.gs * 10), k * .5);
    else camP.lerp(new V3(clamp(bp.x * .3, 2.5 - GW, GW - 2.5), 2.6, S.gs * (L + GD - 1.5)), u < .58 ? 1 : k);
    camL.lerp(bp, k);
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
  const fov = S.phase === 'replay' ? (u < .55 ? 62 : 50) : S.phase === 'intro' ? 60 : 78 + (c.dead ? 0 : c.v.length() >= SUPER ? 9 : c.boosting ? 4 : 0); // effet de vitesse
  camera.fov += (fov - camera.fov) * Math.min(1, dt * 3); camera.updateProjectionMatrix();
}

function animCar(c, dt) {
  const m = c.mesh, P = c.parts, f = fwd(c, m.quaternion), p = m.position, on = m.visible, ease = r => Math.min(1, dt * r);
  // Roues qui tournent selon le déplacement, roues avant qui braquent, caisse qui penche
  c.spin += p.clone().sub(c.wp || p).dot(f) / P.wr; c.wp = p.clone();
  const st = c.in.st || 0, sp = Math.min(1, c.v.length() / MAXS);
  P.wheels.forEach(w => { w.spin.rotation.x = c.spin; if (w.front) w.steer.rotation.y += (-st * .45 - w.steer.rotation.y) * ease(12); });
  P.body.rotation.z += ((c.ground ? -st * sp * .07 : 0) - P.body.rotation.z) * ease(8);
  P.body.rotation.x += ((c.ground ? -(c.in.th || 0) * .025 : 0) - P.body.rotation.x) * ease(6);
  // Boost (flamme, feu, fumée), traînée supersonique, fumée de drift
  c.flame.scale.set(1, 1, .75 + Math.random() * .5);
  if (c.flame.visible) {
    const bk = p.clone().addScaledVector(f, -.75);
    for (let i = 0; i < 2; i++) FXA.emit(bk, f.clone().multiplyScalar(-7).add(rdir(1.2)), { c: c.trail, l: .28, s: .32, g: -.2, k: 2.5 });
    FXN.emit(bk, f.clone().multiplyScalar(-2).add(rdir(.6)), { c: 0x8a8a96, l: .9, s: .3, g: 1.6, a: .22 });
  }
  if (c.sup && on) FXA.emit(p.clone().addScaledVector(f, -.6).add(rdir(.15)), f.clone().negate(), { c: COL[c.team], l: .45, s: .3, k: 2 });
  if (on && c.ground && c.in.drift && c.v.length() > 5) FXN.emit(p.clone().addScaledVector(f, -.4).addScaledVector(upv(c), -.3), rdir(.8), { c: 0xd8d8e0, l: .8, s: .25, g: 1.4, a: .3 });
  c.tag.visible = on && c !== me; c.tag.position.copy(p).y += 1.25; // nom au-dessus de la voiture
  P.fm.uniforms.t.value = clockT; m.updateMatrixWorld();
  const fv = c.v.dot(f), brake = (c.in.th < -.1 && fv > 1) || fv < -1; // feux stop (freinage ou marche arrière)
  P.tailMat.color.set(0xff2030).multiplyScalar(brake ? 7 : 2);
  const h = p.y - REST; // ombre de contact sous la voiture
  P.pool.visible = on && c.ground !== false && S.phase !== 'end'; // phares au sol
  P.blob.visible = on && h < 4; P.blob.position.set(p.x, .03, p.z); P.blob.rotation.y = Math.atan2(f.x, f.z); P.blob.material.opacity = .7 * (1 - h / 4);
  const right = new V3(1, 0, 0).applyQuaternion(m.quaternion); // traînées des feux arrière quand on va vite
  if (c.sup && !c.ws && on) { // bang supersonique : anneau d'air autour de la voiture
    const u = new V3(0, 1, 0).applyQuaternion(m.quaternion);
    for (let i = 0; i < 28; i++) FXA.emit(p, right.clone().multiplyScalar(Math.cos(i * .224) * 9).addScaledVector(u, Math.sin(i * .224) * 9).addScaledVector(f, -3), { c: 0xdff4ff, l: .35, s: .25, k: 3 });
    SFX.sonic(p.x, p.y, p.z);
  }
  c.ws = c.sup;
  P.tails.forEach(t => t.rb.update(P.body.localToWorld(t.at.clone()), right, on && c.v.length() > 13));
  if (on && c.ground && c.in.drift && c.v.length() > 5 && upv(c).y > .9) // traces de pneus en drift
    P.wheels.filter(w => !w.front).forEach((w, j) => { const q = w.steer.getWorldPosition(new V3()).setY(.02), sk = c.sk ||= []; if (!sk[j]) sk[j] = q; else if (sk[j].distanceTo(q) > .3) { skid(sk[j], q); sk[j] = q; } });
  else c.sk = null;
}

function hud(dt) {
  const t = S.ot ? Math.floor(S.time) : Math.ceil(S.time), ts = (S.ot ? '+' : '') + Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0');
  $('sb').textContent = S.score[0]; $('so').textContent = S.score[1]; $('time').textContent = ts;
  setBoard(S.score[0], S.score[1], ts, ['goal', 'replay'].includes(S.phase) ? (S.gs > 0 ? 0 : 1) : null); // écran géant
  $('bv').textContent = Math.floor(me.boost); $('ring').style.strokeDashoffset = 264 * (1 - me.boost / 100);
  $('boost').classList.toggle('full', me.boost >= 100); $('cam').classList.toggle('on', ballCam);
  $('replay').classList.toggle('hidden', S.phase !== 'replay'); $('skip').classList.toggle('hidden', NET.guest);
  $('speed').style.opacity = me.dead || S.phase === 'replay' ? 0 : clamp((me.v.length() - 15) / 8, 0, 1);
  POST.speed = S.phase === 'play' && !me.dead ? clamp((me.v.length() - 17) / 6, 0, 1) * .8 : 0; POST.t = clockT; // flou de vitesse
  if (S.msgT > 0 && (S.msgT -= dt) <= 0) $('msg').classList.remove('show');
}

function frame(dt) {
  clockT += dt;
  if (S.phase === 'replay') { if (!S.rt) SFX.whoosh(); playReplay(dt); }
  else {
    const k = 1 - Math.exp(-30 * dt);
    cars.forEach(c => {
      c.mesh.position.copy(c.p); c.mesh.quaternion.slerp(c.q, k); c.mesh.visible = !c.dead;
      c.flame.visible = c.boosting && !c.dead; c.sup = !c.dead && c.v.length() >= SUPER;
    });
    B.mesh.position.copy(B.p);
    const hv = Math.hypot(B.v.x, B.v.z);
    if (hv > .01) B.mesh.rotateOnWorldAxis(new V3(B.v.z, 0, -B.v.x).divideScalar(hv), hv / BR * dt);
    if (B.mesh.visible && B.v.length() > 16) FXA.emit(B.p, rdir(.3), { c: 0x9fd8ff, l: .35, s: 1.4, a: .25, k: 1.5 }); // traînée de la balle
    if (S.phase === 'play') record(dt);
  }
  cars.forEach(c => animCar(c, dt));
  animPads(clockT); animFx(dt, clockT); updCam(dt); hud(dt);
  const bp = B.mesh.position; ballRing.visible = B.mesh.visible && bp.y > 2.5; // cercle au sol sous la balle en l'air
  ballRing.position.set(bp.x, .03, bp.z); ballRing.scale.setScalar(1 + bp.y * .04); ballRing.material.opacity = clamp(1.3 - bp.y / 14, .25, 1);
  TV.target.copy(bp); if (S.phase === 'replay') focusOn(bp, .45); else POST.dof = 0;
}

// Menu : la voiture du garage tourne sur son plateau
function showPreview() {
  if (preview) removeCar(preview);
  preview = makeCar({ ...GAR, team: 0 }); place(preview, 0, 0); preview.flame.visible = true;
}
function menuView(dt) {
  clockT += dt;
  const m = preview.mesh; m.quaternion.setFromAxisAngle(UP, clockT * .5); m.position.y = REST + .12;
  animCar(preview, dt); preview.tag.visible = false; animPads(clockT); animFx(dt, clockT);
  camera.fov = 50; camera.position.set(3, 1.35, 2.4); camera.lookAt(0, .4, 0);
  if (innerWidth >= 700) camera.setViewOffset(innerWidth, innerHeight, -innerWidth * .2, 0, innerWidth, innerHeight); else camera.clearViewOffset();
  camera.updateProjectionMatrix(); focusOn(new V3(0, .4, 0), .85); // garage : arrière-plan flou
}

function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min((now - last) / 1000, .1); last = now;
  pollPad();
  if (S.phase === 'menu') menuView(dt);
  else if (S.phase === 'end') podiumView(dt);
  else if (!S.paused) {
    const sl = 1 - .7 * clamp(S.slow * 1.5, 0, 1); S.slow -= dt; // ralenti après un but
    if (NET.guest) netGuestFrame(dt); // l'invité affiche ce que l'hôte simule
    else {
      acc += dt * sl;
      while (acc >= DT && S.phase !== 'end') { tick(DT); acc -= DT; }
      if (NET.host) netHostFrame(dt);
    }
    if (S.phase !== 'menu') frame(dt * sl);
  }
  const pl = me && !me.dead && !S.paused && ['intro', 'count', 'play', 'goal'].includes(S.phase); // sons continus
  ambience({ eng: pl ? me.v.length() : -1, th: me?.in.th || 0, boost: pl && me.boosting, sup: pl && me.sup, rain: LOOK.rain, muffle: S.paused || S.slow > .5 ? 2 : S.phase === 'replay' ? 1 : 0,
    crowd: Math.min(1, (S.phase === 'menu' ? .05 : S.phase === 'end' ? .7 : .2 + .5 * clamp((Math.abs(B.p.z) - L + 25) / 25, 0, 1)) + hype * .5) });
  render(dt);
}

// ===== Menu & garage =====
document.querySelectorAll('[data-m],[data-d]').forEach(b => b.onclick = () => {
  const k = b.dataset.m ? 'm' : 'd';
  document.querySelectorAll(`[data-${k}]`).forEach(x => x.classList.toggle('on', x.dataset[k] === b.dataset[k]));
  if (k === 'm') S.mode = +b.dataset.m; else S.diff = +b.dataset.d;
});
function garage() { // boutons du garage ; les récompenses de saison restent verrouillées tant qu'elles ne sont pas gagnées
  [['models', Object.keys(MODELS), 'model'], ['accents', ACCENTS, 'accent'], ['trails', TRAILS, 'trail'], ['motifs', Object.keys(MOTIFS), 'motif'], ['stickers', Object.keys(STICKERS), 'sticker'], ['booms', Object.keys(BOOMS), 'boom']].forEach(([id, list, key]) => {
    $(id).querySelectorAll('button').forEach(b => b.remove());
    list.forEach(v => {
      const b = $(id).appendChild(document.createElement('button')), lock = locked(v);
      if (v[0] !== '#') b.textContent = v; else { b.className = 'swatch'; b.style.background = v; b.setAttribute('aria-label', v); }
      b.classList.toggle('on', GAR[key] === v); b.classList.toggle('locked', lock);
      b.onclick = () => {
        if (lock) return void ($('gmsg').textContent = `🔒 Récompense de saison : finis ${['', '1er', 'dans le top 2', 'dans le top 3'][LOCK[v][0]]} pour la débloquer`);
        GAR[key] = v; save(); $('gmsg').textContent = ''; $(id).querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); key === 'boom' ? demoBoom(v) : showPreview();
      };
    });
  });
}
Object.keys(THEMES).forEach(v => {
  const b = $('themes').appendChild(document.createElement('button')); b.textContent = v; b.classList.toggle('on', GAR.theme === v);
  b.onclick = () => { GAR.theme = v; save(); $('themes').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); applyTheme(v); };
});
const demoBoom = (v, q = new V3(-6, 2, -10)) => { EFX.flash(q, BOOMS[v](q, COL[0]), 800); SFX.boom(v, q.x, q.y, q.z); }; // aperçu de l'explosion derrière la voiture
const screen = id => ['menu', 'garage', 'season'].forEach(i => $(i).classList.toggle('hidden', i !== id));
$('play').onclick = () => start();
$('garageBtn').onclick = () => { $('gmsg').textContent = ''; screen('garage'); }; $('gback').onclick = $('sback').onclick = () => screen('menu');
$('seasonBtn').onclick = showSeason; $('splay').onclick = () => { const o = GAR.season.t[pairs(GAR.season.r)[0][1]]; start(localRoster(o), o); };
$('snew').onclick = e => { // demande confirmation si une saison est en cours
  const b = e.target; if (GAR.season.r % 5 && !b.dataset.ok) { b.dataset.ok = 1; b.textContent = 'Sûr ? Re-clique'; return; }
  newSeason(); showSeason();
};
document.addEventListener('click', e => e.target.closest?.('button') && SFX.ui());

// ===== Saison : 6 équipes, 5 journées, 3 pts la victoire, 1 pt la défaite en prolongation ; les autres matchs sont simulés =====
const TEAMS = [['Toi', 1], ['Comètes', 0], ['Vipères', 1], ['Titans', 1], ['Éclairs', 2], ['Dragons', 2]], LV = ['Débutant', 'Pro', 'All-Star'], ord = n => n + (n > 1 ? 'e' : 'er');
const newSeason = () => { GAR.season = { r: 0, t: TEAMS.map(([n, l]) => ({ n, l, j: 0, v: 0, d: 0, p: 0, bp: 0, bc: 0 })) }; save(); };
const pairs = r => { const a = [1, 2, 3, 4, 5], b = [0, ...a.slice(r), ...a.slice(0, r)]; return [0, 1, 2].map(i => [b[i], b[5 - i]]); }; // calendrier (méthode du cercle)
const ranking = () => GAR.season.t.slice().sort((a, b) => b.p - a.p || b.bp - b.bc - a.bp + a.bc || b.bp - a.bp);
const sim = (A, B) => { let f = Math.random() * 4 + A.l * .7 | 0, c = Math.random() * 4 + B.l * .7 | 0; const o = f === c; if (o) Math.random() < .5 + .15 * (A.l - B.l) ? f++ : c++; return [f, c, o]; };
function seasonResult(a, b, ot) { // enregistre la journée et renvoie le texte affiché sous le score
  const G = GAR.season, T = G.t, rec = (t, f, c, o) => { t.j++; t.bp += f; t.bc += c; if (f > c) { t.v++; t.p += 3; } else { t.d++; t.p += o ? 1 : 0; } };
  pairs(G.r).forEach(([i, j], k) => { const [f, c, o] = k ? sim(T[i], T[j]) : [a, b, ot]; rec(T[i], f, c, o); rec(T[j], c, f, o); });
  const rank = ranking().indexOf(T[0]) + 1; let txt = `${a > b ? '+3 pts' : ot ? '+1 pt' : '+0 pt'} · ${ord(rank)} du classement`;
  if (++G.r === 5) {
    const won = Object.keys(LOCK).filter(k => locked(k) && rank <= LOCK[k][0]);
    GAR.best = Math.min(GAR.best, rank); GAR.trophies += rank === 1; garage();
    txt = `Saison finie : ${ord(rank)} !` + (won.length ? ' 🎁 ' + won.map(k => LOCK[k][1]).join(', ') : '');
  }
  save(); return txt;
}
function showSeason() {
  menu(); screen('season'); if (!GAR.season) newSeason();
  const G = GAR.season, done = G.r >= 5, o = !done && G.t[pairs(G.r)[0][1]], rank = ranking().indexOf(G.t[0]) + 1;
  $('sinfo').textContent = done ? `🏁 Saison terminée : tu finis ${ord(rank)} !` : `Journée ${G.r + 1}/5 · Toi contre les ${o.n} (bots ${LV[o.l]})`;
  fillTable('stable', ['Équipe', 'Pts', 'J', 'V', 'D', '+/-'], ranking().map((t, i) => [`${i + 1}. ${t.n}`, t.p, t.j, t.v, t.d, (t.bp > t.bc ? '+' : '') + (t.bp - t.bc)]), i => ranking()[i] === G.t[0] ? 'me gold' : 'orange');
  $('splay').classList.toggle('hidden', done); Object.assign($('snew'), { textContent: 'Nouvelle saison' }).dataset.ok = '';
  $('srew').textContent = `🎁 Récompenses : top 3 → sticker Couronne · top 2 → motif Légende · 1er → couleur Or + explosion Royale 🏆. Meilleur classement : ${GAR.best < 9 ? ord(GAR.best) : 'aucun'}.`;
}

applyTheme(GAR.theme); garage();
menu();
addEventListener('DOMContentLoaded', () => requestAnimationFrame(loop));
