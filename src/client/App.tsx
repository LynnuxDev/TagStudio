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
  const [isSearching, setIsSearching] = useState(false)
  const [searchLoading, setSearchLoading] = useState(false)
  const [showHiddenFiles, setShowHiddenFiles] = useState(false)
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list')
  const [currentFiles, setCurrentFiles] = useState<FileEntry[]>([])
  const [rootError, setRootError] = useState('')
  const [isDemo, setIsDemo] = useState(false)

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
          const session = await api.getSession()
          if (session?.user) {
            setUser(session.user)
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
    if (!user) return
    fetch('/api/files/root-status', { credentials: 'include' })
      .then(r => r.json())
      .then(data => {
        if (!data.valid) setRootError(data.error || 'Root directory is not accessible')
      })
      .catch(() => setRootError('Failed to check root directory'))
  }, [user])

  useEffect(() => {
    fetch('/api/users/settings', { credentials: 'include' })
      .then(r => r.json())
      .then(data => {
        const s = data.settings || {}
        if (s.theme) applyTheme(s.theme)
        if (s.rootDirectory) setCurrentPath(s.rootDirectory)
        if (s.showHiddenFiles !== undefined) setShowHiddenFiles(s.showHiddenFiles)
        if (s.viewMode) setViewMode(s.viewMode)
      })
      .catch(() => {})
  }, [])

  const handleAuth = useCallback(async () => {
    const session = await api.getSession()
    if (session?.user) setUser(session.user)
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
  }

  const handleSearchResults = (results: SearchResult[]) => {
    setSearchResults(results)
    setIsSearching(true)
    setSelectedFile(null)
  }

  const handleClearSearch = () => {
    setSearchResults(null)
    setIsSearching(false)
  }

  const handleSelectSearchResult = async (result: SearchResult) => {
    const info = await api.getFileInfo(result.path)
    setSelectedFile(info)
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
  if (!user) return <Login onAuth={handleAuth} />

  if (view === 'settings') {
    return (
      <div className="app">
        <div className="app-body">
          <Settings
            onClose={() => setView('browse')}
            onRootDirChange={handleRootDirChange}
            onSettingsChange={s => {
              if (s.showHiddenFiles !== undefined) setShowHiddenFiles(s.showHiddenFiles)
              if (s.viewMode) setViewMode(s.viewMode)
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
          ) : (
            <>
              <span className="user-email">{user.name || user.email}</span>
              <button className="logout-btn" onClick={handleLogout}>Logout</button>
            </>
          )}
          <button className="settings-btn" onClick={() => setView('settings')} title="Settings">&#9881;</button>
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
              ) : viewMode === 'grid' ? (
                <div className="file-grid-body">
                  {searchResults.map((r) => {
                    const name = r.path.split('/').pop() || r.path
                    const isImageFile = /\.(jpg|jpeg|png|gif|webp|svg|tiff?|ico)$/i.test(name)
                    return (
                      <div
                        key={r.path}
                        className={`file-grid-card ${selectedFile?.path === r.path ? 'is-selected' : ''}`}
                        onClick={() => handleSelectSearchResult(r)}
                      >
                        <div className="grid-card-thumb">
                          {isImageFile ? (
                            <img src={`/api/files/raw?path=${encodeURIComponent(r.path)}`} alt="" loading="lazy" className="grid-card-img" />
                          ) : /\.(mp4|mov|webm|avi|mkv|wmv|flv)$/i.test(name) ? (
                            <img src={`/api/files/thumbnail?path=${encodeURIComponent(r.path)}`} alt="" loading="lazy" className="grid-card-img" />
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
                searchResults.map((r) => (
                  <div
                    key={r.path}
                    className={`search-result-row ${selectedFile?.path === r.path ? 'is-selected' : ''}`}
                    onClick={() => handleSelectSearchResult(r)}
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
              />
            </>
          )}
        </div>

        <aside className="side-panel">
          {rootError && <div className="root-error">{rootError}</div>}
          <MetadataPanel file={selectedFile} onUpdate={handleMetadataUpdate} onNavigateMedia={handleNavigateMedia} />
        </aside>
      </div>
    </div>
  )
}
