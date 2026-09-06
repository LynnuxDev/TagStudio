import { useState, useEffect, useCallback, useRef } from 'react'
import type { FileEntry, DirListing } from '../types'
import { useApiContext } from '../hooks/ApiContext'
import { extOf, isAudioEntry, isImageEntry, isVideoEntry } from '../utils/media'
import ThumbImg, { hasCachedThumb } from './ThumbImg'
import { menuCoords, CopyLocationSubmenu, RenameDialog, DeleteConfirmDialog } from './fileActions'
import { getCookie, setCookie } from '../utils/cookies'

const BATCH_SIZE = 100

interface FileListProps {
  path: string
  onNavigate: (path: string) => void
  onSelectFile: (file: FileEntry | null) => void
  selectedPath: string | null
  onRootLoaded?: (root: string) => void
  showHidden?: boolean
  onFilesChange?: (files: FileEntry[]) => void
  viewMode?: 'list' | 'grid'
  readOnly?: boolean
}

export default function FileList({ path, onNavigate, onSelectFile, selectedPath, onRootLoaded, showHidden, onFilesChange, viewMode, readOnly }: FileListProps) {
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
  const [page, setPage] = useState(0)
  const [confirmDelete, setConfirmDelete] = useState<FileEntry | null>(null)
  type SortKey = 'name' | 'size' | 'modified'
  const [sortKey, setSortKey] = useState<SortKey>(() => {
    const c = getCookie('sortKey')
    return c === 'size' || c === 'modified' ? c : 'name'
  })
  const [sortDir, setSortDir] = useState<1 | -1>(() => getCookie('sortDir') === 'desc' ? -1 : 1)
  const [createName, setCreateName] = useState('')
  const [createMode, setCreateMode] = useState<'folder' | 'file' | null>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const lastRevealedRef = useRef<string | null>(null)
  // Anchor for Shift+Click range selection (index into the current page).
  const lastClickIndex = useRef<number | null>(null)

  const [renameTarget, setRenameTarget] = useState<FileEntry | null>(null)

  const [moveModal, setMoveModal] = useState<{ entries: FileEntry[]; browserPath: string } | null>(null)
  const [moveBrowserDirs, setMoveBrowserDirs] = useState<FileEntry[]>([])
  const [moveBrowserLoading, setMoveBrowserLoading] = useState(false)
  const [checked, setChecked] = useState<string[]>([])
  const [bulkTagOpen, setBulkTagOpen] = useState(false)
  const [bulkTagInput, setBulkTagInput] = useState('')
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)

  const { listDir, getFileInfo, addTags, createFolder, createFile, deleteFile, renameFile, moveFile, extractArchive, openWithYacreader, decryptRpgMaker } = useApiContext()

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
    }
    window.addEventListener('click', handleCloseMenu)
    window.addEventListener('contextmenu', handleCloseMenu)
    return () => {
      window.removeEventListener('click', handleCloseMenu)
      window.removeEventListener('contextmenu', handleCloseMenu)
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (createMode) { setCreateMode(null); setCreateName('') }
      else if (renameTarget) setRenameTarget(null)
      else if (confirmDelete) setConfirmDelete(null)
      else if (moveModal) setMoveModal(null)
      else if (bulkTagOpen) { setBulkTagOpen(false); setBulkTagInput('') }
      else if (bulkDeleteOpen) setBulkDeleteOpen(false)
      else if (contextMenu.visible) {
        setContextMenu(prev => ({ ...prev, visible: false }))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [createMode, renameTarget, confirmDelete, moveModal, bulkTagOpen, bulkDeleteOpen, contextMenu.visible])

  // Reset to first page only when navigating to a different directory.
  // Refreshes of the same directory (delete/rename/move/extract/create)
  // must preserve the current page — safePage below already clamps when
  // the list shrinks.
  useEffect(() => {
    setPage(0)
    setChecked([])
    lastRevealedRef.current = null
  }, [path])

  // Shift+Click anchor is an index into the visible page — drop it whenever
  // the visible list changes. (Must live before the loading early-return
  // below: hooks may never run conditionally.)
  useEffect(() => { lastClickIndex.current = null }, [path, page])

  useEffect(() => {
    gridRef.current?.scrollTo?.({ top: 0 })
  }, [page, path])

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

  useEffect(() => { if (createMode && inputRef.current) inputRef.current.focus() }, [createMode])

  const showToast = (msg: string) => {
    setToast(msg)
    window.setTimeout(() => setToast(null), 2000)
  }

  const cycleSort = (key: SortKey) => {
    if (key === sortKey) {
      const next = (sortDir === 1 ? -1 : 1) as 1 | -1
      setSortDir(next)
      setCookie('sortDir', next === 1 ? 'asc' : 'desc')
    } else {
      setSortKey(key)
      setCookie('sortKey', key)
    }
    setPage(0)
  }

  const sortArrow = (key: SortKey) => sortKey === key ? (sortDir === 1 ? ' ▲' : ' ▼') : ''

  const handleContextMenu = (e: React.MouseEvent, entry?: FileEntry | null) => {
    e.preventDefault()
    e.stopPropagation()
    const { x, y } = menuCoords(e)
    setContextMenu({ visible: true, x, y, entry: entry || null })
    // Right-click follows selection so the sidebar acts on the same item.
    if (entry && !entry.isDirectory && entry.path !== selectedPath) onSelectFile(entry)
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

  const handleRename = async (name: string) => {
    if (!renameTarget || !name.trim()) return
    const wasSelected = renameTarget.path === selectedPath
    try {
      const res = await renameFile(renameTarget.path, name.trim())
      showToast('Renamed')
      setRenameTarget(null)
      if (wasSelected) {
        try {
          onSelectFile(await getFileInfo(res.path))
        } catch { /* keep old selection */ }
      }
      fetchDir()
    } catch (err: any) {
      showToast(err.message || 'Failed to rename')
    }
  }

  const handleDelete = async () => {
    if (!confirmDelete) return
    const targetPath = confirmDelete.path
    try {
      await deleteFile(targetPath)
      showToast('Deleted')
      setContextMenu(prev => ({ ...prev, visible: false }))
      setConfirmDelete(null)
      // Don't leave the sidebar showing a file that no longer exists.
      if (targetPath === selectedPath) onSelectFile(null)
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

  const toggleChecked = (entryPath: string) => {
    setChecked(prev => prev.includes(entryPath) ? prev.filter(p => p !== entryPath) : [...prev, entryPath])
  }

  const handleBulkTag = async () => {
    const tag = bulkTagInput.trim()
    if (!tag || checked.length === 0) return
    const results = await Promise.allSettled(checked.map(p => addTags(p, [tag])))
    const ok = results.filter(r => r.status === 'fulfilled').length
    showToast(ok === checked.length ? `Tagged ${ok} item${ok === 1 ? '' : 's'}` : `Tagged ${ok}/${checked.length}`)
    setBulkTagOpen(false)
    setBulkTagInput('')
    fetchDir()
  }

  const handleBulkDelete = async () => {
    if (checked.length === 0) return
    const targets = [...checked]
    const results = await Promise.allSettled(targets.map(p => deleteFile(p)))
    const succeeded = targets.filter((_, i) => results[i].status === 'fulfilled')
    const failed = targets.length - succeeded.length
    setChecked(prev => prev.filter(p => !succeeded.includes(p)))
    if (succeeded.includes(selectedPath ?? '')) onSelectFile(null)
    showToast(failed === 0 ? `Deleted ${succeeded.length} item${succeeded.length === 1 ? '' : 's'}` : `Deleted ${succeeded.length}/${targets.length}`)
    setBulkDeleteOpen(false)
    fetchDir()
  }

  const handleBulkMove = async (entries: FileEntry[], browserPath: string) => {
    const results = await Promise.allSettled(entries.map(entry => {
      const dest = browserPath.endsWith('/') ? browserPath + entry.name : browserPath + '/' + entry.name
      return moveFile(entry.path, dest)
    }))
    const succeeded = entries.filter((_, i) => results[i].status === 'fulfilled').map(e => e.path)
    const failed = entries.length - succeeded.length
    setChecked(prev => prev.filter(p => !succeeded.includes(p)))
    if (succeeded.includes(selectedPath ?? '')) onSelectFile(null)
    showToast(failed === 0 ? `Moved ${succeeded.length} item${succeeded.length === 1 ? '' : 's'}` : `Moved ${succeeded.length}/${entries.length}`)
    setMoveModal(null)
    fetchDir()
  }

  const formatDate = (iso: string): string => {
    return new Date(iso).toLocaleDateString(undefined, {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
  }

  const fileIcon = (entry: FileEntry): string => {
    if (entry.isBrokenLink) return '⚠️'
    if (entry.isDirectory) return '📁'
    if (isImageEntry(entry)) return '🖼️'
    if (isVideoEntry(entry)) return '🎬'
    if (isAudioEntry(entry)) return '🎵'
    const ext = extOf(entry.name)
    switch (ext) {
      case 'zip': case '7z': case 'rar': case 'tar': case 'gz': case 'bz2': case 'xz': return '📦'        // Archive
      case 'pdf': case 'cbz': return '📕'                                                                 // Books
      case 'txt': case 'md': return '📝'                                                                  // Markup/documentation
      case 'json': case 'xml': case 'yaml': case 'yml': case 'toml': case 'csv': return '📊'              // Data
      case 'js': case 'ts': case 'py': case 'rb': case 'go': case 'rs': case 'java': case 'c': case 'cpp': case 'h': return '💻'  // Programming
      default: return '📄'  // default
    }
  }

  const compareEntries = (a: FileEntry, b: FileEntry): number => {
    let r = 0
    if (sortKey === 'name') r = a.name.localeCompare(b.name)
    else if (sortKey === 'size') r = a.size - b.size
    else r = Date.parse(a.modified) - Date.parse(b.modified)
    return r * sortDir
  }
  // Folders stay on top; each group follows the active sort.
  const dirs = (listing?.contents.filter((f: FileEntry) => f.isDirectory) || []).sort(compareEntries)
  const files = (listing?.contents.filter((f: FileEntry) => !f.isDirectory) || []).sort(compareEntries)
  const allEntries = [...dirs, ...files]
  const parentPath = listing?.parent

  // Reveal the selected file (e.g. after "Locate" from search): jump to the
  // page containing selectedPath. Only runs once per selection — subsequent
  // refreshes of the same directory won't yank the user back, and if the
  // listing doesn't contain the selection yet (new folder still loading) it
  // retries when the listing arrives.
  useEffect(() => {
    if (!selectedPath || !listing) return
    if (lastRevealedRef.current === selectedPath) return
    const idx = allEntries.findIndex((e) => e.path === selectedPath)
    if (idx === -1) return
    const targetPage = Math.floor(idx / BATCH_SIZE)
    lastRevealedRef.current = selectedPath
    setPage((prev) => (prev === targetPage ? prev : targetPage))
  }, [selectedPath, listing])

  const hasSelection = !!contextMenu.entry
  const isArchive = hasSelection && /\.(zip|7z|rar|tar|gz|bz2|xz)$/i.test(contextMenu.entry!.name)
  const isCbz = hasSelection && /\.cbz$/i.test(contextMenu.entry!.name)
  const isRpgMakerAsset = hasSelection && /\.(rpgmvp|png_|rpgmvm|rpgmvo)$/i.test(contextMenu.entry!.name)

  const renderContextMenu = () => {
    if (!contextMenu.visible) return null
    if (readOnly) {
      if (!hasSelection) return null
      return (
        <div
          className="context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.stopPropagation()}
        >
          <CopyLocationSubmenu
            path={contextMenu.entry!.path}
            root={listing?.root}
            fullPath={(() => {
              const displayRoot = (listing as any)?.displayRoot
              return displayRoot
                ? displayRoot + contextMenu.entry!.path.substring(listing!.root.length)
                : undefined
            })()}
            showToast={showToast}
            onDone={() => setContextMenu(prev => ({ ...prev, visible: false }))}
          />
        </div>
      )
    }
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
            <CopyLocationSubmenu
              path={contextMenu.entry!.path}
              root={listing?.root}
              fullPath={(() => {
                const displayRoot = (listing as any)?.displayRoot
                return displayRoot
                  ? displayRoot + contextMenu.entry!.path.substring(listing!.root.length)
                  : undefined
              })()}
              showToast={showToast}
              onDone={() => setContextMenu(prev => ({ ...prev, visible: false }))}
            />
          </>
        )}

        {hasSelection && (
          <>
            <div className="context-menu-sep" />
            <div className="context-menu-item" onClick={() => {
              setRenameTarget(contextMenu.entry)
              setContextMenu(prev => ({ ...prev, visible: false }))
            }}>
              ✏️ Rename
            </div>
            <div className="context-menu-item" onClick={() => {
              const entry = contextMenu.entry!
              setMoveModal({ entries: [entry], browserPath: entry.path.substring(0, entry.path.lastIndexOf('/')) || '/' })
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

        {isRpgMakerAsset && (
          <>
            <div className="context-menu-sep" />
            <div className="context-menu-item" onClick={async () => {
              setContextMenu(prev => ({ ...prev, visible: false }))
              try {
                const res = await decryptRpgMaker(contextMenu.entry!.path)
                showToast(`Decrypted to ${res.output}`)
                fetchDir()
              } catch (err: any) {
                showToast(err.message || 'Failed to decrypt')
              }
            }}>
              🔓 Decrypt RPGMaker Asset
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
      <DeleteConfirmDialog
        title={`Delete ${confirmDelete.isSymlink ? 'link' : confirmDelete.isDirectory ? 'folder' : 'file'}?`}
        name={confirmDelete.name}
        onCancel={() => setConfirmDelete(null)}
        onConfirm={handleDelete}
      />
    )
  }

  const renderRenamePrompt = () => {
    if (!renameTarget) return null
    return (
      <RenameDialog
        initial={renameTarget.name}
        onCancel={() => setRenameTarget(null)}
        onSubmit={handleRename}
      />
    )
  }

  const renderMoveModal = () => {
    if (!moveModal) return null
    const { entries, browserPath } = moveModal
    const single = entries.length === 1 ? entries[0] : null
    const destPreview = single
      ? (browserPath.endsWith('/') ? browserPath + single.name : browserPath + '/' + single.name)
      : `${entries.length} items → ${browserPath}`

    return (
      <div className="modal-overlay" onClick={() => setMoveModal(null)}>
        <div className="modal-move" onClick={(e) => e.stopPropagation()}>
          <h3>{single ? `Move "${single.name}"` : `Move ${entries.length} items`}</h3>
          <div className="move-path">
            <span className="move-path-label">Destination:</span>
            <span className="move-path-value">{destPreview}</span>
          </div>
          <div className="move-browser">
            <div className="move-browser-header">
              <button className="move-nav-btn" onClick={() => {
                const parent = browserPath.replace(/\/+$/, '')
                const idx = parent.lastIndexOf('/')
                const parentDir = idx >= 0 ? parent.substring(0, idx) || '/' : '/'
                if (parentDir !== browserPath) setMoveModal({ entries, browserPath: parentDir })
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
                  <div key={dir.path} className="move-browser-item" onDoubleClick={() => setMoveModal({ entries, browserPath: dir.path })}>
                    <span className="move-browser-icon">📁</span>
                    <span className="move-browser-name">{dir.name}</span>
                  </div>
                ))
              )}
            </div>
          </div>
          <div className="modal-actions">
            <button className="modal-cancel" onClick={() => setMoveModal(null)}>Cancel</button>
            <button onClick={() => handleBulkMove(entries, browserPath)}>Move Here</button>
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
      {bulkTagOpen && (
        <div className="modal-overlay" onClick={() => { setBulkTagOpen(false); setBulkTagInput('') }}>
          <div className="modal-confirm" onClick={(e) => e.stopPropagation()}>
            <h3>Add tag to {checked.length} item{checked.length === 1 ? '' : 's'}</h3>
            <input
              autoFocus
              type="text"
              placeholder="Tag name"
              value={bulkTagInput}
              onChange={(e) => setBulkTagInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleBulkTag()}
            />
            <div className="modal-actions">
              <button className="modal-cancel" onClick={() => { setBulkTagOpen(false); setBulkTagInput('') }}>Cancel</button>
              <button onClick={handleBulkTag}>Add</button>
            </div>
          </div>
        </div>
      )}
      {bulkDeleteOpen && (
        <DeleteConfirmDialog
          title={`Delete ${checked.length} item${checked.length === 1 ? '' : 's'}?`}
          name={checked.slice(0, 3).map(p => p.split('/').pop() || p).join(', ') + (checked.length > 3 ? ` +${checked.length - 3} more` : '')}
          onCancel={() => setBulkDeleteOpen(false)}
          onConfirm={handleBulkDelete}
        />
      )}
    </>
  )

  if (loading) return <div className="file-list-loading">Loading...</div>
  if (error) return <div className="file-list-error">{error}</div>

  // Paginate so only one page of entries (and their thumbnails) is mounted
  // at a time — previously infinite scroll kept appending DOM nodes and
  // full-size images until the tab ran out of memory.
  const pageCount = Math.max(1, Math.ceil(allEntries.length / BATCH_SIZE))
  const safePage = Math.min(page, pageCount - 1)
  const pageEntries = allEntries.slice(safePage * BATCH_SIZE, safePage * BATCH_SIZE + BATCH_SIZE)
  const pager = pageCount > 1 ? (
    <div className="file-pager">
      <button disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>← Prev</button>
      <span>Page {safePage + 1} of {pageCount} ({allEntries.length} items)</span>
      <button disabled={safePage >= pageCount - 1} onClick={() => setPage(safePage + 1)}>Next →</button>
      <span className="pager-hint" title="Hold Ctrl (⌘ on Mac) and click to toggle items, or Shift+Click for a range">Ctrl+Click to multi-select</span>
    </div>
  ) : null

  const checkedSet = new Set(checked)

  const handleEntryClick = (e: React.MouseEvent, entry: FileEntry, index: number) => {
    // Guests are read-only: no multi-select, just navigate/select.
    if (readOnly) {
      lastClickIndex.current = index
      if (entry.isDirectory) onNavigate(entry.path)
      else onSelectFile(entry)
      return
    }
    // Ctrl/Cmd+Click toggles multi-select; Shift+Click selects a range.
    if (e.ctrlKey || e.metaKey) {
      toggleChecked(entry.path)
      lastClickIndex.current = index
      if (!entry.isDirectory) onSelectFile(entry)
      return
    }
    if (e.shiftKey && lastClickIndex.current !== null) {
      const start = Math.min(lastClickIndex.current, index)
      const end = Math.max(lastClickIndex.current, index)
      const range = pageEntries.slice(start, end + 1).map(en => en.path)
      setChecked(prev => [...new Set([...prev, ...range])])
      return
    }
    lastClickIndex.current = index
    if (checked.length > 0) setChecked([])
    if (entry.isDirectory) onNavigate(entry.path)
    else onSelectFile(entry)
  }

  const selectionBar = readOnly ? null : checked.length > 0 ? (
    <div className="selection-bar">
      <span className="selection-count">{checked.length} selected</span>
      <button onClick={() => setBulkTagOpen(true)}>🏷 Tag</button>
      <button onClick={() => {
        const entries = allEntries.filter(e => checkedSet.has(e.path))
        if (entries.length > 0) setMoveModal({ entries, browserPath: listing?.path || path })
      }}>📂 Move</button>
      <button className="selection-danger" onClick={() => setBulkDeleteOpen(true)}>🗑 Delete</button>
      <button onClick={() => setChecked([])}>✕ Clear</button>
    </div>
  ) : null

  const sortBar = (
    <div className="sort-bar">
      <label>
        Sort
        <select
          value={sortKey}
          onChange={(e) => {
            const key = e.target.value as SortKey
            setSortKey(key)
            setCookie('sortKey', key)
            setPage(0)
          }}
        >
          <option value="name">Name</option>
          <option value="size">Size</option>
          <option value="modified">Modified</option>
        </select>
      </label>
      <button
        className="sort-dir-btn"
        title={sortDir === 1 ? 'Ascending (click for descending)' : 'Descending (click for ascending)'}
        onClick={() => {
          const next = (sortDir === 1 ? -1 : 1) as 1 | -1
          setSortDir(next)
          setCookie('sortDir', next === 1 ? 'asc' : 'desc')
          setPage(0)
        }}
      >
        {sortDir === 1 ? '▲' : '▼'}
      </button>
    </div>
  )

  if (viewMode === 'grid') {
    return (
      <div className="file-list file-grid" ref={gridRef} onContextMenu={(e) => handleContextMenu(e, null)}>
        {sortBar}
        {selectionBar}
        <div className="file-grid-body">
          {parentPath && safePage === 0 && (
            <div className="file-grid-card folder-card file-grid-card-parent" onClick={() => onNavigate(parentPath)}>
              <div className="grid-card-thumb">
                <span className="grid-card-icon grid-card-icon-parent">⬆</span>
              </div>
              <div className="grid-card-info">
                <div className="grid-card-name">..</div>
              </div>
            </div>
          )}
          {pageEntries.map((entry, idx) => {
            const isSelected = entry.path === selectedPath
            const tags = Array.isArray(entry.metadata.tags) ? entry.metadata.tags : []
            const isImageFile = isImageEntry(entry)
            const isVideoFile = isVideoEntry(entry)
            return (
              <div
                key={entry.path}
                className={`file-grid-card ${entry.isDirectory ? 'folder-card' : 'file-card'} ${isSelected ? 'is-selected' : ''} ${checkedSet.has(entry.path) ? 'is-checked' : ''}`}
                title="Ctrl+Click to multi-select"
                onClick={(e) => handleEntryClick(e, entry, idx)}
                onContextMenu={(e) => handleContextMenu(e, entry)}
              >
                <div className="grid-card-thumb">
                  {entry.isBrokenLink ? (
                    <span className="grid-card-icon" title="Broken link">⚠️</span>
                  ) : entry.isDirectory ? (
                    <span className="grid-card-icon">📁</span>
                  ) : isImageFile ? (
                    <ThumbImg path={entry.path} name={entry.name} thumb={hasCachedThumb(entry.name)} className="grid-card-img" />
                  ) : isVideoFile ? (
                    <ThumbImg path={entry.path} name={entry.name} thumb video fallbackIcon="🎬" className="grid-card-img" />
                  ) : (
                    <span className="grid-card-icon">📄</span>
                  )}
                </div>
                <div className="grid-card-info">
                  <div className="grid-card-name" title={entry.isSymlink && entry.symlinkTarget ? `${entry.name} → ${entry.symlinkTarget}` : entry.name}>
                    {entry.name}{entry.isSymlink && <span className="symlink-badge" title={entry.symlinkTarget || 'Symlink'}> 🔗</span>}
                  </div>
                  <div className="grid-card-meta">
                    {entry.isDirectory ? '-' : formatSize(entry.size)}
                    {tags.length > 0 && <span className="grid-card-tags"> · {tags[0]}{tags.length > 1 ? ` +${tags.length - 1}` : ''}</span>}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
        {pager}
        {contextMenuWidget}
        {toast && <div className="toast-notification">{toast}</div>}
      </div>
    )
  }

  return (
    <div className="file-list" onContextMenu={(e) => handleContextMenu(e, null)}>
      <div className="file-list-header">
        <span className="header-name sortable" onClick={() => cycleSort('name')}>Name{sortArrow('name')}</span>
        <span className="header-size sortable" onClick={() => cycleSort('size')}>Size{sortArrow('size')}</span>
        <span className="header-modified sortable" onClick={() => cycleSort('modified')}>Modified{sortArrow('modified')}</span>
        <span className="header-tags">Tags</span>
      </div>
      {selectionBar}
      <div className="file-list-body">
        {parentPath && safePage === 0 && (
          <div className="file-row file-row-parent" onClick={() => onNavigate(parentPath)}>
            <span className="file-name">..</span>
            <span className="file-size">-</span>
            <span className="file-modified">-</span>
            <span className="file-tags"></span>
          </div>
        )}
        {pageEntries.map((entry, idx) => {
          const tags = Array.isArray(entry.metadata.tags) ? entry.metadata.tags : []
          const isSelected = entry.path === selectedPath
          return (
            <div
              key={entry.path}
              className={`file-row ${entry.isDirectory ? 'is-dir' : ''} ${isSelected ? 'is-selected' : ''} ${checkedSet.has(entry.path) ? 'is-checked' : ''}`}
              title="Ctrl+Click to multi-select"
              onClick={(e) => handleEntryClick(e, entry, idx)}
              onContextMenu={(e) => handleContextMenu(e, entry)}
            >
              <span className="file-name" title={entry.isSymlink && entry.symlinkTarget ? `${entry.name} → ${entry.symlinkTarget}` : entry.name}>
                <span className="file-icon">{fileIcon(entry)}</span>
                {entry.name}{entry.isSymlink && <span className="symlink-badge"> 🔗</span>}
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
      {pager}
      {contextMenuWidget}
      {toast && <div className="toast-notification">{toast}</div>}
    </div>
  )
}
