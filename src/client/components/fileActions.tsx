import { useState, useRef, useEffect } from 'react'

/** Clamp a context-menu position so it stays inside the viewport. */
export function menuCoords(e: React.MouseEvent, menuWidth = 200, menuHeight = 240): { x: number; y: number } {
  let x = e.clientX
  let y = e.clientY
  if (x + menuWidth > window.innerWidth) x = window.innerWidth - menuWidth - 10
  if (y + menuHeight > window.innerHeight) y = window.innerHeight - menuHeight - 10
  return { x, y }
}

interface CopyLocationSubmenuProps {
  /** Absolute file path to copy. */
  path: string
  /** Root used to derive the relative path; falls back to the full path. */
  root?: string | null
  /** Override for "Full Path" (e.g. demo display-root mapping). */
  fullPath?: string
  showToast: (msg: string) => void
  onDone: () => void
}

/** Hover "Copy location" submenu shared by the browse list and search results. */
export function CopyLocationSubmenu({ path, root, fullPath, showToast, onDone }: CopyLocationSubmenuProps) {
  const [open, setOpen] = useState(false)
  const copy = async (text: string, msg: string) => {
    try {
      await navigator.clipboard.writeText(text)
      showToast(msg)
    } catch {
      showToast('Copy failed')
    }
    onDone()
  }
  const name = path.split('/').pop() || path
  const rel = root && path.startsWith(root) ? (path.substring(root.length) || '/') : path
  const full = fullPath ?? path
  return (
    <div
      className={`context-menu-item has-submenu ${open ? 'submenu-open' : ''}`}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      📋 Copy location
      <span className="submenu-arrow">▶</span>
      {open && (
        <div className="context-submenu">
          <div className="context-menu-item" onClick={() => copy(name, 'Copied name!')}>
            Name
          </div>
          <div className="context-menu-item" onClick={() => copy(rel, 'Copied relative path!')}>
            Relative Path
          </div>
          <div className="context-menu-item" onClick={() => copy(full, 'Copied full path!')}>
            Full Path
          </div>
        </div>
      )}
    </div>
  )
}

interface RenameDialogProps {
  initial: string
  /** Name that already exists (from a 409) — offers Replace instead of Rename. */
  conflict?: string | null
  onCancel: () => void
  onSubmit: (name: string, overwrite: boolean) => void
}

export function RenameDialog({ initial, conflict, onCancel, onSubmit }: RenameDialogProps) {
  const [name, setName] = useState(initial)
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { inputRef.current?.focus() }, [])
  const trimmed = name.trim()
  const isConflict = !!conflict && !!trimmed && conflict === trimmed
  const submit = (overwrite: boolean) => {
    if (trimmed) onSubmit(trimmed, overwrite)
  }
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-confirm" onClick={(e) => e.stopPropagation()}>
        <h3>Rename</h3>
        <input
          ref={inputRef}
          type="text"
          placeholder="New name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit(isConflict)}
        />
        {isConflict && (
          <p className="modal-warning">“{conflict}” already exists. Replace it?</p>
        )}
        <div className="modal-actions">
          <button className="modal-cancel" onClick={onCancel}>Cancel</button>
          {isConflict ? (
            <button className="modal-danger" onClick={() => submit(true)}>Replace</button>
          ) : (
            <button onClick={() => submit(false)}>Rename</button>
          )}
        </div>
      </div>
    </div>
  )
}

interface DeleteConfirmDialogProps {
  title: string
  name: string
  onCancel: () => void
  onConfirm: () => void
}

export function DeleteConfirmDialog({ title, name, onCancel, onConfirm }: DeleteConfirmDialogProps) {
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-confirm" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        <p className="modal-path">{name}</p>
        <p className="modal-warning">This cannot be undone.</p>
        <div className="modal-actions">
          <button className="modal-cancel" onClick={onCancel}>Cancel</button>
          <button className="modal-danger" onClick={onConfirm}>Delete</button>
        </div>
      </div>
    </div>
  )
}
