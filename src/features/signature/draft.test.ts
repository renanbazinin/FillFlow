import { beforeEach, describe, expect, it, vi } from 'vitest'

// Minimal localStorage for the Node test environment (must exist before the module loads).
const storage = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (k: string) => storage.get(k) ?? null,
  setItem: (k: string, v: string) => void storage.set(k, String(v)),
  removeItem: (k: string) => void storage.delete(k),
})
storage.set('fillflow:signature', JSON.stringify({ tab: 'type', color: '#1d4ed8', pen: 'bold', font: 'caveat', save: false, name: 'Ada Lovelace' }))

const { draftHasContent, useSignatureDraft } = await import('./draft')

const prefs = () => JSON.parse(storage.get('fillflow:signature') ?? '{}')

beforeEach(() => {
  useSignatureDraft.setState({
    text: { signature: '', initials: '' },
    strokes: { signature: [], initials: [] },
    upload: { signature: null, initials: null },
    uploadEmpty: { signature: false, initials: false },
  })
})

describe('useSignatureDraft', () => {
  it('starts from the remembered preferences', () => {
    const s = useSignatureDraft.getState()
    expect(s.tab).toBe('type')
    expect(s.color).toBe('#1d4ed8')
    expect(s.pen).toBe('bold')
    expect(s.font).toBe('caveat')
    expect(s.save).toBe(false)
  })

  it('persists preference changes', () => {
    useSignatureDraft.getState().setTab('upload')
    useSignatureDraft.getState().setSave(true)
    expect(prefs()).toMatchObject({ tab: 'upload', save: true, name: 'Ada Lovelace' })
  })

  it('prefills the name, and initials derived from it', () => {
    const s = useSignatureDraft.getState()
    s.prefill('signature')
    s.prefill('initials')
    expect(useSignatureDraft.getState().text).toEqual({ signature: 'Ada Lovelace', initials: 'AL' })
  })

  it('never overwrites what the user typed', () => {
    useSignatureDraft.getState().setText('signature', 'Grace')
    useSignatureDraft.getState().prefill('signature')
    expect(useSignatureDraft.getState().text.signature).toBe('Grace')
  })

  it('remembers custom initials, and a new name re-derives them', () => {
    const s = useSignatureDraft.getState()
    s.setText('initials', 'A.L.')
    s.rememberText('initials')
    expect(prefs().initials).toBe('A.L.')
    s.setText('initials', '')
    s.prefill('initials')
    expect(useSignatureDraft.getState().text.initials).toBe('A.L.')

    s.setText('signature', 'Grace Hopper')
    s.rememberText('signature')
    expect(prefs()).toMatchObject({ name: 'Grace Hopper', initials: '' })
    s.setText('initials', '')
    s.prefill('initials')
    expect(useSignatureDraft.getState().text.initials).toBe('GH')
  })

  it('does not store initials that just repeat the derived ones', () => {
    const s = useSignatureDraft.getState()
    s.setText('signature', 'Grace Hopper')
    s.rememberText('signature')
    s.setText('initials', 'GH')
    s.rememberText('initials')
    expect(prefs().initials).toBe('')
  })

  it('tracks content per tab and clears it once used', () => {
    const s = useSignatureDraft.getState()
    const stroke = { points: [[1, 2, 0.5]] as [number, number, number][], simulate: true }
    expect(draftHasContent(useSignatureDraft.getState(), 'signature', 'draw')).toBe(false)
    s.addStroke('signature', stroke)
    s.addStroke('signature', stroke)
    expect(draftHasContent(useSignatureDraft.getState(), 'signature', 'draw')).toBe(true)
    expect(draftHasContent(useSignatureDraft.getState(), 'initials', 'draw')).toBe(false)
    s.undoStroke('signature')
    expect(useSignatureDraft.getState().strokes.signature).toHaveLength(1)
    s.consume('signature', 'draw')
    expect(useSignatureDraft.getState().strokes.signature).toHaveLength(0)

    s.setText('initials', '   ')
    expect(draftHasContent(useSignatureDraft.getState(), 'initials', 'type')).toBe(false)
    s.setText('initials', 'AL')
    expect(draftHasContent(useSignatureDraft.getState(), 'initials', 'type')).toBe(true)
    s.consume('initials', 'type')
    // The typed name is kept: it's the remembered name.
    expect(useSignatureDraft.getState().text.initials).toBe('AL')
  })

  it('an upload with nothing left after background removal has no content', () => {
    const s = useSignatureDraft.getState()
    const fake = { fileName: 'x.png' } as never
    s.setUpload('signature', fake)
    expect(draftHasContent(useSignatureDraft.getState(), 'signature', 'upload')).toBe(true)
    s.setUploadEmpty('signature', true)
    expect(draftHasContent(useSignatureDraft.getState(), 'signature', 'upload')).toBe(false)
    // A new image resets the flag.
    s.setUpload('signature', fake)
    expect(draftHasContent(useSignatureDraft.getState(), 'signature', 'upload')).toBe(true)
  })

  it('ignores corrupt stored preferences', async () => {
    storage.set('fillflow:signature', '{"tab":"paint","color":"#abcdef","pen":7,"font":"comic","save":"yes"}')
    vi.resetModules()
    const fresh = (await import('./draft')).useSignatureDraft.getState()
    expect(fresh).toMatchObject({ tab: 'draw', color: '#111827', pen: 'medium', font: 'great-vibes', save: true })
  })
})
