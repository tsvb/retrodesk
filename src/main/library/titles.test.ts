import { describe, expect, it } from 'vitest'
import { matchKey, moveTrailingArticle, parseRegionGroup, parseRomName } from './titles'

describe('parseRomName', () => {
  const cases: [string, string, string[], string[]][] = [
    ['Legend of Zelda, The - A Link to the Past (USA) (Rev 1) [!]', 'The Legend of Zelda: A Link to the Past', ['USA'], ['Rev 1']],
    ['Super Mario World (USA)', 'Super Mario World', ['USA'], []],
    ['Final Fantasy VII (USA) (Disc 1)', 'Final Fantasy VII', ['USA'], ['Disc 1']],
    ['Sonic the Hedgehog (USA, Europe)', 'Sonic the Hedgehog', ['USA', 'Europe'], []],
    ['Pokemon - Red Version (USA, Europe) (SGB Enhanced)', 'Pokemon: Red Version', ['USA', 'Europe'], ['SGB Enhanced']],
    ['Star Wars - Episode I - Racer (USA)', 'Star Wars: Episode I - Racer', ['USA'], []],
    ['Boy and His Blob, A - Trouble on Blobolonia (USA)', 'A Boy and His Blob: Trouble on Blobolonia', ['USA'], []],
    ['Simpsons, The - Bart vs. the Space Mutants (Europe) (Beta)', 'The Simpsons: Bart vs. the Space Mutants', ['Europe'], ['Beta']],
    ['Metal Slug - Super Vehicle-001', 'Metal Slug: Super Vehicle-001', [], []],
    ['Pac-Man 2 - The New Adventures (USA)', 'Pac-Man 2: The New Adventures', ['USA'], []],
    ['Chrono Trigger (Japan) (En,Fr,De) (Proto)', 'Chrono Trigger', ['Japan'], ['En,Fr,De', 'Proto']],
    ['Street Fighter II (U) [!]', 'Street Fighter II', ['USA'], []],
    ['Bomberman (JUE) [b1]', 'Bomberman', ['Japan', 'USA', 'Europe'], ['b1']],
    ['Lemmings (1991)(Psygnosis)(US-EU)[cr]', 'Lemmings', ['USA', 'Europe'], ['1991', 'Psygnosis', 'cr']],
    ['Asterix (De)', 'Asterix', [], ['De']],
    ['Tetris (World) (Rev A)', 'Tetris', ['World'], ['Rev A']],
    ['super_mario_world', 'super mario world', [], []],
    ["Aventure, L' (France)", "L'Aventure", ['France'], []],
    ['Mario Kart 8 [AMKE01]', 'Mario Kart 8', [], ['AMKE01']],
    ['Daiku no Gen-san (Japan, Korea)', 'Daiku no Gen-san', ['Japan', 'Korea'], []],
    ['Hong Kong 97 (Japan) (Unl)', 'Hong Kong 97', ['Japan'], ['Unl']],
    ['Game (Hong Kong)', 'Game', ['Hong Kong'], []],
    ['(Prototype only)', '(Prototype only)', [], ['Prototype only']]
  ]
  for (const [raw, title, regions, tags] of cases) {
    it(raw, () => {
      const p = parseRomName(raw)
      expect(p.title).toBe(title)
      expect(p.regions).toEqual(regions)
      expect(p.tags).toEqual(tags)
    })
  }

  it('keeps hyphenated words and lone dashes intact', () => {
    expect(parseRomName('Spider-Man (USA)').title).toBe('Spider-Man')
    expect(parseRomName('X-Men - Mutant Apocalypse (USA)').title).toBe('X-Men: Mutant Apocalypse')
  })
})

describe('regions', () => {
  it('parses comma lists, TOSEC and GoodTools codes', () => {
    expect(parseRegionGroup('USA, Europe, Brazil')).toEqual(['USA', 'Europe', 'Brazil'])
    expect(parseRegionGroup('JP-US')).toEqual(['Japan', 'USA'])
    expect(parseRegionGroup('UE')).toEqual(['USA', 'Europe'])
    expect(parseRegionGroup('Rev 1')).toBeUndefined()
    expect(parseRegionGroup('En,Ja')).toBeUndefined()
    expect(parseRegionGroup('Fr')).toBeUndefined()
  })
})

describe('articles', () => {
  it('moves trailing articles to the front', () => {
    expect(moveTrailingArticle('Legend of Zelda, The')).toBe('The Legend of Zelda')
    expect(moveTrailingArticle('Addams Family, The')).toBe('The Addams Family')
    expect(moveTrailingArticle('Siedler, Die')).toBe('Die Siedler')
    expect(moveTrailingArticle('Bubble Bobble, Part 2')).toBe('Bubble Bobble, Part 2')
  })
})

describe('matchKey', () => {
  it('makes No-Intro and display names collide', () => {
    expect(matchKey('Legend of Zelda, The - A Link to the Past (USA)')).toBe(matchKey('The Legend of Zelda: A Link to the Past'))
    expect(matchKey('Legend of Zelda, The - A Link to the Past (USA)')).toBe('legendofzeldalinktothepast')
    expect(matchKey('Advanced Dungeons _ Dragons - Eye of the Beholder (USA)')).toBe(matchKey('Advanced Dungeons & Dragons - Eye of the Beholder (Japan)'))
    expect(matchKey('Pokémon Stadium')).toBe(matchKey('Pokemon Stadium (Europe)'))
  })
})
