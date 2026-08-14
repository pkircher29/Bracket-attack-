/* Junkyard Jukebox — guest request app + host player console */
'use strict';

const API = localStorage.getItem('jm-api') || '';   // same origin in production
const $ = (s, el = document) => el.querySelector(s);

const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function toast(msg, type = 'ok') {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.innerHTML = msg;
  $('#toasts').appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 400); }, 4500);
}

async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  const token = localStorage.getItem('jm-token');
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch(API + path, { ...opts, headers });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) { localStorage.removeItem('jm-token'); location.hash = '#/login'; }
  if (!res.ok) throw Object.assign(new Error(data.error || 'request failed'), { status: res.status, data });
  return data;
}

const loggedIn = () => !!localStorage.getItem('jm-token');
const myName = () => localStorage.getItem('jm-name') || '';

/* ---------- views ---------- */

let pollTimer = null;

function fmtDur(ms) {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function art(t, cls = '') {
  return t.art ? `<img src="${esc(t.art)}" alt="" loading="lazy">` : `<div class="noart ${cls}">🎵</div>`;
}

function trackMeta(t) {
  const artists = (t.artists || []).map(a => a.name).join(', ');
  return `${esc(artists)} · ${esc(t.album)}${t.year ? ` · ${esc(t.year)}` : ''}`;
}

function vLogin() {
  return `
  <div class="login">
    <div class="hero-stripe"></div>
    <h1>Junkyard <em>Jukebox</em></h1>
    <p class="muted">You pick it, we blast it. Fair rotation, no hogging the aux.</p>
    <input id="l-name" placeholder="Your name" maxlength="24" autocomplete="off">
    <input id="l-pass" type="password" placeholder="Party password" autocomplete="off">
    <button class="btn btn-accent btn-lg" data-action="join">🎶 Let me in</button>
    <p class="muted small">First time here? The host sets things up at <a href="#/setup" style="color:var(--accent)">setup</a>.</p>
  </div>`;
}

function vSearch() {
  return `
  <h2>Request a song</h2>
  <input id="q" placeholder="Search songs, artists, albums…" autocomplete="off">
  <div id="results" style="margin-top:14px"><div class="empty">Type to search Spotify. 🔍</div></div>`;
}

function trackRow(t, action) {
  const pop = Math.max(0, Math.min(100, t.popularity || 0));
  return `
  <div class="trackrow">
    ${art(t)}
    <div class="tinfo">
      <div class="tname">${esc(t.name)}</div>
      <div class="tmeta">${trackMeta(t)} · ${fmtDur(t.duration_ms)}</div>
      <div class="pop"><div class="popbar"><i style="width:${pop}%"></i></div><span class="muted small">${pop}</span></div>
    </div>
    ${action || ''}
  </div>`;
}

function vQueue(d) {
  const np = d.now_playing;
  const banned = d.me.banned_until;
  return `
  ${banned ? `<div class="banbox"><b>⛔ Cooling off.</b> You fired off too many requests — you're on a
     20-minute timeout and your spot moved to the back of the line.
     <span class="muted small">Back at ${new Date(banned).toLocaleTimeString()}.</span></div>` : ''}
  <h2>Now playing</h2>
  ${np ? `<div class="card nowplaying">
      ${art(np.track)}
      <div class="tinfo">
        <div class="tname">${esc(np.track.name)}</div>
        <div class="tmeta">${trackMeta(np.track)}</div>
        <div style="margin-top:6px">${np.source === 'auto'
          ? '<span class="chip chip-auto">🤖 autoplay</span>'
          : `<span class="chip chip-live"><span class="pulse"></span>requested by ${esc(np.user_name || '?')}</span>`}</div>
      </div>
    </div>`
    : `<div class="empty">Nothing spinning yet — <a href="#/search" style="color:var(--accent)">request something!</a></div>`}
  <h2>Up next <span class="muted small">(fair rotation — fewest plays goes first)</span></h2>
  ${d.up_next.length ? d.up_next.map(o => `
    <div class="trackrow ${o.mine ? 'mine' : ''}">
      <div class="tpos">${o.pos}</div>
      ${art(o.track)}
      <div class="tinfo">
        <div class="tname">${esc(o.track.name)}</div>
        <div class="tmeta">${trackMeta(o.track)} — <b>${esc(o.user_name)}</b></div>
      </div>
      ${o.mine ? `<button class="btn btn-ghost btn-sm" data-action="cancel" data-id="${o.id}">✕</button>` : ''}
    </div>`).join('')
    : `<div class="empty">Queue's empty — autoplay keeps the tunes going, but your pick beats the robot's. 🤖</div>`}
  <h2>Plays so far</h2>
  <div class="statchips">
    ${d.users.length ? d.users.map(u =>
      `<span class="pchip">${esc(u.name)} <b>${u.played}</b>${u.banned ? ' ⛔' : ''}</span>`).join('')
      : '<span class="muted small">No plays yet.</span>'}
  </div>`;
}

function vPlayer() {
  return `
  <h2>Host player console</h2>
  <div class="card playerbox" id="playerbox">
    <div class="muted">Checking Spotify link…</div>
  </div>
  <p class="muted small" style="margin-top:12px">This page plays the music — open it on the device wired to the
  speakers (Spotify Premium required). It auto-advances the queue and falls back to autoplay when empty.</p>`;
}

function vSetup(st) {
  return `
  <h2>Host setup</h2>
  <div class="card">
    <p class="muted small" style="margin-bottom:12px">
      Create a (free) Spotify app at <b>developer.spotify.com/dashboard</b>, add
      <b>${esc(st.redirect_uri)}</b> as a Redirect URI, then paste its credentials here.
      Web Playback SDK requires Spotify Premium on the host account.
    </p>
    ${st.configured ? `<label class="f">Current party password (to make changes)<input id="s-cur" type="password"></label>` : ''}
    <label class="f">Party password (what guests type to get in)<input id="s-pass" placeholder="e.g. scrapyard2026"></label>
    <label class="f">Spotify Client ID<input id="s-id" placeholder="${st.spotify ? 'saved ✓ (leave blank to keep)' : ''}"></label>
    <label class="f">Spotify Client Secret<input id="s-secret" type="password" placeholder="${st.spotify ? 'saved ✓ (leave blank to keep)' : ''}"></label>
    <button class="btn btn-accent" data-action="save-setup">Save</button>
    <p class="muted small" style="margin-top:10px">
      Status: password ${st.configured ? '✓' : '✗'} · Spotify app ${st.spotify ? '✓' : '✗'} ·
      host account ${st.linked ? 'linked ✓' : `not linked — <a href="${API}/spotify/login" style="color:var(--accent)">connect Spotify</a> (after saving)`}
    </p>
  </div>`;
}

/* ---------- router ---------- */

function nav() {
  const r = location.hash.replace(/^#\//, '') || 'search';
  $('#nav').innerHTML = loggedIn() ? `
    <a href="#/search" class="${r === 'search' ? 'on' : ''}">Search</a>
    <a href="#/queue" class="${r === 'queue' ? 'on' : ''}">Queue</a>
    <a href="#/player" class="${r === 'player' ? 'on' : ''}">Player</a>
    <a href="#/login" data-action="logout" title="${esc(myName())}">↩</a>` : '';
}

async function render() {
  clearInterval(pollTimer);
  const r = location.hash.replace(/^#\//, '') || (loggedIn() ? 'search' : 'login');
  nav();
  const app = $('#app');

  if (r === 'setup') {
    const st = await api('/api/status');
    app.innerHTML = vSetup(st);
    return;
  }
  if (!loggedIn() || r === 'login') { app.innerHTML = vLogin(); return; }

  if (r === 'queue') {
    const load = async () => {
      try { app.innerHTML = vQueue(await api('/api/queue')); } catch {}
    };
    await load();
    pollTimer = setInterval(load, 4000);
    return;
  }
  if (r === 'player') {
    app.innerHTML = vPlayer();
    Player.init();
    return;
  }
  app.innerHTML = vSearch();
  const q = $('#q');
  let t = null;
  q.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(doSearch, 400);
  });
  q.focus();
}

async function doSearch() {
  const q = $('#q');
  const box = $('#results');
  if (!q || q.value.trim().length < 2) { if (box) box.innerHTML = '<div class="empty">Type to search Spotify. 🔍</div>'; return; }
  try {
    const d = await api('/api/search?q=' + encodeURIComponent(q.value.trim()));
    box.innerHTML = d.tracks.length
      ? d.tracks.map((t, i) => trackRow(t, `<button class="btn btn-accent btn-sm" data-action="req" data-i="${i}">＋ Request</button>`)).join('')
      : '<div class="empty">No matches. Try another search.</div>';
    box.dataset.tracks = JSON.stringify(d.tracks);
  } catch (e) {
    box.innerHTML = `<div class="empty">Search failed: ${esc(e.message)}</div>`;
  }
}

/* ---------- host player ---------- */

const Player = (() => {
  let player = null, deviceId = null, current = null, advancing = false;

  function box() { return $('#playerbox'); }

  async function init() {
    try {
      const st = await api('/api/status');
      if (!st.spotify) { box().innerHTML = `<div>Spotify app not configured. <a class="btn btn-accent btn-sm" href="#/setup">Go to setup</a></div>`; return; }
      if (!st.linked) { box().innerHTML = `<div><a class="btn btn-accent" href="${API}/spotify/login">🔗 Connect host Spotify (Premium)</a></div>`; return; }
      await api('/api/spotify/token'); // verifies the link works
      loadSdk();
    } catch (e) {
      box().innerHTML = `<div class="muted">Player error: ${esc(e.message)}</div>`;
    }
  }

  function loadSdk() {
    if (window.Spotify) return onSdk();
    window.onSpotifyWebPlaybackSDKReady = onSdk;
    const s = document.createElement('script');
    s.src = 'https://sdk.scdn.co/spotify-player.js';
    document.head.appendChild(s);
    box().innerHTML = '<div class="muted">Loading Spotify player…</div>';
  }

  function onSdk() {
    player = new Spotify.Player({
      name: 'Junkyard Jukebox 📻',
      getOAuthToken: cb => api('/api/spotify/token').then(d => cb(d.access_token)).catch(() => {}),
      volume: 1,
    });
    player.addListener('ready', e => { deviceId = e.device_id; ui('Ready — hit Start to fire it up.'); });
    player.addListener('not_ready', () => ui('Device went offline.'));
    player.addListener('initialization_error', e => ui('Init error: ' + e.message));
    player.addListener('authentication_error', e => ui('Auth error: ' + e.message));
    player.addListener('account_error', () => ui('This Spotify account is not Premium — playback needs Premium.'));
    player.addListener('player_state_changed', st => {
      if (!st) return;
      if (current && st.paused && st.position === 0 &&
          st.track_window.previous_tracks.some(t => t.id === current.trackId)) {
        trackEnded();
      }
    });
    player.connect();
    ui('Connecting to Spotify…');
  }

  function ui(status) {
    const npHtml = current ? `
      <div class="nowplaying" style="text-align:left">
        ${art(current.track)}
        <div class="tinfo">
          <div class="tname">${esc(current.track.name)}</div>
          <div class="tmeta">${trackMeta(current.track)}</div>
          <div style="margin-top:6px">${current.source === 'auto'
            ? '<span class="chip chip-auto">🤖 autoplay</span>'
            : `<span class="chip chip-live"><span class="pulse"></span>${esc(current.userName || 'request')}</span>`}</div>
        </div>
      </div>` : '';
    box().innerHTML = `
      ${npHtml}
      <div class="muted small">${esc(status)}</div>
      <div class="controls">
        <button class="btn btn-accent" data-action="p-start">▶ ${current ? 'Next' : 'Start'}</button>
        <button class="btn btn-ghost" data-action="p-toggle">⏯ Pause/Resume</button>
        <button class="btn btn-ghost" data-action="p-skip">⏭ Skip</button>
      </div>`;
  }

  async function playNext() {
    if (advancing || !deviceId) return;
    advancing = true;
    try {
      const n = await api('/api/next');
      if (n.source === 'none') { ui('Queue empty and nothing played yet — get a request in to start the party.'); advancing = false; return; }
      const track = n.track;
      const tok = (await api('/api/spotify/token')).access_token;
      const res = await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`, {
        method: 'PUT',
        headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
        body: JSON.stringify({ uris: [track.uri] }),
      });
      if (!res.ok && res.status !== 204) throw new Error('Spotify play failed (' + res.status + ')');
      current = { track, trackId: track.id, source: n.source, userName: n.user_name };
      await api('/api/played', { method: 'POST', body: JSON.stringify(n.source === 'request' ? { request_id: n.request_id } : { track }) });
      ui('Playing.');
    } catch (e) {
      ui('Play error: ' + e.message);
    }
    advancing = false;
  }

  function trackEnded() {
    current = null;
    playNext();
  }

  return {
    init, playNext,
    toggle: () => player && player.togglePlay(),
    skip: () => { playNext(); },
  };
})();

/* ---------- actions ---------- */

document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const act = el.dataset.action;
  try {
    if (act === 'join') {
      const name = $('#l-name').value.trim();
      const pass = $('#l-pass').value;
      const d = await api('/api/join', { method: 'POST', body: JSON.stringify({ name, password: pass }) });
      localStorage.setItem('jm-token', d.token);
      localStorage.setItem('jm-name', d.user.name);
      toast(`Welcome, <b>${esc(d.user.name)}</b>! 🎶`);
      location.hash = '#/search';
    }
    if (act === 'logout') { localStorage.removeItem('jm-token'); }
    if (act === 'req') {
      const tracks = JSON.parse($('#results').dataset.tracks || '[]');
      const t = tracks[Number(el.dataset.i)];
      if (!t) return;
      el.disabled = true;
      const d = await api('/api/request', { method: 'POST', body: JSON.stringify({ track: t }) });
      toast(`Queued <b>${esc(t.name)}</b> — position ${d.position} in the rotation. 🎶`);
    }
    if (act === 'cancel') {
      await api('/api/request/' + el.dataset.id, { method: 'DELETE' });
      toast('Request cancelled.');
      render();
    }
    if (act === 'save-setup') {
      const body = {
        current_password: $('#s-cur') ? $('#s-cur').value : '',
        shared_password: $('#s-pass').value,
        spotify_client_id: $('#s-id').value,
        spotify_client_secret: $('#s-secret').value,
      };
      await api('/api/setup', { method: 'POST', body: JSON.stringify(body) });
      toast('Saved. ✓');
      render();
    }
    if (act === 'p-start') Player.playNext();
    if (act === 'p-toggle') Player.toggle();
    if (act === 'p-skip') Player.skip();
  } catch (err) {
    if (err.status === 429 && err.data && err.data.banned_until) {
      toast(`⛔ ${esc(err.message)}<br><span class="small">You can request again at ${new Date(err.data.banned_until).toLocaleTimeString()}.</span>`, 'error');
      if (location.hash.includes('queue')) render();
    } else {
      toast(esc(err.message), 'error');
    }
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && $('#l-pass') && document.activeElement === $('#l-pass')) {
    const btn = $('[data-action="join"]');
    if (btn) btn.click();
  }
});

addEventListener('hashchange', render);
render();
