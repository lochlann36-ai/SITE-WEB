'use strict';
// ===== Rocket Ball : commandes tactiles (joystick à gauche, boutons à droite) =====
const TOUCH = { x: 0, y: 0, jump: false, boost: false, drift: false };
if (TOUCH_DEV) document.body.classList.add('touch');

(() => {
  const stick = $('stick'), knob = $('knob');
  let id = null;
  const move = e => {
    if (e.pointerId !== id) return;
    const r = stick.getBoundingClientRect(), R = r.width / 2;
    let x = (e.clientX - r.left - R) / R, y = (e.clientY - r.top - R) / R;
    const m = Math.hypot(x, y); if (m > 1) { x /= m; y /= m; }
    TOUCH.x = x; TOUCH.y = y; knob.style.transform = `translate(${x * R * .6}px, ${y * R * .6}px)`;
  };
  const release = e => { if (e.pointerId !== id) return; id = null; TOUCH.x = TOUCH.y = 0; knob.style.transform = ''; };
  stick.addEventListener('pointerdown', e => { e.preventDefault(); id = e.pointerId; stick.setPointerCapture(id); move(e); });
  stick.addEventListener('pointermove', move);
  ['pointerup', 'pointercancel'].forEach(t => stick.addEventListener(t, release));

  [['tJump', 'jump'], ['tBoost', 'boost'], ['tDrift', 'drift']].forEach(([el, k]) => {
    const b = $(el), set = v => e => { e.preventDefault(); TOUCH[k] = v; b.classList.toggle('on', v); };
    b.addEventListener('pointerdown', set(true));
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(t => b.addEventListener(t, set(false)));
  });
  $('tCam').onclick = () => ballCam = !ballCam;
  $('tPause').onclick = pause;
})();
