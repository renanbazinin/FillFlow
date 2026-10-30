import type { ReactNode } from 'react'
import { Check, CircleCheckBig, MousePointerClick, Signature, TriangleAlert, Type } from 'lucide-react'
import { Kbd } from '../../../components/ui/controls'
import { cn } from '../../../lib/utils/misc'
import { TOOL_BY_ID } from '../../../model/tools'
import type { ToolId } from '../../../model/types'
import { useEditor } from '../../../store/editor'

function StateCard({ icon, tone = 'accent', title, children }: { icon: ReactNode; tone?: 'accent' | 'warning' | 'success'; title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 pb-8 pt-10 text-center">
      <div
        className={cn(
          'mb-4 flex size-12 items-center justify-center rounded-2xl [&_svg]:size-[22px]',
          tone === 'accent' && 'bg-accent-soft text-accent-ink',
          tone === 'warning' && 'bg-warning-soft text-warning',
          tone === 'success' && 'bg-success-soft text-success',
        )}
      >
        {icon}
      </div>
      <h3 className="text-[15px] font-semibold tracking-[-0.01em] text-fg">{title}</h3>
      <div className="mt-1.5 max-w-[280px] text-[13px] leading-relaxed text-fg-muted">{children}</div>
    </div>
  )
}

const QUICK_TOOLS: { id: ToolId; icon: ReactNode }[] = [
  { id: 'text', icon: <Type /> },
  { id: 'check', icon: <Check /> },
  { id: 'signature', icon: <Signature /> },
]

function ToolChips() {
  const pick = (id: ToolId) => {
    const s = useEditor.getState()
    if (id === 'signature') s.openDialog('signature')
    else s.setTool(id)
  }
  return (
    <div className="mt-5 flex w-full max-w-[300px] flex-col gap-1.5">
      {QUICK_TOOLS.map(({ id, icon }) => {
        const tool = TOOL_BY_ID[id]
        return (
          <button
            key={id}
            type="button"
            onClick={() => pick(id)}
            className="flex min-h-11 items-center gap-3 rounded-xl border border-line bg-surface px-3 py-2 text-left shadow-xs transition-colors hover:border-line-strong hover:bg-surface-2"
          >
            <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-surface-3 text-fg-muted [&_svg]:size-4">{icon}</span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-medium text-fg">{tool.label}</span>
              <span className="block text-[11.5px] leading-snug text-fg-subtle">{tool.hint}</span>
            </span>
            {tool.shortcut && <Kbd>{tool.shortcut}</Kbd>}
          </button>
        )
      })}
    </div>
  )
}

/** The PDF has no AcroForm fields: explain the free-form tools instead. */
export function NoFieldsState() {
  return (
    <StateCard icon={<MousePointerClick />} title="No fillable fields">
      This PDF has no built-in form fields — you can still fill it. Pick a tool and click anywhere on a page.
      <div className="flex justify-center">
        <ToolChips />
      </div>
    </StateCard>
  )
}

/** Pure dynamic XFA documents: nothing native to fill. */
export function XfaNotice() {
  return (
    <StateCard icon={<TriangleAlert />} tone="warning" title="Dynamic XFA form">
      This PDF is an Adobe dynamic (XFA) form, which can’t be filled in a browser. You can still type, check and sign on top of
      the pages, or open it in Adobe Acrobat Reader to use its own fields.
      <div className="flex justify-center">
        <ToolChips />
      </div>
    </StateCard>
  )
}

export function FilterDoneState({ filter }: { filter: 'required' | 'empty' }) {
  return (
    <StateCard icon={<CircleCheckBig />} tone="success" title={filter === 'required' ? 'Required fields done' : 'Nothing left to fill'}>
      {filter === 'required' ? 'Every required field has a value.' : 'Every field has a value. Review the form, then export.'}
    </StateCard>
  )
}

export function NoRequiredState() {
  return (
    <StateCard icon={<CircleCheckBig />} tone="success" title="No required fields">
      This form doesn’t mark any field as required.
    </StateCard>
  )
}
