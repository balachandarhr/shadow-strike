# SHADOW STRIKE (Web) · v2

A 3D third-person shooter you play in the browser, built with Three.js. There is no build step. Defend the Command Center against waves of soldiers, heavies, vehicles and the Iron Goliath boss on level 10.

**Play:** https://balachandarhr.github.io/shadow-strike/

## What's new in v2
- **Ultra-modern UI:**
  - glassmorphism panels with neon cyan/magenta and Orbitron/Rajdhani fonts
  - a 3D camera fly-through behind the menu, plus animated transitions
  - mission cards, and an Armory with a rotating 3D weapon preview
- **HUD:**
  - segmented HP, shield and base bars
  - circular ammo arcs and cooldown rings
  - a dynamic crosshair that spreads with recoil
  - hit markers and damage-direction indicators
  - a kill feed, floating damage numbers and combo popups (Double Kill → Godlike)
  - a radar and a boss bar with phases
- **3D effects:**
  - HDR neon materials, bloom, FXAA, vignette, chromatic aberration and film grain, with a motion feel when sprinting or dashing
  - dynamic muzzle and explosion lights
  - shockwaves, debris, sparks, rocket smoke trails and tracers
  - enemies tumble and dissolve on death
  - camera shake, plus slow-motion on boss kills and big multi-kills
  - light shafts, fog, sky gradients and soft shadows
- **Graphics quality:** Low, Medium or High in Settings. The game picks automatically, using Low on phones, and drops the level if fps falls. Low turns off post-processing and the heavy passes. Add `?q=low|medium|high` to the URL to force a level.

## Controls
**Desktop** (click the game to lock the mouse):

| Action | Key |
|---|---|
| Move | WASD |
| Sprint | Shift |
| Dash (brief invulnerability) | Space or Ctrl |
| Jump | C |
| Aim | Mouse |
| Fire | Left click |
| Aim down sights (scope on the rifle) | Right click |
| Reload | R |
| Weapons | 1, 2, 3 or the mouse wheel |
| Airstrike | Q |
| Shield | E |
| Pause | P or Esc |

**Mobile** (landscape):
- A floating joystick moves you; it appears wherever your left thumb lands. Push it all the way forward to sprint.
- Drag on the right side to aim.
- Round buttons handle fire, reload, aim (ADS), jump, dash, airstrike and shield, with cooldown rings and haptics.
- In Settings you can change:
  - aim sensitivity and smoothing, and invert Y
  - auto-fire (shoots when the crosshair is on an enemy)
  - light aim assist
  - haptics, the FPS counter and graphics quality

The combat drone fires on its own once it is unlocked (clear level 3 or buy it in the Armory).

## Features
- 10 campaign levels with a level select
- Endless survival mode
- Credits and an Armory with upgrades for damage, reload, armor and the drone, saved in localStorage

## Run locally
    python3 -m http.server 8000
Then open http://localhost:8000. ES modules need a server, so opening the file directly will not work.

## Limitations
- The art uses primitive shapes as placeholders
- There are no ads or in-app purchases
- On desktop, Ctrl+key combinations may trigger browser shortcuts; use Space to dash
