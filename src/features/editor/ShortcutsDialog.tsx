import { Fragment, useMemo, useRef } from 'react'
import { Kbd } from '../../components/ui/controls'
import { Dialog } from '../../components/ui/dialog'
import { richText, useT } from '../../i18n'
import { isMac } from '../../lib/utils/misc'
import { useEditor } from '../../store/editor'
import { isPointerAction, keyLabels, shortcutGroups, type KeyCombo, type ShortcutGroup } from './shortcuts'

/** Every keyboard shortcut, grouped. Open when `activeDialog === 'shortcuts'`. */
export function ShortcutsDialog() {
  const open = useEditor((s) => s.activeDialog === 'shortcuts')
  const t = useT()
  const groups = useMemo(() => shortcutGroups(isMac, t), [t])
  const bodyRef = useRef<HTMLDivElement>(null)
  const [tools, editing, ...rest] = groups
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && useEditor.getState().closeDialog()}
      size="xl"
      title={t.editor.shortcuts.title}
      description={richText(t.editor.shortcuts.intro, { key: <Kbd className="mx-0.5 align-[1px]">?</Kbd> })}
      // Focus the (scrollable) list rather than ringing the close button. The list is a Tab stop of
      // its own: Tab and Shift+Tab move between it and the close button, and the arrow keys scroll it.
      onOpenAutoFocus={(e) => {
        e.preventDefault()
        bodyRef.current?.focus()
      }}
    >
      <div
        ref={bodyRef}
        tabIndex={0}
        role="region"
        aria-label={t.editor.shortcuts.list}
        className="grid gap-x-8 gap-y-6 rounded-md pb-1 pt-1 focus-visible:outline-offset-4 md:grid-cols-2 lg:grid-cols-3"
      >
        <Group group={tools} />
        <Group group={editing} />
        <div className="space-y-6">
          {rest.map((g) => (
            <Group key={g.title} group={g} />
          ))}
        </div>
      </div>
    </Dialog>
  )
}

function Group({ group }: { group: ShortcutGroup }) {
  const t = useT()
  return (
    <section>
      <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-fg-subtle">{group.title}</h3>
      <ul className="divide-y divide-line/70">
        {group.rows.map((row) => {
          const Icon = row.icon
          return (
            <li key={row.label} className="flex min-h-8 items-center gap-2.5 py-0.5">
              {Icon && <Icon className="size-[15px] shrink-0 text-fg-subtle" strokeWidth={1.9} />}
              <span className="min-w-0 flex-1 text-[13px] text-fg">{row.label}</span>
              {/* The alternatives follow the interface's reading direction; each one reads left to right. */}
              <span className="flex shrink-0 items-center gap-1.5">
                {row.combos.map((combo, i) => (
                  <Fragment key={i}>
                    {i > 0 && <span className="text-[11px] text-fg-subtle">{t.editor.shortcuts.or}</span>}
                    <Combo keys={combo} />
                  </Fragment>
                ))}
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/** One combination: its key caps (and pointer action, in words), left to right in any language. */
function Combo({ keys }: { keys: KeyCombo }) {
  const t = useT()
  const labels = keyLabels(keys)
  return (
    <span dir="ltr" className="flex items-center gap-0.5">
      {labels.map((label, i) =>
        isPointerAction(label) ? (
          <span key={i} className="px-0.5 text-[12px] text-fg-muted">
            {i > 0 && <span className="me-1 text-fg-subtle">+</span>}
            {t.editor.shortcuts.pointer[label]}
          </span>
        ) : (
          <Kbd key={i} className="min-w-[22px] px-1.5">
            {label}
          </Kbd>
        ),
      )}
    </span>
  )
}
