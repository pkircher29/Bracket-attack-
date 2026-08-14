/* Bracket Attack — single-elimination bracket engine
   with a 3rd-place match and same-leg dynamic substitution. */
'use strict';

const Bracket = (() => {

  const now = () => new Date().toISOString();

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
      updatedAt: new Date().toISOString(),
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
          updatedAt: now(),
        });
      }
    }
    if (R >= 2) {
      matches.push({
        id: 'third', round: R, idx: 99,
        teamA: null, teamB: null, scoreA: 0, scoreB: 0,
        status: 'pending', winner: null, bye: false,
        isFinal: false, isThird: true, skipped: false,
        updatedAt: now(),
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
      next.updatedAt = now();
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
    third.updatedAt = now();
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
      mm.updatedAt = now();
    }
    m.status = 'live';
    m.startedAt = new Date().toISOString();
    m.updatedAt = now();
    t.updatedAt = now();
    Store.save();
  }

  /* ---------- finishing ---------- */

  function finishMatch(t, m, winnerId) {
    m.status = 'done';
    m.winner = winnerId;
    m.endedAt = new Date().toISOString();
    m.updatedAt = now();
    feedWinner(t, m);
    checkComplete(t);
    t.updatedAt = now();
    Store.save();
  }

  // Record score taps with a timestamp so per-match merge works.
  function touchMatch(t, m) {
    m.updatedAt = now();
    t.updatedAt = now();
  }

  /* ---------- host/admin operations ----------
     Each returns null on success or an error string. */

  // Reopen a finished match to fix a score. Blocked if the teams involved
  // already played later matches (reopen those first, newest to oldest).
  function reopenMatch(t, m) {
    if (m.bye || m.status !== 'done') return 'Only finished matches can be reopened.';
    const w = m.winner, l = loserOf(m);
    const downstream = t.matches.filter(x => x.id !== m.id && (x.isThird || x.round > m.round) &&
      ((w && (x.teamA === w || x.teamB === w)) || (l && (x.teamA === l || x.teamB === l))));
    if (downstream.some(x => x.status !== 'pending')) {
      return 'Later matches involving these teams were already played — reopen those first.';
    }
    for (const x of downstream) {
      if (x.teamA === w || x.teamA === l) x.teamA = null;
      if (x.teamB === w || x.teamB === l) x.teamB = null;
      x.updatedAt = now();
    }
    const third = t.matches.find(x => x.isThird);
    if (third && third.skipped && m.round === t.rounds - 1) {
      Object.assign(third, { teamA: null, teamB: null, scoreA: 0, scoreB: 0,
        status: 'pending', winner: null, skipped: false, updatedAt: now() });
    }
    m.status = 'live'; m.winner = null; m.endedAt = null; m.updatedAt = now();
    if (t.status === 'complete') { t.status = 'active'; t.placements = { first: null, second: null, third: null }; }
    t.updatedAt = now();
    Store.save();
    return null;
  }

  // Fresh bracket, same teams, reshuffled draw.
  function restart(t) {
    buildMatches(t);
    t.status = 'active';
    t.placements = { first: null, second: null, third: null };
    t.updatedAt = now();
    Store.save();
  }

  // Swap two teams between their current (not-yet-started) bracket slots.
  function swapSlots(t, idA, idB) {
    if (!idA || !idB || idA === idB) return 'Pick two different teams.';
    const map = new Map();
    for (const m of t.matches) {
      if (m.status !== 'pending') continue;
      if (m.teamA) map.set(m.teamA, { m, side: 'teamA' });
      if (m.teamB) map.set(m.teamB, { m, side: 'teamB' });
    }
    const a = map.get(idA), b = map.get(idB);
    if (!a || !b) return 'Both teams must be waiting in matches that have not started.';
    a.m[a.side] = idB;
    b.m[b.side] = idA;
    a.m.updatedAt = now(); b.m.updatedAt = now(); t.updatedAt = now();
    Store.save();
    return null;
  }

  // Swap two players between teams, or sub in a pool player for a rostered one.
  function movePlayer(t, pidA, pidB) {
    if (!pidA || !pidB || pidA === pidB) return 'Pick two different players.';
    const teamOfP = (pid) => t.teams.find(tm => tm.playerIds.includes(pid));
    const ta = teamOfP(pidA);
    if (!ta) return 'The first pick must be a player currently on a team.';
    const tb = teamOfP(pidB);
    const ia = ta.playerIds.indexOf(pidA);
    if (tb) {
      const ib = tb.playerIds.indexOf(pidB);
      ta.playerIds[ia] = pidB;
      tb.playerIds[ib] = pidA;
      tb.roster = tb.playerIds.map(pid => ({ id: pid, name: Store.playerName(pid) }));
    } else {
      ta.playerIds[ia] = pidB;
    }
    ta.roster = ta.playerIds.map(pid => ({ id: pid, name: Store.playerName(pid) }));
    t.updatedAt = now();
    Store.save();
    return null;
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

  /* ---------- sync support ----------
     Merge two replicas of the same tournament: newest metadata wins,
     matches merge individually by updatedAt, then the bracket is
     reconciled so winners from one device feed matches on another. */

  function mergeTournaments(local, remote) {
    const base = ((remote.updatedAt || '') > (local.updatedAt || '')) ? remote : local;
    const other = base === local ? remote : local;
    const t = JSON.parse(JSON.stringify(base));
    const otherById = new Map((other.matches || []).map(m => [m.id, m]));
    t.matches = t.matches.map(m => {
      const o = otherById.get(m.id);
      return (o && (o.updatedAt || '') > (m.updatedAt || ''))
        ? JSON.parse(JSON.stringify(o)) : m;
    });
    reconcile(t);
    return t;
  }

  /* Re-derive cross-match state after a merge. Only fills empty slots —
     never overwrites — so substitution swaps survive. */
  function reconcile(t) {
    for (const m of t.matches) {
      if (m.isThird || m.isFinal || m.status !== 'done' || !m.winner) continue;
      const next = t.matches.find(x =>
        !x.isThird && x.round === m.round + 1 && x.idx === (m.idx >> 1));
      if (next && next.status === 'pending') {
        const side = m.idx % 2 === 0 ? 'teamA' : 'teamB';
        if (!next[side]) next[side] = m.winner;
      }
    }
    if (t.rounds >= 2) {
      const third = t.matches.find(x => x.isThird);
      if (third && third.status === 'pending' && !third.teamA && !third.teamB) {
        maybeSetupThird(t);
      }
    }
    if (t.status !== 'complete') checkComplete(t);
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

  return { createTournament, isReady, planStart, applyStart, finishMatch, touchMatch,
           reopenMatch, restart, swapSlots, movePlayer,
           mergeTournaments, reconcile, progress, roundName, loserOf };
})();
