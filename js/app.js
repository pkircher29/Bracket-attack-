/* Bracket Attack — router & actions */
'use strict';

(() => {
  let route = { name: 'home' };

  function parseHash() {
    const h = location.hash.replace(/^#\/?/, '');
    const parts = h.split('/').filter(Boolean);
    if (!parts.length) return { name: 'home' };
    if (parts[0] === 'players') return { name: 'players' };
    if (parts[0] === 'new') return { name: 'new' };
    if (parts[0] === 't' && parts[1]) return { name: 'tournament', tid: parts[1] };
    if (parts[0] === 'm' && parts[1] && parts[2]) return { name: 'match', tid: parts[1], mid: parts[2] };
    return { name: 'home' };
  }

  function currentTournament() { return Store.tournament(route.tid); }
  function currentMatch() {
    const t = currentTournament();
    return t ? t.matches.find(m => m.id === route.mid) : null;
  }

  function render() {
    route = parseHash();
    const app = $('#app');
    switch (route.name) {
      case 'players':    app.innerHTML = Views.players(); break;
      case 'new':        app.innerHTML = Views.newTournament(); break;
      case 'tournament': app.innerHTML = Views.tournamentPage(currentTournament()); break;
      case 'match':      app.innerHTML = Views.scorePage(currentTournament(), currentMatch()); break;
      default:           app.innerHTML = Views.overview();
    }
    $$('.topnav a').forEach(a => a.classList.toggle('on', a.dataset.nav === route.name ||
      (a.dataset.nav === 'home' && ['tournament', 'match'].includes(route.name))));
    window.scrollTo(0, 0);
  }

  /* ---------- match flow ---------- */

  function startMatch(mid) {
    const t = currentTournament();
    const m = t && t.matches.find(x => x.id === mid);
    if (!t || !m || !Bracket.isReady(m)) return;

    const plan = Bracket.planStart(t, m);
    if (plan.stuck.length) {
      const lines = plan.stuck.map(s =>
        `${s.team.name}: ${s.names} currently playing in "${s.where}"`).join('\n');
      if (!confirm(`Heads up — players are mid-game and no free team is available on this leg:\n\n${lines}\n\nStart anyway?`)) {
        return;
      }
    }
    Bracket.applyStart(t, m, plan);
    plan.swaps.forEach(s => toast(s.note, 'warn'));
    const target = `#/m/${t.id}/${m.id}`;
    if (location.hash === target) render();
    else location.hash = target;
  }

  function finishMatch() {
    const t = currentTournament();
    const m = currentMatch();
    if (!t || !m || m.status !== 'live') return;
    if (m.scoreA === m.scoreB) {
      toast('It\'s tied — someone has to win! Keep playing.', 'error');
      return;
    }
    const r = t.rules;
    const hi = Math.max(m.scoreA, m.scoreB);
    const diff = Math.abs(m.scoreA - m.scoreB);
    if (hi < r.target && !confirm(`Neither team has reached ${r.target} yet. Finish anyway?`)) return;
    if (hi >= r.target && r.winBy > 0 && diff < r.winBy &&
        !confirm(`Rules say win by ${r.winBy} (current margin: ${diff}). Finish anyway?`)) return;

    const winnerId = m.scoreA > m.scoreB ? m.teamA : m.teamB;
    Bracket.finishMatch(t, m, winnerId);
    toast(`🏆 <b>${esc(Store.teamName(t, winnerId))}</b> takes it, ${m.scoreA}–${m.scoreB}!`, 'ok');
    if (t.status === 'complete') {
      Confetti.burst(220);
      toast(`🎉 <b>${esc(Store.teamName(t, t.placements.first))}</b> are the ${esc(t.name)} champions!`, 'ok');
    }
    location.hash = `#/t/${t.id}`;
  }

  /* ---------- click actions ---------- */

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const act = el.dataset.action;

    switch (act) {
      /* players page */
      case 'add-players': {
        const input = $('#new-players');
        const n = Store.addPlayers(input.value.split(/[,\n;]+/));
        if (n) toast(`Added ${n} player${n > 1 ? 's' : ''}.`, 'ok');
        input.value = '';
        render();
        break;
      }
      case 'remove-player': {
        if (confirm(`Remove ${Store.playerName(el.dataset.id)} from the pool?`)) {
          Store.removePlayer(el.dataset.id);
          render();
        }
        break;
      }
      case 'create-team': {
        const name = $('#team-name').value.trim();
        const ids = $$('.team-pick:checked').map(x => x.value);
        if (!name) { toast('Give the team a name.', 'error'); break; }
        if (!ids.length) { toast('Pick at least one player.', 'error'); break; }
        Store.addStaticTeam(name, ids);
        toast(`Static team <b>${esc(name)}</b> created.`, 'ok');
        render();
        break;
      }
      case 'remove-team': {
        Store.removeStaticTeam(el.dataset.id);
        render();
        break;
      }

      /* new tournament draft */
      case 'draft-game': {
        const d = Views.getDraft();
        d.gameIdx = Number(el.dataset.i);
        const g = GAME_PRESETS[d.gameIdx];
        d.target = g.target; d.winBy = g.winBy; d.notes = g.notes;
        render();
        break;
      }
      case 'draft-static': {
        const d = Views.getDraft();
        if (el.checked) d.staticIds.add(el.dataset.id);
        else d.staticIds.delete(el.dataset.id);
        d.randomTeams = []; d.bench = [];
        render();
        break;
      }
      case 'draft-shuffle': {
        Views.shuffleDraftTeams();
        render();
        break;
      }
      case 'draft-create': {
        const d = Views.getDraft();
        const teams = [];
        for (const id of d.staticIds) {
          const st = Store.state.staticTeams.find(t => t.id === id);
          if (st) teams.push({ name: st.name, playerIds: st.playerIds, kind: 'static' });
        }
        teams.push(...d.randomTeams);
        if (teams.length < 2) { toast('You need at least 2 teams to run a bracket.', 'error'); break; }
        const preset = GAME_PRESETS[d.gameIdx];
        const game = preset.name === 'Custom' ? (d.customGame.trim() || 'Custom Game') : preset.name;
        const t = Bracket.createTournament({
          name: d.name.trim() || `${game} Showdown`,
          game, icon: preset.icon,
          rules: { target: d.target, winBy: d.winBy, notes: d.notes },
          teamSize: d.teamSize,
          teams,
        });
        Views.resetDraft();
        toast(`🚀 <b>${esc(t.name)}</b> is underway — bracket drawn!`, 'ok');
        location.hash = `#/t/${t.id}`;
        break;
      }

      /* tournament & match */
      case 'start-match': startMatch(el.dataset.mid); break;
      case 'finish-match': finishMatch(); break;
      case 'score-add': {
        const m = currentMatch();
        if (!m || m.status !== 'live') break;
        const key = el.dataset.side === 'A' ? 'scoreA' : 'scoreB';
        m[key] = Math.max(0, m[key] + Number(el.dataset.n));
        Store.save();
        render();
        break;
      }
      case 'del-tournament': {
        const t = currentTournament();
        if (t && confirm(`Delete "${t.name}" and all its matches? This can't be undone.`)) {
          Store.removeTournament(t.id);
          location.hash = '#/';
        }
        break;
      }

      /* data tools */
      case 'export-data': {
        const blob = new Blob([Store.exportJSON()], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'bracket-attack-backup.json';
        a.click();
        URL.revokeObjectURL(a.href);
        break;
      }
      case 'reset-all': {
        if (confirm('Wipe ALL players, teams and tournaments?') &&
            confirm('Really sure? There is no undo.')) {
          Store.resetAll();
          render();
        }
        break;
      }
    }
  });

  /* ---------- field changes (new-tournament form & import) ---------- */

  document.addEventListener('change', (e) => {
    const el = e.target;

    if (el.id === 'import-file') {
      const file = el.files[0];
      if (!file) return;
      file.text().then(txt => {
        if (!confirm('Importing replaces everything currently stored. Continue?')) return;
        try {
          Store.importJSON(txt);
          toast('Backup imported.', 'ok');
          render();
        } catch (err) {
          toast('Import failed: ' + esc(err.message), 'error');
        }
      });
      return;
    }

    const field = el.dataset.field;
    if (!field) return;
    const d = Views.getDraft();
    if (field === 'target' || field === 'winBy' || field === 'teamSize') {
      d[field] = Number(el.value);
      if (field === 'teamSize') { d.randomTeams = []; d.bench = []; render(); }
    } else {
      d[field] = el.value;
    }
  });

  addEventListener('hashchange', render);
  render();
})();
