# Havenfall Lights

A from-scratch remake of the Christmas village game, focused on decorating with lights.
It's single-player, runs fully in the browser, and needs no server.

## Play

From the repo root:

```bash
python3 -m http.server 5174
```

Then open http://localhost:5174/lights/

## How it plays

1. Walk over glowing bulbs in the snow. Each one clips onto the empty coil of wire Steph carries, and the order you collect them in becomes the color pattern.
2. With all 8 bulbs on the coil, click a glowing hook on a cabin. Steph throws one end up to it and the strand dangles from that hook back to her hand.
3. Click a second hook on the same side of that cabin. She throws the other end, and the strand bounces into place and lights up.
4. Three strands light up a cabin: its windows glow, a wreath appears and the villager who lives there steps out to say hello (and share tips). Light all five cabins and the great tree switches on.

Extras:

- **Special bulbs.** Rare glitter bulbs make a strand sparkle; snowflake bulbs make the light chase along it. Look for them in the snow, frozen in the pond, and hidden in some of the pines.
- **Snowballs.** Press F to throw one where the camera is looking. Hitting a pine knocks its snow off, and sometimes a hidden bulb falls out.
- **Frozen pond.** Out past the cabins. Steph skates on the ice, and skating over a frozen bulb pops it out.
- **Night to morning.** The sky slowly brightens with every cabin you light, reaching sunrise when the great tree comes on.
- **Photo mode.** Press P (or the camera ornament) to hide the overlays, frame a shot and save it as a PNG.

Controls: WASD/arrows to walk, Shift to sprint, Space to hop, drag to look, scroll to zoom, Esc or right-click to cancel a strand, F to throw a snowball, P for photo mode, Q to drop a bulb, M to toggle music.

Add `?debug` to the URL to expose game internals as `window.__lights` for testing from the console.

## Files

- `world.js`: village, cabins and their hooks, trees, snowfall
- `main.js`: player, camera, bulbs, strand hanging, effects, HUD
- `villagers.js`: the cabin villagers, their animation and speech bubbles
- `audio.js`: background music and synthesized chimes and effects

It reuses `src/client/assets/character/steph.glb` and the background music from `src/client/audio/`.
