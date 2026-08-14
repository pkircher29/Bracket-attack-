/* Bracket Attack — state & persistence */
'use strict';

const Store = (() => {
  const KEY = 'bracket-attack-v1';

  let state = load() || { players: [], staticTeams: [], tournaments: [] };

  function load() {
    try { return JSON.parse(localStorage.getItem(KEY)); }
    catch { return null; }
  }

  function save() {
    localStorage.setItem(KEY, JSON.stringify(state));
  }

  /* ---------- players ---------- */

  function addPlayers(names) {
    const existing = new Set(state.players.map(p => p.name.toLowerCase()));
    let added = 0;
    for (const raw of names) {
      const name = raw.trim();
      if (!name || existing.has(name.toLowerCase())) continue;
      state.players.push({ id: uid('p'), name });
      existing.add(name.toLowerCase());
      added++;
    }
    save();
    return added;
  }

  function removePlayer(id) {
    state.players = state.players.filter(p => p.id !== id);
    state.staticTeams.forEach(t => t.playerIds = t.playerIds.filter(pid => pid !== id));
    state.staticTeams = state.staticTeams.filter(t => t.playerIds.length > 0);
    save();
  }

  function playerName(id) {
    const p = state.players.find(p => p.id === id);
    if (p) return p.name;
    // fall back to a name snapshotted on a tournament roster
    for (const t of state.tournaments) {
      for (const team of t.teams) {
        const hit = (team.roster || []).find(r => r.id === id);
        if (hit) return hit.name;
      }
    }
    return '(removed)';
  }

  /* ---------- static teams ---------- */

  function addStaticTeam(name, playerIds) {
    state.staticTeams.push({ id: uid('st'), name, playerIds: [...playerIds] });
    save();
  }

  function removeStaticTeam(id) {
    state.staticTeams = state.staticTeams.filter(t => t.id !== id);
    save();
  }

  /* ---------- tournaments ---------- */

  function tournament(id) {
    return state.tournaments.find(t => t.id === id);
  }

  function removeTournament(id) {
    state.tournaments = state.tournaments.filter(t => t.id !== id);
    save();
  }

  function teamOf(t, teamId) {
    return t.teams.find(x => x.id === teamId) || null;
  }

  function teamName(t, teamId) {
    const team = teamOf(t, teamId);
    return team ? team.name : 'TBD';
  }

  /* ---------- who is playing right now? ---------- */

  // Map of playerId -> { tournament, match } for every player in a live match.
  function busyPlayers() {
    const map = new Map();
    for (const t of state.tournaments) {
      if (t.status !== 'active') continue;
      for (const m of t.matches) {
        if (m.status !== 'live') continue;
        for (const side of ['teamA', 'teamB']) {
          const team = teamOf(t, m[side]);
          if (!team) continue;
          for (const pid of team.playerIds) map.set(pid, { tournament: t, match: m });
        }
      }
    }
    return map;
  }

  /* ---------- tournament-of-tournaments leaderboard ----------
     1st place team: 4 pts per player · 2nd: 3 · 3rd: 2 · everyone else: 1 */

  function leaderboard() {
    const rows = new Map();
    const row = (pid) => {
      if (!rows.has(pid)) {
        rows.set(pid, { id: pid, name: playerName(pid), points: 0, played: 0, wins: 0, podiums: 0 });
      }
      return rows.get(pid);
    };
    for (const t of state.tournaments) {
      if (t.status !== 'complete') continue;
      const podium = [t.placements.first, t.placements.second, t.placements.third];
      for (const team of t.teams) {
        const place = podium.indexOf(team.id);
        const pts = place === 0 ? 4 : place === 1 ? 3 : place === 2 ? 2 : 1;
        for (const pid of team.playerIds) {
          const r = row(pid);
          r.points += pts;
          r.played += 1;
          if (place === 0) r.wins += 1;
          if (place >= 0 && place <= 2) r.podiums += 1;
        }
      }
    }
    return [...rows.values()].sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
  }

  /* ---------- import / export ---------- */

  function exportJSON() {
    return JSON.stringify(state, null, 2);
  }

  function importJSON(json) {
    const data = JSON.parse(json);
    if (!data || !Array.isArray(data.players) || !Array.isArray(data.tournaments)) {
      throw new Error('Not a Bracket Attack backup file.');
    }
    data.staticTeams = data.staticTeams || [];
    state = data;
    save();
  }

  function resetAll() {
    state = { players: [], staticTeams: [], tournaments: [] };
    save();
  }

  return {
    get state() { return state; },
    save, addPlayers, removePlayer, playerName,
    addStaticTeam, removeStaticTeam,
    tournament, removeTournament, teamOf, teamName,
    busyPlayers, leaderboard,
    exportJSON, importJSON, resetAll,
  };
})();
