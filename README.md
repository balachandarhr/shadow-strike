# SHADOW STRIKE (Web)

A 3D third-person shooter you play in the browser, built with Three.js. There is no build step. Defend the Command Center against waves of soldiers, heavies, vehicles and the Iron Goliath boss on level 10.

## Controls
**Desktop:** click to lock the mouse. WASD to move, mouse to aim, click to fire, R to reload, 1/2/3 to switch weapons (MG / Rifle / Rocket), Q for airstrike, E for shield, F for drone (once unlocked), Esc to pause.
**Mobile (landscape):** left joystick moves you, dragging on the right side aims, and the on-screen buttons handle fire, reload, weapons, airstrike, shield and drone.

## Features
- 10 campaign levels plus a level select
- Endless survival mode
- Coins and an upgrade shop (damage, reload, armor, drone), saved in localStorage
- Automatic quality scaling for mobile

## Run locally
    python3 -m http.server 8000
Then open http://localhost:8000. ES modules need a server, so opening the file directly will not work.

## Limitations
- The art uses primitive shapes as placeholders
- There are no ads or in-app purchases
