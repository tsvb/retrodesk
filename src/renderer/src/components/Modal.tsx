import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { FocusScope, useActions } from '../input/hooks'
import { feedback } from '../lib/feedback'
import { Button } from './Button'

interface ModalProps {
  title: string
  description?: ReactNode
  onClose: () => void
  children?: ReactNode
  /** Footer buttons; rendered in a focus row. */
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg'
  closeLabel?: string
  className?: string
}

export function Modal(props: ModalProps) {
  return createPortal(
    <FocusScope isolated>
      <ModalInner {...props} />
    </FocusScope>,
    document.body
  )
}

function ModalInner({ title, description, onClose, children, footer, size = 'md', closeLabel = 'Close', className = '' }: ModalProps) {
  useActions({ back: { label: closeLabel, run: onClose } })
  useEffect(() => {
    feedback('open')
  }, [])
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
      <div className="modal__scrim" onClick={onClose} />
      <div className={`modal__panel modal__panel--${size} ${className}`}>
        <h2 className="modal__title">{title}</h2>
        {description && <div className="modal__desc">{description}</div>}
        {children && <div className="modal__body">{children}</div>}
        {footer && <div className="modal__footer">{footer}</div>}
      </div>
    </div>
  )
}

export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  danger,
  onConfirm,
  onCancel
}: {
  title: string
  description?: ReactNode
  confirmLabel: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <Modal
      title={title}
      description={description}
      onClose={onCancel}
      size="sm"
      closeLabel="Cancel"
      footer={
        <>
          <Button variant="secondary" onPress={onCancel} autoFocus={danger}>
            Cancel
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onPress={onConfirm} autoFocus={!danger}>
            {confirmLabel}
          </Button>
        </>
      }
    />
  )
}
