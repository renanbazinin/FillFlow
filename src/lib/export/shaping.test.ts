import fontkit from '@pdf-lib/fontkit'
import { describe, expect, it } from 'vitest'
import { firstStrongDirection, hasMissingGlyphs, paintableText, shapeLine, shapeText, visualRuns } from './shaping'
import { testFont, testFontBytes } from './testing/fonts'

const sans = testFont('sans', false)
const mono = testFont('mono', false)

/** Characters of each glyph in visual order. */
function visual(text: string, base?: 'ltr' | 'rtl'): string {
  return shapeLine(sans, text, base)
    .flatMap((r) => r.glyphs.map((g) => String.fromCodePoint(...g.codePoints)))
    .join('')
}

describe('visualRuns', () => {
  it('keeps pure LTR text as one run', () => {
    expect(visualRuns('Hello, world 123')).toEqual([{ start: 0, end: 16, level: 0, rtl: false, text: 'Hello, world 123' }])
  })

  it('orders an RTL paragraph with embedded Latin right-to-left', () => {
    const runs = visualRuns('שלום Hello')
    expect(runs.map((r) => [r.start, r.end, r.rtl])).toEqual([
      [5, 10, false],
      [0, 5, true],
    ])
  })

  it('places an RTL run inside an LTR paragraph', () => {
    const runs = visualRuns('Hello שלום world')
    expect(runs.map((r) => [r.start, r.end, r.rtl])).toEqual([
      [0, 6, false],
      [6, 10, true],
      [10, 16, false],
    ])
  })

  it('keeps numbers left-to-right inside RTL text', () => {
    const runs = visualRuns('מספר 123')
    expect(runs.map((r) => [line(r), r.rtl])).toEqual([
      ['123', false],
      ['מספר ', true],
    ])
    function line(r: { start: number; end: number }) {
      return 'מספר 123'.slice(r.start, r.end)
    }
  })

  it('mirrors brackets in RTL runs', () => {
    const [run] = visualRuns('(שלום)')
    expect(run.rtl).toBe(true)
    expect(run.text).toBe(')שלום(')
  })

  it('honours a forced base direction', () => {
    expect(visualRuns('Hello!', 'rtl').map((r) => [r.start, r.end, r.rtl])).toEqual([
      [5, 6, true],
      [0, 5, false],
    ])
  })
})

describe('shapeLine', () => {
  it('produces glyphs in visual order for Hebrew', () => {
    expect(visual('שלום')).toBe('םולש')
  })

  it('does not reverse Latin that follows Hebrew (fontkit would)', () => {
    expect(visual('שלום Hello')).toBe('Hello םולש')
    expect(visual('Hello שלום')).toBe('Hello םולש')
  })

  it('renders mirrored brackets correctly', () => {
    expect(visual('(שלום)')).toBe('(םולש)')
    expect(visual('שלום (עולם)')).toBe('(םלוע) םולש')
  })

  it('tells the characters each glyph stands for: a mirrored bracket stands for the bracket typed', () => {
    const [run] = shapeLine(sans, '(שלום)')
    expect(run.glyphs.map((g) => String.fromCodePoint(...g.codePoints)).join('')).toBe('(םולש)')
    expect(run.chars.join('')).toBe(')םולש(')
    expect(run.typed).toEqual(['(', 'ש', 'ל', 'ו', 'ם', ')'])
    // Left-to-right brackets, and glyphs composed of several characters, stand for their own code points.
    for (const text of ['(abc)', 'שָׁלוֹם']) {
      for (const r of shapeLine(sans, text)) expect(r.chars).toEqual(r.glyphs.map((g) => String.fromCodePoint(...g.codePoints)))
    }
    // The clusters keep their points in the order typed, though the shin dot is composed first.
    const shalom = shapeText(sans, 'שָׁל', 'rtl')
    expect(shalom.typed).toEqual(['שָׁ', 'ל'])
    expect(shalom.chars).toContain('שׁ')
  })

  it('handles numbers and punctuation in Hebrew sentences', () => {
    expect(visual('מספר 123.')).toBe('.123 רפסמ')
    expect(visual('טלפון: 03-1234567')).toBe('03-1234567 :ןופלט')
  })

  it('positions combining marks with GPOS offsets', () => {
    const { glyphs, positions } = shapeText(sans, 'é', 'ltr')
    expect(glyphs).toHaveLength(2)
    expect(positions[1].xAdvance).toBe(0)
    expect(positions[1].xOffset).not.toBe(0)
  })

  it('composes dagesh and shin/sin dots with their letter whatever the order of the points', () => {
    const composed = (text: string) => shapeText(sans, text, 'rtl').glyphs.map((g) => g.codePoints)
    // Canonical order puts the vowel first: shin, qamats, shin dot.
    expect(composed('\u05E9\u05B8\u05C1')).toEqual(composed('\u05E9\u05C1\u05B8'))
    expect(composed('\u05E9\u05B8\u05C1')).toContainEqual([0x5e9, 0x5c1])
    // Bet, qamats, dagesh.
    expect(composed('\u05D1\u05B8\u05BC')).toContainEqual([0x5d1, 0x5bc])
    // Shin, qamats, dagesh, shin dot.
    expect(composed('\u05E9\u05B8\u05BC\u05C1')).toContainEqual([0x5e9, 0x5bc, 0x5c1])
    // The vowel is still positioned on the composed letter.
    const { glyphs, positions } = shapeText(sans, '\u05E9\u05B8\u05C1', 'rtl')
    expect(positions[glyphs.findIndex((g) => g.codePoints[0] === 0x5b8)].xOffset).toBeGreaterThan(0)
  })

  it('places a point the same way whether or not the letter before it is pointed, as browsers do', () => {
    /** Where `point` is drawn relative to the first `letter`, in font units. */
    const offset = (font: ReturnType<typeof testFont>, text: string, letter: number, point: number) => {
      const { glyphs, positions } = shapeText(font, text, 'rtl')
      const at: [number, number][] = []
      let pen = 0
      glyphs.forEach((_, i) => {
        at.push([pen + positions[i].xOffset, positions[i].yOffset])
        pen += positions[i].xAdvance
      })
      const l = glyphs.findIndex((g) => g.codePoints[0] === letter)
      const p = glyphs.findIndex((g) => g.codePoints[0] === point)
      return [at[p][0] - at[l][0], at[p][1] - at[l][1]]
    }
    const RESH = 0x5e8
    for (const [fontId, bold] of [['serif', false], ['serif', true], ['mono', false], ['mono', true], ['sans', false]] as const) {
      const font = testFont(fontId, bold)
      const name = `${fontId}${bold ? ' bold' : ''}`
      // Tsere under resh, after a bet with sheva (OpenType backtracks are nearest glyph first).
      expect(offset(font, 'בְרֵא', RESH, 0x5b5), name).toEqual(offset(font, 'רֵא', RESH, 0x5b5))
      // Qamats under resh, after a shin with sin dot and sheva.
      expect(offset(font, 'יִשְׂרָאֵל', RESH, 0x5b8), name).toEqual(offset(font, 'רָא', RESH, 0x5b8))
    }
  })

  it('tells the characters of a glyph first used for a presentation form, and spells those out', () => {
    // fontkit keeps one glyph object per glyph id, with the code points of its first use, and
    // fonts are shared across exports: after שׁ and וֹ typed as one character each (U+FB2A,
    // U+FB4B), their glyphs drawn for ש and its dot, or ו and its holam, counted one character.
    const font = fontkit.create(testFontBytes('sans', false).slice())
    const [shin, vav] = [0xfb2a, 0xfb4b].map((cp) => String.fromCodePoint(cp))
    const forms = shapeText(font, `${shin}לום ${vav}ת`, 'rtl')
    expect(forms.chars).toEqual(expect.arrayContaining([shin.normalize('NFD'), vav.normalize('NFD')]))
    expect(forms.typed[0]).toBe(shin.normalize('NFD'))
    for (const text of ['שָׁלוֹם', 'מִצְוֹת']) expect(shapeText(font, text, 'rtl').chars, text).toEqual(shapeText(sans, text, 'rtl').chars)
  })

  it('tells which grapheme cluster each glyph belongs to', () => {
    expect(shapeText(sans, 'e\u0301te', 'ltr').clusters).toEqual([0, 0, 1, 2])
    // Visual order for RTL: the last letter (final mem) comes first.
    const shalom = shapeText(sans, '\u05E9\u05B8\u05C1\u05DC\u05D5\u05B9\u05DD', 'rtl')
    expect(shalom.clusters[0]).toBe(3)
    expect(shalom.clusters.at(-1)).toBe(0)
    expect(new Set(shalom.clusters).size).toBe(4)
  })

  it('drops invisible bidi controls instead of painting them as spaces', () => {
    const plain = shapeText(sans, 'abc', 'ltr')
    const marked = shapeText(sans, '‏abc‎', 'ltr')
    expect(marked.glyphs.map((g) => g.id)).toEqual(plain.glyphs.map((g) => g.id))
    expect(marked.advance).toBe(plain.advance)
  })

  it('does not apply kerning or ligatures', () => {
    const av = shapeText(sans, 'AV', 'ltr')
    expect(av.advance).toBe(sans.glyphForCodePoint(65).advanceWidth + sans.glyphForCodePoint(86).advanceWidth)
    // Cousine has a discretionary ligature table; it must stay off.
    expect(shapeText(mono, 'ffi', 'ltr').glyphs).toHaveLength(3)
  })
})

describe('helpers', () => {
  it('detects the first strong direction', () => {
    expect(firstStrongDirection('123 שלום abc')).toBe('rtl')
    expect(firstStrongDirection('  abc שלום')).toBe('ltr')
    expect(firstStrongDirection('123 !?')).toBeNull()
  })

  it('maps ASCII whitespace and strips ignorables', () => {
    expect(paintableText('a\tb\r‍c')).toBe('a b c')
  })

  it('finds characters the font lacks', () => {
    expect(hasMissingGlyphs(sans, 'Hello שלום Привет Γειά')).toBe(false)
    expect(hasMissingGlyphs(sans, 'Thumbs 👍')).toBe(true)
    expect(hasMissingGlyphs(sans, 'مرحبا')).toBe(true)
    expect(hasMissingGlyphs(sans, '日本')).toBe(true)
    expect(hasMissingGlyphs(sans, 'tab\there‏')).toBe(false)
  })
})
