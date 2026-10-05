# RetroDesk

The Retroid Pocket 6 experience, rebuilt for a Windows or macOS desktop: a controller-first game library that installs and launches emulators for you, plus an in-game **Game Assist** quick menu. Use it from the couch with a gamepad, or at the desk with mouse and keyboard.

## What it does

| Retroid Pocket 6 | RetroDesk on a PC or Mac |
|---|---|
| Retroid Launcher / ES-DE / Daijisho frontend | 10-foot UI: Home (continue playing, recents, favourites), Systems, per-system cover grid (virtualised, 5k+ games), game detail, on-screen-keyboard search |
| Pick an emulator per system | One-click install of RetroArch 1.22 + the best libretro core per system, or a standalone emulator (Dolphin, PCSX2, RPCS3, Eden, Azahar, Cemu, xemu, Vita3K, PPSSPP, DuckStation). Override per system or per game |
| Game Assist side bar (FPS, temps, shortcuts) | Transparent always-on-top overlay. Open with **Back + Start** on a controller (or Guide), or **Ctrl+Alt+Home**. Offers resume, save/load state, slot ±, screenshot, fast-forward, reset, RetroArch menu, performance mode and quit, plus live CPU/GPU/temperature/RAM/battery stats |
| Performance profiles (Standard → High Performance) | Windows 11 power modes (Quiet / Balanced / Max) applied while you play, then restored afterwards. On a Mac, macOS manages power itself; Low Power Mode is shown in the quick menu |
| Xbox / Nintendo button layout swap | Same, for the UI and confirm/back, chosen automatically from the controller unless you pick one. Controller glyphs match Xbox, PlayStation or Nintendo pads |
| Hold-Select hotkeys | RetroArch hotkeys: Select + RB save, + LB load, + RT fast-forward, + D-pad ← → slot, + Y screenshot, + X menu |
| Quick resume | Auto save state on exit and auto load on launch |
| Box art scraping | libretro-thumbnails box art, snaps and title screens, matched fuzzily to No-Intro/Redump names (no API key). Arcade names resolved via the FBNeo DAT. Local art next to ROMs is used first |
| Winlator / PC games | Steam library import (games launch through Steam) |
| RetroAchievements, shaders, run-ahead, rewind | Settings → In-game and RetroAchievements (CRT, LCD-grid and sharp-pixel shader presets) |
| Controller tester | Settings → Controls |

Other features: BIOS checker with MD5 validation and import, drag-and-drop ROM import, play time and play count tracking, four themes (Midnight, AMOLED, Light, Retro) with accent colours, UI sounds, and a first-run setup wizard.

**Supported systems (40):** NES, SNES, N64, GameCube, Wii, Wii U, Switch, Game Boy/Color/Advance, DS, 3DS, Virtual Boy, Master System, Genesis/Mega Drive, Sega CD, 32X, Saturn, Dreamcast, Game Gear, PlayStation 1/2/3, PSP, Vita, Xbox, Atari 2600/7800/Lynx, PC Engine (+CD), Arcade (FBNeo), Neo Geo, Neo Geo Pocket (+Color), WonderSwan (+Color), 3DO, ColecoVision and MSX. Steam is also included.

## Using it

1. Install it:
   - **Windows:** run `RetroDesk-Setup-x.y.z.exe`, or the portable exe. The installer is not code-signed, so Windows SmartScreen warns the first time: choose **More info**, then **Run anyway**. Requires 64-bit Windows 10 or 11.
   - **macOS:** open `RetroDesk-x.y.z-mac-arm64.dmg` (Apple Silicon) or `-mac-x64.dmg` (Intel) and drag RetroDesk to Applications. The app is not notarized, so the first time, Control-click it, choose **Open**, then **Open** again (or allow it under System Settings → Privacy & Security).
2. The setup wizard asks for:
   - **A data folder** (default `RetroDesk` in your home folder). Emulators, BIOS, saves, states, screenshots and artwork live here.
   - **Your ROM folders.** Sub-folders are matched to systems by common names (`snes`, `psx`, `Nintendo 64`, `Sega - Mega Drive`, …). You can also assign a folder to a system. ROMs in an unrecognised folder are still found if their extension, or for disc images their header, identifies the system.
3. RetroDesk scans your ROMs and offers to install emulators for the systems it found, then downloads artwork.
4. Put BIOS files in `<data>/bios` or import them from Settings → BIOS. They are checked automatically.

### Where your data lives

| | Windows (installed) | Windows (portable exe) | macOS |
|---|---|---|---|
| Settings and the library database | `%APPDATA%\RetroDesk` | `RetroDesk-data\app` next to the exe | `~/Library/Application Support/RetroDesk` |
| Data folder (emulators, BIOS, saves, states, screenshots, artwork) | `%USERPROFILE%\RetroDesk` unless you chose another | `RetroDesk-data` next to the exe unless you chose another | `~/RetroDesk` unless you chose another |

Uninstalling RetroDesk leaves both folders in place. Delete them yourself if you no longer want your saves and settings.

On macOS, RetroArch runs from the data folder with its own `retroarch.cfg` there, so it never touches a RetroArch you installed yourself. Standalone emulators are app bundles in the data folder too, but they keep their own settings, keys and firmware in `~/Library/Application Support/<emulator>`; that is where RetroDesk copies BIOS files and keys for them.

RetroDesk goes online only to download the emulators you install (from the libretro buildbot, GitHub, dolphin-emu.org and eden-emu.dev) and artwork (from thumbnails.libretro.com and Steam). It sends no usage data and does not update itself.

### Controls

| | Gamepad | Keyboard |
|---|---|---|
| Move | D-pad / left stick | Arrows |
| Select / back | Bottom / right button (right / bottom on Nintendo controllers) | Enter / Esc |
| Favourite | X | F |
| Search | Y | `/` or Ctrl+F |
| Switch section | LB / RB | Q / E or PgUp / PgDn |
| Page / letter jump | LT / RT | Z / C |
| Quick menu in game | Back + Start (hold) or Guide | Ctrl+Alt+Home (on a Mac keyboard: Control+Option+Fn+←) |
| Fullscreen | — | F11 (or the green window button on a Mac) |

The first time RetroArch starts, Windows Firewall may ask about network access. Choose **Cancel**: RetroDesk drives RetroArch over a UDP port on this PC only, which works either way, and allowing access would let other devices on your network send RetroArch commands while you play. You'll see a one-time notice about this before that first launch. On a Mac with the macOS firewall turned on, the same question reads "accept incoming network connections"; choose **Deny**.

## Development

```bash
npm install
```
```bash
npm run dev
```

| Script | Purpose |
|---|---|
| `npm run dev` | Electron + Vite with hot reload |
| `npm run typecheck` | `tsc` for main/preload and renderer |
| `npm test` | Vitest unit tests (library, scanner, titles, artwork, emulators, launcher, UDP client, system) |
| `npm run lint` | oxlint (`.oxlintrc.json`): correctness rules for TypeScript and React |
| `npm run format` | Prettier (`.prettierrc.json`) rewrites the source in place; `npm run format:check` only reports |
| `npm run check` | Lint, format check, typecheck, then the unit tests. Run it before pushing |
| `npm run e2e` | Builds, launches the real app on a throwaway data folder with fake ROMs, screenshots every screen into `.e2e/smoke` |
| `npm run e2e:play -- <dir>` | Real play session: installs RetroArch + Gambatte, runs a zlib-licensed homebrew Game Boy ROM, exercises save state, the overlay, pause/resume and quit, and checks play time was recorded. `<dir>` (default `.e2e/play`) caches the ~200 MB download |
| `npm run dist` | Production build + NSIS installer + portable exe in `dist/` |
| `npm run dist:mac` | Production build + `.dmg` and `.zip` for Apple Silicon and Intel in `dist/` (run it on a Mac; ad-hoc signed, not notarized) |

Set `RETRODESK_USER_DATA` and `RETRODESK_DATA_ROOT` to run against an isolated profile.

### Layout

```
src/shared/      IPC contract (types.ts, api.ts): the single source of truth between processes, plus the tables
                 the app is derived from: quickActions.ts (Game Assist actions, hotkeys, confirmations),
                 settingsSchema.ts (choices and switches: types, defaults, validation, controls, RetroArch config)
                 and emulators.ts (emulator key formats)
src/preload/     Generic contextBridge proxy exposing window.retrodesk
src/main/
  index.ts       App lifecycle, IPC registration, rdmedia:// protocol for local artwork
  windows.ts     Main window + transparent click-through Game Assist overlay window
  settings.ts    Settings persistence (userData/settings.json) + change broadcast
  systems.ts     System catalogue (data/systems.json: extensions, cores, BIOS md5s, folder aliases)
  library/       Store, scanner (multi-disc, disc-header sniffing, PS3/Wii U/Vita folders), No-Intro title parsing,
                 libretro-thumbnails artwork, Steam (VDF parser), BIOS checks, importer
  emulators/     Downloads (buildbot, GitHub, Forgejo, Dolphin), 7-Zip extraction, RetroArch config generation,
                 standalone emulator setup (data/standalone-emulators.json), install manifest
  launch/        Session lifecycle, RetroArch UDP network commands, BIOS pre-flight, emulator window refocus
  system/        CPU/RAM/GPU (nvidia-smi)/battery stats (Win32_Battery, pmset), Windows power modes
  platform.ts    Host OS and CPU architecture: Windows and macOS builds differ in downloads, paths and OS services
  gamepads.ts    macOS: controllers read natively through SDL (@kmamal/sdl), since Chromium misses common ones there
src/renderer/    React 19 UI: input/ (gamepad + keyboard + spatial focus), screens/, overlay/, stores/ (zustand)
docs/research/   Retroid Pocket 6 feature research and the verified emulator technical reference
```

## Known limitations

- **macOS support is new** and has had less real-world testing than Windows. In particular:
  - Controller hotkeys in RetroArch use the mFi driver's button numbers.
  - The quick menu is a panel window drawn over RetroArch's fullscreen Space.
  - Focus is handed back to the game through `NSRunningApplication`.
  - Standalone emulators are found inside their app bundles.

  Please report anything that misbehaves.
- **Controllers on macOS** are read through SDL rather than Chromium's Gamepad API, which on current macOS misses controllers such as the Switch Pro Controller. `npm run dist:mac` fetches SDL's native binding for each package's architecture, which needs network access while packaging.
- **Power modes** are Windows-only. macOS needs administrator rights to change power settings, so RetroDesk leaves them alone there.
- **On macOS, not every emulator has a build for every Mac:** Eden (Switch) is Apple Silicon only, and Cemu (Wii U) is an Intel build that runs through Rosetta. A few libretro cores are missing from the buildbot for one architecture; installing one of those says so.

- **Standalone emulators** support only Quit from the quick menu. RetroArch supports the full set of quick-menu actions.
- **Vita games** need a title ID: from `param.sfo`, from a `[PCSE00123]` tag in the file name, or from a `.vpk` being installed.
- **Firmware and keys** for Switch, PS3 and PS2 must come from your own console. RetroDesk checks for them and copies them into place.
- **The Guide button** is often taken by Xbox Game Bar, which is why Back + Start is the default quick-menu combo.
- **RetroAchievements credentials** are stored in plain text in RetroDesk's settings and RetroArch's appended config.
- **Changing the data folder** copies artwork across but nothing else. Emulators, BIOS files and saves stay in the old folder, and games stored in its `roms` folder leave the library on the next scan.

## Legal

RetroDesk does not include or download games, console BIOS files, firmware or keys. Use only software you are legally entitled to use.

Emulators and libretro cores are downloaded from their own projects, under their own licences, when you choose to install them. They are not part of RetroDesk.

RetroDesk is an independent project. It is not affiliated with or endorsed by Retroid, Nintendo, Sony, Microsoft, Sega, Valve, or the RetroArch and libretro projects. Product names are trademarks of their owners and are used here only to describe compatibility.

RetroDesk is released under the MIT licence (see [LICENSE](LICENSE)). The components it bundles are listed in [THIRD-PARTY-NOTICES.txt](THIRD-PARTY-NOTICES.txt).
