# RetroDesk: Emulator Technical Reference

Researched 2026-10-03. Every URL marked **[verified]** returned HTTP 200 on that date (curl HEAD/GET). CLI flags marked **[src]** were checked against the emulator's current source code. The machine-readable companions are `systems.json` (40 systems) and `standalone-emulators.json` (RetroArch plus 10 standalone emulators).

---

## A. RetroArch (Windows x64)

### A1. Version and download

| Item | Value |
|---|---|
| Latest stable | **1.22.2** (GitHub `libretro/RetroArch` release `v1.22.2`, published 2025-11-20; no newer stable exists as of 2026-10-03) |
| Portable archive | `https://buildbot.libretro.com/stable/1.22.2/windows/x86_64/RetroArch.7z` **[verified]**, 202,509,078 bytes |
| Archive layout | `RetroArch-Win64/retroarch.exe` (verified by reading the 7z header), plus `assets/`, etc. |
| Stable all-cores bundle | `https://buildbot.libretro.com/stable/1.22.2/windows/x86_64/RetroArch_cores.7z` **[verified]**, ~230 MB |
| Installer (avoid) | `.../RetroArch-Win64-setup.exe` |
| Nightly | `https://buildbot.libretro.com/nightly/windows/x86_64/RetroArch.7z` **[verified]**, rebuilt daily |

On Windows, RetroArch is **portable by default**: `retroarch.cfg`, `saves/`, `states/`, `system/` and `cores/` are all created next to `retroarch.exe`.

**Finding the latest stable programmatically.** The buildbot uses an h5ai/Apache-style listing:

```ts
const html = await (await fetch('https://buildbot.libretro.com/stable/')).text();
const versions = [...html.matchAll(/href="\/stable\/(\d+\.\d+\.\d+)\/"/g)].map(m => m[1]);
const latest = versions.sort(semverCompare).at(-1);           // "1.22.2"
const url = `https://buildbot.libretro.com/stable/${latest}/windows/x86_64/RetroArch.7z`;
```

The listing is sorted lexically (1.9.x appears after 1.22.x), so you must sort it as semver. As a fallback, `GET https://api.github.com/repos/libretro/RetroArch/releases/latest` returns `tag_name`, for example `"v1.22.2"`. Unauthenticated GitHub API calls are limited to 60 per hour per IP.

### A2. Cores

- **Nightly core URL pattern [verified]:** `https://buildbot.libretro.com/nightly/windows/x86_64/latest/<core>_libretro.dll.zip`
  - For example, `.../latest/snes9x_libretro.dll.zip` (1.3 MB). The zip holds only `snes9x_libretro.dll` at its root.
  - All 48 core basenames used in `systems.json` returned 200.
- **Core index:** `https://buildbot.libretro.com/nightly/windows/x86_64/latest/.index-extended` **[verified]**. Each line has the form `YYYY-MM-DD <crc32> <core>_libretro.dll.zip`. Use it to detect core updates.
- **Stable cores:** individual stable core zips are not published per version. The only stable option is the `RetroArch_cores.7z` bundle under `stable/<ver>/windows/x86_64/`. Every frontend, including RetroArch's own Core Updater, uses the nightly `latest/` URL.
- **Core info files** (extensions, firmware lists): `https://raw.githubusercontent.com/libretro/libretro-core-info/master/<core>_libretro.info`, or the bundle `https://buildbot.libretro.com/assets/frontend/info.zip`. Put them in `info/` so RetroArch can show core names and check firmware.
- **System asset packs [verified]:**
  - `https://buildbot.libretro.com/assets/system/blueMSX.zip` (needed by the blueMSX core)
  - `https://buildbot.libretro.com/assets/system/PPSSPP.zip` (needed by the PPSSPP core)
  - Also available: `Dolphin.zip`, `LRPS2.zip`, `FinalBurn Neo (hiscore).zip`
  - Extract them into `system/`.
- **BIOS md5 source of truth:** `https://raw.githubusercontent.com/libretro/libretro-database/master/dat/System.dat`. Every md5 in `systems.json` comes from this file.

### A3. Command line [src: retroarch.c v1.22.2]

```
retroarch.exe -L "cores\snes9x_libretro.dll" "D:\roms\snes\Game.sfc" --fullscreen
              [--config "path\retroarch.cfg"]        # -c, replaces the main config
              [--appendconfig "a.cfg|b.cfg"]         # overlays keys on top of the main config ('|' separated)
              [--verbose --log-file "ra.log"]
              [-e 3 | --entryslot=3]                 # state slot to auto-load if savestate_auto_load is enabled
              [--set-shader "path.slangp"] [--savestate DIR] [-s/--save DIR] [--sram-mode]
              [--subsystem NAME] [--command "CMD;HOST;PORT"] [--max-frames N] [--eof-exit] [--version]
```

The complete long-option list in 1.22.2 is:
libretro, menu, help, save, fullscreen, record, recordconfig, size, verbose, config, appendconfig, nodevice, dualanalog, device, savestate, set-shader, play-replay, record-replay, sram-mode, host, connect, mitm-session, check-frames, port, command, nick, ups, bps, ips, xdelta, no-patch, detach, features, subsystem, max-frames, max-frames-ss, max-frames-ss-path, eof-exit, version, log-file, accessibility, load-menu-on-error, entryslot, scan.

**Recommended frontend pattern.** Leave the user's `retroarch.cfg` alone and write a RetroDesk-owned `retrodesk.cfg`. Pass it on every launch with `--appendconfig`. Set `config_save_on_exit = "false"` in it so that menu tweaks don't overwrite your managed keys.

### A4. Network Control Interface (UDP) [src: command.h / command.c v1.22.2]

To enable it, set `network_cmd_enable = "true"` and `network_cmd_port = "55355"` (55355 is the default, `DEFAULT_NETWORK_CMD_PORT`). It listens on UDP. Send a plain ASCII datagram such as `SAVE_STATE`, with no newline required. Replies go back to the sender's address and port, so use one bound `dgram` socket for both sending and receiving.

```ts
import dgram from 'node:dgram';
const sock = dgram.createSocket('udp4');
sock.on('message', m => console.log(m.toString()));      // e.g. "GET_STATUS PLAYING super_nes,Super Mario World (USA),crc32=b19ed489\n"
sock.send('GET_STATUS', 55355, '127.0.0.1');
```

**Query and argument commands (these send a reply):**

| Command | Reply format |
|---|---|
| `VERSION` | `1.22.2` |
| `GET_STATUS` | `GET_STATUS <PAUSED\|PLAYING> <system_id>,<content basename>,crc32=<lowercase hex, unpadded>\n`, or `GET_STATUS CONTENTLESS`. `system_id` comes from the core info file and falls back to the core library name. |
| `GET_CONFIG_PARAM <name>` | `GET_CONFIG_PARAM <name> <value>`. Supports a limited set of keys (directories, `video_fullscreen`, `savestate_directory`, and so on). |
| `SHOW_MSG <text>` | No reply. Shows an OSD message. |
| `SET_SHADER <path>` | Loads a shader preset. |
| `LOAD_STATE_SLOT <n>` | `LOAD_STATE_SLOT <n>` |
| `READ_CORE_MEMORY <hexaddr> <n>` / `WRITE_CORE_MEMORY <hexaddr> <bytes..>` | Echoes the data, or returns `-1 <error>`. |
| `READ_CORE_RAM` / `WRITE_CORE_RAM` | Legacy versions of the above. |
| `PLAY_REPLAY_SLOT <n>`, `SEEK_REPLAY <frame>`, `SAVE_FILES`, `LOAD_FILES`, `LOAD_CORE <path>` | `SAVE_FILES` flushes SRAM to disk and replies `OK` or `NO`. Use it before killing the process. |

**Hotkey-equivalent commands (no reply):**

| Group | Commands |
|---|---|
| Menu and quit | `MENU_TOGGLE`, `QUIT`, `CLOSE_CONTENT`, `RESET` |
| Speed and timing | `FAST_FORWARD`, `FAST_FORWARD_HOLD`, `SLOWMOTION`, `SLOWMOTION_HOLD`, `REWIND`, `PAUSE_TOGGLE`, `FRAMEADVANCE` |
| Audio | `MUTE`, `VOLUME_UP`, `VOLUME_DOWN` |
| Save states | `LOAD_STATE`, `SAVE_STATE`, `STATE_SLOT_PLUS`, `STATE_SLOT_MINUS` |
| Replays | `PLAY_REPLAY`, `RECORD_REPLAY`, `HALT_REPLAY`, `SAVE_REPLAY_CHECKPOINT`, `PREV_REPLAY_CHECKPOINT`, `NEXT_REPLAY_CHECKPOINT`, `REPLAY_SLOT_PLUS`, `REPLAY_SLOT_MINUS` |
| Disc control | `DISK_EJECT_TOGGLE`, `DISK_NEXT`, `DISK_PREV` |
| Shaders and cheats | `SHADER_TOGGLE`, `SHADER_HOLD`, `SHADER_NEXT`, `SHADER_PREV`, `CHEAT_TOGGLE`, `CHEAT_INDEX_PLUS`, `CHEAT_INDEX_MINUS` |
| Capture | `SCREENSHOT`, `RECORDING_TOGGLE`, `STREAMING_TOGGLE` |
| Display and input toggles | `TURBO_FIRE_TOGGLE`, `GRAB_MOUSE_TOGGLE`, `GAME_FOCUS_TOGGLE`, `FULLSCREEN_TOGGLE`, `UI_COMPANION_TOGGLE`, `VRR_RUNLOOP_TOGGLE`, `RUNAHEAD_TOGGLE`, `PREEMPT_TOGGLE`, `FPS_TOGGLE`, `STATISTICS_TOGGLE`, `AI_SERVICE` |
| Netplay | `NETPLAY_PING_TOGGLE`, `NETPLAY_HOST_TOGGLE`, `NETPLAY_GAME_WATCH`, `NETPLAY_PLAYER_CHAT`, `NETPLAY_FADE_CHAT_TOGGLE` |
| Menu navigation | `MENU_UP`, `MENU_DOWN`, `MENU_LEFT`, `MENU_RIGHT`, `MENU_A`, `MENU_B` |
| Misc | `OVERLAY_NEXT`, `OSK`, `SEND_DEBUG_INFO` |

Notes:
- Some commands are toggles that act once per datagram. `QUIT` respects `quit_press_twice` unless confirmation is disabled.
- For a clean exit, set `quit_press_twice = "false"`, send `SAVE_FILES` (optional), then send `QUIT`. Fall back to killing the process after a timeout.
- `stdin_cmd_enable` accepts the same commands over stdin, which works if you spawn RetroArch with a stdin pipe.

### A5. retroarch.cfg keys for a frontend (all verified to exist in configuration.c v1.22.2)

The file format is `key = "value"`, with every value quoted.

```ini
# Paths
libretro_directory = "C:\RetroDesk\emulators\retroarch\cores"
libretro_info_path = "...\info"
system_directory = "C:\RetroDesk\bios"           # BIOS root (Flycast uses system\dc\, FBNeo uses system\fbneo\, PPSSPP uses system\PPSSPP\)
savefile_directory = "C:\RetroDesk\saves"
savestate_directory = "C:\RetroDesk\states"
screenshot_directory = "C:\RetroDesk\screenshots"
thumbnails_directory = "...\thumbnails"
sort_savefiles_enable = "true"                   # per-core subfolder; also sort_savefiles_by_content_enable / sort_savestates_*_enable / sort_screenshots_by_content_enable
sort_savestates_enable = "true"
savefiles_in_content_dir = "false"
savestates_in_content_dir = "false"
systemfiles_in_content_dir = "false"

# Video
video_driver = "vulkan"                          # vulkan | d3d11 | d3d12 | glcore | gl ("d3d11" is the safest default on Windows; Beetle PSX HW / ParaLLEl prefer vulkan)
video_fullscreen = "true"
video_windowed_fullscreen = "true"               # borderless; avoids exclusive-mode alt-tab issues
video_vsync = "true"
video_smooth = "false"
video_scale_integer = "false"
aspect_ratio_index = "22"                        # 22 = ASPECT_RATIO_CORE (verified in gfx/video_defines.h); 20=config, 21=square pixel, 23=custom, 24=full
video_shader_enable = "false"

# Behaviour
config_save_on_exit = "false"                    # IMPORTANT when the frontend owns the config
pause_nonactive = "false"                        # true pauses when the window loses focus
quit_press_twice = "false"
quit_on_close_content = "1"                      # 0=disabled, 1=enabled, 2=CLI only (quit when content closes)
menu_driver = "ozone"                            # ozone | xmb | rgui | glui
menu_pause_libretro = "true"
suspend_screensaver_enable = "true"
ui_menubar_enable = "false"
video_window_show_decorations = "false"
input_autodetect_enable = "true"
notification_show_autoconfig = "false"
content_runtime_log = "true"                     # per-game playtime logs in playlists/logs/

# Save states
savestate_auto_save = "false"                    # save to .state.auto on exit
savestate_auto_load = "false"                    # load .state.auto on start
savestate_auto_index = "true"
savestate_thumbnail_enable = "true"              # writes <state>.png, useful for the frontend's state picker
savestate_max_keep = "0"
savestate_file_compression = "true"

# Hotkeys
input_enable_hotkey = "nul"                      # keyboard key for the hotkey modifier
input_enable_hotkey_btn = "4"                    # gamepad button index (e.g. Select/Back)
input_menu_toggle_gamepad_combo = "4"            # see enum below
input_quit_gamepad_combo = "0"
input_hotkey_block_delay = "5"
input_exit_emulator = "escape"
input_exit_emulator_btn = "nul"
input_save_state_btn = "nul"                     # pattern: input_<bind>[_btn|_axis|_mbtn]
input_load_state_btn = "nul"
input_state_slot_increase_btn = "nul"
input_state_slot_decrease_btn = "nul"
input_toggle_fast_forward_btn = "nul"
input_toggle_fullscreen = "f"

# Network control
network_cmd_enable = "true"
network_cmd_port = "55355"

# Misc
rewind_enable = "false"
run_ahead_enabled = "false"
log_to_file = "true"
frontend_log_level = "1"
menu_show_core_updater = "false"                 # optional: hide updater menus from users
menu_show_online_updater = "false"
```

**Hotkey bind names** (prefix `input_`, suffixes `_btn`, `_axis`, `_mbtn`; no suffix means a keyboard key):
enable_hotkey, menu_toggle, exit_emulator, close_content, reset, toggle_fast_forward, hold_fast_forward, toggle_slowmotion, hold_slowmotion, rewind, pause_toggle, frame_advance, audio_mute, volume_up, volume_down, load_state, save_state, state_slot_increase, state_slot_decrease, play_replay, record_replay, halt_replay, disk_eject_toggle, disk_next, disk_prev, shader_toggle, shader_next, shader_prev, cheat_toggle, screenshot, recording_toggle, streaming_toggle, turbo_fire_toggle, grab_mouse_toggle, game_focus_toggle, toggle_fullscreen, desktop_menu_toggle, toggle_vrr_runloop, runahead_toggle, preempt_toggle, fps_toggle, toggle_statistics, ai_service, netplay_*, overlay_next, osk_toggle.

**`input_menu_toggle_gamepad_combo` / `input_quit_gamepad_combo` enum** [src: input_defines.h]:

| Value | Combo |
|---|---|
| 0 | None |
| 1 | Down+Y+L+R |
| 2 | L3+R3 |
| 3 | L1+R1+Start+Select |
| 4 | Start+Select |
| 5 | L3+R |
| 6 | L+R |
| 7 | Hold Start |
| 8 | Hold Select |
| 9 | Down+Select |
| 10 | L2+R2 |

### A6. Recommended core per system (all URLs verified 200)

| System | Default core (basename) | Alternatives | Extensions (RA also opens .zip/.7z for cartridge systems) | BIOS (file, md5, required?) |
|---|---|---|---|---|
| NES/FDS | `mesen_libretro` | fceumm, nestopia | nes fds unf unif | disksys.rom `ca30b50f880eb660a320674ed365ef7a` (FDS only) |
| SNES | `snes9x_libretro` | bsnes, mesen-s | sfc smc swc fig bs st | none |
| N64 | `mupen64plus_next_libretro` | parallel_n64 | z64 n64 v64 ndd | none |
| GB / GBC | `gambatte_libretro` | sameboy, mgba | gb gbc dmg | gb_bios.bin / gbc_bios.bin optional |
| GBA | `mgba_libretro` | vbam, gpsp | gba | gba_bios.bin `a860e8c0b6d573d191e4ec7db1b1e4f6` optional |
| NDS | `melondsds_libretro` | desmume | nds dsi ids | bios7.bin `df692a80a5b1bc90728bc3dfc76cd948`, bios9.bin `a392174eb3e572fed6447e956bde4b25`, firmware.bin `e45033d9b0fa6b0de071292bba7c9d13`, all optional (FreeBIOS built in) |
| Virtual Boy | `mednafen_vb_libretro` | | vb vboy bin | none |
| Genesis/MD | `genesis_plus_gx_libretro` | picodrive, blastem | md gen smd bin 68k sgd | bios_MD.bin optional |
| Master System | `genesis_plus_gx_libretro` | gearsystem | sms sg | bios_U/E/J.sms optional |
| Game Gear | `genesis_plus_gx_libretro` | gearsystem | gg | bios.gg optional |
| Sega CD | `genesis_plus_gx_libretro` | picodrive | chd cue iso m3u | **bios_CD_U.bin `2efd74e3232ff260e371b99f84024f7f`** (US), bios_CD_E.bin `e66fa1dc5820d254611fdcdba0662372`, bios_CD_J.bin `278a9397d192149e84e820ac621a8edd`; the BIOS matching the disc's region is required |
| 32X | `picodrive_libretro` | | 32x bin | none |
| Saturn | `mednafen_saturn_libretro` (Beetle Saturn) | ymir (new, on buildbot), kronos, yabasanshiro | chd cue ccd toc m3u | **mpr-17933.bin `3240872c70984b6cbfda1586cab68dbe`** (US/EU), **sega_101.bin `85ec9ca47d8f6807718151cbcca8b964`** (JP); required per region |
| Dreamcast | `flycast_libretro` | | chd gdi cdi cue m3u | dc/dc_boot.bin `e10c53c2f8b90bab96ead2d368858623` optional (HLE), dc/dc_flash.bin optional |
| PS1 | `mednafen_psx_hw_libretro` (Beetle PSX HW) | swanstation, pcsx_rearmed (HLE BIOS), standalone DuckStation | chd cue bin img iso ccd toc m3u pbp exe | **scph5501.bin `490f666e1afb15b7362b406ed1cea246`** (US), scph5500.bin `8dd7d5296a650fac7319bce665a6a53c` (JP), scph5502.bin `32736f17079d0b2b7024407c39bd3050` (EU); Beetle requires the BIOS for the disc's region |
| PSP | `ppsspp_libretro` | standalone PPSSPP | iso cso chd pbp elf prx | `PPSSPP/` asset folder (from PPSSPP.zip) **required** |
| Atari 2600 | `stella_libretro` | | a26 bin | none |
| Atari 7800 | `prosystem_libretro` | | a78 bin cdf | "7800 BIOS (U).rom" `0763f1ffb006ddbe32e52d497ee848ae` optional |
| Lynx | `handy_libretro` | mednafen_lynx | lnx lyx o | lynxboot.img `fcd403db69f54290b51035d82f835e7b` (optional for Handy, required for Beetle Lynx) |
| PCE/TG16 | `mednafen_pce_libretro` | mednafen_pce_fast, geargrafx | pce sgx | none |
| PCE-CD | `mednafen_pce_libretro` | mednafen_pce_fast | chd cue ccd toc m3u | **syscard3.pce `38179df8f4ac870017db21ebcbf53114`** required |
| Arcade / Neo Geo | `fbneo_libretro` | mame2003_plus, mame | zip 7z | neogeo.zip (`00dad01abdbf8ea9e79ad2fe11bdb182` for the current set) required for Neo Geo; place it in the ROM folder or system/fbneo/ |
| WonderSwan / Color | `mednafen_wswan_libretro` | | ws wsc pc2 pcv2 | none |
| NGP / NGPC | `mednafen_ngp_libretro` | race | ngp ngc ngpc npc | none |
| 3DO | `opera_libretro` | | chd cue iso bin | **panafz10.bin `51f2f43ae2f3508a14d9f56597e2d3ce`** (or panafz1.bin `f47264dd47fe30f73ab3c010015c155b` / goldstar.bin `8639fd5e549bd6238cfee79e3e749114`); one is required |
| ColecoVision | `gearcoleco_libretro` | bluemsx | col cv bin rom | **colecovision.rom `2c66f5911e5b42b8ebe113403548eee7`** required |
| MSX/MSX2 | `bluemsx_libretro` | fmsx | rom ri mx1 mx2 dsk cas m3u | `Machines/` + `Databases/` from blueMSX.zip **required**; fMSX instead needs MSX.ROM `aa95aea2563cd5ec0a0919b44cc17d47`, MSX2.ROM `ec3a01c91f24fbddcbcab0ad301bc9ef`, MSX2EXT.ROM `2183c2aff17cf4297bdb496de78c2e8a` |

Notes:
- Beetle PSX HW and ParaLLEl-type cores work best with `video_driver = "vulkan"` (or `glcore`). On d3d11, Beetle PSX HW falls back to its software renderer.
- `melondsds` is the actively maintained melonDS fork. Plain `melonds` is legacy.
- The buildbot also carries `azahar_libretro`, `pcsx2_libretro` (LRPS2), `dolphin_libretro` and `cemu_libretro`. The standalone emulators are better for those systems.

---

## B. Standalone emulators

Full machine-readable data is in `standalone-emulators.json`. Archive layouts were verified by reading zip central directories, or 7z headers, with HTTP range requests.

| Emulator | Source | Windows x64 asset | Exe inside archive | Fullscreen launch args | Portable trigger | Type |
|---|---|---|---|---|---|---|
| **Dolphin** 2609 | `GET https://dolphin-emu.org/update/latest/beta/` returns JSON; use the artifact whose `system` is "Windows x64" | `https://dl.dolphin-emu.org/releases/2609/dolphin-2609-x64.7z` [verified] | `Dolphin-x64/Dolphin.exe` | `-b -C Dolphin.Display.Fullscreen=True -e "{rom}"` | `portable.txt` next to Dolphin.exe | 7z |
| **PCSX2** 2.8.2 | GitHub `PCSX2/pcsx2` (releases/latest = stable; prereleases = nightlies 2.9.x) | `^pcsx2-v[\d.]+-windows-x64-Qt\.7z$` | `pcsx2-qt.exe` (archive root) | `-batch -nogui -fullscreen "{rom}"` [src] | `portable.txt` (or the `-portable` flag) | 7z |
| **RPCS3** 0.0.43-20204 | GitHub `RPCS3/rpcs3-binaries-win`, releases/latest | `^rpcs3-v[\d.]+-\d+-[0-9a-f]+_win64_msvc\.7z$` | `rpcs3.exe` (root) | `--no-gui --fullscreen "{EBOOT.BIN / folder / iso}"` [src] | Always portable | 7z |
| **Eden** 0.2.1 (Switch) | Forgejo: `https://git.eden-emu.dev/api/v1/repos/eden-emu/eden/releases?limit=1` (the GitHub mirror is DMCA-blocked) | `^Eden-Windows-v[\d.]+-amd64-msvc-standard\.zip$`, served from `stable.eden-emu.dev` [verified] | `eden.exe` (root) | `-f -g "{rom}"` [src: launch_params.cpp] | `user/` directory next to exe | zip |
| **Azahar** 2126.1.2 (3DS) | GitHub `azahar-emu/azahar` | `^azahar-windows-msvc-[\d.]+\.zip$` | `azahar-windows-msvc-<ver>/azahar.exe` | `-f "{rom}"` [src] | `user/` next to exe | zip (backslash entry names!) |
| **Cemu** 2.6 (Wii U) | GitHub `cemu-project/Cemu` | `^cemu-[\d.]+-windows-x64\.zip$` | `Cemu_2.6/Cemu.exe` | `-f -g "{rom}"` [src] | `portable/` directory next to exe | zip |
| **xemu** 0.8.136 | GitHub `xemu-project/xemu` | `xemu-win-x86_64-release.zip` (stable alias) [verified] | `xemu.exe` (root) | `-full-screen -dvd_path "{iso}"` [src] | `xemu.toml` next to exe | zip |
| **Vita3K** (continuous) | GitHub `Vita3K/Vita3K`, tag `continuous` | `windows-latest.zip` [verified] | `Vita3K.exe` (root) | `-F -r {TitleID}` [src] | `portable/` directory next to exe | zip |
| **PPSSPP** 1.20.4 | GitHub `hrydgard/ppsspp` | `^PPSSPP-v[\d.]+-Windows-x64\.zip$` | `PPSSPPWindows64.exe` (root) | `--fullscreen --pause-menu-exit "{rom}"` [src] | Portable by default (`memstick/`); `installed.txt` turns it off | zip |
| **DuckStation** (rolling) | GitHub `stenzek/duckstation`, tag `latest` | `duckstation-windows-x64-release.zip` [verified] | `duckstation-qt-x64-ReleaseLTCG.exe` (root) | `-batch -nogui -fullscreen "{rom}"` [src] | `portable.txt` | zip |

**Switch emulator choice.** **Eden** is the only fork with current public Windows release downloads that I could verify:
- Eden: v0.2.1 (2026-06), with a Forgejo API and direct CDN links.
- Citron: last Windows nightly is from 2026-04 (`citron-neo/emulator`).
- Ryubing/Ryujinx: `git.ryujinx.app` did not respond, and the GitHub `Ryubing/*` repos return 404.
- Several GitHub mirrors are DMCA-blocked, so avoid hard-coding GitHub for Switch.

**Runtime prerequisite.** Dolphin, PCSX2, RPCS3, Cemu and Eden-msvc need the VC++ 2015-2022 x64 runtime: `https://aka.ms/vs/17/release/vc_redist.x64.exe` [verified]. Install it silently with `/install /quiet /norestart`. This needs elevation, so ask the user.

**Firmware and keys that users must supply** (these cannot be redistributed):
- PS2: BIOS dump in `<pcsx2>/bios/`.
- PS3: `PS3UPDAT.PUP`, which is free from playstation.com. Install it with `rpcs3.exe --installfw`.
- Switch: `prod.keys` and firmware in `user/keys/`.
- Xbox: `mcpx_1.0.bin` (`d49c52a4102f6df7bcf8d0617ac475ed`) plus a Complex 4627 flash. The HDD image is downloadable from `https://github.com/xemu-project/xemu-dashboard/releases/latest/download/xbox_hdd.qcow2` [verified]. Set the paths in `xemu.toml` under `[sys.files]`.
- Vita: `PSVUPDAT.PUP`, installed with `--firmware`.
- Wii U: `keys.txt`, only for encrypted .wud/.wux dumps.

---

## C. Artwork without API keys: libretro-thumbnails

- **URL pattern:** `https://thumbnails.libretro.com/<System Folder>/<Type>/<Name>.png`
  - URL-encode spaces as `%20`, `,` as `%2C`, and so on.
  - Types are `Named_Boxarts`, `Named_Snaps`, `Named_Titles` and `Named_Logos` (all four verified).
- **Verified examples:**
  - `https://thumbnails.libretro.com/Nintendo%20-%20Super%20Nintendo%20Entertainment%20System/Named_Boxarts/Super%20Mario%20World%20(USA).png` returns 200 image/png, 301 KB.
  - The same URL with Named_Snaps, Named_Titles and Named_Logos also returns 200.
  - Others returning 200: `Legend of Zelda, The (USA)` (NES), `Final Fantasy VII (USA) (Disc 1)` (PS1), and `Metal Slug - Super Vehicle-001` under both "FBNeo - Arcade Games" and "SNK - Neo Geo".
- **GitHub mirror:** `https://raw.githubusercontent.com/libretro-thumbnails/<Folder with spaces→_ and " - "→_-_>/master/<Type>/<Name>.png`, for example `Nintendo_-_Super_Nintendo_Entertainment_System`. Returned 200.
- **Filename rule** [src: gfx/gfx_thumbnail_path.c v1.22.2]: take the No-Intro/Redump name (the ROM filename without extension) and replace each of `& * / : ` " < > ? \ |` with `_`. The double quote is also replaced, so the full set is `&*/:\`"<>?\|`. Real example: `Advanced Dungeons _ Dragons - Eye of the Beholder (USA).png`.
- **Fallback:** RetroArch also tries a "short" name that is truncated at the first ` (`. Few files on the server use short names (`Super Mario World.png` returns 404), so fuzzy matching against the directory listing works better.
- **Directory listings** are browsable HTML, for example `GET https://thumbnails.libretro.com/<Folder>/Named_Boxarts/`. Fetch one per system, cache it, and fuzzy-match ROM names (strip tags, normalise case and punctuation). The listings are large (SNES is thousands of entries) but static.
- **Region fallback:** if `(USA)` is missing, try `(USA, Europe)`, `(World)`, `(Europe)`, then `(Japan)` by matching the title prefix in the cached listing.

**Folder names per system** (exact, from the server root listing):

| id | Folder | id | Folder |
|---|---|---|---|
| nes | Nintendo - Nintendo Entertainment System | psx | Sony - PlayStation |
| snes | Nintendo - Super Nintendo Entertainment System | ps2 | Sony - PlayStation 2 |
| n64 | Nintendo - Nintendo 64 | ps3 | Sony - PlayStation 3 (67 boxarts) |
| gb | Nintendo - Game Boy | psp | Sony - PlayStation Portable |
| gbc | Nintendo - Game Boy Color | vita | Sony - PlayStation Vita (9 boxarts) |
| gba | Nintendo - Game Boy Advance | gc | Nintendo - GameCube |
| nds | Nintendo - Nintendo DS | wii | Nintendo - Wii |
| 3ds | Nintendo - Nintendo 3DS | wiiu | Nintendo - Wii U |
| vb | Nintendo - Virtual Boy | switch | none (no folder exists) |
| genesis | Sega - Mega Drive - Genesis | xbox | Microsoft - Xbox |
| sms | Sega - Master System - Mark III | atari2600 | Atari - 2600 |
| gg | Sega - Game Gear | atari7800 | Atari - 7800 |
| segacd | Sega - Mega-CD - Sega CD | lynx | Atari - Lynx |
| 32x | Sega - 32X | pce | NEC - PC Engine - TurboGrafx 16 |
| saturn | Sega - Saturn | pcecd | NEC - PC Engine CD - TurboGrafx-CD |
| dreamcast | Sega - Dreamcast | arcade | FBNeo - Arcade Games (or "MAME") |
| neogeo | SNK - Neo Geo | ws / wsc | Bandai - WonderSwan / Bandai - WonderSwan Color |
| ngp / ngpc | SNK - Neo Geo Pocket / SNK - Neo Geo Pocket Color | 3do | The 3DO Company - 3DO |
| coleco | Coleco - ColecoVision | msx | Microsoft - MSX (and Microsoft - MSX2) |

Arcade thumbnails use the full game description (for example "Metal Slug - Super Vehicle-001"), not the zip shortname (`mslug`). Map shortnames through the FBNeo DAT: `https://raw.githubusercontent.com/libretro/FBNeo/master/dats/FinalBurn%20Neo%20(ClrMame%20Pro%20XML%2C%20Arcade%20only).dat`. That DAT URL is unverified.

**Scrapers that need keys (for later):**
- **ScreenScraper:** needs developer credentials (`devid`/`devpassword`, requested from the ScreenScraper team) plus an optional user account for higher quotas. It has the best metadata and media, but is rate-limited per user.
- **TheGamesDB:** needs an API key requested on their forum. Public keys have a monthly quota.
- **IGDB:** needs a Twitch developer app (Client ID + Client Secret) and an OAuth client-credentials token. It is free but cannot be redistributed in a client app without exposing the secret, so a proxy is needed.

---

## D. 7z extraction from Node on Windows (checked on this machine)

- **`7zip-bin` 5.2.0 is installed.** The Windows x64 binary is `node_modules\7zip-bin\win\x64\7za.exe` (7-Zip (a) 21.07). In code, use `require('7zip-bin').path7za`, which resolves the right arch.
  - Other binaries: `win\ia32\7za.exe`, `win\arm64\7za.exe`.
  - **electron-builder:** the binary is inside `app.asar` and cannot be executed from there. Add `"asarUnpack": ["node_modules/7zip-bin/**"]` and replace `app.asar` with `app.asar.unpacked` in the path at runtime.
  - Usage: `spawn(path7za, ['x', archive, '-o' + dest, '-y', '-bsp1'])`. `-bsp1` streams progress percentages to stdout.
- **Windows `tar.exe`** (`C:\Windows\System32\tar.exe`) is **bsdtar 3.8.8, libarchive 3.8.8** with liblzma/zstd/bz2. **Tested:** it extracted an LZMA2 `.7z` made by 7za correctly (`tar -xf test.7z -C out`). It is usable as a fallback, but prefer 7za. libarchive's 7z support has gaps (some BCJ2 and PPMd edge cases, no encrypted archives).
  - The `tar` found first on PATH in Git Bash is GNU tar 1.35, which cannot read 7z. Always call `C:\Windows\System32\tar.exe` explicitly.
- **Zip files:** 7za handles them, and so does Windows tar. The Azahar zip uses `\` as the path separator inside entries. 7za and bsdtar map that to folders, but pure-JS unzip libraries (adm-zip, yauzl) may produce filenames containing backslashes. Use 7za for everything.

---

## E. RetroAchievements in RetroArch (keys verified in configuration.c)

```ini
cheevos_enable = "true"
cheevos_username = "user"
cheevos_password = "pass"            # used once at login; RetroArch then stores cheevos_token and blanks the password
cheevos_token = ""                   # API token persisted after a successful login (write it to reuse the session)
cheevos_hardcore_mode_enable = "false"   # hardcore disables save-state loading, rewind, slow-motion and cheats
cheevos_richpresence_enable = "true"
cheevos_badges_enable = "true"
cheevos_unlock_sound_enable = "true"
cheevos_auto_screenshot = "false"
cheevos_challenge_indicators = "true"
# cheevos_leaderboards_enable is DEPRECATED in 1.22 (still parsed); use cheevos_visibility_lboard_* instead
cheevos_test_unofficial = "false"
cheevos_start_active = "false"
cheevos_verbose_enable = "true"
# Others: cheevos_visibility_{unlock,mastery,account,summary,progress_tracker,lboard_start,lboard_submit,lboard_cancel,lboard_trackers},
#   cheevos_appearance_{anchor,padding_auto,padding_h,padding_v}, cheevos_custom_host
```

The frontend flow:
1. Collect the username and password in the RetroDesk UI.
2. Write them to the appended cfg with `config_save_on_exit` enabled for one run, or log in through the RA web API (`https://retroachievements.org/dorequest.php?r=login2`) to get a token yourself.
3. Store only `cheevos_username` and `cheevos_token`. Never keep the plaintext password on disk.

Hardcore mode blocks state loads, so the save-state UI for that game should be disabled in RetroDesk too.
