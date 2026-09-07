import { useState, useEffect, useCallback, useRef } from 'react'
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

function getPathFromUrl(): string | null {
  try {
    const p = new URLSearchParams(window.location.search).get('path')
    return p ? p : null
  } catch {
    return null
  }
}

function normalizeRoot(root: string): string {
  if (!root) return ''
  const stripped = root.replace(/\/+$/, '')
  return stripped || '/'
}

/** Absolute fs path -> URL value relative to root ('' = root itself).
 *  Falls back to the absolute path when it can't be relativized
 *  (root not loaded yet, or outside root). */
function toRelativePath(absPath: string, root: string): string {
  if (!absPath) return ''
  const r = normalizeRoot(root)
  if (!r) return absPath
  if (absPath === r) return ''
  if (r === '/') return absPath.replace(/^\//, '')
  if (absPath.startsWith(r + '/')) return absPath.slice(r.length + 1)
  return absPath
}

/** URL value -> absolute fs path. Leading '/' = legacy absolute URL.
 *  Returns null for relative values while root is still unknown. */
function toAbsolutePath(value: string | null, root: string): string | null {
  if (!value) return ''
  if (value.startsWith('/')) return value
  if (!root) return null
  const r = normalizeRoot(root)
  const rel = value.replace(/^\//, '')
  return r === '/' ? `/${rel}` : `${r}/${rel}`
}

function getSelFromUrl(): string | null {
  try {
    const s = new URLSearchParams(window.location.search).get('sel')
    return s ? s : null
  } catch {
    return null
  }
}

function buildUrlForPath(absPath: string, root: string, sel?: string | null): string {
  const u = new URL(window.location.href)
  const rel = toRelativePath(absPath, root)
  if (rel) u.searchParams.set('path', rel)
  else u.searchParams.delete('path')
  // sel === undefined preserves whatever is already in the URL.
  if (sel !== undefined) {
    if (sel) u.searchParams.set('sel', sel)
    else u.searchParams.delete('sel')
  }
  return u.pathname + u.search + u.hash
}

export default function App() {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [needsSetup, setNeedsSetup] = useState(false)
  const [view, setView] = useState<View>('browse')
  // Deep-linkable: ?path= is relative to the server root ('' = root) and
  // restores the folder on reload / shared links. Absolute values are still
  // accepted for back-compat with old links.
  const [currentPath, setCurrentPath] = useState(() => {
    const v = getPathFromUrl()
    if (!v) return ''
    if (v.startsWith('/')) return v
    return '' // relative — resolved against rootPath once known (below)
  })
  // Relative ?path= value waiting for rootPath so it can be resolved.
  const [pendingRelative, setPendingRelative] = useState<string | null>(() => {
    const v = getPathFromUrl()
    return v && !v.startsWith('/') ? v : null
  })
  // Raw ?sel= value waiting to be resolved + selected (see effects below).
  const [pendingSel, setPendingSel] = useState<string | null>(() => getSelFromUrl())
  const [rootPath, setRootPath] = useState('')
  const rootRef = useRef(rootPath)
  useEffect(() => { rootRef.current = rootPath }, [rootPath])
  // Folder back/forward history (mouse XBUTTON1/XBUTTON2 + nav buttons).
  const [backStack, setBackStack] = useState<string[]>([])
  const [forwardStack, setForwardStack] = useState<string[]>([])
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
  const [searchRenameConflict, setSearchRenameConflict] = useState<string | null>(null)
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
        // Don't clobber a deep-linked / history-restored path.
        if (s.rootDirectory && !getPathFromUrl()) setCurrentPath(s.rootDirectory)
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

  const navigateTo = useCallback((path: string) => {
    if (path === currentPath) return
    if (currentPath) setBackStack(b => [...b.slice(-99), currentPath])
    setForwardStack([])
    setCurrentPath(path)
    try {
      // Carry the selection in state so back/forward restores it; the URL
      // keeps ?sel= (selection persists across folder nav, same as state).
      window.history.pushState(
        { path, sel: selectedRef.current?.path ?? null },
        '',
        buildUrlForPath(path, rootRef.current),
      )
    } catch {
      // History API unavailable (e.g. non-browser env) — in-app nav still works.
    }
  }, [currentPath])

  const goBack = useCallback(() => {
    // One press = one action: back out of search first so folder nav is visible.
    if (isSearching) {
      setSearchResults(null)
      setSearchPage(0)
      setIsSearching(false)
      return
    }
    if (backStack.length === 0) return
    // Folder nav lives in browser history, so the toolbar back button,
    // mouse side buttons and the in-app button all stay in sync.
    // popstate handler below applies the actual state change.
    try {
      window.history.back()
    } catch {
      const prev = backStack[backStack.length - 1]
      setBackStack(backStack.slice(0, -1))
      if (currentPath) setForwardStack(f => [...f.slice(-99), currentPath])
      setCurrentPath(prev)
    }
  }, [backStack, currentPath, isSearching])

  const goForward = useCallback(() => {
    if (isSearching) {
      setSearchResults(null)
      setSearchPage(0)
      setIsSearching(false)
      if (forwardStack.length === 0) return
    }
    if (forwardStack.length === 0) return
    try {
      window.history.forward()
    } catch {
      const next = forwardStack[forwardStack.length - 1]
      setForwardStack(forwardStack.slice(0, -1))
      if (currentPath) setBackStack(b => [...b.slice(-99), currentPath])
      setCurrentPath(next)
    }
  }, [forwardStack, currentPath, isSearching])

  // Refs mirror state for the popstate handler (avoids stale closures).
  const backRef = useRef(backStack)
  const forwardRef = useRef(forwardStack)
  const pathRef = useRef(currentPath)
  useEffect(() => { backRef.current = backStack }, [backStack])
  useEffect(() => { forwardRef.current = forwardStack }, [forwardStack])
  useEffect(() => { pathRef.current = currentPath }, [currentPath])
  const searchingRef = useRef(isSearching)
  useEffect(() => { searchingRef.current = isSearching }, [isSearching])
  const selectedRef = useRef(selectedFile)
  useEffect(() => { selectedRef.current = selectedFile }, [selectedFile])
  const apiRef = useRef(api)
  apiRef.current = api
  // Guards out-of-order ?sel= fetches (rapid back/forward).
  const selReqRef = useRef(0)
  const selPendingRef = useRef(false)

  // Select an absolute path if it exists and is a file; otherwise clear.
  // Latest call wins.
  const fetchSel = useCallback((absPath: string | null) => {
    if (!absPath) {
      selReqRef.current++
      selPendingRef.current = false
      setSelectedFile(prev => (prev ? null : prev))
      return
    }
    const id = ++selReqRef.current
    selPendingRef.current = true
    apiRef.current.getFileInfo(absPath).then(
      info => {
        if (selReqRef.current !== id) return
        selPendingRef.current = false
        setSelectedFile(info && !info.isDirectory ? info : null)
      },
      () => {
        if (selReqRef.current !== id) return
        selPendingRef.current = false
        setSelectedFile(null)
      },
    )
  }, [])

  // Tag the initial history entry on mount (even while the path is still
  // empty) so popping back to it later yields an explicit state instead of
  // null. Without this, back-to-home resolves to "unknown" and the UI stalls.
  // history.state.path stays absolute internally; only the visible URL is
  // relative (see buildUrlForPath).
  useEffect(() => {
    try {
      const initial = getPathFromUrl() ?? ''
      window.history.replaceState({ path: initial }, '', buildUrlForPath(initial, rootRef.current))
    } catch { /* ignore */ }
  }, [])

  // Resolve a relative deep-link (?path=sub/dir) once the root is known.
  useEffect(() => {
    if (!rootPath || !pendingRelative) return
    if (pathRef.current) { setPendingRelative(null); return } // user already navigated
    const abs = toAbsolutePath(pendingRelative, rootPath)
    setPendingRelative(null)
    if (!abs) return
    try {
      window.history.replaceState({ path: abs }, '', buildUrlForPath(abs, rootPath))
    } catch { /* ignore */ }
    setCurrentPath(abs)
  }, [rootPath, pendingRelative])

  // Once the root is known, canonicalize the visible URL to the relative
  // form (replace, never push — no extra history entries). No-op when the
  // URL already matches (normal pushes and popstate traversals).
  // ?sel= is preserved.
  useEffect(() => {
    if (!rootPath || !currentPath) return
    try {
      const want = buildUrlForPath(currentPath, rootPath)
      const cur = window.location.pathname + window.location.search + window.location.hash
      if (want !== cur) window.history.replaceState({ path: currentPath, sel: selectedRef.current?.path ?? null }, '', want)
    } catch { /* ignore */ }
  }, [rootPath, currentPath])

  // Mirror the sidebar selection into ?sel= (root-relative) via replaceState
  // so any copied link reopens with the file selected. Skipped while a
  // deep-link or popstate selection is still being applied.
  useEffect(() => {
    if (!rootPath || pendingSel || selPendingRef.current) return
    const wantSel = selectedFile ? toRelativePath(selectedFile.path, rootPath) : null
    if ((getSelFromUrl() ?? null) === wantSel) return
    try {
      const url = buildUrlForPath(pathRef.current, rootPath, wantSel)
      window.history.replaceState({ path: pathRef.current, sel: selectedFile?.path ?? null }, '', url)
    } catch { /* ignore */ }
  }, [selectedFile, currentPath, rootPath, pendingSel])

  // Apply a deep-linked ?sel= once root, auth and folder are ready.
  // Selects the file only if it exists (and is a file, not a directory).
  useEffect(() => {
    if (!rootPath || !pendingSel) return
    if (!user && !isGuest && !isDemo) return
    if (pendingRelative) return // folder still resolving — sel applies after
    const abs = toAbsolutePath(pendingSel, rootPath)
    setPendingSel(null)
    if (abs === null) return // root unknown — shouldn't happen here
    if (selectedRef.current) return // user already selected something
    if (!abs) return
    fetchSel(abs)
  }, [rootPath, pendingSel, pendingRelative, user, isGuest, isDemo, fetchSel])

  // Browser toolbar back/forward (and history jumps): mirror into app state.
  useEffect(() => {
    const onPopState = (e: PopStateEvent) => {
      const st = e.state as { path?: string; sel?: string | null } | null
      const statePath = st?.path
      // No ?path (initial entry, old pre-history URLs) means home (''),
      // which the server resolves to the root listing — never ignore it.
      // history.state.path is absolute; URL values may be relative (new)
      // or absolute (old links) — resolve accordingly.
      const raw = typeof statePath === 'string' ? statePath : (getPathFromUrl() ?? '')
      const target = raw.startsWith('/') || !raw
        ? raw
        : (toAbsolutePath(raw, rootRef.current) ?? pathRef.current)
      const cur = pathRef.current
      // Selection is authoritative per history entry (state wins, URL is the
      // fallback for entries written before ?sel= existed).
      {
        let selAbs: string | null | undefined
        if (st && 'sel' in st) selAbs = st.sel ?? null
        else {
          const selRaw = getSelFromUrl()
          if (!selRaw) selAbs = null
          else if (selRaw.startsWith('/')) selAbs = selRaw
          else selAbs = toAbsolutePath(selRaw, rootRef.current) ?? undefined
        }
        const curSel = selectedRef.current?.path ?? null
        if (selAbs !== undefined && selAbs !== curSel) fetchSel(selAbs)
      }
      if (target === cur) return
      // Any history traversal exits the search overlay.
      if (searchingRef.current) {
        setSearchResults(null)
        setSearchPage(0)
        setIsSearching(false)
      }
      // Home is never tracked in backStack (navigations from '' skip it),
      // so handle it as a back-step explicitly to keep forward intact.
      if (target === '') {
        if (!cur) return
        setForwardStack(f => [...f.slice(-99), cur].slice(-100))
        setBackStack(b => (b.length > 0 ? b.slice(0, -1) : b))
        setCurrentPath('')
        return
      }
      const back = [...backRef.current]
      const fwd = [...forwardRef.current]
      const backIdx = back.lastIndexOf(target)
      if (backIdx !== -1) {
        const between = back.slice(backIdx + 1)
        setBackStack(back.slice(0, backIdx))
        setForwardStack([...fwd, cur, ...between.reverse()].slice(-100))
        setCurrentPath(target)
        return
      }
      const fwdIdx = fwd.lastIndexOf(target)
      if (fwdIdx !== -1) {
        const after = fwd.slice(fwdIdx + 1)
        setForwardStack(fwd.slice(0, fwdIdx))
        setBackStack([...back, cur, ...after.reverse()].slice(-100))
        setCurrentPath(target)
        return
      }
      // Unknown entry (e.g. direct URL edit): treat as a fresh navigation.
      if (cur) setBackStack([...back.slice(-99), cur])
      setForwardStack([])
      setCurrentPath(target)
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  // XBUTTON1 (button 3) = back, XBUTTON2 (button 4) = forward.
  // preventDefault also stops the browser from navigating away from the app.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (e.button === 3) {
        e.preventDefault()
        goBack()
      } else if (e.button === 4) {
        e.preventDefault()
        goForward()
      }
    }
    const onUp = (e: MouseEvent) => {
      if (e.button === 3 || e.button === 4) e.preventDefault()
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('mouseup', onUp)
    }
  }, [goBack, goForward])

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
      if (searchRenameTarget) { setSearchRenameTarget(null); setSearchRenameConflict(null) }
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
    navigateTo(parent)
    try {
      const info = await api.getFileInfo(result.path)
      setSelectedFile(info)
    } catch {
      setSelectedFile(null)
    }
  }

  const handleSearchRename = async (name: string, overwrite = false) => {
    if (!searchRenameTarget || !name.trim()) return
    const oldPath = searchRenameTarget.path
    try {
      const res = await api.renameFile(oldPath, name.trim(), overwrite)
      const newPath: string = res.path
      // On replace, the victim row (if present) is gone — drop it.
      setSearchResults(prev => prev ? prev
        .filter(r => r.path !== newPath || r.path === oldPath)
        .map(r => r.path === oldPath ? { ...r, path: newPath } : r) : prev)
      if (selectedFile?.path === oldPath) {
        try {
          const info = await api.getFileInfo(newPath)
          setSelectedFile(info)
        } catch { /* keep old selection */ }
      }
      showSearchToast(overwrite ? 'Replaced' : 'Renamed')
      setSearchRenameTarget(null)
      setSearchRenameConflict(null)
    } catch (err: any) {
      if (err?.status === 409 && !overwrite) {
        setSearchRenameConflict(name.trim())
        return
      }
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
    navigateTo(dir)
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
                              setSearchRenameConflict(null)
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
                        conflict={searchRenameConflict}
                        onCancel={() => { setSearchRenameTarget(null); setSearchRenameConflict(null) }}
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
              <div className="nav-bar">
                <button
                  className="nav-btn"
                  disabled={!isSearching && backStack.length === 0}
                  onClick={goBack}
                  title="Back (mouse side button)"
                >←</button>
                <button
                  className="nav-btn"
                  disabled={forwardStack.length === 0}
                  onClick={goForward}
                  title="Forward (mouse side button)"
                >→</button>
                <Breadcrumb path={currentPath || rootPath} root={rootPath} onNavigate={navigateTo} />
              </div>
              <FileList
                path={currentPath}
                onNavigate={navigateTo}
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
