# Retroid Pocket 6: Feature Inventory and Desktop Translation

Research date: 2026-10-03. Purpose: list the software and user-facing features the Retroid Pocket 6 (RP6) offers, both stock and from the usual emulation stack, so a Windows desktop app can recreate the experience.

Confidence markers: **[confirmed]** means several sources agree. **[reported]** means one source. **[unverified]** means inferred from earlier Retroid models or general knowledge, so check it on a real device.

---

## 1. Hardware summary (context only)

| Area | Detail |
|---|---|
| SoC | Qualcomm Snapdragon 8 Gen 2 (4 nm). CPU is 1x 3.2 GHz + 4x 2.8 GHz + 3x 2.0 GHz. GPU is an Adreno 740 at 680 MHz. Mature Turnip (Mesa) custom drivers are seen as a big advantage for emulation. [confirmed] |
| RAM / storage | 8 GB or 12 GB LPDDR5X, 128 GB (also 256 GB per some retailers) UFS 3.1, microSD [confirmed] |
| Screen | 5.5" AMOLED touchscreen, 1920x1080, up to 120 Hz, switchable between 60 and 120 Hz. Reviewers mention black-frame-insertion and CRT shader use at 120 Hz. [confirmed] |
| Controls | Hall-effect sticks with L3/R3, analog L2/R2 (the "L2/R2 mode" setting picks analog, digital or both), L1/R1, ABXY, Start/Select, D-pad. Sold in two physical layouts: D-pad above or below the left stick. [confirmed] |
| System buttons | Dedicated **Home** and **Back** buttons on the front, beside the speakers (moved there in the post-feedback redesign). Two programmable rear buttons, **M1/M2**, which were first under the screen and then moved to the back. Power and volume buttons on the right edge. [confirmed] |
| Other | Joystick RGB LEDs (color is set from quick settings), active cooling fan, 6000 mAh battery with 27 W charging, Wi-Fi 7, BT 5.3, USB-C 3.1 with DisplayPort output up to 4K60, 3.5 mm jack. [confirmed] |
| OS | Android 13 with Retroid customizations and official OTA updates. No games are preloaded. [confirmed] |
| Price | Roughly $209 (8/128) to $259 (12 GB). Launched late 2025, shipped around January 2026. [reported] |

---

## 2. Stock software

### 2.1 Retroid Launcher (stock frontend)
- Optional console-style home screen that sits alongside the normal Android launcher. [confirmed]
- Users download or enable **platform definitions** and add a **ROM directory per platform**. [confirmed]
- Per-platform **emulator selection**, including standalone apps or specific RetroArch cores, and file-extension (suffix) filtering. [reported]
- **Direct launch**: opens the chosen emulator with the game, then returns to the launcher when the emulator closes. [confirmed]
- Scraping: some reviews say it imports the collection and fetches box art and screenshots automatically "with varying success". Other guides say scraping is limited. Treat it as basic and unreliable. [conflicting]
- It also works as a hub for handheld settings. Reviews call it "clean", "colorful", "serviceable" and "barely adequate". Most enthusiasts replace it with ES-DE, Daijisho, Beacon or iiSU. [confirmed]

### 2.2 Quick Settings / "Handheld Settings" (system level)
Reached by swiping down twice for quick-settings tiles, or through Settings > Handheld Settings. [confirmed]
- **Performance profile**: Standard / Balanced / Performance / High Performance. The available steps depend on firmware. Sources recommend Standard for retro systems and High Performance for PS2, GameCube, Switch and Wii U. [confirmed]
- **Fan mode**: Quiet / Smart / Sport or Extreme (some sources say Balanced / Performance) plus custom. Smart measured about 52 dB and Extreme about 58 dB. [confirmed, naming varies]
- **Refresh rate**: 60 Hz or 120 Hz. [confirmed]
- **Joystick LED color and effects**. [confirmed]
- **Controller style**: Xbox layout or Nintendo/"retro" layout. This swaps how Android reports A/B and X/Y. [confirmed]
- **L2/R2 mode**: analog, digital, or both. [confirmed]
- **Vibration strength**. [reported]
- **Back key mapping**: what the Back button does. [reported]
- **M1/M2 mapping**: assign any button or combo to the rear buttons. Reviewers say this is mostly used for emulator hotkeys. [confirmed]
- **Charging limit**, for example 80% when playing while plugged in. [confirmed]
- **Floating icon toggle**: shows or hides the in-game edge bar. [confirmed]
- **Controller tester**: checks D-pad, face buttons, shoulders, triggers, sticks and L3/R3. Stick calibration is also available. [reported / unverified for RP6]
- **Display output** and **background process management** options. [reported]

### 2.3 "Game Assist" floating bar (in-game overlay)
- A thin white bar on the right screen edge, visible in every app. Swiping it in opens the **Game Assist** panel. [confirmed]
- Panel contents: **FPS counter, temperature and performance monitoring**, quick shortcuts to common functions, and **Button Mapping**. [confirmed]
- **Key Adapter / screen mapping**: drag virtual button icons onto on-screen touch positions so physical buttons and sticks can drive touch-only Android games. Saved as schemes with left/right joystick mapping. [confirmed]
- Screenshot and screen recording: neither is documented as part of Retroid's overlay. Android 13 has its own screen recorder tile and screenshot. [unverified]

### 2.4 Modes
- There is no separate "handheld vs. Android mode" boot. The device is always Android. Controller style (Xbox or Nintendo) is the main mode switch. Older Retroid devices had an Xbox/"Android" gamepad identity toggle; this is unverified on the RP6. [unverified]
- DisplayPort-out "docked" use with a TV and Bluetooth controllers. [confirmed]

### 2.5 Updates, cloud and saves
- **OTA**: Settings > System > Updater / System Update, with incremental updates. [confirmed]
- **No Retroid cloud-save service was found** in any source. Users rely on Google Play Games for native games, RetroArch cloud sync (WebDAV), Syncthing, or emulator-specific sync. [confirmed by absence]
- File transfer happens over USB-C MTP or by moving the microSD card. [confirmed]
- No built-in game store or ROM library beyond the launcher.

---

## 3. Typical emulation stack on the RP6

### 3.1 Frontends
| Frontend | Price | Notable features |
|---|---|---|
| **ES-DE** (EmulationStation Desktop Edition) | Paid on Android (Patreon, about $5); free on Windows/Linux/macOS | Deepest theme engine with a downloadable theme library (Linear bundled on Android; Modern and Slate available). Scrapes ScreenScraper and TheGamesDB, including videos. Media types: covers, 3D boxes, marquees, screenshots, title screens, fan art, miximages, videos and PDF manuals. Automatic collections (All Games, Favorites, Last Played) plus custom collections. Filters, random game, per-system and per-game alternative emulators, screensavers (dim, black, slideshow, video), kid and kiosk UI modes, metadata editor, play count and last-played tracking, dual-screen support. |
| **Daijisho** | Free, no ads | Fast on all hardware. Platform index downloads, "player" (emulator intent) templates, per-game emulator choice, built-in scraping, per-system wallpapers, list or grid views, light and dark themes, favorites, recently played and search. |
| **Beacon** | Free with extras / about $3-4 | Minimal clean grid, wallpaper and accent colors, in-app box art scraping, very easy setup. |
| **iiSU** | Free (alpha) | Visuals-first animated UI that recreates PSP/3DS/Wii U menus, widgets, **built-in RetroAchievements**, StreetPass/Miiverse-style social features, dual-screen optimized. Development has been quiet since July 2026. |
| **Retroid Launcher** | Stock | See 2.1. |
| Others | - | Cocoon (dual-screen), Pegasus (free, hard to configure), LaunchBox Android, RESET Collection (randomizer, YouTube video snaps), RetroX (subscription with cloud saves), Plain Launcher, DIG. |
| Utility | - | **Obtainium** watches GitHub releases and keeps emulator APKs up to date. |

### 3.2 Emulators per system (RP6 consensus, 2026)
| System | Android emulator(s) | RP6 performance tier |
|---|---|---|
| 8/16-bit, GB/GBC/GBA, Genesis, arcade | RetroArch (Mesen, Snes9x, mGBA, Genesis Plus GX, FBNeo, etc.) | A: perfect, with headroom for shaders and run-ahead |
| PS1 | DuckStation standalone, or RetroArch SwanStation/Beetle | A: 4x+ upscale |
| N64 | Mupen64Plus FZ Pro, RetroArch Mupen64Plus-Next | A |
| Dreamcast / Saturn | RetroArch Flycast / Beetle Saturn / Yaba Sanshiro | A: Dreamcast at 4x |
| NDS | melonDS / WatermelonDS (dual-screen layouts) | A |
| PSP | PPSSPP | A: 3-4x, full screen |
| PS2 | **NetherSX2** (AetherSX2 fork) or **ARMSX2** (newer, actively updated, hardcore RetroAchievements) | A-: 2-3x, needs Performance or High Performance mode |
| GameCube / Wii | Dolphin (or forks) | A: 2-3x |
| 3DS | **Azahar** (Citra successor) | A |
| PS Vita | Vita3K | A-: "exceptionally well" |
| Switch | **Eden** (main), Citron; Sudachi less active. Turnip drivers (e.g. MrPurple666 builds). | A-/B+: many games at 60 fps (Metroid Dread, Mario Odyssey), varies by title |
| Wii U | Cemu (Android) | C+/B: playable, with compromises |
| PS3 | aPS3e, RPCSX, ARMSX3 | C-: light games only |
| Original Xbox | X1 Box | D: early WIP |
| PS4 | Bachata S4 | F: experimental |
| Windows PC games | Winlator (Cmod/Bionic), GameHub, GameNative | Indies and older AAA titles at 720p (e.g. Arkham Asylum at 60). 12 GB model recommended. Winlator Cmod is reported about 20 fps faster than GameHub. |
| Native Android / streaming | Play Store games, Moonlight, Steam Link, xCloud, GeForce Now | Excellent |

Typical tuning: Vulkan everywhere. RetroArch with run-ahead (1 frame) and integer scaling. Per-game overrides. Emulator battery optimization set to "Unrestricted". Developer animation scale at 0.5x. Three-button navigation enabled.

### 3.3 Folder conventions
`/Roms/<System>/` on the SD card, with BIOS placed per emulator (DuckStation `bios/`, NetherSX2 `bios/`, RetroArch `system/`). ES-DE uses its own `ROMs/<system>` naming and `ES-DE/` data folders.

---

## 4. Frontend and emulator UX features people love

**Library and frontend**
- Themes and theme downloader (ES-DE), animated console-style UIs (iiSU), wallpapers and accent colors (Daijisho, Beacon).
- Scraping from ScreenScraper, TheGamesDB and libretro-thumbnails: box art, 3D boxes, marquees/wheels, screenshots, **video snaps** that play while browsing, fan art, manuals, descriptions, genres, release dates and ratings.
- Collections: auto (All, Favorites, Last/Recently Played) and custom, genre collections, filters, search, random game, jump-to-letter.
- Favorites, hide game, mark completed or broken.
- Play count, last played and play time. RetroArch has runtime logging. Frontend support for play time varies.
- Per-system and per-game emulator or core selection.
- Screensavers and attract mode (video or slideshow of random games).
- Kid and kiosk modes. Dual-screen layouts.
- RetroAchievements display (iiSU; RetroArch in-game).

**In-game / emulator**
- **Hotkeys**: the usual RetroArch scheme uses Select as the hotkey enabler. Select+R1 save state, Select+L1 load state, Select+X (or L3) menu, Select+R2 fast-forward, Select+Start quit. The M1/M2 rear buttons often carry the menu or save-state hotkeys.
- Save states with slots and thumbnails, plus auto save/load state ("quick resume") and periodic auto-save of SRAM.
- Rewind, fast-forward, slow-motion, run-ahead and preemptive frames for low latency.
- Shaders (CRT-Royale, CRT-Geom, LCD grids, scanlines) and overlays/bezels. 120 Hz enables BFI.
- Per-game and per-core overrides, input remaps, cheats, netplay.
- RetroAchievements with hardcore mode (RetroArch, PPSSPP, DuckStation, Dolphin, ARMSX2).
- Upscaling and texture packs (Dolphin, PPSSPP, Azahar), widescreen patches (PCSX2/NetherSX2).
- **Quick resume via Android**: press Home and the emulator stays suspended in RAM, then return through Recents or the frontend.

---

## 5. Desktop translation (Windows)

| RP6 feature | Windows desktop equivalent / implementation |
|---|---|
| **Physical controls** (sticks, analog triggers, L3/R3, ABXY, D-pad) | **SDL3 Gamepad API** is the most robust choice: XInput, DualSense/DS4, Switch Pro and 8BitDo in one API, with a mapping DB and sensor/rumble/LED access. Windows.Gaming.Input or XInput are fallbacks. Supports controller hot-plug and multiple pads. |
| **Home button** | Gamepad **Guide/PS button** via SDL (`SDL_GAMEPAD_BUTTON_GUIDE`). Short press opens the frontend or overlay; long press opens the quick menu. Xbox Game Bar captures the Guide button by default, so offer to disable it or use a fallback chord (e.g. Select+Start held). A keyboard hotkey also works. |
| **Back button** | Mapped to "back/cancel" in the UI (B or Esc). In-game, it can be configured to send an emulator command (e.g. RetroArch `MENU_TOGGLE`) or to close the game with a confirmation. |
| **M1/M2 rear buttons** | Paddle support for Xbox Elite, DualSense Edge and Steam Controller through SDL paddles, plus user-defined **macro/hotkey chords**. Any button or chord can trigger an app action (save state, screenshot, overlay). |
| **Controller style: Xbox vs. Nintendo layout** | Input-layer option to **swap A/B and X/Y**, by label or by position. Also writes the matching setting into emulator configs (RetroArch `menu_swap_ok_cancel_buttons`, Dolphin/Eden/Cemu controller profiles). SDL can report face-button labels (`SDL_GetGamepadButtonLabel`) for automatic glyphs. |
| **L2/R2 analog/digital mode** | Per-profile trigger mode with an adjustable digital threshold, and deadzone/curve settings for sticks (Hall-effect pads need small deadzones). |
| **Controller tester / calibration** | Built-in **gamepad test screen** showing live axes, buttons, triggers, rumble and gyro, with deadzone tuning. |
| **Game Assist floating bar / overlay** | A **global-hotkey overlay**: a borderless, topmost, transparent, click-through window over borderless-fullscreen games (exclusive fullscreen needs injection; prefer borderless). Contents: FPS (PresentMon/ETW or emulator-reported), CPU/GPU temperature and load (LibreHardwareMonitor), battery (on laptops/handheld PCs), clock, and quick actions. It is opened by the Guide button or a chord, and is fully controller-navigable. |
| Overlay quick actions to RetroArch | **RetroArch Network Control Interface**: UDP on `localhost:55355`, enabled with `network_cmd_enable = "true"`. Commands include `SAVE_STATE`, `LOAD_STATE`, `STATE_SLOT_PLUS/MINUS`, `PAUSE_TOGGLE`, `RESET`, `CLOSE_CONTENT`, `QUIT`, `FAST_FORWARD`, `REWIND`, `SCREENSHOT`, `RECORDING_TOGGLE`, `SHADER_NEXT/PREV/TOGGLE`, `DISK_NEXT/EJECT_TOGGLE`, `MUTE`, `VOLUME_UP/DOWN`, `FULLSCREEN_TOGGLE`, `MENU_TOGGLE`, `FPS_TOGGLE`, `RUNAHEAD_TOGGLE`, `CHEAT_TOGGLE`, `OVERLAY_NEXT`. Status is queried with `GET_STATUS`, which returns PAUSED/PLAYING with system, game and CRC, plus `VERSION` and `GET_CONFIG_PARAM`. |
| Overlay quick actions to standalone emulators | Most standalone emulators have no network API. Inject the emulator's own **keyboard hotkeys** via `SendInput` to its window (e.g. PCSX2 F1/F3 save/load, Dolphin Shift+F1 / F1, DuckStation F1/F2/F3), or pre-configure each emulator's hotkeys in its config at setup. DuckStation and PCSX2 also accept CLI options like `-statefile`/`-resume`. Keep a per-emulator "action to keystroke" map. |
| **Performance profiles** (Standard to High Performance) | Switch **Windows power plans or overlays** (`powercfg /setactive`, Balanced/Best performance overlays) and optionally process priority and affinity. On AMD handheld PCs use the RyzenAdj TDP presets; on Intel, the vendor tools. Presets can be per game or per system. Keep the expectations modest on desktops. |
| **Fan mode** | Usually not controllable on a desktop. Optionally integrate FanControl/LibreHardwareMonitor, or read-only display. Low priority. |
| **60/120 Hz refresh switch** | Use `ChangeDisplaySettingsEx` / DisplayConfig APIs to set the refresh rate per game or system (e.g. 60 Hz for retro, max for BFI or modern games). Also VRR/G-Sync awareness. Restore on exit. |
| **Joystick LED color** | SDL `SDL_SetGamepadLED` (DualSense/DS4/some third-party pads). Optional nicety. |
| **Charging limit** | Not applicable (on laptops this is an OEM feature). Skip. |
| **Key Adapter (touch mapping for Android games)** | Equivalent is a **gamepad-to-keyboard/mouse mapper** for PC games and emulators without controller support, as in Steam Input, JoyToKey or AntiMicroX: per-app profiles, stick to mouse, button to key or macro. |
| **Screenshot / screen recording** | RetroArch `SCREENSHOT` / `RECORDING_TOGGLE` when it is in focus. Otherwise **Windows.Graphics.Capture** for a per-window screenshot, or FFmpeg `ddagrab` / Windows.Media.Capture for clips, plus an "instant replay" ring buffer if wanted. Files are saved per game and shown in the game's gallery. |
| **Retroid Launcher / frontend** | A **10-foot, controller-first library UI**. Per-system ROM folders, platform definitions (system to extensions and emulators), per-system and per-game emulator or core choice, direct launch that **returns to the frontend when the emulator exits** (watch the child process), and kiosk/fullscreen behavior. Can import or interoperate with ES-DE gamelists and RetroArch playlists. |
| **Scraping / media** | ScreenScraper API (needs a dev ID and user credentials), TheGamesDB, IGDB, and libretro-thumbnails (free, keyed by No-Intro name) for box art, screenshots, title screens, marquees, 3D boxes, **video snaps**, manuals and metadata. Hashing (CRC32/MD5/SHA1) for exact matching. Local cache. |
| **Themes** | Theme engine with downloadable themes, wallpapers per system, accent colors, grid/list/carousel views, and optional animated console-style themes (iiSU-like). |
| **Collections / favorites / recently played / play time** | SQLite library with auto collections (All, Favorites, Recently Played, Most Played, Never Played) and custom/genre collections, filters, search, random game. **Play time** is tracked by timing the emulator process. RetroArch runtime logs can also be imported. |
| **Quick resume** | When leaving a game, send `SAVE_STATE` to an auto slot (RetroArch `savestate_auto_save/auto_load`, or emulator "resume state" CLI flags) before closing. A "Resume" tile then reloads it. Optionally **suspend the process** (NtSuspendProcess) for instant switching between running games, with an "active game" indicator in the frontend. |
| **Save states / hotkeys** | Unified hotkey layer (Select-chord scheme by default, user-remappable) translated per emulator through the network command or keystroke injection. Save-state browser with thumbnails where readable. |
| **Shaders / overlays / BFI** | Expose RetroArch shader presets (slang) and bezel overlays per system from the frontend, by writing per-core or per-game overrides. BFI or CRT-beam-sim on 120 Hz+ monitors. |
| **RetroAchievements** | RA Web API (username and API key typed by the user) to show the achievement list and progress per game in the library. In-game unlocks are handled by the emulators (RetroArch, PCSX2, DuckStation, PPSSPP, Dolphin). Hardcore toggle written into configs. |
| **Android emulators to Windows equivalents** | RetroArch (Windows), DuckStation, **PCSX2** (replaces NetherSX2/ARMSX2), PPSSPP, Dolphin, **Azahar**, melonDS, Vita3K, **Eden or Citron** (Windows builds) or **Ryubing/Ryujinx forks** for Switch, **Cemu** (Wii U, much better on PC), **RPCS3** (PS3, much better on PC), **xemu** (Xbox), **Xenia Canary** (Xbox 360), **shadPS4** (PS4), Flycast, Mupen64Plus/RMG/ares. Winlator, GameHub and GameNative are not needed because Windows runs PC games natively, so integrate Steam, GOG, Epic and Playnite libraries. |
| **Emulator install and updates** (Obtainium) | Built-in **emulator manager** that downloads releases from GitHub or official sites, checks versions, pre-configures paths, BIOS and hotkeys, and validates BIOS files by hash. |
| **OTA updates** | App self-update (e.g. Velopack/Squirrel/MSIX) with release notes. |
| **Cloud / saves** | Optional sync of saves and states (folder sync, WebDAV like RetroArch cloud sync, or a Syncthing-friendly layout). Backup and export of the library database. |
| **DisplayPort "docked" mode** | Big Picture/TV mode: full-screen frontend, multi-monitor selection, auto-launch at login, controller-only navigation, local multiplayer. |
| **Native Android games / streaming** | Out of scope. Optionally add launcher entries for Moonlight, Steam Link, xCloud and GeForce Now. |

### Suggested priority for an MVP
1. Controller-first library frontend with system/emulator definitions, direct launch and return.
2. Scraping (libretro-thumbnails first, then ScreenScraper), favorites, recently played and play time.
3. Global Guide-button overlay with RetroArch UDP commands and keystroke injection for standalone emulators (save/load state, pause, screenshot, quit, FPS).
4. A/B layout swap, hotkey chords and per-game profiles.
5. Emulator manager, BIOS checker, quick resume via auto states, RetroAchievements display, themes.

---

## Sources
- https://www.goretroid.com/products/retroid-pocket-6-handheld
- https://droix.net/blogs/retroid-pocket-6-review/
- https://www.stuff.tv/review/retroid-pocket-6-review/
- https://retrododo.com/retroid-pocket-6-review/
- https://gardinerbryant.com/hands-on-with-the-retroid-pocket-6-the-8gb-sweet-spot/
- https://heldgames.com/guides/retroid-pocket-6-setup
- https://heldgames.com/guides/best-emulation-frontends
- https://www.joeysretrohandhelds.com/guides/retroid-pocket-6-setup-guide/
- https://junubgames.com/retroid-pocket-6-setup-guide/
- https://retrolize.co.uk/blogs/retro-blog/complete-retroid-pocket-setup-guide-emulators-bios-controls-performance
- https://handheldwiki.com/retroid-pocket-6/
- https://www.gizmochina.com/2025/10/27/retroid-pocket-6-launched-specs-price/
- https://www.technetbooks.com/2025/10/retroid-pocket-6-control-layout-updated.html
- https://www.notebookcheck.net/Retroid-Pocket-6-shown-running-Batman-Arkham-Asylum-at-60fps.1200498.0.html
- https://wiki.retroidhandhelds.com/index.php/Frontends_&_Launchers
- https://retrohandheldguides.com/best-android-emulator-frontend/
- https://gitlab.com/es-de/emulationstation-de/-/blob/master/USERGUIDE.md
- https://heldgames.com/guides/iisu-setup-guide
- https://docs.libretro.com/development/retroarch/network-control-interface/
