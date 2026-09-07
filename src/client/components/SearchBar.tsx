import { useState, useRef, useEffect } from 'react'
import type { SearchResult } from '../types'
import { useApiContext } from '../hooks/ApiContext'

const COMMON_EXTENSIONS = [
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.rpgmvp', '.png_',
  '.mp4', '.m4v', '.mov', '.avi', '.mkv',
  '.mp3', '.wav', '.flac', '.ogg',
  '.pdf', '.doc', '.docx', '.txt',
  '.zip', '.tar', '.gz', '.rar',
  '.json', '.xml', '.csv', '.yaml',
]

interface SearchBarProps {
  onSearchResult: (results: SearchResult[]) => void
  onClearSearch: () => void
  isSearching: boolean
  onSearchLoading?: (loading: boolean) => void
}

export default function SearchBar({ onSearchResult, onClearSearch, isSearching, onSearchLoading }: SearchBarProps) {
  const [query, setQuery] = useState('')
  const [key, setKey] = useState('')
  const [value, setValue] = useState('')
  const [extensions, setExtensions] = useState<string[]>([])
  const [filterTags, setFilterTags] = useState<string[]>([])
  const [showFilters, setShowFilters] = useState(false)

  const [allTags, setAllTags] = useState<string[]>([])
  const [tagInput, setTagInput] = useState('')
  const [showTagDropdown, setShowTagDropdown] = useState(false)

  const [extInput, setExtInput] = useState('')
  const [showExtDropdown, setShowExtDropdown] = useState(false)

  const { search, getTags } = useApiContext()
  const extRef = useRef<HTMLDivElement>(null)
  const tagDropRef = useRef<HTMLDivElement>(null)

  const fetchTags = () =>
    getTags().then((res: { tags: string[] }) => setAllTags(res.tags || [])).catch(() => {})

  useEffect(() => { fetchTags() }, [])

  useEffect(() => {
    const onTagsChanged = () => fetchTags()
    window.addEventListener('tags-changed', onTagsChanged)
    return () => window.removeEventListener('tags-changed', onTagsChanged)
  }, [])

  useEffect(() => { if (showFilters) fetchTags() }, [showFilters])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (extRef.current && !extRef.current.contains(e.target as Node)) setShowExtDropdown(false)
      if (tagDropRef.current && !tagDropRef.current.contains(e.target as Node)) setShowTagDropdown(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const normalizeExt = (raw: string) => {
    const trimmed = raw.trim().toLowerCase()
    if (!trimmed) return ''
    return trimmed.startsWith('.') ? trimmed : `.${trimmed}`
  }

  const toggleExt = (ext: string) => {
    const normalized = normalizeExt(ext)
    if (!normalized) return
    setExtensions(prev =>
      prev.includes(normalized) ? prev.filter(e => e !== normalized) : [...prev, normalized],
    )
  }

  const toggleFilterTag = (t: string) => {
    setFilterTags(prev =>
      prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t],
    )
  }

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault()
    const params: { q?: string; key?: string; value?: string; extensions?: string; tags?: string } = {}
    if (query.trim()) params.q = query.trim()
    if (key.trim() && value.trim()) {
      params.key = key.trim()
      params.value = value.trim()
    }
    if (extensions.length > 0) params.extensions = extensions.join(',')
    if (filterTags.length > 0) params.tags = filterTags.join(',')
    if (!params.q && !params.key && !params.extensions && !params.tags) return
    onSearchLoading?.(true)
    try {
      const result = await search(params)
      onSearchResult(result.results)
    } catch (err) {
      console.error('Search failed', err)
    } finally {
      onSearchLoading?.(false)
    }
  }

  const handleClear = () => {
    setQuery('')
    setKey('')
    setValue('')
    setExtensions([])
    setFilterTags([])
    setTagInput('')
    setExtInput('')
    setShowExtDropdown(false)
    onClearSearch()
  }

  const filteredTagOptions = allTags.filter(t =>
    !filterTags.includes(t) && t.includes(tagInput.toLowerCase()),
  )

  const filteredExtOptions = COMMON_EXTENSIONS.filter(ext =>
    !extensions.includes(ext) && ext.includes(extInput.trim().toLowerCase()),
  )

  const commitExtInput = () => {
    const normalized = normalizeExt(extInput)
    if (!normalized) return
    if (!extensions.includes(normalized)) {
      setExtensions(prev => [...prev, normalized])
    }
    setExtInput('')
  }

  return (
    <div className="search-container">
      <form className="search-bar" onSubmit={handleSearch}>
        <input
          type="text"
          placeholder="Search files..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="search-input"
        />
        <button type="submit" className="search-btn">Search</button>
        {isSearching && (
          <button type="button" className="search-btn clear" onClick={handleClear}>Clear</button>
        )}
        <button
          type="button"
          className={`search-btn filter-toggle ${showFilters ? 'active' : ''}`}
          onClick={() => setShowFilters(!showFilters)}
        >
          Filter {showFilters ? '▲' : '▼'}
        </button>
      </form>

      {showFilters && (
        <div className="filter-panel">
          <div className="filter-row">
            <div className="filter-field tag-filter-field" ref={extRef}>
              <label>Extensions</label>
              {extensions.length > 0 && (
                <div className="filter-tags-list">
                  {extensions.map(ext => (
                    <span key={ext} className="filter-tag-badge" onClick={() => toggleExt(ext)}>
                      {ext} &times;
                    </span>
                  ))}
                </div>
              )}
              <div className="filter-tag-input-wrap">
                <input
                  type="text"
                  placeholder="Add extension..."
                  value={extInput}
                  onChange={e => { setExtInput(e.target.value); setShowExtDropdown(true) }}
                  onFocus={() => setShowExtDropdown(true)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      commitExtInput()
                    } else if (e.key === 'Escape') {
                      setShowExtDropdown(false)
                    }
                  }}
                />
                {showExtDropdown && filteredExtOptions.length > 0 && (
                  <div className="tag-dropdown">
                    {filteredExtOptions.map(ext => (
                      <div key={ext} className="tag-dropdown-item" onMouseDown={e => e.preventDefault()} onClick={() => { toggleExt(ext); setExtInput('') }}>
                        {ext}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="filter-field tag-filter-field">
              <label>Tags</label>
              {filterTags.length > 0 && (
                <div className="filter-tags-list">
                  {filterTags.map(t => (
                    <span key={t} className="filter-tag-badge" onClick={() => toggleFilterTag(t)}>
                      {t} &times;
                    </span>
                  ))}
                </div>
              )}
              <div className="filter-tag-input-wrap">
                <input
                  type="text"
                  placeholder="Add tag..."
                  value={tagInput}
                  onChange={e => { setTagInput(e.target.value); setShowTagDropdown(true) }}
                  onFocus={() => setShowTagDropdown(true)}
                />
                {showTagDropdown && filteredTagOptions.length > 0 && (
                  <div className="tag-dropdown" ref={tagDropRef}>
                    {filteredTagOptions.map(t => (
                      <div key={t} className="tag-dropdown-item" onClick={() => { toggleFilterTag(t); setTagInput('') }}>
                        {t}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="filter-field">
              <label>Key</label>
              <input
                type="text"
                placeholder="Key"
                value={key}
                onChange={e => setKey(e.target.value)}
                list="search-key-suggestions"
              />
              <datalist id="search-key-suggestions">
                <option value="artist" />
                <option value="performer" />
                <option value="album" />
                <option value="title" />
                <option value="year" />
                <option value="genre" />
                <option value="composer" />
                <option value="lyricist" />
                <option value="conductor" />
                <option value="label" />
                <option value="catalog" />
                <option value="bpm" />
                <option value="mood" />
                <option value="rating" />
                <option value="url" />
                <option value="isrc" />
                <option value="upc" />
                <option value="description" />
                <option value="author" />
                <option value="source" />
                <option value="resolution" />
                <option value="codec" />
                <option value="bitrate" />
                <option value="samplerate" />
                <option value="channels" />
              </datalist>
            </div>

            <div className="filter-field">
              <label>Value</label>
              <input
                type="text"
                placeholder="Value"
                value={value}
                onChange={e => setValue(e.target.value)}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
