import { useState, useEffect, useCallback } from 'react'
import { useApiContext } from './hooks/ApiContext'
import type { User, FileEntry, SearchResult } from './types'
import Login from './components/Login'
import Setup from './components/Setup'
import FileList from './components/FileList'
import MetadataPanel from './components/MetadataPanel'
import SearchBar from './components/SearchBar'
import Breadcrumb from './components/Breadcrumb'
import Settings, { applyTheme } from './components/Settings'
import { menuCoords, CopyLocationSubmenu, RenameDialog, DeleteConfirmDialog } from './components/fileActions'
import ThumbImg, { hasCachedThumb } from './components/ThumbImg'
import { isImageEntry, isVideoEntry } from './utils/media'
import { getCookie, setCookie } from './utils/cookies'

type View = 'browse' | 'settings'

export default function App() {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [needsSetup, setNeedsSetup] = useState(false)
  const [view, setView] = useState<View>('browse')
  const [currentPath, setCurrentPath] = useState('')
  const [rootPath, setRootPath] = useState('')
  const [selectedFile, setSelectedFile] = useState<FileEntry | null>(null)
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null)
  const [searchPage, setSearchPage] = useState(0)
  const SEARCH_PAGE_SIZE = 100
  const [isSearching, setIsSearching] = useState(false)
  const [searchLoading, setSearchLoading] = useState(false)
  const [showHiddenFiles, setShowHiddenFiles] = useState(false)
  const [viewMode, setViewMode] = useState<'list' | 'grid'>((getCookie('viewMode') as 'list' | 'grid') || 'list')
  const [currentFiles, setCurrentFiles] = useState<FileEntry[]>([])
  const [rootError, setRootError] = useState('')
  const [isDemo, setIsDemo] = useState(false)
  const [isGuest, setIsGuest] = useState(false)
  const [guestEnabled, setGuestEnabled] = useState(false)
  const [showLogin, setShowLogin] = useState(false)

  const [searchMenu, setSearchMenu] = useState<{ visible: boolean; x: number; y: number; result: SearchResult | null }>({
    visible: false, x: 0, y: 0, result: null,
  })
  const [searchRenameTarget, setSearchRenameTarget] = useState<SearchResult | null>(null)
  const [searchDeleteTarget, setSearchDeleteTarget] = useState<SearchResult | null>(null)
  const [searchToast, setSearchToast] = useState<string | null>(null)

  const [theme, setTheme] = useState<'system' | 'light' | 'dark'>((getCookie('theme') as 'system' | 'light' | 'dark') || 'dark')

  // apply theme on mount and on change
  useEffect(() => { applyTheme(theme) }, [theme])

  const api = useApiContext()

  useEffect(() => {
    (async () => {
      try {
        const setupStatus = await fetch('/api/auth/setup-status', { credentials: 'include' }).then(r => r.json())
        if (setupStatus.demo) {
          setIsDemo(true)
          setUser({ id: 'demo', email: 'demo@tagger.app', name: 'Demo User' })
          setNeedsSetup(false)
        } else if (setupStatus.needsSetup) {
          setNeedsSetup(true)
        } else {
          const [session, gs] = await Promise.all([
            api.getSession().catch(() => null),
            // Public endpoint — also tells logged-out visitors if guest mode is on.
            fetch('/api/users/global-settings', { credentials: 'include' }).then(r => r.json()).catch(() => null),
          ])
          if (gs?.settings?.guest_readonly === 'true') setGuestEnabled(true)
          if (session?.user) {
            setUser(session.user)
          } else if (gs?.settings?.guest_readonly === 'true') {
            // Guest-first: land visitors directly in read-only view when on.
            setIsGuest(true)
          }
        }
      } catch {
        // If either fails, proceed to login
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  useEffect(() => {
    if (!user && !isGuest) return
    fetch('/api/files/root-status', { credentials: 'include' })
      .then(r => r.json())
      .then(data => {
        if (!data.valid) setRootError(data.error || 'Root directory is not accessible')
      })
      .catch(() => setRootError('Failed to check root directory'))
  }, [user, isGuest])

  useEffect(() => {
    if (!user) return
    fetch('/api/users/settings', { credentials: 'include' })
      .then(r => r.json())
      .then(data => {
        const s = data.settings || {}
        if (s.rootDirectory) setCurrentPath(s.rootDirectory)
        if (s.showHiddenFiles !== undefined) setShowHiddenFiles(s.showHiddenFiles)
      })
      .catch(() => {})
  }, [user])

  const handleAuth = useCallback(async () => {
    const session = await api.getSession()
    if (session?.user) { setUser(session.user); setIsGuest(false); setShowLogin(false) }
  }, [])

  const handleSetupComplete = useCallback(() => {
    setNeedsSetup(false)
    handleAuth()
  }, [handleAuth])

  const handleLogout = async () => {
    if (isDemo) return
    await api.signOut()
    setUser(null)
    setSelectedFile(null)
    setSearchResults(null)
    setIsSearching(false)
    // Fall back to guest view when it's enabled.
    if (guestEnabled) setIsGuest(true)
    setShowLogin(false)
  }

  const handleSearchResults = (results: SearchResult[]) => {
    setSearchResults(results)
    setSearchPage(0)
    setIsSearching(true)
    setSelectedFile(null)
  }

  const handleClearSearch = () => {
    setSearchResults(null)
    setSearchPage(0)
    setIsSearching(false)
  }

  const handleSelectSearchResult = async (result: SearchResult) => {
    const info = await api.getFileInfo(result.path)
    setSelectedFile(info)
  }

  const showSearchToast = (msg: string) => {
    setSearchToast(msg)
    window.setTimeout(() => setSearchToast(null), 2000)
  }

  useEffect(() => {
    if (!searchMenu.visible) return
    const handleCloseMenu = () => {
      setSearchMenu(prev => prev.visible ? { ...prev, visible: false } : prev)
    }
    window.addEventListener('click', handleCloseMenu)
    window.addEventListener('contextmenu', handleCloseMenu)
    return () => {
      window.removeEventListener('click', handleCloseMenu)
      window.removeEventListener('contextmenu', handleCloseMenu)
    }
  }, [searchMenu.visible])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (searchRenameTarget) setSearchRenameTarget(null)
      else if (searchDeleteTarget) setSearchDeleteTarget(null)
      else if (searchMenu.visible) {
        setSearchMenu(prev => ({ ...prev, visible: false }))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [searchRenameTarget, searchDeleteTarget, searchMenu.visible])

  const handleSearchContextMenu = (e: React.MouseEvent, result: SearchResult) => {
    e.preventDefault()
    e.stopPropagation()
    const { x, y } = menuCoords(e)
    setSearchMenu({ visible: true, x, y, result })
    // Right-click follows selection so the sidebar acts on the same item.
    if (result.path !== selectedFile?.path) {
      handleSelectSearchResult(result).catch(() => {})
    }
  }

  const handleLocateSearchResult = async (result: SearchResult) => {
    const idx = result.path.lastIndexOf('/')
    const parent = idx > 0 ? result.path.substring(0, idx) : '/'
    setSearchMenu(prev => ({ ...prev, visible: false }))
    // Exit search mode and open the containing folder with the file selected,
    // as if the user had browsed there and clicked it.
    setSearchResults(null)
    setSearchPage(0)
    setIsSearching(false)
    setCurrentPath(parent)
    try {
      const info = await api.getFileInfo(result.path)
      setSelectedFile(info)
    } catch {
      setSelectedFile(null)
    }
  }

  const handleSearchRename = async (name: string) => {
    if (!searchRenameTarget || !name.trim()) return
    const oldPath = searchRenameTarget.path
    try {
      const res = await api.renameFile(oldPath, name.trim())
      const newPath: string = res.path
      setSearchResults(prev => prev ? prev.map(r => r.path === oldPath ? { ...r, path: newPath } : r) : prev)
      if (selectedFile?.path === oldPath) {
        try {
          const info = await api.getFileInfo(newPath)
          setSelectedFile(info)
        } catch { /* keep old selection */ }
      }
      showSearchToast('Renamed')
      setSearchRenameTarget(null)
    } catch (err: any) {
      showSearchToast(err.message || 'Failed to rename')
    }
  }

  const handleSearchDelete = async () => {
    if (!searchDeleteTarget) return
    const targetPath = searchDeleteTarget.path
    try {
      await api.deleteFile(targetPath)
      setSearchResults(prev => prev ? prev.filter(r => r.path !== targetPath) : prev)
      if (selectedFile?.path === targetPath) setSelectedFile(null)
      showSearchToast('Deleted')
      setSearchDeleteTarget(null)
    } catch (err: any) {
      showSearchToast(err.message || 'Failed to delete')
      setSearchDeleteTarget(null)
    }
  }

  const handleMetadataUpdate = () => {
    if (selectedFile) {
      api.getFileInfo(selectedFile.path).then(setSelectedFile)
    }
  }

  const handleRootDirChange = (dir: string) => {
    setCurrentPath(dir)
  }

  const handleNavigateMedia = (dir: 1 | -1) => {
    if (!selectedFile || currentFiles.length === 0) return
    const idx = currentFiles.findIndex(f => f.path === selectedFile.path)
    if (idx === -1) return
    const next = (idx + dir + currentFiles.length) % currentFiles.length
    setSelectedFile(currentFiles[next])
  }

  if (loading) return <div className="app-loading">Loading...</div>
  if (needsSetup) return <Setup onComplete={handleSetupComplete} />
  if (!user && (showLogin || !isGuest)) {
    return <Login onAuth={handleAuth} onGuest={guestEnabled ? () => { setIsGuest(true); setShowLogin(false) } : undefined} />
  }
  const readOnly = !user || isGuest

  if (view === 'settings' && !readOnly) {
    return (
      <div className="app">
        <div className="app-body">
          <Settings
            onClose={() => setView('browse')}
            onRootDirChange={handleRootDirChange}
            onSettingsChange={s => {
              if (s.showHiddenFiles !== undefined) setShowHiddenFiles(s.showHiddenFiles)
              if (s.viewMode) { setViewMode(s.viewMode); setCookie('viewMode', s.viewMode) }
              if (s.theme) { setTheme(s.theme); setCookie('theme', s.theme) }
            }}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-left">
          <h1 className="app-title">TagStudio</h1>
          <SearchBar
            onSearchResult={handleSearchResults}
            onClearSearch={handleClearSearch}
            isSearching={isSearching}
            onSearchLoading={setSearchLoading}
          />
        </div>
        <div className="header-right">
          {isDemo ? (
            <span className="demo-badge">Demo</span>
          ) : readOnly ? (
            <>
              <span className="demo-badge">Guest · read-only</span>
              <button className="logout-btn" onClick={() => setShowLogin(true)}>Login</button>
            </>
          ) : (
            <>
              <span className="user-email">{user.name || user.email}</span>
              <button className="logout-btn" onClick={handleLogout}>Logout</button>
            </>
          )}
          {!readOnly && <button className="settings-btn" onClick={() => setView('settings')} title="Settings">&#9881;</button>}
        </div>
      </header>

      <div className="app-body">
        <div className="main-panel">
          {searchLoading && (
            <div className="search-loading">Searching...</div>
          )}

          {isSearching && searchResults ? (
            <div className="search-results">
              <h2>Search Results ({searchResults.length})</h2>
              {searchResults.length === 0 ? (
                <div className="search-empty">No files found matching your criteria.</div>
              ) : (() => {
                const searchPageCount = Math.max(1, Math.ceil(searchResults.length / SEARCH_PAGE_SIZE))
                const safeSearchPage = Math.min(searchPage, searchPageCount - 1)
                const pageResults = searchResults.slice(safeSearchPage * SEARCH_PAGE_SIZE, safeSearchPage * SEARCH_PAGE_SIZE + SEARCH_PAGE_SIZE)
                const searchPager = searchPageCount > 1 ? (
                  <div className="file-pager">
                    <button disabled={safeSearchPage === 0} onClick={() => setSearchPage(safeSearchPage - 1)}>← Prev</button>
                    <span>Page {safeSearchPage + 1} of {searchPageCount}</span>
                    <button disabled={safeSearchPage >= searchPageCount - 1} onClick={() => setSearchPage(safeSearchPage + 1)}>Next →</button>
                  </div>
                ) : null
                return (
                  <>
                    {viewMode === 'grid' ? (
                      <div className="file-grid-body">
                        {pageResults.map((r) => {
                          const name = r.path.split('/').pop() || r.path
                          const isImageFile = isImageEntry({ name })
                          const isVideoFile = isVideoEntry({ name, kind: r.kind })
                          return (
                            <div
                              key={r.path}
                              className={`file-grid-card ${selectedFile?.path === r.path ? 'is-selected' : ''}`}
                              onClick={() => handleSelectSearchResult(r)}
                              onContextMenu={(e) => handleSearchContextMenu(e, r)}
                            >
                              <div className="grid-card-thumb">
                                {isImageFile ? (
                                  <ThumbImg path={r.path} name={name} thumb={hasCachedThumb(name)} className="grid-card-img" />
                                ) : isVideoFile ? (
                                  <ThumbImg path={r.path} name={name} thumb video fallbackIcon="🎬" className="grid-card-img" />
                                ) : (
                                  <span className="grid-card-icon">📄</span>
                                )}
                              </div>
                              <div className="grid-card-info">
                                <div className="grid-card-name" title={r.path}>{name}</div>
                                <div className="grid-card-meta">
                                  {Array.isArray(r.metadata.tags) && r.metadata.tags.length > 0 && (
                                    <span className="grid-card-tags">{r.metadata.tags[0]}{r.metadata.tags.length > 1 ? ` +${r.metadata.tags.length - 1}` : ''}</span>
                                  )}
                                </div>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    ) : (
                      pageResults.map((r) => (
                        <div
                          key={r.path}
                          className={`search-result-row ${selectedFile?.path === r.path ? 'is-selected' : ''}`}
                          onClick={() => handleSelectSearchResult(r)}
                          onContextMenu={(e) => handleSearchContextMenu(e, r)}
                        >
                          <span className="result-path">{r.path}</span>
                          <span className="result-tags">
                            {Array.isArray(r.metadata.tags) && (r.metadata.tags as string[]).map((t: string) => (
                              <span key={t} className="tag-badge">{t}</span>
                            ))}
                          </span>
                        </div>
                      ))
                    )}
                    {searchPager}
                    {searchMenu.visible && searchMenu.result && (
                      <div
                        className="context-menu"
                        style={{ top: searchMenu.y, left: searchMenu.x }}
                        onClick={(e) => e.stopPropagation()}
                        onContextMenu={(e) => e.stopPropagation()}
                      >
                        <div className="context-menu-item" onClick={() => handleLocateSearchResult(searchMenu.result!)}>
                          📍 Locate
                        </div>
                        <div className="context-menu-sep" />
                        <CopyLocationSubmenu
                          path={searchMenu.result!.path}
                          root={rootPath}
                          showToast={showSearchToast}
                          onDone={() => setSearchMenu(prev => ({ ...prev, visible: false }))}
                        />
                        <div className="context-menu-sep" />
                        {!readOnly && (
                          <>
                            <div className="context-menu-item" onClick={() => {
                              setSearchRenameTarget(searchMenu.result)
                              setSearchMenu(prev => ({ ...prev, visible: false }))
                            }}>
                              ✏️ Rename
                            </div>
                            <div className="context-menu-sep" />
                            <div className="context-menu-item danger" onClick={() => {
                              setSearchDeleteTarget(searchMenu.result)
                              setSearchMenu(prev => ({ ...prev, visible: false }))
                            }}>
                              🗑 Delete
                            </div>
                          </>
                        )}
                      </div>
                    )}
                    {searchRenameTarget && (
                      <RenameDialog
                        initial={searchRenameTarget.path.split('/').pop() || searchRenameTarget.path}
                        onCancel={() => setSearchRenameTarget(null)}
                        onSubmit={handleSearchRename}
                      />
                    )}
                    {searchDeleteTarget && (
                      <DeleteConfirmDialog
                        title="Delete file?"
                        name={searchDeleteTarget.path.split('/').pop() || searchDeleteTarget.path}
                        onCancel={() => setSearchDeleteTarget(null)}
                        onConfirm={handleSearchDelete}
                      />
                    )}
                    {searchToast && <div className="toast-notification">{searchToast}</div>}
                  </>
                )
              })()}
            </div>
          ) : (
            <>
              <Breadcrumb path={currentPath || rootPath} root={rootPath} onNavigate={setCurrentPath} />
              <FileList
                path={currentPath}
                onNavigate={setCurrentPath}
                onSelectFile={setSelectedFile}
                selectedPath={selectedFile?.path || null}
                onRootLoaded={setRootPath}
                showHidden={showHiddenFiles}
                onFilesChange={setCurrentFiles}
                viewMode={viewMode}
                readOnly={readOnly}
              />
            </>
          )}
        </div>

        <aside className="side-panel">
          {rootError && <div className="root-error">{rootError}</div>}
          <MetadataPanel file={selectedFile} onUpdate={handleMetadataUpdate} onNavigateMedia={handleNavigateMedia} readOnly={readOnly} />
        </aside>
      </div>
    </div>
  )
}
