'use strict';
// ===== Rocket Ball : multijoueur en ligne (pair-à-pair avec PeerJS, l'hôte fait tourner la partie) =====
const PREFIX = 'rocketball-v1-', ERRORS = {
  'peer-unavailable': 'Code introuvable', 'unavailable-id': 'Code déjà pris, réessaie', network: 'Pas de connexion au serveur de jeu (ouvre le jeu depuis le site)',
  'server-error': 'Serveur indisponible', 'browser-incompatible': 'Jeu en ligne bloqué ici : ouvre le jeu depuis le site',
};
let lobby = [], snapT = 0, sendT = 0; // lobby : invités de l'hôte { conn, name, model, accent, trail, boom, motif, sticker }

const netMsg = t => $('netmsg').textContent = t;
function newPeer(id) {
  NET.peer?.destroy();
  NET.peer = new Peer(id, { debug: 0 });
  NET.peer.on('error', e => netMsg(ERRORS[e.type] || 'Connexion impossible'));
  return NET.peer;
}
function netClose() {
  NET.peer?.destroy();
  Object.assign(NET, { on: false, host: false, guest: false, peer: null, conn: null, snap: null, ev: [] });
  lobby = []; $('lobby').classList.add('hidden');
}
function showLobby(names, isHost) {
  $('lobby').classList.remove('hidden'); $('launch').classList.toggle('hidden', !isHost);
  $('players').replaceChildren(...names.map((n, i) => Object.assign(document.createElement('li'), { textContent: `${i % 2 ? '🟠' : '🔵'} ${n}` })));
  netMsg(isHost ? `${names.length} joueur(s) · donne le code à tes amis` : "Connecté ! En attente de l'hôte…");
}

// ----- Hôte -----
function hostGame() {
  const code = Array.from({ length: 5 }, () => 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'[Math.random() * 31 | 0]).join('');
  netMsg('Création de la partie…');
  const peer = newPeer(PREFIX + code);
  Object.assign(NET, { host: true, guest: false }); lobby = [];
  peer.on('open', () => { $('room').textContent = code; hostLobby(); });
  peer.on('connection', conn => {
    conn.on('data', d => hostData(conn, d));
    conn.on('close', () => hostDrop(conn));
  });
}
const lobbyNames = () => [GAR.name, ...lobby.map(p => p.name)];
function hostLobby() {
  showLobby(lobbyNames(), true);
  lobby.forEach(p => p.conn.open && p.conn.send({ t: 'lobby', names: lobbyNames() }));
}
function hostData(conn, d) {
  if (d.t === 'in') { const c = cars.find(c => c.conn === conn); if (c && !c.bot) Object.assign(c.in, d.i); }
  else if (d.t === 'hello' && !lobby.some(p => p.conn === conn)) {
    if (lobby.length >= 5 || S.phase !== 'menu') return conn.send({ t: 'full' });
    lobby.push({ conn, name: String(d.name || 'Invité').slice(0, 12), model: d.model, accent: d.accent, trail: d.trail, boom: d.boom, motif: d.motif, sticker: d.sticker });
    hostLobby();
  }
}
function hostDrop(conn) {
  lobby = lobby.filter(p => p.conn !== conn);
  const c = cars.find(c => c.conn === conn);
  if (c) { c.bot = true; c.conn = null; fx('msg', `${c.name} est parti`, 2, 'un bot le remplace'); }
  if (S.phase === 'menu') hostLobby();
}
function hostStart() { // équipes alternées, places libres complétées par des bots
  const humans = [{ ...GAR, me: true }, ...lobby.slice(0, S.mode * 2 - 1)], teams = [[], []], names = NAMES.slice().sort(() => Math.random() - .5);
  lobby.slice(S.mode * 2 - 1).forEach(p => p.conn.send({ t: 'full' }));
  humans.forEach((h, i) => teams[i % 2].push(h));
  teams.forEach((t, k) => { while (t.length < S.mode) t.push(botRoster(k, names.pop())); t.forEach(r => r.team = k); });
  const roster = [...teams[0], ...teams[1]], pub = roster.map(({ team, name, model, accent, trail, motif, sticker }) => ({ team, name, model, accent, trail, motif, sticker }));
  NET.on = true; NET.ev = [];
  start(roster.map(r => ({ ...r, bot: !r.me && !r.conn })));
  roster.forEach((r, i) => r.conn?.send({ t: 'start', mode: S.mode, roster: pub, you: i, theme: THEME })); // tout le monde joue dans l'ambiance de l'hôte
}
const r2 = x => Math.round(x * 100) / 100;
function sendSnap() {
  const d = {
    t: 's', ph: S.phase, sc: S.score, tm: r2(S.time), tr: r2(S.timer), ot: S.ot, bv: +B.mesh.visible, pd: pads.map(p => +(p.t > 0)).join(''), ev: NET.ev.splice(0), st: cars.map(c => c.st),
    b: [...B.p.toArray(), ...B.v.toArray()].map(r2),
    c: cars.map(c => [...c.p.toArray(), ...c.q.toArray(), ...c.v.toArray()].map(r2).concat(Math.round(c.boost), (c.dead > 0) | c.boosting << 1 | c.ground << 2)),
  };
  cars.forEach(c => c.conn?.open && c.conn.send(d));
}
function netHostFrame(dt) { if ((snapT += dt) >= 1 / 30) { snapT = 0; sendSnap(); } }

// ----- Invité -----
function joinGame(code) {
  code = code.trim().toUpperCase();
  if (!code) return netMsg('Entre le code de la partie');
  netMsg('Connexion…');
  const peer = newPeer();
  NET.code = code;
  Object.assign(NET, { host: false, guest: true });
  peer.on('open', () => {
    const conn = NET.conn = peer.connect(PREFIX + code, { reliable: true, serialization: 'json' });
    conn.on('open', () => conn.send({ t: 'hello', name: GAR.name, model: GAR.model, accent: GAR.accent, trail: GAR.trail, boom: GAR.boom, motif: GAR.motif, sticker: GAR.sticker }));
    conn.on('data', guestData);
    conn.on('close', () => {
      if (!NET.guest) return;
      quit(); overlay('Partie terminée', "L'hôte s'est déconnecté", 'OK', () => $('over').classList.add('hidden'));
    });
  });
}
function guestData(d) {
  if (d.t === 'full') { netClose(); netMsg('Partie pleine ou déjà lancée'); }
  else if (d.t === 'lobby') { $('room').textContent = NET.code; showLobby(d.names, false); }
  else if (d.t === 'start') { S.mode = d.mode; if (d.theme && d.theme !== THEME) applyTheme(d.theme); NET.on = true; NET.snap = null; start(d.roster.map((r, i) => ({ ...r, me: i === d.you }))); }
  else if (d.t === 's' && S.phase !== 'menu') applySnap(d);
}
function applySnap(d) {
  const prev = S.phase;
  Object.assign(S, { phase: d.ph, score: d.sc, time: d.tm, timer: d.tr, ot: d.ot });
  NET.snap = d; NET.age = 0;
  d.c.forEach((a, i) => { const c = cars[i]; if (c) Object.assign(c, { boost: a[10], dead: a[11] & 1, boosting: !!(a[11] & 2), ground: !!(a[11] & 4) }).v.fromArray(a, 7); });
  B.v.fromArray(d.b, 3); B.mesh.visible = !!d.bv;
  pads.forEach((p, i) => p.t = +d.pd[i]); d.st?.forEach((s, i) => cars[i] && (cars[i].st = s));
  d.ev.forEach(([n, ...a]) => Object.hasOwn(FX, n) && FX[n](...a));
  if (S.phase === prev) return;
  if (S.phase === 'goal') { REPLAY = REC.splice(0); Object.assign(S, { gs: Math.sign(B.p.z) || 1, shake: .8, slow: 1.6 }); }
  if (S.phase === 'replay') S.rt = 0;
  if (S.phase === 'end') showEnd();
}
function netGuestFrame(dt) { // rapproche l'affichage du dernier état reçu, et envoie nos commandes
  const d = NET.snap, k = 1 - Math.exp(-20 * dt), tgt = new V3();
  if (!d || !me) return;
  NET.age = Math.min(NET.age + dt, .15);
  d.c.forEach((a, i) => {
    const c = cars[i]; if (!c) return;
    tgt.fromArray(a).addScaledVector(c.v, NET.age);
    c.p.distanceTo(tgt) > 5 ? c.p.copy(tgt) : c.p.lerp(tgt, k);
    c.q.slerp(new Q().fromArray(a, 3).normalize(), k);
  });
  tgt.fromArray(d.b).addScaledVector(B.v, NET.age);
  B.p.distanceTo(tgt) > 5 ? B.p.copy(tgt) : B.p.lerp(tgt, k);
  playerInput(me);
  if ((sendT += dt) >= 1 / 60 && NET.conn?.open) { sendT = 0; NET.conn.send({ t: 'in', i: me.in }); }
}

// ----- Écran « En ligne » -----
const tryNet = f => {
  if (!window.Peer) return netMsg('Multijoueur indisponible ici : ouvre le jeu depuis le site');
  try { f(); } catch (e) { netMsg('Erreur : ' + e.message); }
};
$('onlineBtn').onclick = () => { $('menu').classList.add('hidden'); $('online').classList.remove('hidden'); $('pseudo').value = GAR.name; netMsg(''); };
$('back').onclick = () => { netClose(); $('online').classList.add('hidden'); $('menu').classList.remove('hidden'); };
$('pseudo').oninput = e => { GAR.name = e.target.value.trim().slice(0, 12) || 'Joueur'; save(); };
$('host').onclick = () => tryNet(hostGame);
$('join').onclick = () => tryNet(() => joinGame($('code').value));
$('code').onkeydown = e => e.key === 'Enter' && $('join').click();
$('launch').onclick = hostStart;
