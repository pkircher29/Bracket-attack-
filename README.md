# ⚙️ Bracket Attack — Junkyard Olympics Edition

**A tournament-of-tournaments tracker for backyard game days**, themed for the
**Junkyard Olympics**: rust, scrap steel and caution tape. Run multiple
tournaments — cornhole, horseshoes, ladder golf, whatever — all at the same
time, each with its own bracket page and scorekeeping, feeding one overall
medal table. Random teams get junkyard-grade names like *Rusty Hubcaps* and
*Greasy Sprockets*.

## Features

- **Overview dashboard** — every tournament at a glance (live/active/complete,
  progress bars) plus the overall standings.
- **Tournament of tournaments scoring** — when a tournament finishes, every
  player on the 1st place team earns **4 points**, 2nd place **3**, 3rd place
  **2**, and everyone who played gets **1** — so it always pays to play.
- **Player pool & teams** — bulk-add your whole crew. Build **static teams**
  that stay together in every tournament, and draw **random teams** from the
  remaining pool on a tournament-by-tournament basis (with auto-generated team
  names like *Blazing Baggers*).
- **Per-tournament rules** — when a tournament begins you lock in its scoring
  rules: target score, win-by margin, and house-rule notes. Presets for
  cornhole, horseshoes, ladder golf and darts.
- **Single-elimination brackets** with byes handled automatically and a
  3rd-place match so bronze points are earned on the court, not on paper.
- **Big scorekeeping page per match** — huge scores, +1/+2/+3 buttons,
  target-score highlighting, winner declaration.
- **Knows who's playing right now** — players in a live match anywhere get a
  🎮 badge, and when you start a match whose players are busy in another
  tournament, the app **automatically substitutes a free team from the same
  leg of the bracket** and tells you what it did.
- **Confetti.** Obviously.
- Export/import your data as a JSON backup.

## Running it

It's a zero-build static web app — no server, no dependencies.

- **Locally:** just open `index.html` in a browser (or `python3 -m http.server`
  in the repo folder and visit `http://localhost:8000`).
- **Hosted free on GitHub Pages:** repo **Settings → Pages → Deploy from a
  branch → `main` / root** — your app goes live at
  `https://<user>.github.io/Bracket-attack-/`.

All data is saved in the browser's local storage on the device you score from
(use one phone/tablet as the official scoreboard). Use *Export backup* on the
overview page to move data between devices.

## How a game day works

1. **Players & Teams** page — paste in everyone's names. Optionally create
   static teams (the duos who always play together).
2. **New Tournament** — pick the game, set the rules, check the static teams
   you want in, and hit 🎲 to draw random teams from everyone else.
3. Run matches from the tournament page — **Start** a match, score it on the
   big scoreboard, **Finish** to advance the bracket.
4. Repeat with as many simultaneous tournaments as you like. The overview
   page keeps the master leaderboard.

## Tech

Vanilla HTML/CSS/JS. No frameworks, no build step, works offline once loaded.
