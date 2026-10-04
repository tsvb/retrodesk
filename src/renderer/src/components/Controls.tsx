import { useState, type ReactNode } from 'react'
import { Check, ChevronRight } from 'lucide-react'
import { useFocusable, useFocusGroup } from '../input/hooks'
import { feedback } from '../lib/feedback'
import { Modal } from './Modal'

/** Label + description on the left, control on the right. */
export function SettingRow({ title, description, children, stacked }: { title: string; description?: ReactNode; children?: ReactNode; stacked?: boolean }) {
  return (
    <div className={`setting ${stacked ? 'setting--stacked' : ''}`}>
      <div className="setting__text">
        <span className="setting__title">{title}</span>
        {description && <span className="setting__desc">{description}</span>}
      </div>
      {children && <div className="setting__control">{children}</div>}
    </div>
  )
}

/** A whole-row toggle: activating anywhere on the row flips it. */
export function ToggleRow({ title, description, value, onChange, disabled }: { title: string; description?: ReactNode; value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  const { props } = useFocusable<HTMLDivElement>({
    disabled,
    label: value ? 'Turn off' : 'Turn on',
    onActivate: () => {
      feedback('toggle')
      onChange(!value)
    }
  })
  return (
    <div className={`setting setting--toggle ${disabled ? 'is-disabled' : ''}`} role="switch" aria-checked={value} {...props}>
      <div className="setting__text">
        <span className="setting__title">{title}</span>
        {description && <span className="setting__desc">{description}</span>}
      </div>
      <span className={`switch ${value ? 'is-on' : ''}`} aria-hidden="true">
        <span className="switch__knob" />
      </span>
    </div>
  )
}

export interface Option<T extends string> {
  value: T
  label: string
  hint?: string
}

/** Segmented choice: each option is focusable; left/right moves, confirm selects. */
export function Segmented<T extends string>({ options, value, onChange, group, size = 'md' }: { options: Option<T>[]; value: T; onChange: (v: T) => void; group: string; size?: 'md' | 'lg' }) {
  useFocusGroup(group, { memory: false })
  return (
    <div className={`segmented segmented--${size}`} role="radiogroup">
      {options.map((o) => (
        <SegmentedOption key={o.value} option={o} selected={o.value === value} group={group} onSelect={() => onChange(o.value)} />
      ))}
    </div>
  )
}

function SegmentedOption<T extends string>({ option, selected, group, onSelect }: { option: Option<T>; selected: boolean; group: string; onSelect: () => void }) {
  const { props } = useFocusable<HTMLDivElement>({ group, label: 'Choose', onActivate: onSelect })
  return (
    <div className={`segmented__opt ${selected ? 'is-selected' : ''}`} role="radio" aria-checked={selected} {...props}>
      <span>{option.label}</span>
      {option.hint && <small>{option.hint}</small>}
    </div>
  )
}

/** A row that shows the current value and opens a list picker. Good for long option lists. */
export function PickerRow<T extends string>({
  title,
  description,
  value,
  options,
  onChange,
  disabled
}: {
  title: string
  description?: ReactNode
  value: T
  options: Option<T>[]
  onChange: (v: T) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const current = options.find((o) => o.value === value)
  const { props } = useFocusable<HTMLDivElement>({ disabled, label: 'Change', onActivate: () => setOpen(true) })
  return (
    <>
      <div className={`setting setting--picker ${disabled ? 'is-disabled' : ''}`} role="button" {...props}>
        <div className="setting__text">
          <span className="setting__title">{title}</span>
          {description && <span className="setting__desc">{description}</span>}
        </div>
        <span className="setting__value">
          {current?.label ?? value}
          <ChevronRight size="1em" />
        </span>
      </div>
      {open && (
        <PickerModal
          title={title}
          options={options}
          value={value}
          onClose={() => setOpen(false)}
          onPick={(v) => {
            setOpen(false)
            onChange(v)
          }}
        />
      )}
    </>
  )
}

export function PickerModal<T extends string>({ title, options, value, onPick, onClose, description }: { title: string; options: Option<T>[]; value?: T; onPick: (v: T) => void; onClose: () => void; description?: ReactNode }) {
  return (
    <Modal title={title} description={description} onClose={onClose} size="sm">
      <div className="picker">
        {options.map((o) => (
          <PickerItem key={o.value} option={o} selected={o.value === value} onPick={() => onPick(o.value)} />
        ))}
      </div>
    </Modal>
  )
}

function PickerItem<T extends string>({ option, selected, onPick }: { option: Option<T>; selected: boolean; onPick: () => void }) {
  const { props } = useFocusable<HTMLDivElement>({ autoFocus: selected, label: 'Choose', onActivate: onPick, group: 'picker' })
  return (
    <div className={`picker__item ${selected ? 'is-selected' : ''}`} role="option" aria-selected={selected} {...props}>
      <span className="picker__text">
        <span>{option.label}</span>
        {option.hint && <small>{option.hint}</small>}
      </span>
      {selected && <Check size="1.1em" />}
    </div>
  )
}

export function ProgressBar({ value, tone = 'accent' }: { value: number; tone?: 'accent' | 'danger' | 'ok' }) {
  const indeterminate = value < 0
  return (
    <div className={`progress progress--${tone} ${indeterminate ? 'is-indeterminate' : ''}`} role="progressbar" aria-valuenow={indeterminate ? undefined : Math.round(value * 100)}>
      <div className="progress__fill" style={indeterminate ? undefined : { transform: `scaleX(${Math.max(0, Math.min(1, value))})` }} />
    </div>
  )
}

export function Spinner({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  return <span className={`spinner spinner--${size}`} aria-label="Working" />
}
