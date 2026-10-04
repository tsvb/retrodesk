# Contract requests from the renderer

Requests from the frontend (src/renderer) for main, preload and shared.

Status: 1 to 4 are implemented and the renderer now uses them (label/local fallbacks remain for older backends). 5 is still open.

## 1. Allow UI sounds without a click (main, BrowserWindow options)
Add `autoplayPolicy: 'no-user-gesture-required'` to `webPreferences` for both the main and overlay windows. Chromium does not count gamepad presses as a user gesture, so a controller-only user hears no UI sounds until they click or press a key.
*Workaround:* the AudioContext is unlocked on the first pointer or keyboard event.

## 2. Settings-changed event (shared/api.ts, preload, main)
Add `on.settingsChanged(cb: (s: Settings) => void)`, broadcast from `updateSettings()`. The overlay and main windows each hold their own copy of the settings. Without the event, a theme, accent, button-layout or combo change in one window is not seen by the other until it reloads.
*Workaround:* the overlay reloads settings each time it opens, and the main window reloads them when it regains focus.

## 3. Bind task progress to its subject (shared/types.ts `TaskProgress`)
Add an optional `subject?: { kind: 'emulator' | 'system' | 'scan' | 'artwork' | 'import'; id?: string }`. The Emulators page and the launch dialog need to know which install a task belongs to.
*Workaround:* the renderer matches running tasks by text: label contains the emulator name, or /install/i, /scan/i, /art/i. Please keep labels of the form `Installing <EmulatorStatus.name>`, `Scanning …` and `Downloading artwork …`.

## 4. Session state for the quick menu (shared/types.ts `SessionInfo`)
Add `fastForward: boolean`, and if possible `paused: boolean`. The overlay shows Fast forward as a toggle and currently tracks it locally, so the toggle resets when the overlay reopens.

## 5. Optional: FPS in `SystemStats`
`fps?: number` (from RetroArch `GET_STATUS` or PresentMon) would complete the Game Assist stats card, matching the handheld's FPS counter.
