import type { ReactNode } from 'react'
import { useFocusGroup } from '../input/hooks'

/** A titled horizontal shelf. Its focus group remembers the last focused item. */
export function Row({ id, title, aside, children, variant = 'games' }: { id: string; title: string; aside?: ReactNode; children: ReactNode; variant?: 'games' | 'systems' }) {
  useFocusGroup(id, { memory: true })
  return (
    <section className={`row row--${variant}`}>
      <header className="row__head">
        <h2 className="row__title">{title}</h2>
        {aside && <span className="row__aside">{aside}</span>}
      </header>
      <div className="row__track">{children}</div>
    </section>
  )
}
