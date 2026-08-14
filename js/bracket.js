/* Bracket Attack — single-elimination bracket engine
   with a 3rd-place match and same-leg dynamic substitution. */
'use strict';

const Bracket = (() => {

  function nextPow2(n) {
    let p = 1;
    while (p < n) p *= 2;
    return p;
  }

  /* Create a tournament. `teams` = [{name, playerIds, kind: 'static'|'random'}] */
  function createTournament({ name, game, icon, rules, teamSize, teams }) {
    const t = {
      id: uid('t'),
      name, game, icon,
      rules: {
        target: Math.max(1, Number(rules.target) || 21),
        winBy: Math.max(0, Number(rules.winBy) || 0),
        notes: rules.notes || '',
      },
      teamSize,
      status: 'active',
      createdAt: new Date().toISOString(),
      teams: teams.map(team => ({
        id: uid('tm'),
        name: team.name,
        kind: team.kind,
        playerIds: [...team.playerIds],
        roster: team.playerIds.map(pid => ({ id: pid, name: Store.playerName(pid) })),
      })),
      matches: [],
      rounds: 0,
      placements: { first: null, second: null, third: null },
    };
    buildMatches(t);
    Store.state.tournaments.unshift(t);
    Store.save();
    return t;
  }

  function buildMatches(t) {
    const ids = shuffle(t.teams.map(x => x.id));
    const N = ids.length;
    const P = Math.max(2, nextPow2(N));
    const R = Math.round(Math.log2(P));
    const byes = P - N;

    // Round 1 pairs — byes spread across the first `byes` pairs.
    const pairs = [];
    let ti = 0;
    for (let i = 0; i < P / 2; i++) {
      if (i < byes) pairs.push([ids[ti++] ?? null, null]);
      else pairs.push([ids[ti++] ?? null, ids[ti++] ?? null]);
    }

    const matches = [];
    for (let r = 1; r <= R; r++) {
      const count = P / Math.pow(2, r);
      for (let i = 0; i < count; i++) {
        matches.push({
          id: `r${r}m${i}`,
          round: r, idx: i,
          teamA: r === 1 ? pairs[i][0] : null,
          teamB: r === 1 ? pairs[i][1] : null,
          scoreA: 0, scoreB: 0,
          status: 'pending',     // pending -> live -> done
          winner: null,
          bye: false,
          isFinal: r === R && i === 0,
          isThird: false,
        });
      }
    }
    if (R >= 2) {
      matches.push({
        id: 'third', round: R, idx: 99,
        teamA: null, teamB: null, scoreA: 0, scoreB: 0,
        status: 'pending', winner: null, bye: false,
        isFinal: false, isThird: true, skipped: false,
      });
    }
    t.matches = matches;
    t.rounds = R;

    // Auto-advance byes in round 1.
    for (const m of matches.filter(m => m.round === 1 && !m.isThird)) {
      if (m.teamA && !m.teamB) {
        m.winner = m.teamA; m.status = 'done'; m.bye = true;
        feedWinner(t, m);
      }
    }
  }

  function loserOf(m) {
    if (!m.winner) return null;
    const other = m.winner === m.teamA ? m.teamB : m.teamA;
    return other || null;
  }

  function feedWinner(t, m) {
    if (m.isThird || m.isFinal) return;
    const next = t.matches.find(x =>
      !x.isThird && x.round === m.round + 1 && x.idx === (m.idx >> 1));
    if (next) {
      if (m.idx % 2 === 0) next.teamA = m.winner;
      else next.teamB = m.winner;
    }
    if (t.rounds >= 2 && m.round === t.rounds - 1) maybeSetupThird(t);
  }

  // Once both semifinals finish, populate (or short-circuit) the 3rd-place match.
  function maybeSetupThird(t) {
    const semis = t.matches.filter(x => !x.isThird && x.round === t.rounds - 1);
    if (!semis.every(s => s.status === 'done')) return;
    const third = t.matches.find(x => x.isThird);
    if (!third || third.status === 'done') return;
    const losers = semis.map(loserOf).filter(Boolean);
    if (losers.length === 2) {
      third.teamA = losers[0];
      third.teamB = losers[1];
    } else {
      // 0 or 1 real losers (bye semifinal) — nothing to play for.
      third.winner = losers[0] || null;
      third.status = 'done';
      third.skipped = true;
    }
  }

  function isReady(m) {
    return m.status === 'pending' && m.teamA && m.teamB;
  }

  /* ---------- dynamic same-leg substitution ----------
     If a team about to start has players who are mid-match in ANY tournament,
     swap that team with a fully-free team from another not-yet-started match
     on the same round ("equal leg") of this bracket. */

  function planStart(t, m) {
    const busy = Store.busyPlayers();
    const swaps = [];
    const stuck = [];
    const claimed = new Set([m.teamA, m.teamB]);

    for (const side of ['teamA', 'teamB']) {
      const team = Store.teamOf(t, m[side]);
      if (!team) continue;
      const busyMembers = team.playerIds.filter(pid => busy.has(pid));
      if (!busyMembers.length) continue;

      const cand = findSwap(t, m, busy, claimed);
      const where = busy.get(busyMembers[0]).tournament.name;
      if (cand) {
        claimed.add(cand.teamId);
        swaps.push({
          mSide: side,
          matchId: cand.matchId,
          side: cand.side,
          inId: cand.teamId,
          outId: m[side],
          note: `⚡ <b>${esc(team.name)}</b> is mid-game in <b>${esc(where)}</b> — ` +
                `<b>${esc(Store.teamName(t, cand.teamId))}</b> subbed onto this leg.`,
        });
      } else {
        stuck.push({
          team,
          names: busyMembers.map(Store.playerName).join(', '),
          where,
        });
      }
    }
    return { swaps, stuck };
  }

  function findSwap(t, m, busy, claimed) {
    for (const mm of t.matches) {
      if (mm.id === m.id || mm.status !== 'pending') continue;
      if (mm.round !== m.round || mm.isThird !== m.isThird) continue;
      for (const side of ['teamA', 'teamB']) {
        const id = mm[side];
        if (!id || claimed.has(id)) continue;
        const team = Store.teamOf(t, id);
        if (team && team.playerIds.every(pid => !busy.has(pid))) {
          return { matchId: mm.id, side, teamId: id };
        }
      }
    }
    return null;
  }

  function applyStart(t, m, plan) {
    for (const s of plan.swaps) {
      const mm = t.matches.find(x => x.id === s.matchId);
      mm[s.side] = s.outId;
      m[s.mSide] = s.inId;
    }
    m.status = 'live';
    m.startedAt = new Date().toISOString();
    Store.save();
  }

  /* ---------- finishing ---------- */

  function finishMatch(t, m, winnerId) {
    m.status = 'done';
    m.winner = winnerId;
    m.endedAt = new Date().toISOString();
    feedWinner(t, m);
    checkComplete(t);
    Store.save();
  }

  function checkComplete(t) {
    const final = t.matches.find(x => x.isFinal);
    const third = t.matches.find(x => x.isThird);
    if (!final || final.status !== 'done') return;
    if (third && third.status !== 'done') return;
    t.status = 'complete';
    t.completedAt = new Date().toISOString();
    t.placements = {
      first: final.winner,
      second: loserOf(final),
      third: third ? third.winner : null,
    };
  }

  function progress(t) {
    const real = t.matches.filter(m => !m.bye && !m.skipped);
    const done = real.filter(m => m.status === 'done').length;
    return { done, total: real.length };
  }

  function roundName(t, r) {
    if (r === t.rounds) return 'Final';
    if (r === t.rounds - 1) return 'Semifinals';
    if (r === t.rounds - 2) return 'Quarterfinals';
    return `Round ${r}`;
  }

  return { createTournament, isReady, planStart, applyStart, finishMatch, progress, roundName, loserOf };
})();
