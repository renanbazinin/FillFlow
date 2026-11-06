import { useId, type Ref } from 'react'
import { RadioGroup } from 'radix-ui'
import { Check } from 'lucide-react'
import { FieldLabel, Input } from '../../components/ui/controls'
import { cn } from '../../lib/utils/misc'
import { useSignatureDraft } from './draft'
import { SIGNATURE_FONTS, signatureFontLabel, signatureFontScale, signatureFontStack, type SignatureFontId } from './fonts'
import type { SignatureRole } from './library'
import { FitText, InkSwatches } from './parts'

/** Grid placement: 2 columns on phones (last card full width), 3 + 2 on wider screens. */
const CARD_SPAN = ['sm:col-span-2', 'sm:col-span-2', 'sm:col-span-2', 'sm:col-span-3', 'col-span-2 sm:col-span-3']

export function TypePad({ role, onSubmit, inputRef }: { role: SignatureRole; onSubmit: () => void; inputRef?: Ref<HTMLInputElement> }) {
  const text = useSignatureDraft((s) => s.text[role])
  const font = useSignatureDraft((s) => s.font)
  const color = useSignatureDraft((s) => s.color)
  const setText = useSignatureDraft((s) => s.setText)
  const setFont = useSignatureDraft((s) => s.setFont)
  const setColor = useSignatureDraft((s) => s.setColor)
  const inputId = useId()
  const isSignature = role === 'signature'
  const sample = text.trim() || (isSignature ? 'Your Name' : 'YN')

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1">
          <FieldLabel htmlFor={inputId}>{isSignature ? 'Your full name' : 'Your initials'}</FieldLabel>
          <Input
            ref={inputRef}
            id={inputId}
            value={text}
            onChange={(e) => setText(role, e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                e.preventDefault()
                onSubmit()
              }
            }}
            dir="auto"
            placeholder={isSignature ? 'e.g. Jane Cooper' : 'e.g. JC'}
            autoComplete={isSignature ? 'name' : 'off'}
            autoCapitalize="words"
            spellCheck={false}
            enterKeyHint="done"
            maxLength={isSignature ? 64 : 8}
            className="h-10 text-[15px]"
          />
        </div>
        <InkSwatches value={color} onChange={setColor} className="sm:h-10" />
      </div>

      <RadioGroup.Root
        value={font}
        onValueChange={(v) => setFont(v as SignatureFontId)}
        aria-label="Handwriting style"
        className="grid grid-cols-2 gap-2 sm:grid-cols-6"
      >
        {SIGNATURE_FONTS.map((f, i) => (
          <RadioGroup.Item
            key={f.id}
            value={f.id}
            aria-label={signatureFontLabel(f, sample)}
            className={cn(
              'group relative flex h-[84px] min-w-0 flex-col rounded-xl border border-line bg-white px-3 pb-2 pt-1 text-left shadow-xs transition-[border-color,box-shadow] duration-150 hover:border-line-strong data-[state=checked]:border-accent data-[state=checked]:ring-3 data-[state=checked]:ring-accent/20',
              CARD_SPAN[i],
            )}
          >
            <FitText
              dir="auto"
              className={cn('flex-1', !text.trim() && 'opacity-35')}
              style={{ fontFamily: signatureFontStack(f), fontSize: `${Math.round(30 * signatureFontScale(f, sample))}px`, color }}
            >
              {sample}
            </FitText>
            <span className="flex h-4 items-center justify-between gap-2">
              <span className="truncate text-[11px] font-medium leading-none text-black/60">{signatureFontLabel(f, sample)}</span>
              <RadioGroup.Indicator className="inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-accent text-accent-fg animate-scale-in">
                <Check className="size-2.5" strokeWidth={3.5} />
              </RadioGroup.Indicator>
            </span>
          </RadioGroup.Item>
        ))}
      </RadioGroup.Root>
    </div>
  )
}
