import { useEffect } from 'react'

/**
 * Bottom sheet on phones, centred panel on wider screens.
 *
 * The expense flow uses these for progressive disclosure: the main screen stays
 * one readable sentence, and the fiddly parts (who paid, how it splits) only
 * appear when you tap into them.
 */
export default function Sheet({ open, title, onClose, children, footer }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title}
           onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" aria-hidden="true" />
        <div className="sheet-head">
          <button type="button" className="sheet-cancel" onClick={onClose}>Cancel</button>
          <span className="sheet-title">{title}</span>
          <span className="sheet-spacer" />
        </div>
        <div className="sheet-body">{children}</div>
        {footer && <div className="sheet-foot">{footer}</div>}
      </div>
    </div>
  )
}
