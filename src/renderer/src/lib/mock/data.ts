import type { EmulatorStatus, SystemDef } from '@shared/types'

/** Browser-preview fixture data. Only used when window.retrodesk is absent. */

const ra = (core: string, isDefault = false) => ({ type: 'retroarch' as const, core, ...(isDefault ? { default: true } : {}) })
const sa = (id: string, isDefault = false) => ({ type: 'standalone' as const, id, ...(isDefault ? { default: true } : {}) })

// prettier-ignore
export const MOCK_SYSTEMS: SystemDef[] = [
  { id: 'nes', name: 'Nintendo Entertainment System', shortName: 'NES', manufacturer: 'Nintendo', year: 1983, generation: 3, extensions: ['.nes'], emulators: [ra('mesen', true), ra('fceumm')], bios: [], color: '#e0383e' },
  { id: 'snes', name: 'Super Nintendo', shortName: 'SNES', manufacturer: 'Nintendo', year: 1990, generation: 4, extensions: ['.sfc', '.smc'], emulators: [ra('snes9x', true), ra('bsnes')], bios: [], color: '#7357e8' },
  { id: 'n64', name: 'Nintendo 64', shortName: 'N64', manufacturer: 'Nintendo', year: 1996, generation: 5, extensions: ['.z64', '.n64', '.v64'], emulators: [ra('mupen64plus_next', true)], bios: [], color: '#1fa463' },
  { id: 'gb', name: 'Game Boy', shortName: 'GB', manufacturer: 'Nintendo', year: 1989, generation: 4, extensions: ['.gb'], emulators: [ra('gambatte', true), ra('mgba')], bios: [], color: '#8bac0f' },
  { id: 'gbc', name: 'Game Boy Color', shortName: 'GBC', manufacturer: 'Nintendo', year: 1998, generation: 5, extensions: ['.gbc'], emulators: [ra('gambatte', true), ra('mgba')], bios: [], color: '#d9418c' },
  { id: 'gba', name: 'Game Boy Advance', shortName: 'GBA', manufacturer: 'Nintendo', year: 2001, generation: 6, extensions: ['.gba'], emulators: [ra('mgba', true)], bios: [], color: '#4a3fc4' },
  { id: 'nds', name: 'Nintendo DS', shortName: 'NDS', manufacturer: 'Nintendo', year: 2004, generation: 7, extensions: ['.nds'], emulators: [sa('melonds', true), ra('melondsds')], bios: [], color: '#3a86f0' },
  { id: 'genesis', name: 'Sega Genesis / Mega Drive', shortName: 'MD', manufacturer: 'Sega', year: 1988, generation: 4, extensions: ['.md', '.gen', '.bin'], emulators: [ra('genesis_plus_gx', true)], bios: [], color: '#2563eb' },
  { id: 'saturn', name: 'Sega Saturn', shortName: 'SAT', manufacturer: 'Sega', year: 1994, generation: 5, extensions: ['.cue', '.chd'], emulators: [ra('mednafen_saturn', true)], bios: [{ file: 'sega_101.bin', md5: '85ec9ca47d8f6807718151cbcca8b964', required: true, description: 'Saturn BIOS (JP)' }], color: '#5b6b8c' },
  { id: 'dreamcast', name: 'Dreamcast', shortName: 'DC', manufacturer: 'Sega', year: 1998, generation: 6, extensions: ['.gdi', '.cdi', '.chd'], emulators: [ra('flycast', true)], bios: [{ file: 'dc/dc_boot.bin', md5: 'e10c53c2f8b90bab96ead2d368858623', required: false, description: 'Dreamcast BIOS' }], color: '#f26b1d' },
  { id: 'psx', name: 'PlayStation', shortName: 'PS1', manufacturer: 'Sony', year: 1994, generation: 5, extensions: ['.cue', '.chd', '.pbp', '.m3u'], emulators: [sa('duckstation', true), ra('swanstation')], bios: [{ file: 'scph5501.bin', md5: '490f666e1afb15b7362b406ed1cea246', required: true, description: 'PS1 BIOS (USA)' }, { file: 'scph5502.bin', md5: '32736f17079d0b2b7024407c39bd3050', required: false, description: 'PS1 BIOS (Europe)' }], color: '#9aa3b8' },
  { id: 'ps2', name: 'PlayStation 2', shortName: 'PS2', manufacturer: 'Sony', year: 2000, generation: 6, extensions: ['.iso', '.chd'], emulators: [sa('pcsx2', true)], bios: [{ file: 'ps2-0230a-20080220.bin', md5: '', required: true, description: 'PS2 BIOS (USA v2.30)' }], color: '#2f49c8' },
  { id: 'psp', name: 'PlayStation Portable', shortName: 'PSP', manufacturer: 'Sony', year: 2004, generation: 7, extensions: ['.iso', '.cso', '.chd'], emulators: [sa('ppsspp', true)], bios: [], color: '#6b7085' },
  { id: 'gc', name: 'GameCube', shortName: 'GC', manufacturer: 'Nintendo', year: 2001, generation: 6, extensions: ['.iso', '.rvz', '.gcz'], emulators: [sa('dolphin', true)], bios: [], color: '#6c4fd0' },
  { id: '3ds', name: 'Nintendo 3DS', shortName: '3DS', manufacturer: 'Nintendo', year: 2011, generation: 8, extensions: ['.3ds', '.cci'], emulators: [sa('azahar', true)], bios: [], color: '#d32f3c' },
  { id: 'arcade', name: 'Arcade', shortName: 'ARC', manufacturer: 'FinalBurn Neo', year: 1978, extensions: ['.zip'], emulators: [ra('fbneo', true)], bios: [{ file: 'neogeo.zip', md5: '', required: false, description: 'Neo Geo BIOS' }], color: '#e8b10e' }
]

// prettier-ignore
export const MOCK_GAMES: Record<string, string[]> = {
  nes: ['Super Mario Bros. 3 (USA)', 'The Legend of Zelda (USA)', 'Mega Man 2 (USA)', 'Metroid (USA)', 'Castlevania (USA)', 'Contra (USA)', 'Kirby\'s Adventure (USA)', 'Punch-Out!! (USA)', 'Duck Tales (USA)', 'Ninja Gaiden (USA)', 'Final Fantasy (USA)', 'Tetris (USA)', 'Dr. Mario (Japan, USA)', 'Excitebike (Japan, USA)'],
  snes: ['Super Mario World (USA)', 'The Legend of Zelda - A Link to the Past (USA)', 'Super Metroid (Japan, USA) (En,Ja)', 'Chrono Trigger (USA)', 'Final Fantasy III (USA) (Rev 1)', 'Donkey Kong Country (USA) (Rev 2)', 'EarthBound (USA)', 'Super Mario Kart (USA)', 'Secret of Mana (USA)', 'Mega Man X (USA)', 'Street Fighter II Turbo (USA)', 'F-Zero (USA)', 'Kirby Super Star (USA)', 'Yoshi\'s Island (USA)', 'Star Fox (USA)', 'Super Castlevania IV (USA)', 'Contra III - The Alien Wars (USA)', 'ActRaiser (USA)'],
  n64: ['Super Mario 64 (USA)', 'The Legend of Zelda - Ocarina of Time (USA) (Rev 2)', 'Mario Kart 64 (USA)', 'GoldenEye 007 (USA)', 'Banjo-Kazooie (USA)', 'Star Fox 64 (USA)', 'Paper Mario (USA)', 'Super Smash Bros. (USA)', 'F-Zero X (USA)', 'Wave Race 64 (USA)', 'Majora\'s Mask (USA)'],
  gb: ['Tetris (World) (Rev 1)', 'Pokemon - Red Version (USA, Europe)', 'The Legend of Zelda - Link\'s Awakening (USA, Europe)', 'Super Mario Land 2 - 6 Golden Coins (USA, Europe)', 'Kirby\'s Dream Land (USA, Europe)', 'Metroid II - Return of Samus (World)', 'Wario Land - Super Mario Land 3 (World)'],
  gbc: ['Pokemon - Crystal Version (USA, Europe)', 'The Legend of Zelda - Oracle of Ages (USA)', 'The Legend of Zelda - Oracle of Seasons (USA)', 'Shantae (USA)', 'Wario Land 3 (World) (En,Ja)', 'Dragon Warrior Monsters (USA)', 'Pokemon Pinball (USA)'],
  gba: ['Metroid Fusion (USA)', 'The Legend of Zelda - The Minish Cap (USA)', 'Pokemon - Emerald Version (USA, Europe)', 'Advance Wars (USA)', 'Golden Sun (USA, Europe)', 'Castlevania - Aria of Sorrow (USA)', 'Fire Emblem (USA, Australia)', 'Mario & Luigi - Superstar Saga (USA)', 'WarioWare, Inc. - Mega Microgame$! (USA)', 'Metroid - Zero Mission (USA)', 'Mother 3 (Japan) (Translated En)', 'F-Zero - Maximum Velocity (USA, Europe)', 'Kirby & The Amazing Mirror (USA)'],
  nds: ['New Super Mario Bros. (USA)', 'Mario Kart DS (USA, Australia) (En,Fr,De,Es,It)', 'The World Ends with You (USA)', 'Phoenix Wright - Ace Attorney (USA) (En,Ja,Fr)', 'Professor Layton and the Curious Village (USA)', 'Pokemon - HeartGold Version (USA)', 'Castlevania - Dawn of Sorrow (USA)', 'Chrono Trigger (USA) (En,Fr)'],
  genesis: ['Sonic the Hedgehog 2 (World) (Rev A)', 'Streets of Rage 2 (USA)', 'Gunstar Heroes (USA)', 'Phantasy Star IV (USA)', 'Sonic & Knuckles (World)', 'Shinobi III - Return of the Ninja Master (USA)', 'Ecco the Dolphin (USA, Europe)', 'Castlevania - Bloodlines (USA)', 'Comix Zone (USA)', 'Rocket Knight Adventures (USA)', 'Vectorman (USA, Europe)'],
  dreamcast: ['Sonic Adventure (USA) (En,Ja,Fr,De,Es)', 'Jet Grind Radio (USA)', 'Crazy Taxi (USA)', 'Soulcalibur (USA)', 'Shenmue (USA) (Disc 1)', 'Skies of Arcadia (USA) (Disc 1)', 'Power Stone 2 (USA)'],
  psx: ['Final Fantasy VII (USA) (Disc 1)', 'Castlevania - Symphony of the Night (USA)', 'Metal Gear Solid (USA) (Disc 1) (Rev 1)', 'Crash Bandicoot (USA)', 'Spyro the Dragon (USA)', 'Tekken 3 (USA)', 'Resident Evil 2 (USA) (Disc 1)', 'Gran Turismo 2 (USA) (Rev 1)', 'Silent Hill (USA)', 'Chrono Cross (USA) (Disc 1)', 'Tony Hawk\'s Pro Skater 2 (USA)', 'Ape Escape (USA)', 'Vagrant Story (USA)', 'Suikoden II (USA)'],
  ps2: ['Shadow of the Colossus (USA)', 'Final Fantasy X (USA)', 'Kingdom Hearts (USA)', 'Okami (USA)', 'Persona 4 (USA)', 'Ratchet & Clank (USA)', 'Jak and Daxter - The Precursor Legacy (USA)', 'Ico (USA)', 'Burnout 3 - Takedown (USA)'],
  psp: ['Crisis Core - Final Fantasy VII (USA)', 'Monster Hunter Freedom Unite (USA)', 'Patapon (USA)', 'Lumines (USA)', 'God of War - Chains of Olympus (USA)', 'Persona 3 Portable (USA)', 'Daxter (USA)'],
  gc: ['The Legend of Zelda - The Wind Waker (USA)', 'Metroid Prime (USA)', 'Super Smash Bros. Melee (USA) (Rev 2)', 'Paper Mario - The Thousand-Year Door (USA)', 'F-Zero GX (USA)', 'Pikmin (USA)', 'Super Mario Sunshine (USA)', 'Luigi\'s Mansion (USA)', 'Animal Crossing (USA)'],
  arcade: ['Street Fighter III 3rd Strike', 'Metal Slug X', 'The King of Fighters \'98', 'Galaga', 'Ms. Pac-Man', 'Donkey Kong', 'Pac-Man', 'Final Fight', 'Teenage Mutant Ninja Turtles', 'Dodonpachi', 'Out Run']
}

/** Extra word lists to synthesise thousands of plausible titles for performance testing (?mockGames=5000). */
export const SYNTH_A = ['Super', 'Mega', 'Ultra', 'Neo', 'Hyper', 'Turbo', 'Final', 'Legend of', 'Dragon', 'Star', 'Shadow', 'Pixel', 'Crystal', 'Iron', 'Thunder', 'Galaxy', 'Ninja', 'Cyber', 'Royal', 'Midnight']
export const SYNTH_B = ['Quest', 'Racer', 'Fighter', 'Warriors', 'Kingdom', 'Odyssey', 'Blaster', 'Hunter', 'Saga', 'Force', 'Tactics', 'Rally', 'Island', 'Dungeon', 'Arena', 'Chronicles', 'Squadron', 'Labyrinth', 'Frontier', 'Paradise']

export const MOCK_EMULATORS: EmulatorStatus[] = [
  { id: 'retroarch', kind: 'retroarch', name: 'RetroArch', systems: ['nes', 'snes', 'n64', 'gb', 'gbc', 'gba', 'genesis', 'saturn', 'dreamcast', 'arcade', 'psx', 'nds'], installed: true, version: '1.21.0', installPath: 'C:\\Users\\you\\RetroDesk\\emulators\\retroarch', sizeBytes: 512_000_000 },
  { id: 'core:mesen', kind: 'core', name: 'Mesen', systems: ['nes'], installed: true, version: '0.9.9', sizeBytes: 4_100_000 },
  { id: 'core:fceumm', kind: 'core', name: 'FCEUmm', systems: ['nes'], installed: false },
  { id: 'core:snes9x', kind: 'core', name: 'Snes9x', systems: ['snes'], installed: true, version: '1.63', sizeBytes: 3_200_000 },
  { id: 'core:bsnes', kind: 'core', name: 'bsnes', systems: ['snes'], installed: false },
  { id: 'core:mupen64plus_next', kind: 'core', name: 'Mupen64Plus-Next', systems: ['n64'], installed: true, version: '2.6', sizeBytes: 9_800_000 },
  { id: 'core:gambatte', kind: 'core', name: 'Gambatte', systems: ['gb', 'gbc'], installed: true, version: '0.5.0', sizeBytes: 1_100_000 },
  { id: 'core:mgba', kind: 'core', name: 'mGBA', systems: ['gb', 'gbc', 'gba'], installed: true, version: '0.10.3', sizeBytes: 2_800_000 },
  { id: 'core:melondsds', kind: 'core', name: 'melonDS DS', systems: ['nds'], installed: false },
  { id: 'core:genesis_plus_gx', kind: 'core', name: 'Genesis Plus GX', systems: ['genesis'], installed: true, version: '1.7.4', sizeBytes: 3_900_000 },
  { id: 'core:mednafen_saturn', kind: 'core', name: 'Beetle Saturn', systems: ['saturn'], installed: false },
  { id: 'core:flycast', kind: 'core', name: 'Flycast', systems: ['dreamcast'], installed: false },
  { id: 'core:swanstation', kind: 'core', name: 'SwanStation', systems: ['psx'], installed: false },
  { id: 'core:fbneo', kind: 'core', name: 'FinalBurn Neo', systems: ['arcade'], installed: true, version: '1.0.0.3', sizeBytes: 38_000_000 },
  { id: 'duckstation', kind: 'standalone', name: 'DuckStation', systems: ['psx'], installed: true, version: '0.1-7294', sizeBytes: 64_000_000 },
  { id: 'pcsx2', kind: 'standalone', name: 'PCSX2', systems: ['ps2'], installed: false },
  { id: 'ppsspp', kind: 'standalone', name: 'PPSSPP', systems: ['psp'], installed: true, version: '1.19.3', sizeBytes: 71_000_000 },
  { id: 'dolphin', kind: 'standalone', name: 'Dolphin', systems: ['gc'], installed: false },
  { id: 'melonds', kind: 'standalone', name: 'melonDS', systems: ['nds'], installed: false },
  { id: 'azahar', kind: 'standalone', name: 'Azahar', systems: ['3ds'], installed: false }
]
