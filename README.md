# Fathom — The Kindle Dive

**Hunt in the dark.** A bioluminescent deep-sea maze chase, playable entirely in
your browser. Graze every plankton mote, read the corridors with sonar, and outswim
three hunters that track light, sound, and the flash of a flare.

Eating makes you brighter: your light reaches farther and your circular window
grows. Explored passages remain in memory, but even remembered ground disappears
beyond that window. The amber glimmer ahead could be a bonus jellyfish—or a
Lanternjaw wearing its disguise.

## Run locally

Requires a current Node.js release supported by Vite (Node 22.12+ recommended).

```sh
npm ci
npm run dev
```

Open the local URL Vite prints. No services, accounts, external fonts, or runtime
network connections are needed.

## Controls

| Key | Action |
| --- | --- |
| Arrow keys / WASD | Swim while held; buffer turns at junctions |
| Space | Send a sonar pulse |
| Left or right Shift | Release ink |
| P / Escape | Pause or resume |
| M | Toggle sound |
| Up / Down | Select a menu item |
| Enter / Space | Confirm |
| Escape | Return from a menu or the briefing |
| Backtick | Toggle the engine's diagnostic overlay |

Menus also support mouse and touch. Touching the game reveals the engine's
direction pad, sonar and ink buttons, and menu controls. The **How to Play**
briefing explains each hunter's tell and how to escape it.

Every plankton is worth 10 points; a harmless amber drifter is worth 200. Clearing
a maze awards 500 and descends a depth. You begin with three reserve lives in
addition to your current attempt. Deeper mazes add hunters and shorten sonar's
reach.

## Production build

```sh
npm ci
npm run build
npm run preview
```

`dist/index.html` is the static entry point. Deploy the entire `dist/` directory,
including its `assets/` tree, at either a server root or a sub-path. All asset URLs
resolve relative to the page.

## Checks and simulation

```sh
npm run typecheck
npm run lint
npm run format
npm test
```

Fathom uses the Simple 2D engine for the frame loop, input, canvas fit, audio,
assets, and diagnostics. Its render-free simulation advances at 120 fixed ticks
per second and carries fractional frame time forward. All persistent game data,
including the deterministic random generator, lives in the engine-held state;
updates and debug poses return new values.

`src/game.ts` exports the game, its state types, and its typed debug contract.
The engine exposes that surface as `engine.debug`: apply poses through
`engine.apply`, inspect `debug.snapshot(engine.state)`, and advance counted frames
with an engine-supplied clock. Nothing is attached to the page's global object.
Tests use real engine instances over native canvases, scripted clocks, and the
seeded art. Coverage reports are written to `coverage/`.

The player-facing description, screenshots, and a recorded live dive are in
[`showcase/`](showcase/showcase.md).
