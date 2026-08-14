/* Bracket Attack — shared utilities */
'use strict';

const $  = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function uid(prefix = 'id') {
  return prefix + '_' + Math.random().toString(36).slice(2, 10);
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/* ---------- game presets ---------- */

const GAME_PRESETS = [
  { name: 'Cornhole',    icon: '🌽', target: 21,  winBy: 0, notes: 'Cancellation scoring. Bag in the hole = 3, on the board = 1.' },
  { name: 'Horseshoes',  icon: '🐴', target: 21,  winBy: 0, notes: 'Ringer = 3, leaner = 2, closest within a shoe = 1.' },
  { name: 'Ladder Golf', icon: '🪜', target: 21,  winBy: 0, notes: 'Top rung = 3, middle = 2, bottom = 1. Exact 21 to win.' },
  { name: 'Darts',       icon: '🎯', target: 301, winBy: 0, notes: 'Count down from 301. First to exactly zero wins.' },
  { name: 'Custom',      icon: '🏅', target: 11,  winBy: 0, notes: '' },
];

/* ---------- fun random team names ---------- */

const TEAM_ADJ = ['Blazing', 'Turbo', 'Mighty', 'Savage', 'Golden', 'Rowdy', 'Cosmic',
  'Thundering', 'Slick', 'Iron', 'Wild', 'Electric', "Smokin'", 'Fearless', 'Lucky',
  'Rustic', 'Flying', 'Raging', 'Sneaky', 'Grumpy'];
const TEAM_NOUN = ['Baggers', 'Broncos', 'Hurlers', 'Legends', 'Mavericks', 'Outlaws',
  'Renegades', 'Rockets', 'Slingers', 'Tossers', 'Titans', 'Vipers', 'Wranglers',
  'Aces', 'Bandits', 'Chuckers', 'Hawks', 'Nomads', 'Pirates', 'Wizards'];

function randomTeamName(used = new Set()) {
  for (let i = 0; i < 60; i++) {
    const n = TEAM_ADJ[Math.floor(Math.random() * TEAM_ADJ.length)] + ' ' +
              TEAM_NOUN[Math.floor(Math.random() * TEAM_NOUN.length)];
    if (!used.has(n)) { used.add(n); return n; }
  }
  return 'Team ' + uid('').slice(1, 5).toUpperCase();
}

/* ---------- toasts ---------- */

function toast(msg, type = 'info') {
  const box = $('#toasts');
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.innerHTML = msg;
  box.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 400);
  }, 4500);
}

/* ---------- confetti ---------- */

const Confetti = (() => {
  const canvas = () => $('#confetti');
  let parts = [], raf = null;
  const COLORS = ['#ff7a18', '#ff2d78', '#ffd166', '#06d6a0', '#4cc9f0', '#c77dff'];

  function resize() {
    const c = canvas();
    c.width = innerWidth;
    c.height = innerHeight;
  }

  function tick() {
    const c = canvas(), ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
    parts = parts.filter(p => p.y < c.height + 30 && p.life > 0);
    for (const p of parts) {
      p.x += p.vx; p.y += p.vy; p.vy += 0.12; p.rot += p.vr; p.life--;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.s / 2, -p.s / 2, p.s, p.s * 0.6);
      ctx.restore();
    }
    if (parts.length) raf = requestAnimationFrame(tick);
    else { raf = null; ctx.clearRect(0, 0, c.width, c.height); }
  }

  function burst(n = 160) {
    resize();
    const c = canvas();
    for (let i = 0; i < n; i++) {
      parts.push({
        x: c.width / 2 + (Math.random() - 0.5) * c.width * 0.5,
        y: c.height * 0.25,
        vx: (Math.random() - 0.5) * 12,
        vy: -Math.random() * 9 - 2,
        s: 6 + Math.random() * 8,
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.3,
        life: 220,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
      });
    }
    if (!raf) raf = requestAnimationFrame(tick);
  }

  addEventListener('resize', resize);
  return { burst };
})();
