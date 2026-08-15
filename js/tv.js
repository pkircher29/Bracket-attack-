/* Junkyard Olympics Yard TV — read-only public carousel backed by the shared live room. */
'use strict';

const YardTV = (() => {
  const $ = (selector) => document.querySelector(selector);
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const panels = [...document.querySelectorAll('.tv-panel')];
  let index = 0;
  let seconds = 14;
  let paused = false;

  function room() {
    return (localStorage.getItem('ba-room') || 'junkyard').toLowerCase().replace(/[^a-z0-9_-]/g, '-').slice(0, 40) || 'junkyard';
  }

  function apiBase() {
    const sameOrigin = /(^|\.)junkyardolympics\.com$|\.workers\.dev$/i.test(location.hostname);
    return localStorage.getItem('ba-sync-url') || (sameOrigin ? '' : 'https://bracket-attack-sync.pkircher.workers.dev');
  }

  function teamName(tournament, id) {
    return tournament?.teams?.find((team) => team.id === id)?.name || 'TBD';
  }

  function progress(tournament) {
    const playable = (tournament.matches || []).filter((match) => !match.bye && !match.skipped);
    return { done: playable.filter((match) => match.status === 'done').length, total: playable.length };
  }

  function leaderBoard(state) {
    const rows = new Map();
    const playerName = (id) => state.players?.find((player) => player.id === id)?.name || '(removed)';
    for (const tournament of state.tournaments || []) {
      if (tournament.status !== 'complete') continue;
      const podium = [tournament.placements?.first, tournament.placements?.second, tournament.placements?.third];
      for (const team of tournament.teams || []) {
        const place = podium.indexOf(team.id);
        const points = place === 0 ? 4 : place === 1 ? 3 : place === 2 ? 2 : 1;
        for (const id of team.playerIds || []) {
          const current = rows.get(id) || { name: playerName(id), points: 0, events: 0, wins: 0 };
          current.points += points;
          current.events += 1;
          if (place === 0) current.wins += 1;
          rows.set(id, current);
        }
      }
    }
    return [...rows.values()].sort((a, b) => b.points - a.points || b.wins - a.wins || a.name.localeCompare(b.name));
  }

  function currentMatches(state) {
    const live = [];
    const upcoming = [];
    for (const tournament of state.tournaments || []) {
      for (const match of tournament.matches || []) {
        if (!match.teamA || !match.teamB || match.status === 'done') continue;
        const entry = { tournament, match };
        if (match.status === 'live') live.push(entry); else upcoming.push(entry);
      }
    }
    return { live, upcoming };
  }

  function matchCard(entry) {
    if (!entry) return '<div class="tv-empty"><b>The yard is between matches.</b><span>Check the event board for the next official call.</span></div>';
    const { tournament, match } = entry;
    return `<div class="tv-versus"><div><b>${esc(teamName(tournament, match.teamA))}</b><span>${esc(tournament.game)}</span></div><em>${match.status === 'live' ? `${match.scoreA} <i>:</i> ${match.scoreB}` : 'VS'}</em><div><b>${esc(teamName(tournament, match.teamB))}</b><span>${esc(tournament.name)}</span></div></div>`;
  }

  function row(rank, title, detail, trailing = '') {
    return `<article class="tv-row"><strong>${rank}</strong><div><b>${esc(title)}</b><span>${esc(detail)}</span></div><em>${trailing}</em></article>`;
  }

  function render(state) {
    const { live, upcoming } = currentMatches(state);
    const firstLive = live[0];
    $('#now-heading').textContent = firstLive ? `${firstLive.tournament.name} is live` : 'No match is on the clock';
    $('#now-card').innerHTML = matchCard(firstLive);

    const next = [...live.slice(1), ...upcoming].slice(0, 7);
    $('#deck-list').innerHTML = next.length
      ? next.map((entry, i) => row(i + 1, `${teamName(entry.tournament, entry.match.teamA)} vs ${teamName(entry.tournament, entry.match.teamB)}`, `${entry.tournament.name} · ${entry.tournament.game}`, entry.match.status === 'live' ? 'LIVE' : 'ON DECK')).join('')
      : '<div class="tv-empty"><b>No matches are queued yet.</b><span>Hosts will light up the board when the next bracket begins.</span></div>';

    const events = state.tournaments || [];
    $('#event-grid').innerHTML = events.length ? events.map((event) => {
      const p = progress(event);
      const liveMatch = event.matches?.find((match) => match.status === 'live');
      const label = event.status === 'complete' ? `🏁 ${teamName(event, event.placements?.first)} won` : liveMatch ? `🔴 ${teamName(event, liveMatch.teamA)} vs ${teamName(event, liveMatch.teamB)}` : `${p.done}/${p.total} matches complete`;
      return `<article class="event-card"><span>${esc(event.icon || '⚙️')} ${esc(event.game || 'Event')}</span><h2>${esc(event.name)}</h2><p>${esc(label)}</p><div class="tv-progress"><i style="width:${p.total ? Math.round((p.done / p.total) * 100) : 0}%"></i></div></article>`;
    }).join('') : '<div class="tv-empty"><b>The event board is waiting.</b><span>New tournaments will appear here automatically.</span></div>';

    const leaders = leaderBoard(state).slice(0, 10);
    const medals = ['🥇', '🥈', '🥉'];
    $('#standings-list').innerHTML = leaders.length
      ? leaders.map((leader, i) => row(medals[i] || i + 1, leader.name, `${leader.events} completed event${leader.events === 1 ? '' : 's'} · ${leader.wins} win${leader.wins === 1 ? '' : 's'}`, `${leader.points} PTS`)).join('')
      : '<div class="tv-empty"><b>Standings unlock after the first event.</b><span>First = 4 · second = 3 · third = 2 · everybody scores a point.</span></div>';

    const teams = [];
    for (const tournament of events) {
      for (const team of tournament.teams || []) {
        const names = (team.roster || []).map((player) => player.name).join(' · ') || (team.playerIds || []).map((id) => state.players?.find((player) => player.id === id)?.name).filter(Boolean).join(' · ');
        teams.push({ name: team.name, detail: `${tournament.game || tournament.name} · ${names || 'competitors pending'}` });
      }
    }
    const seen = new Set();
    const uniqueTeams = teams.filter((team) => !seen.has(`${team.name}|${team.detail}`) && seen.add(`${team.name}|${team.detail}`)).slice(0, 12);
    $('#roster-list').innerHTML = uniqueTeams.length
      ? uniqueTeams.map((team, i) => row(i + 1, team.name, team.detail, 'READY')).join('')
      : '<div class="tv-empty"><b>No teams are locked in yet.</b><span>Competitor names will appear as events are created.</span></div>';
  }

  function setPanel(next) {
    index = (next + panels.length) % panels.length;
    panels.forEach((panel, i) => panel.classList.toggle('active', i === index));
    [...document.querySelectorAll('#panel-dots button')].forEach((dot, i) => dot.classList.toggle('active', i === index));
    seconds = 14;
    $('#next-in').textContent = seconds;
  }

  function clock() {
    $('#tv-clock').textContent = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' }).format(new Date());
  }

  async function refresh() {
    try {
      const response = await fetch(`${apiBase()}/r/${encodeURIComponent(room())}?since=-1`, { cache: 'no-store' });
      if (!response.ok) throw new Error('room fetch failed');
      const payload = await response.json();
      render(payload.state || { players: [], tournaments: [] });
      $('#connection-status').textContent = payload.state ? 'LIVE DATA' : 'WAITING FOR EVENT DATA';
      $('#connection-status').classList.remove('offline');
    } catch {
      $('#connection-status').textContent = 'RECONNECTING';
      $('#connection-status').classList.add('offline');
    }
  }

  function init() {
    $('#room-name').textContent = room().toUpperCase();
    $('#panel-dots').innerHTML = panels.map((panel, i) => `<button aria-label="Show ${esc(panel.dataset.panel)}" class="${i === 0 ? 'active' : ''}"></button>`).join('');
    [...document.querySelectorAll('#panel-dots button')].forEach((dot, i) => dot.addEventListener('click', () => setPanel(i)));
    document.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowRight' || event.key === 'Enter') setPanel(index + 1);
      if (event.key === 'ArrowLeft') setPanel(index - 1);
      if (event.key.toLowerCase() === 'f') document.documentElement.requestFullscreen?.();
      if (event.code === 'Space') { event.preventDefault(); paused = !paused; }
    });
    setInterval(() => {
      clock();
      if (!paused && --seconds <= 0) setPanel(index + 1);
      $('#next-in').textContent = seconds;
    }, 1000);
    clock();
    refresh();
    setInterval(refresh, 3000);
  }

  init();
})();
