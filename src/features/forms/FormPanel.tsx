import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useShallow } from 'zustand/react/shallow'
import { confirm } from '../../components/ui/confirm'
import { getFormDocumentInfo } from '../../lib/pdf/formFields'
import type { FormField } from '../../model/types'
import { useEditor } from '../../store/editor'
import { cssEscape, focusField, revealField } from './navigation'
import { FieldRow } from './panel/FieldRow'
import { FilterDoneState, NoFieldsState, NoRequiredState, XfaNotice } from './panel/PanelStates'
import { ProgressHeader } from './panel/ProgressHeader'
import { formIsDirty, formProgress, nextEmptyField, visibleFieldNames, type FieldFilter } from './progress'

async function resetForm(fields: FormField[]) {
  const ok = await confirm({
    title: 'Reset the form?',
    description: 'Every field goes back to the value it had when you opened the PDF. Items you placed on the pages stay.',
    confirmLabel: 'Reset form',
    danger: true,
  })
  if (!ok) return
  const s = useEditor.getState()
  s.beginGesture() // one undo step for the whole reset
  for (const f of fields) s.setFormValue(f.name, f.defaultValue)
  s.endGesture()
  toast('Form reset', { action: { label: 'Undo', onClick: () => useEditor.getState().undo() } })
}

function FieldList({ fields }: { fields: FormField[] }) {
  const [filter, setFilter] = useState<FieldFilter>('all')
  const rootRef = useRef<HTMLDivElement>(null)
  const lastActive = useRef<string | null>(null)
  const activeName = useEditor((s) => s.activeFieldName)
  const progress = useEditor(useShallow((s) => formProgress(fields, s.formValues, s.elements)))
  const names = useEditor(useShallow((s) => visibleFieldNames(fields, filter, s.formValues, s.elements, s.activeFieldName)))
  const dirty = useEditor((s) => formIsDirty(fields, s.formValues))

  useEffect(() => {
    if (activeName) lastActive.current = activeName
  }, [activeName])

  const byName = useMemo(() => new Map(fields.map((f) => [f.name, f])), [fields])
  const multiPage = useMemo(() => new Set(fields.map((f) => f.widgets[0]?.page)).size > 1, [fields])
  const groups = useMemo(() => {
    const out: { page: number; fields: FormField[] }[] = []
    for (const name of names) {
      const f = byName.get(name)
      if (!f) continue
      const page = f.widgets[0]?.page ?? 0
      const last = out.at(-1)
      if (last && last.page === page) last.fields.push(f)
      else out.push({ page, fields: [f] })
    }
    return out
  }, [names, byName])

  const onNext = () => {
    const s = useEditor.getState()
    // With the Required filter on, hop between required fields only.
    const pool = filter === 'required' && fields.some((f) => f.required) ? fields.filter((f) => f.required) : fields
    const next =
      nextEmptyField(pool, s.formValues, s.elements, s.activeFieldName ?? lastActive.current) ??
      nextEmptyField(fields, s.formValues, s.elements, s.activeFieldName ?? lastActive.current)
    if (!next) return
    if (rootRef.current?.closest('[role="dialog"]')) {
      // Small screens: the page is behind this sheet, so fill the field right here.
      revealField(next)
      const row = rootRef.current.querySelector<HTMLElement>(`[data-panel-field="${cssEscape(next.name)}"]`)
      row?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
      row?.querySelector<HTMLElement>('input, textarea, select, button, [tabindex="0"]')?.focus({ preventScroll: true })
      return
    }
    void focusField(next)
  }

  return (
    <div ref={rootRef} className="flex min-h-full flex-col">
      <ProgressHeader
        progress={progress}
        filter={filter}
        onFilter={setFilter}
        emptyCount={progress.total - progress.filled}
        dirty={dirty}
        onNext={onNext}
        onReset={() => void resetForm(fields)}
      />
      <div className="flex-1 px-2 pb-6 pt-1">
        {groups.map((g) => (
          <section key={g.page} aria-label={`Page ${g.page + 1}`}>
            {multiPage && (
              <h3 className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-fg-subtle">Page {g.page + 1}</h3>
            )}
            <div className="flex flex-col gap-0.5 pt-1">
              {g.fields.map((f) => (
                <FieldRow key={f.name} field={f} />
              ))}
            </div>
          </section>
        ))}
        {!groups.length && filter === 'required' && <NoRequiredState />}
        {!groups.length && filter === 'empty' && <FilterDoneState filter="empty" />}
      </div>
    </div>
  )
}

/**
 * Right-panel "Form" tab: the document's fields as a clean vertical form, with progress,
 * required-field indicators and "next empty field" navigation. The parent provides the height
 * and the scroll container; the progress header sticks to its top.
 */
export function FormPanel() {
  const doc = useEditor((s) => s.doc)
  if (!doc) return null
  if (!doc.formFields.length) return getFormDocumentInfo(doc.pdf)?.pureXfa ? <XfaNotice /> : <NoFieldsState />
  // Keyed by document: filter and "last field" start fresh for every file.
  return <FieldList key={doc.id} fields={doc.formFields} />
}
