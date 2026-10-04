import { useEffect, useRef, useState } from 'react'
import { useFocusable } from '../input/hooks'
import { useInputStore } from '../stores/input'
import { Modal } from './Modal'
import { OnScreenKeyboard } from './OnScreenKeyboard'

interface Props {
  title: string
  description?: string
  value: string
  onCommit: (v: string) => void
  password?: boolean
  placeholder?: string
}

/**
 * Text setting. With a controller, activating opens an on-screen keyboard; with mouse/keyboard it
 * focuses the real input. The value is committed on blur / Enter / Done.
 */
export function TextField({ title, description, value, onCommit, password, placeholder }: Props) {
  const [draft, setDraft] = useState(value)
  const [osk, setOsk] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => setDraft(value), [value])

  const { props } = useFocusable<HTMLDivElement>({
    keepDomFocus: true,
    label: 'Edit',
    onActivate: () => {
      if (useInputStore.getState().source === 'pad') setOsk(true)
      else inputRef.current?.focus()
    }
  })
  const commit = (v: string) => {
    if (v !== value) onCommit(v)
  }
  return (
    <>
      <div className="setting setting--text" {...props}>
        <label className="setting__text">
          <span className="setting__title">{title}</span>
          {description && <span className="setting__desc">{description}</span>}
        </label>
        <input
          ref={inputRef}
          className="textinput"
          type={password ? 'password' : 'text'}
          value={draft}
          placeholder={placeholder}
          spellCheck={false}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => commit(draft)}
        />
      </div>
      {osk && (
        <TextPrompt
          title={title}
          initial={draft}
          password={password}
          onClose={() => setOsk(false)}
          onDone={(v) => {
            setOsk(false)
            setDraft(v)
            commit(v)
          }}
        />
      )}
    </>
  )
}

export function TextPrompt({ title, initial, password, onDone, onClose }: { title: string; initial: string; password?: boolean; onDone: (v: string) => void; onClose: () => void }) {
  const [text, setText] = useState(initial)
  return (
    <Modal title={title} onClose={onClose} size="md" closeLabel="Cancel">
      <div className="prompt__value">{password ? '•'.repeat(text.length) : text || <span className="muted">Start typing</span>}</div>
      <OnScreenKeyboard
        withDone
        withShift
        onKey={(k) => {
          if (k.type === 'char') setText((t) => t + k.value)
          else if (k.type === 'space') setText((t) => `${t} `)
          else if (k.type === 'backspace') setText((t) => t.slice(0, -1))
          else if (k.type === 'clear') setText('')
          else if (k.type === 'done') onDone(text)
        }}
      />
    </Modal>
  )
}
