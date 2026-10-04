import { useState } from 'react'
import { ArrowBigUp, CornerDownLeft, Delete, Space } from 'lucide-react'
import { useFocusable, useFocusGroup } from '../input/hooks'
import type { LucideIcon } from 'lucide-react'

export type OskKey = { type: 'char'; value: string } | { type: 'backspace' } | { type: 'space' } | { type: 'clear' } | { type: 'done' } | { type: 'shift' }

const LETTERS = ['abcdefg', 'hijklmn', 'opqrstu', "vwxyz'-", '1234567', '890&:.!']

/** Gamepad-friendly alphabetical keyboard. Physical typing is handled separately by the screen. */
export function OnScreenKeyboard({ onKey, withDone, withShift, group = 'osk' }: { onKey: (k: OskKey) => void; withDone?: boolean; withShift?: boolean; group?: string }) {
  useFocusGroup(group, { memory: false })
  const [upper, setUpper] = useState(false)
  return (
    <div className="osk" role="group" aria-label="On-screen keyboard">
      {LETTERS.map((row, r) => (
        <div className="osk__row" key={row}>
          {row.split('').map((ch, i) => {
            const v = upper ? ch.toUpperCase() : ch
            return <Key key={ch} group={group} label={v} autoFocus={r === 0 && i === 0} onPress={() => onKey({ type: 'char', value: v })} />
          })}
        </div>
      ))}
      <div className="osk__row osk__row--wide">
        {withShift && <Key group={group} icon={ArrowBigUp} label="Shift" active={upper} span={1} onPress={() => setUpper((u) => !u)} />}
        <Key group={group} icon={Space} label="Space" span={withShift ? 2 : 3} onPress={() => onKey({ type: 'space' })} />
        <Key group={group} icon={Delete} label="Delete" span={2} onPress={() => onKey({ type: 'backspace' })} />
        {withDone ? (
          <Key group={group} icon={CornerDownLeft} label="Done" span={2} accent onPress={() => onKey({ type: 'done' })} />
        ) : (
          <Key group={group} label="Clear" span={2} onPress={() => onKey({ type: 'clear' })} />
        )}
      </div>
    </div>
  )
}

function Key({ label, icon: Icon, span = 1, onPress, group, autoFocus, accent, active }: { label: string; icon?: LucideIcon; span?: number; onPress: () => void; group: string; autoFocus?: boolean; accent?: boolean; active?: boolean }) {
  const { props } = useFocusable<HTMLDivElement>({ group, autoFocus, label: Icon ? label : 'Type', onActivate: onPress, scroll: 'none' })
  return (
    <div className={`osk__key ${accent ? 'is-accent' : ''} ${active ? 'is-active' : ''}`} style={{ gridColumn: `span ${span}` }} role="button" aria-label={label} {...props}>
      {Icon ? (
        <>
          <Icon size="1.1em" />
          <span className="osk__keylabel">{label}</span>
        </>
      ) : (
        label
      )}
    </div>
  )
}
