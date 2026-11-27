# Spirebound

A browser action roguelite built from four pieces of key art: pick a champion,
fight through three realms, and take the Spire.

**Play:** https://spirebound.higgsfield.app

## The game

- **Three champions** — Rootwarden (melee bulwark), Emberline (ranged marksman),
  Frostcrown (slowing controller). Each has their own attack, dash and ultimate.
- **Ability loadouts** — every champion owns four active abilities and takes two
  into a run (a charge, a grenade, a blizzard, a blink…). Each can be mastered
  three times as you climb.
- **Three realms** — the Verdant Ruins, the Ember Canyon and the Frost Reach.
  Each is a timed swarm that ends in a guardian fight.
- **Real 3D characters** — every champion, foe and guardian is a rigged model
  that turns freely to face its target, casts a shadow and takes the realm's
  light.
- **Kill streaks and elites** — chain kills for a score multiplier; gold-marked
  elites hit harder and drop more.
- **Boons** — every level-up offers one of three upgrades; a fallen guardian's
  boon counts double.
- **Hall of Ascents** — finished runs are recorded in a shared top ten. Share a
  hall link (`?room=<name>`) and friends' runs land on the same wall.

Your champion attacks the nearest foe automatically; you choose where to stand.

| Action              | Keyboard      | Gamepad    | Touch           |
| ------------------- | ------------- | ---------- | --------------- |
| Move                | WASD / arrows | Left stick | Drag anywhere   |
| Dash (two charges)  | Space         | A          | Dash button     |
| Abilities 1 and 2   | Q and E       | X and B    | Ability buttons |
| Ultimate            | R or F        | Y          | Ult button      |
| Pause               | Esc or P      | Start      | Pause button    |

## Layout

Everything lives in `app/`.

| Path                   | What it is                                                              |
| ---------------------- | ----------------------------------------------------------------------- |
| `src/logic.js`         | The Hall of Ascents rules: seeds, ordered realm clears, bounded scores  |
| `public/game.js`       | The fight: fixed-timestep simulation, floor and effects rendering       |
| `public/stage3d.js`    | The three.js layer that draws the character models over the floor       |
| `public/models.js`     | Index of the models in `public/models` and the clips each one carries   |
| `public/vendor/`       | three.js r170 and the loaders it needs, vendored                        |
| `public/data.js`       | Every tunable number and every player-visible string                    |
| `public/anims.js`      | Index of the sprite sheets in `public/art/anim` (the no-WebGL fallback) |
| `public/client.js`     | Screens, HUD and the socket to the hall                                 |
| `public/input.js`      | Keyboard, touch stick and gamepad                                       |
| `public/audio.js`      | Music loop and sound effects                                            |
| `design/assets.csv`    | The asset manifest; `design/style-formula.txt` is the shared art style  |
| `tests/`               | Hall rules and room protocol tests                                      |

The fight runs on the player's device; the room deals each run's seed and is the
authority on progress and scores, so the client cannot post a run it did not
plausibly play.

## Standalone copy

`python3 tools/export-static.py <out-dir>` writes a copy of the game that needs
no room server: one page plus its assets, all on relative paths, for any static
host. That copy keeps its Hall of Ascents in the browser, running the same
`logic.js` rules locally, and carries its models as base64 text for hosts that
serve only common web file types.

## Develop

```bash
cd app
bun install
bun run dev     # local server
bun run test    # rules + room protocol, in the real Workers runtime
bun run build   # logic check, typecheck, bundle
```

Debug flags on the URL: `?dev=1` shows a frame/entity overlay, `?auto=1` runs an
autopilot (with `&hero=warden|gunner|knight`, `&ab=<ability>,<ability>` and
`&speed=1..16`), `?realm=0..2` starts in a later realm, `?skip=<seconds>` jumps
the realm clock forward (handy for reaching a guardian), and `?flat=1` turns the
3D layer off and draws the sprite fallback instead.

The simulation is 2D and runs at a fixed 60 Hz; rendering interpolates between
steps, so motion stays smooth on any display. Three canvases are stacked: the
floor and ground effects, a transparent WebGL layer with the character models
under a pitched orthographic camera, and a top layer for projectiles, particles,
health bars and damage numbers. A ground point lines up exactly between them, so
the rules never need to know which renderer is drawing.

Champions carry run, idle and attack clips. Most foes carry a single move clip;
the hound and the dragon are unrigged and rocked in code. If frames drop, the 3D
layer lowers its resolution first and then turns shadows off.

## Credits

Character models, sprites, ability icons, arena floors, music and sound effects
were generated with Higgsfield from the supplied key art, which is used directly
for the title and realm cards. Rendering uses three.js (MIT). The display
typeface is Cinzel (SIL Open Font License).
