# Steph's Christmas Lights

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
4. Three strands light up a cabin: its windows glow and a wreath appears. Light all five cabins and the great tree switches on.

Controls: WASD/arrows to walk, Shift to sprint, Space to hop, drag to look, scroll to zoom, Esc or right-click to cancel a strand, Q to drop a bulb, M to toggle music.

Add `?debug` to the URL to expose game internals as `window.__lights` for testing from the console.

## Files

- `world.js`: village, cabins and their hooks, trees, snowfall
- `main.js`: player, camera, bulbs, strand hanging, effects, HUD
- `audio.js`: background music and synthesized chimes

It reuses `src/client/assets/character/steph.glb` and the background music from `src/client/audio/`.
