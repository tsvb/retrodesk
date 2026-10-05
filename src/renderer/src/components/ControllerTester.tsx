import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { pushInterceptor } from '../input/bus'
import { FocusScope } from '../input/hooks'
import { useInputStore } from '../stores/input'
import { useSettings } from '../stores/settings'
import { buttonForAction, padButtonDef, PadButton } from './Glyph'
import { Button } from './Button'
import type { PadFamily } from '../input/types'

interface PadSnapshot {
  id: string
  buttons: number[]
  axes: number[]
}

const EXIT_HOLD_MS = 1500

/**
 * Live controller test, like the Retroid's built-in tester. All controller input is captured while it
 * is open; hold the back button (or press Esc / click Done) to leave.
 */
export function ControllerTester({ onClose }: { onClose: () => void }) {
  const [snap, setSnap] = useState<PadSnapshot | null>(null)
  const [exitProgress, setExitProgress] = useState(0)
  const pads = useInputStore((s) => s.pads)
  const layout = useSettings((s) => s.settings?.ui.buttonLayout ?? 'xbox')
  const family: PadFamily = pads[0]?.family ?? 'xbox'
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(
    () =>
      pushInterceptor((ev, source) => {
        if (source === 'pad') return true
        if (ev.kind === 'action' && ev.action === 'back') {
          closeRef.current()
          return true
        }
        return ev.kind === 'nav'
      }),
    []
  )

  useEffect(() => {
    let raf = 0
    let backSince = 0
    const backIndex = buttonForAction('back', layout)
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick)
      // Background throttling is off app-wide: don't re-render the tester every frame for an unfocused window.
      if (!document.hasFocus()) return
      const gp = navigator.getGamepads().find((g): g is Gamepad => !!g && g.connected)
      if (!gp) {
        setSnap(null)
        return
      }
      setSnap({ id: gp.id, buttons: gp.buttons.map((b) => b.value || (b.pressed ? 1 : 0)), axes: [...gp.axes] })
      if (gp.buttons[backIndex]?.pressed) {
        if (!backSince) backSince = now
        const p = Math.min(1, (now - backSince) / EXIT_HOLD_MS)
        setExitProgress(p)
        if (p >= 1) {
          backSince = 0
          closeRef.current()
        }
      } else {
        backSince = 0
        setExitProgress(0)
      }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [layout])

  const b = (i: number) => snap?.buttons[i] ?? 0
  const ax = (i: number) => snap?.axes[i] ?? 0
  const on = (i: number) => (b(i) > 0.3 ? 'is-on' : '')

  return createPortal(
    <FocusScope isolated>
      <div className="modal tester" role="dialog" aria-label="Controller test">
        <div className="modal__scrim" />
        <div className="modal__panel modal__panel--lg tester__panel">
          <h2 className="modal__title">Controller test</h2>
          <p className="modal__desc">{snap ? snap.id : 'Press any button on a controller to start.'}</p>
          <svg className="tester__pad" viewBox="0 0 640 360" aria-hidden="true">
            <path
              className="tester__body"
              d="M170 70h300c60 0 96 36 112 96l34 124c10 38-14 62-46 62-26 0-42-14-58-40l-30-50H158l-30 50c-16 26-32 40-58 40-32 0-56-24-46-62l34-124c16-60 52-96 112-96z"
            />
            {/* triggers / shoulders */}
            <rect className="tester__trigger" x="150" y="8" width="90" height="26" rx="10" />
            <rect className="tester__trigger-fill" x="150" y="8" width={90 * b(6)} height="26" rx="10" />
            <rect className="tester__trigger" x="400" y="8" width="90" height="26" rx="10" />
            <rect className="tester__trigger-fill" x="400" y="8" width={90 * b(7)} height="26" rx="10" />
            <rect className={`tester__btn ${on(4)}`} x="140" y="44" width="110" height="22" rx="11" />
            <rect className={`tester__btn ${on(5)}`} x="390" y="44" width="110" height="22" rx="11" />
            {/* d-pad */}
            <g transform="translate(250 255)">
              <rect className={`tester__btn ${on(12)}`} x="-14" y="-50" width="28" height="36" rx="5" />
              <rect className={`tester__btn ${on(13)}`} x="-14" y="14" width="28" height="36" rx="5" />
              <rect className={`tester__btn ${on(14)}`} x="-50" y="-14" width="36" height="28" rx="5" />
              <rect className={`tester__btn ${on(15)}`} x="14" y="-14" width="36" height="28" rx="5" />
            </g>
            {/* face buttons */}
            <g transform="translate(470 140)">
              {[
                [3, 0, -40],
                [2, -40, 0],
                [1, 40, 0],
                [0, 0, 40]
              ].map(([i, x, y]) => {
                const def = padButtonDef(family, i as number)
                return (
                  <g key={i} transform={`translate(${x} ${y})`}>
                    <circle className={`tester__btn ${on(i as number)}`} r="19" style={b(i as number) > 0.3 && def.color ? { fill: def.color } : undefined} />
                    <text className="tester__label" textAnchor="middle" dy="7">
                      {def.label}
                    </text>
                  </g>
                )
              })}
            </g>
            {/* meta */}
            <rect className={`tester__btn ${on(8)}`} x="262" y="146" width="34" height="18" rx="9" />
            <rect className={`tester__btn ${on(9)}`} x="344" y="146" width="34" height="18" rx="9" />
            <circle className={`tester__btn ${on(16)}`} cx="320" cy="108" r="16" />
            {/* sticks */}
            {[
              [175, 150, 0, 1, 10],
              [395, 255, 2, 3, 11]
            ].map(([cx, cy, xa, ya, press]) => (
              <g key={cx}>
                <circle className={`tester__well ${on(press as number)}`} cx={cx} cy={cy} r="38" />
                <circle className="tester__stick" cx={(cx as number) + ax(xa as number) * 24} cy={(cy as number) + ax(ya as number) * 24} r="20" />
              </g>
            ))}
          </svg>
          <div className="tester__readout">
            <span>
              Left stick {fmt(ax(0))}, {fmt(ax(1))}
            </span>
            <span>
              Right stick {fmt(ax(2))}, {fmt(ax(3))}
            </span>
            <span>
              Triggers {fmt(b(6))} / {fmt(b(7))}
            </span>
          </div>
          <div className="tester__buttons">
            {Array.from({ length: Math.max(17, snap?.buttons.length ?? 0) }, (_, i) => (
              <span key={i} className={`tester__chip ${on(i)}`}>
                {i}
              </span>
            ))}
          </div>
          <div className="modal__footer tester__footer">
            <span className="tester__exit">
              Hold <PadButton family={family} index={buttonForAction('back', layout)} size="sm" /> to exit
              <span className="tester__exitbar" style={{ transform: `scaleX(${exitProgress})` }} />
            </span>
            <Button variant="primary" onPress={onClose} autoFocus>
              Done
            </Button>
          </div>
        </div>
      </div>
    </FocusScope>,
    document.body
  )
}

const fmt = (v: number) => (v >= 0 ? ' ' : '') + v.toFixed(2)
