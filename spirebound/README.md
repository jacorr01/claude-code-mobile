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
| `public/game.js`       | The fight: fixed-timestep simulation and canvas rendering               |
| `public/data.js`       | Every tunable number and every player-visible string                    |
| `public/anims.js`      | Generated index of the animation sprite sheets in `public/art/anim`     |
| `public/client.js`     | Screens, HUD and the socket to the hall                                 |
| `public/input.js`      | Keyboard, touch stick and gamepad                                       |
| `public/audio.js`      | Music loop and sound effects                                            |
| `design/assets.csv`    | The asset manifest; `design/style-formula.txt` is the shared art style  |
| `tests/`               | Hall rules and room protocol tests                                      |

The fight runs on the player's device; the room deals each run's seed and is the
authority on progress and scores, so the client cannot post a run it did not
plausibly play.

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
`&speed=1..16`).

The simulation runs at a fixed 60 Hz and rendering interpolates between steps,
so motion stays smooth on any display. Hero run and attack animations are
sprite sheets cut from short generated clips; enemies are animated in code.

## Credits

Sprites, hero animations, ability icons, arena floors, music and sound effects
were generated with Higgsfield from the supplied key art, which is used directly for the title and realm
cards. The display typeface is Cinzel (SIL Open Font License).
