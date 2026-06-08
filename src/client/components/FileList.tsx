import { useState, useEffect, useCallback, useRef } from 'react'
import type { FileEntry, DirListing } from '../types'
import { useApiContext } from '../hooks/ApiContext'

const BATCH_SIZE = 50

interface FileListProps {
  path: string
  onNavigate: (path: string) => void
  onSelectFile: (file: FileEntry) => void
  selectedPath: string | null
  onRootLoaded?: (root: string) => void
  showHidden?: boolean
  onFilesChange?: (files: FileEntry[]) => void
  viewMode?: 'list' | 'grid'
}

export default function FileList({ path, onNavigate, onSelectFile, selectedPath, onRootLoaded, showHidden, onFilesChange, viewMode }: FileListProps) {
  const [listing, setListing] = useState<DirListing | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [toast, setToast] = useState<string | null>(null)
  const [contextMenu, setContextMenu] = useState<{
    visible: boolean
    x: number
    y: number
    entry: FileEntry | null
  }>({
    visible: false,
    x: 0,
    y: 0,
    entry: null
  })
  const [visibleCount, setVisibleCount] = useState(BATCH_SIZE)
  const [submenu, setSubmenu] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<FileEntry | null>(null)
  const [createName, setCreateName] = useState('')
  const [createMode, setCreateMode] = useState<'folder' | 'file' | null>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const [renameTarget, setRenameTarget] = useState<FileEntry | null>(null)
  const [renameName, setRenameName] = useState('')

  const [moveModal, setMoveModal] = useState<{ entry: FileEntry; browserPath: string } | null>(null)
  const [moveBrowserDirs, setMoveBrowserDirs] = useState<FileEntry[]>([])
  const [moveBrowserLoading, setMoveBrowserLoading] = useState(false)

  const { listDir, createFolder, createFile, deleteFile, renameFile, moveFile, extractArchive, openWithYacreader } = useApiContext()

  const fetchDir = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await listDir(path, showHidden)
      setListing(data)
      if (data.root && onRootLoaded) onRootLoaded(data.root)
      if (onFilesChange) onFilesChange(data.contents.filter((f: FileEntry) => !f.isDirectory))
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [path, showHidden, onFilesChange])

  useEffect(() => { fetchDir() }, [fetchDir])

  useEffect(() => {
    const handleCloseMenu = () => {
      setContextMenu(prev => prev.visible ? { ...prev, visible: false } : prev)
      setSubmenu(null)
    }
    window.addEventListener('click', handleCloseMenu)
    window.addEventListener('contextmenu', handleCloseMenu)
    return () => {
      window.removeEventListener('click', handleCloseMenu)
      window.removeEventListener('contextmenu', handleCloseMenu)
    }
  }, [])

  useEffect(() => { setVisibleCount(BATCH_SIZE) }, [listing])

  useEffect(() => {
    if (!moveModal) return
    setMoveBrowserLoading(true)
    listDir(moveModal.browserPath, false)
      .then((data: DirListing) => {
        setMoveBrowserDirs(data.contents.filter((f: FileEntry) => f.isDirectory))
      })
      .catch(() => setMoveBrowserDirs([]))
      .finally(() => setMoveBrowserLoading(false))
  }, [moveModal?.browserPath])

  useEffect(() => { if ((createMode || renameTarget) && inputRef.current) inputRef.current.focus() }, [createMode, renameTarget])

  const handleGridScroll = useCallback(() => {
    const el = gridRef.current
    if (!el) return
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 200) {
      setVisibleCount(prev => prev + BATCH_SIZE)
    }
  }, [])

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 2000)
  }

  const handleContextMenu = (e: React.MouseEvent, entry?: FileEntry | null) => {
    e.preventDefault()
    e.stopPropagation()
    const menuWidth = 200
    let x = e.clientX
    let y = e.clientY
    if (x + menuWidth > window.innerWidth) x = window.innerWidth - menuWidth - 10
    if (y + 240 > window.innerHeight) y = window.innerHeight - 240 - 10
    setContextMenu({ visible: true, x, y, entry: entry || null })
    setSubmenu(null)
  }

  const handleCreate = async () => {
    if (!createName.trim()) return
    const parent = contextMenu.entry?.isDirectory ? contextMenu.entry.path : listing?.path
    if (!parent) return
    try {
      if (createMode === 'folder') await createFolder(parent, createName.trim())
      else await createFile(parent, createName.trim())
      showToast(createMode === 'folder' ? 'Folder created' : 'File created')
      setCreateMode(null)
      setCreateName('')
      setContextMenu(prev => ({ ...prev, visible: false }))
      fetchDir()
    } catch (err: any) {
      showToast(err.message || 'Failed')
    }
  }

  const handleRename = async () => {
    if (!renameTarget || !renameName.trim()) return
    try {
      await renameFile(renameTarget.path, renameName.trim())
      showToast('Renamed')
      setRenameTarget(null)
      setRenameName('')
      fetchDir()
    } catch (err: any) {
      showToast(err.message || 'Failed to rename')
    }
  }

  const handleDelete = async () => {
    if (!confirmDelete) return
    try {
      await deleteFile(confirmDelete.path)
      showToast('Deleted')
      setContextMenu(prev => ({ ...prev, visible: false }))
      setConfirmDelete(null)
      fetchDir()
    } catch (err: any) {
      showToast(err.message || 'Failed to delete')
      setConfirmDelete(null)
    }
  }

  const formatSize = (bytes: number): string => {
    if (bytes === 0) return '-'
    const units = ['B', 'KB', 'MB', 'GB', 'TB']
    const i = Math.floor(Math.log(bytes) / Math.log(1024))
    return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`
  }

  const formatDate = (iso: string): string => {
    return new Date(iso).toLocaleDateString(undefined, {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
  }

  const fileIcon = (name: string, isDir: boolean): string => {
    if (isDir) return '📁'
    const ext = name.split('.').pop()?.toLowerCase()
    if (!ext) return '📄'
    switch (ext) {
      case 'jpg': case 'jpeg': case 'png': case 'gif': case 'webp': case 'svg': case 'bmp': return '🖼️'   // Image
      case 'mp4': case 'mov': case 'webm': case 'avi': case 'mkv': case 'wmv': case 'flv': return '🎬'    // Video
      case 'mp3': case 'wav': case 'flac': case 'ogg': case 'm4a': case 'aac': case 'wma': return '🎵'    // Audio
      case 'zip': case '7z': case 'rar': case 'tar': case 'gz': case 'bz2': case 'xz': return '📦'        // Archive
      case 'pdf': case 'cbz': return '📕'                                                                 // Books
      case 'txt': case 'md': return '📝'                                                                  // Markup/documentation
      case 'json': case 'xml': case 'yaml': case 'yml': case 'toml': case 'csv': return '📊'              // Data
      case 'js': case 'ts': case 'py': case 'rb': case 'go': case 'rs': case 'java': case 'c': case 'cpp': case 'h': return '💻'  // Programming
      default: return '📄'  // default
    }
  }

  const dirs = listing?.contents.filter((f: FileEntry) => f.isDirectory) || []
  const files = listing?.contents.filter((f: FileEntry) => !f.isDirectory) || []
  const allEntries = [...dirs, ...files]
  const parentPath = listing?.parent

  const hasSelection = !!contextMenu.entry
  const copyMenuOpen = submenu === 'copy'
  const isArchive = hasSelection && /\.(zip|7z|rar|tar|gz|bz2|xz)$/i.test(contextMenu.entry!.name)
  const isCbz = hasSelection && /\.cbz$/i.test(contextMenu.entry!.name)

  const renderContextMenu = () => {
    if (!contextMenu.visible) return null
    return (
      <div
        className="context-menu"
        style={{ top: contextMenu.y, left: contextMenu.x }}
        onClick={(e) => e.stopPropagation()}
        onContextMenu={(e) => e.stopPropagation()}
      >
        <div className="context-menu-item" onClick={() => setCreateMode('folder')}>
          📁 New Folder
        </div>
        <div className="context-menu-item" onClick={() => setCreateMode('file')}>
          📄 New File
        </div>

        {hasSelection && (
          <>
            <div className="context-menu-sep" />
            <div
              className={`context-menu-item has-submenu ${copyMenuOpen ? 'submenu-open' : ''}`}
              onMouseEnter={() => setSubmenu('copy')}
              onMouseLeave={() => setSubmenu(null)}
            >
              📋 Copy
              <span className="submenu-arrow">▶</span>
              {copyMenuOpen && (
                <div className="context-submenu">
                  <div className="context-menu-item" onClick={() => {
                    navigator.clipboard.writeText(contextMenu.entry!.name)
                    showToast('Copied name!')
                    setContextMenu(prev => ({ ...prev, visible: false }))
                  }}>
                    Name
                  </div>
                  <div className="context-menu-item" onClick={() => {
                    if (listing?.root) {
                      const rel = contextMenu.entry!.path.startsWith(listing.root)
                        ? contextMenu.entry!.path.substring(listing.root.length)
                        : contextMenu.entry!.path
                      navigator.clipboard.writeText(rel || '/')
                      showToast('Copied relative path!')
                    }
                    setContextMenu(prev => ({ ...prev, visible: false }))
                  }}>
                    Relative Path
                  </div>
                  <div className="context-menu-item" onClick={() => {
                    navigator.clipboard.writeText(contextMenu.entry!.path)
                    showToast('Copied full path!')
                    setContextMenu(prev => ({ ...prev, visible: false }))
                  }}>
                    Full Path
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        {hasSelection && (
          <>
            <div className="context-menu-sep" />
            <div className="context-menu-item" onClick={() => {
              setRenameName(contextMenu.entry!.name)
              setRenameTarget(contextMenu.entry)
              setContextMenu(prev => ({ ...prev, visible: false }))
            }}>
              ✏️ Rename
            </div>
            <div className="context-menu-item" onClick={() => {
              const entry = contextMenu.entry!
              setMoveModal({ entry, browserPath: entry.path.substring(0, entry.path.lastIndexOf('/')) || '/' })
              setContextMenu(prev => ({ ...prev, visible: false }))
            }}>
              📂 Move to...
            </div>
          </>
        )}

        {isCbz && (
          <>
            <div className="context-menu-sep" />
            <div className="context-menu-item" onClick={async () => {
              setContextMenu(prev => ({ ...prev, visible: false }))
              try {
                await openWithYacreader(contextMenu.entry!.path)
              } catch (err: any) {
                showToast(err.message || 'Failed to open')
              }
            }}>
              📖 Open with YACReader
            </div>
          </>
        )}

        {isArchive && (
          <>
            <div className="context-menu-sep" />
            <div className="context-menu-item" onClick={async () => {
              setContextMenu(prev => ({ ...prev, visible: false }))
              try {
                const res = await extractArchive(contextMenu.entry!.path)
                showToast(`Extracted to ${res.output}`)
                fetchDir()
              } catch (err: any) {
                showToast(err.message || 'Failed to extract')
              }
            }}>
              📦 Extract with 7z
            </div>
          </>
        )}

        {hasSelection && (
          <>
            <div className="context-menu-sep" />
            <div className="context-menu-item danger" onClick={() => {
              setConfirmDelete(contextMenu.entry)
              setContextMenu(prev => ({ ...prev, visible: false }))
            }}>
              🗑 Delete
            </div>
          </>
        )}
      </div>
    )
  }

  const renderDeleteConfirm = () => {
    if (!confirmDelete) return null
    return (
      <div className="modal-overlay" onClick={() => setConfirmDelete(null)}>
        <div className="modal-confirm" onClick={(e) => e.stopPropagation()}>
          <h3>Delete {confirmDelete.isDirectory ? 'folder' : 'file'}?</h3>
          <p className="modal-path">{confirmDelete.name}</p>
          <p className="modal-warning">This cannot be undone.</p>
          <div className="modal-actions">
            <button className="modal-cancel" onClick={() => setConfirmDelete(null)}>Cancel</button>
            <button className="modal-danger" onClick={handleDelete}>Delete</button>
          </div>
        </div>
      </div>
    )
  }

  const renderRenamePrompt = () => {
    if (!renameTarget) return null
    return (
      <div className="modal-overlay" onClick={() => { setRenameTarget(null); setRenameName('') }}>
        <div className="modal-confirm" onClick={(e) => e.stopPropagation()}>
          <h3>Rename</h3>
          <input
            ref={inputRef}
            type="text"
            placeholder="New name"
            value={renameName}
            onChange={(e) => setRenameName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleRename()}
          />
          <div className="modal-actions">
            <button className="modal-cancel" onClick={() => { setRenameTarget(null); setRenameName('') }}>Cancel</button>
            <button onClick={handleRename}>Rename</button>
          </div>
        </div>
      </div>
    )
  }

  const renderMoveModal = () => {
    if (!moveModal) return null
    const { entry, browserPath } = moveModal
    const destPath = browserPath.endsWith('/') ? browserPath + entry.name : browserPath + '/' + entry.name

    return (
      <div className="modal-overlay" onClick={() => setMoveModal(null)}>
        <div className="modal-move" onClick={(e) => e.stopPropagation()}>
          <h3>Move "{entry.name}"</h3>
          <div className="move-path">
            <span className="move-path-label">Destination:</span>
            <span className="move-path-value">{destPath}</span>
          </div>
          <div className="move-browser">
            <div className="move-browser-header">
              <button className="move-nav-btn" onClick={() => {
                const parent = browserPath.replace(/\/+$/, '')
                const idx = parent.lastIndexOf('/')
                const parentDir = idx >= 0 ? parent.substring(0, idx) || '/' : '/'
                if (parentDir !== browserPath) setMoveModal({ entry, browserPath: parentDir })
              }} disabled={browserPath === '/'}>⬆ Up</button>
              <span className="move-browser-path">{browserPath}</span>
            </div>
            <div className="move-browser-list">
              {moveBrowserLoading ? (
                <div className="move-browser-loading">Loading...</div>
              ) : moveBrowserDirs.length === 0 ? (
                <div className="move-browser-empty">No subdirectories</div>
              ) : (
                moveBrowserDirs.map(dir => (
                  <div key={dir.path} className="move-browser-item" onDoubleClick={() => setMoveModal({ entry, browserPath: dir.path })}>
                    <span className="move-browser-icon">📁</span>
                    <span className="move-browser-name">{dir.name}</span>
                  </div>
                ))
              )}
            </div>
          </div>
          <div className="modal-actions">
            <button className="modal-cancel" onClick={() => setMoveModal(null)}>Cancel</button>
            <button onClick={async () => {
              try {
                await moveFile(entry.path, destPath)
                showToast('Moved successfully')
                setMoveModal(null)
                fetchDir()
              } catch (err: any) {
                showToast(err.message || 'Failed to move')
              }
            }}>Move Here</button>
          </div>
        </div>
      </div>
    )
  }

  const renderCreatePrompt = () => {
    if (!createMode) return null
    return (
      <div className="modal-overlay" onClick={() => { setCreateMode(null); setCreateName('') }}>
        <div className="modal-confirm" onClick={(e) => e.stopPropagation()}>
          <h3>New {createMode === 'folder' ? 'Folder' : 'File'}</h3>
          <input
            ref={inputRef}
            type="text"
            placeholder={createMode === 'folder' ? 'Folder name' : 'File name'}
            value={createName}
            onChange={(e) => setCreateName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
          />
          <div className="modal-actions">
            <button className="modal-cancel" onClick={() => { setCreateMode(null); setCreateName('') }}>Cancel</button>
            <button onClick={handleCreate}>Create</button>
          </div>
        </div>
      </div>
    )
  }

  const contextMenuWidget = (
    <>
      {renderContextMenu()}
      {renderDeleteConfirm()}
      {renderRenamePrompt()}
      {renderMoveModal()}
      {renderCreatePrompt()}
    </>
  )

  if (loading) return <div className="file-list-loading">Loading...</div>
  if (error) return <div className="file-list-error">{error}</div>

  if (viewMode === 'grid') {
    return (
      <div className="file-list file-grid" ref={gridRef} onScroll={handleGridScroll}>
        <div className="file-grid-body" onContextMenu={(e) => handleContextMenu(e, null)}>
          {parentPath && (
            <div className="file-grid-card folder-card file-grid-card-parent" onClick={() => onNavigate(parentPath)}>
              <div className="grid-card-thumb">
                <span className="grid-card-icon grid-card-icon-parent">⬆</span>
              </div>
              <div className="grid-card-info">
                <div className="grid-card-name">..</div>
              </div>
            </div>
          )}
          {allEntries.slice(0, visibleCount).map((entry) => {
            const isSelected = entry.path === selectedPath
            const tags = Array.isArray(entry.metadata.tags) ? entry.metadata.tags : []
            const isImageFile = /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(entry.name)
            return (
              <div
                key={entry.path}
                className={`file-grid-card ${entry.isDirectory ? 'folder-card' : 'file-card'} ${isSelected ? 'is-selected' : ''}`}
                onClick={() => { if (entry.isDirectory) onNavigate(entry.path); else onSelectFile(entry) }}
                onContextMenu={(e) => handleContextMenu(e, entry)}
              >
                <div className="grid-card-thumb">
                  {entry.isDirectory ? (
                    <span className="grid-card-icon">📁</span>
                  ) : isImageFile ? (
                    <img src={`/api/files/raw?path=${encodeURIComponent(entry.path)}`} alt="" loading="lazy" className="grid-card-img" />
                  ) : /\.(mp4|mov|webm|avi|mkv|wmv|flv)$/i.test(entry.name) ? (
                    <img src={`/api/files/thumbnail?path=${encodeURIComponent(entry.path)}`} alt="" loading="lazy" className="grid-card-img" />
                  ) : (
                    <span className="grid-card-icon">📄</span>
                  )}
                </div>
                <div className="grid-card-info">
                  <div className="grid-card-name" title={entry.name}>{entry.name}</div>
                  <div className="grid-card-meta">
                    {entry.isDirectory ? '-' : formatSize(entry.size)}
                    {tags.length > 0 && <span className="grid-card-tags"> · {tags[0]}{tags.length > 1 ? ` +${tags.length - 1}` : ''}</span>}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
        {contextMenuWidget}
        {toast && <div className="toast-notification">{toast}</div>}
      </div>
    )
  }

  return (
    <div className="file-list" onContextMenu={(e) => handleContextMenu(e, null)}>
      <div className="file-list-header">
        <span className="header-name">Name</span>
        <span className="header-size">Size</span>
        <span className="header-modified">Modified</span>
        <span className="header-tags">Tags</span>
      </div>
      <div className="file-list-body">
        {parentPath && (
          <div className="file-row file-row-parent" onClick={() => onNavigate(parentPath)}>
            <span className="file-name">..</span>
            <span className="file-size">-</span>
            <span className="file-modified">-</span>
            <span className="file-tags"></span>
          </div>
        )}
        {allEntries.map((entry) => {
          const tags = Array.isArray(entry.metadata.tags) ? entry.metadata.tags : []
          const isSelected = entry.path === selectedPath
          return (
            <div
              key={entry.path}
              className={`file-row ${entry.isDirectory ? 'is-dir' : ''} ${isSelected ? 'is-selected' : ''}`}
              onClick={() => { if (entry.isDirectory) onNavigate(entry.path); else onSelectFile(entry) }}
              onContextMenu={(e) => handleContextMenu(e, entry)}
            >
              <span className="file-name">
                <span className="file-icon">{fileIcon(entry.name, entry.isDirectory)}</span>
                {entry.name}
              </span>
              <span className="file-size">{formatSize(entry.size)}</span>
              <span className="file-modified">{formatDate(entry.modified)}</span>
              <span className="file-tags">
                {tags.slice(0, 3).map((t: string) => (
                  <span key={t} className="tag-badge">{t}</span>
                ))}
                {tags.length > 3 && <span className="tag-more">+{tags.length - 3}</span>}
              </span>
            </div>
          )
        })}
      </div>
      {contextMenuWidget}
      {toast && <div className="toast-notification">{toast}</div>}
    </div>
  )
}
