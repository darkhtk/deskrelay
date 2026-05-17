# PROJECT

Sample project used to exercise the orchestration framework. Completion of this
project is not the primary goal of the lab; it exists only to give the framework
something real to coordinate. The framework is the deliverable.

## Sample Project: Reflex Tap

A single-page browser mini-game: "Reflex Tap." A coloured square appears at a
random position inside a fixed-size canvas; the player clicks or taps it. Each
successful hit increments a score; missing or being too slow ends the round.
Everything runs in one static HTML file with inline CSS and a small JS module.

Why this scope:

- Small enough that one worker can produce a vertical slice in a single round.
- Has just enough surface (rendering, input, state, timing, persistence-of-score)
  to require multi-worker coordination without becoming a real product.
- No build step, no external dependencies, no server.

## Primary Lab Goal Reminder

The point of this sample is to stress-test:

- Delegation discipline (manager does not author the game code directly).
- Multi-worker coordination over shared files.
- Independent verification of worker output.

Shipping a polished game is explicitly NOT the goal.

## Initial Scope

- One HTML file containing markup, styles, and script.
- A fixed-size canvas (for example 480x320).
- A single round of gameplay with a visible score and a visible timer.
- A simple end-of-round screen with a restart action.

## Milestones

- M0: vertical slice. One HTML file. Square appears, click increments score,
      round ends after a fixed duration. No styling polish.
- M1: input quality. Pointer + touch parity, miss penalty, basic timing feedback.
- M2: persistence. High score retained via localStorage and shown on restart.

M0 - reflex-tap one-page slice: done (R6 R4', game/index.html, see ARTIFACTS.md and game/index.html in this lab).

No milestones beyond M2.

## Out of Scope

- Multiple game modes or difficulty selection.
- Networked or multiplayer features.
- Backend services, accounts, leaderboards beyond local storage.
- Build tools, bundlers, frameworks (React, Vue, etc.).
- Audio assets or third-party art assets.
- Mobile app packaging.
- Analytics or telemetry.
- Accessibility audits beyond keyboard reachability of the restart action.

## Acceptance Signal (for the lab, not the game)

The framework round that produces an M0 vertical slice is considered successful
when:

- The slice was produced by a claude-code worker, not the manager.
- The manager independently verified the file exists, opens in a browser, and
  the core interaction works.
- Any failure encountered during the round was logged in FAILURES.md with a
  layer label.
