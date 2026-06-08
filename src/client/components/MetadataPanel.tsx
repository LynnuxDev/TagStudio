import React, { useState, useEffect, useRef } from 'react'
import type { FileEntry, MetadataResponse } from '../types'
import type { InfoRow } from '../fileInfoProviders'
import { getExtraRows } from '../fileInfoProviders'
import { useApiContext } from '../hooks/ApiContext'

interface MetadataPanelProps {
  file: FileEntry | null
  onUpdate: () => void
  onNavigateMedia?: (dir: 1 | -1) => void
}

interface TreeNode {
  name: string
  path: string
  isDirectory: boolean
  children: Record<string, TreeNode>
}

function buildTree(paths: string[]): TreeNode {
  const root: TreeNode = {
    name: 'root',
    path: '',
    isDirectory: true,
    children: {},
  }

  for (const p of paths) {
    if (!p.trim()) continue
    const parts = p.split('/').filter(Boolean)
    let current = root
    let accumulatedPath = ''

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      accumulatedPath = accumulatedPath ? `${accumulatedPath}/${part}` : part
      
      const isLast = i === parts.length - 1
      const isDir = !isLast || p.endsWith('/')

      if (!current.children[part]) {
        current.children[part] = {
          name: part,
          path: accumulatedPath,
          isDirectory: isDir,
          children: {},
        }
      }
      current = current.children[part]
    }
  }

  return root
}

function FileTreeNode({ node, level }: { node: TreeNode; level: number }) {
  const [isExpanded, setIsExpanded] = useState(level === 0)

  if (!node.isDirectory) {
    return (
      <div className="archive-file-item file" style={{ paddingLeft: `${level * 12 + 6}px` }} title={node.path}>
        <span>📄</span>
        <span className="file-name-text">{node.name}</span>
      </div>
    )
  }

  const childrenList = Object.values(node.children).sort((a, b) => {
    if (a.isDirectory && !b.isDirectory) return -1
    if (!a.isDirectory && b.isDirectory) return 1
    return a.name.localeCompare(b.name)
  })

  if (node.name === 'root') {
    return (
      <div className="archive-tree-root">
        {childrenList.map((child) => (
          <FileTreeNode key={child.path} node={child} level={0} />
        ))}
      </div>
    )
  }

  return (
    <div className="archive-tree-dir-wrapper">
      <div
        className="archive-file-item dir"
        style={{ paddingLeft: `${level * 12 + 6}px` }}
        onClick={() => setIsExpanded(!isExpanded)}
        title={node.path}
      >
        <span>{isExpanded ? '📂' : '📁'}</span>
        <span className="dir-name-text">{node.name}</span>
      </div>
      {isExpanded && (
        <div className="archive-tree-children">
          {childrenList.map((child) => (
            <FileTreeNode key={child.path} node={child} level={level + 1} />
          ))}
        </div>
      )}
    </div>
  )
}

function formatSize(bytes: number): string {
  if (bytes === 0) return '-'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

export default function MetadataPanel({ file, onUpdate, onNavigateMedia }: MetadataPanelProps) {
  const [meta, setMeta] = useState<MetadataResponse | null>(null)
  const [newKey, setNewKey] = useState('')
  const [newValue, setNewValue] = useState('')
  const [newTag, setNewTag] = useState('')
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [editingDescription, setEditingDescription] = useState(false)
  const [descriptionDraft, setDescriptionDraft] = useState('')

  const [archiveFiles, setArchiveFiles] = useState<string[] | null>(null)
  const [archiveLoading, setArchiveLoading] = useState(false)
  const [archiveError, setArchiveError] = useState('')
  const [extraRows, setExtraRows] = useState<InfoRow[]>([])
  const [textContent, setTextContent] = useState<string | null>(null)
  const [textError, setTextError] = useState('')
  const [textLoading, setTextLoading] = useState(false)
  const [textDraft, setTextDraft] = useState<string | null>(null)
  const [textSaving, setTextSaving] = useState(false)
  const [mediaInfo, setMediaInfo] = useState<{ width?: number; height?: number; duration?: number }>({})

  const isImage = file ? /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(file.name) : false
  const isVideo = file ? /\.(mp4|mov|webm|avi|mkv|wmv|flv)$/i.test(file.name) : false
  const isZip = file ? /\.zip$/i.test(file.name) : false
  const isText = file ? /\.(txt|md|json|xml|yaml|yml|csv|log|sh|js|ts|py|rb|html|css|cfg|ini|conf|env|toml|lock|sql|r|go|rs|java|c|cpp|h|hpp|mermaid)$/i.test(file.name) : false

  const [lightbox, setLightbox] = useState<{ type: 'image' | 'video'; src: string } | null>(null)
  const lightboxOpen = useRef(false)

  useEffect(() => {
    if (lightboxOpen.current && file) {
      const src = `/api/files/raw?path=${encodeURIComponent(file.path)}`
      setLightbox(prev => prev ? { ...prev, src } : null)
    }
  }, [file])

  const openLightbox = (type: 'image' | 'video', src: string) => {
    lightboxOpen.current = true
    setLightbox({ type, src })
  }

  const closeLightbox = () => {
    lightboxOpen.current = false
    setLightbox(null)
  }

  const { getMetadata, patchMetadata, deleteMetadataKey, addTags, removeTag, getArchiveList, saveTextFile, openWithMpv } = useApiContext()

  useEffect(() => {
    if (file) {
      getMetadata(file.path).then(setMeta).catch(() => setMeta(null))
    } else {
      setMeta(null)
    }
  }, [file])

  useEffect(() => {
    setArchiveFiles(null)
    setArchiveError('')
    setExtraRows([])
    setTextContent(null)
    setTextError('')
    setTextDraft(null)

    if (file && isZip) {
      setArchiveLoading(true)
      getArchiveList(file.path)
        .then((res: { files: string[] }) => setArchiveFiles(res.files))
        .catch((err: any) => setArchiveError(err.message || 'Failed to load archive'))
        .finally(() => setArchiveLoading(false))
    }

    if (file && !file.isDirectory && isText && file.size <= 100 * 1024) {
      setTextLoading(true)
      fetch(`/api/files/read-text?path=${encodeURIComponent(file.path)}`, { credentials: 'include' })
        .then(r => r.json())
        .then(data => {
          if (data.content !== undefined) setTextContent(data.content)
          else setTextError(data.error || 'Failed to read')
        })
        .catch(() => setTextError('Failed to read file'))
        .finally(() => setTextLoading(false))
    } else if (file && !file.isDirectory && isText && file.size > 100 * 1024) {
      setTextError('File too large to preview (max 100 KB)')
    }

    if (file && !file.isDirectory) {
      getExtraRows(file).then(setExtraRows)
    }

    setMediaInfo({})
    if (file && isImage) {
      const img = new Image()
      img.onload = () => setMediaInfo({ width: img.naturalWidth, height: img.naturalHeight })
      img.src = `/api/files/raw?path=${encodeURIComponent(file.path)}`
    } else if (file && isVideo) {
      const video = document.createElement('video')
      video.preload = 'metadata'
      video.onloadedmetadata = () => {
        setMediaInfo({ duration: video.duration })
        video.src = ''
      }
      video.src = `/api/files/raw?path=${encodeURIComponent(file.path)}`
    }
  }, [file, isZip, isText, isImage, isVideo])

  useEffect(() => {
    if (!lightbox) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') onNavigateMedia?.(-1)
      else if (e.key === 'ArrowRight') onNavigateMedia?.(1)
      else if (e.key === 'Escape') closeLightbox()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [lightbox, onNavigateMedia])

  if (!file) {
    return <div className="metadata-panel empty">Select a file to view metadata</div>
  }

  const handleAddField = async () => {
    if (!newKey.trim()) return
    let val: unknown = newValue.trim()
    if (val === 'true') val = true
    else if (val === 'false') val = false
    else if (!isNaN(Number(val)) && val !== '') val = Number(val)

    await patchMetadata(file.path, { [newKey]: val })
    setNewKey('')
    setNewValue('')
    const updated = await getMetadata(file.path)
    setMeta(updated)
    onUpdate()
  }

  const handleDeleteKey = async (key: string) => {
    await deleteMetadataKey(file.path, key)
    const updated = await getMetadata(file.path)
    setMeta(updated)
    onUpdate()
  }

  const handleEditKey = async (key: string) => {
    let val: unknown = editValue.trim()
    if (val === 'true') val = true
    else if (val === 'false') val = false
    else if (!isNaN(Number(val)) && val !== '') val = Number(val)

    await patchMetadata(file.path, { [key]: val })
    setEditingKey(null)
    setEditValue('')
    const updated = await getMetadata(file.path)
    setMeta(updated)
    onUpdate()
  }

  const refreshTagsList = () => {
    window.dispatchEvent(new CustomEvent('tags-changed'))
  }

  const handleAddTag = async () => {
    if (!newTag.trim()) return
    await addTags(file.path, [newTag.trim()])
    setNewTag('')
    const updated = await getMetadata(file.path)
    setMeta(updated)
    onUpdate()
    refreshTagsList()
  }

  const handleRemoveTag = async (tag: string) => {
    await removeTag(file.path, tag)
    const updated = await getMetadata(file.path)
    setMeta(updated)
    onUpdate()
    refreshTagsList()
  }

  const handleSaveText = async () => {
    if (!file || textDraft === null) return
    setTextSaving(true)
    try {
      await saveTextFile(file.path, textDraft)
      setTextContent(textDraft)
      setTextDraft(null)
    } catch (err: any) {
      alert(err.message || 'Failed to save')
    } finally {
      setTextSaving(false)
    }
  }

  const metadata = meta?.metadata || {}
  const tags: string[] = Array.isArray(metadata.tags) ? metadata.tags : []
  const otherKeys = Object.keys(metadata).filter(k => k !== 'tags' && k !== 'description')

  const warnings: string[] = []
  if (!file.isDirectory && file.size > 500 * 1024 * 1024) {
    warnings.push(`Large file: ${formatSize(file.size)}`)
  }
  if (file.extension === '.zip' && file.size > 1024 * 1024 * 1024) {
    warnings.push('Large archive — listing contents may be slow')
  }
  if (file.extension === '.zip' && archiveError) {
    warnings.push(`Could not read archive contents: ${archiveError}`)
  }

  const permString = file.mode ? ((file.mode & parseInt('777', 8)).toString(8)) : '-'
  const typeLabel = file.isDirectory
    ? 'Directory'
    : (file.extension ? file.extension.slice(1).toUpperCase() : 'File')

  return (
    <div className="metadata-panel">
      {warnings.length > 0 && (
        <div className="sidebar-warnings">
          {warnings.map((w, i) => (
            <div key={i} className="sidebar-warning">{w}</div>
          ))}
        </div>
      )}

      <div className="metadata-header">
        <h3>{file.name}</h3>
        <span className="metadata-path">{file.path}</span>
      </div>



      <div className="metadata-section">
        <h4>Description</h4>
        {(metadata.description || editingDescription) ? (
          <div className="description-field">
            {editingDescription ? (
              <div className="description-edit">
                <textarea
                  value={descriptionDraft}
                  onChange={(e) => setDescriptionDraft(e.target.value)}
                  rows={4}
                  autoFocus
                />
                <div className="description-actions">
                  <button onClick={async () => {
                    await patchMetadata(file.path, { description: descriptionDraft })
                    setEditingDescription(false)
                    const updated = await getMetadata(file.path)
                    setMeta(updated)
                    onUpdate()
                  }}>Save</button>
                  <button onClick={() => setEditingDescription(false)}>Cancel</button>
                </div>
              </div>
            ) : (
              <div className="description-display">
                <div className="description-text">{String(metadata.description)}</div>
                <div className="description-actions">
                  <button className="btn-icon" onClick={() => {
                    setDescriptionDraft(String(metadata.description))
                    setEditingDescription(true)
                  }} title="Edit">&#9998;</button>
                  <button className="btn-icon delete" onClick={() => handleDeleteKey('description')} title="Delete">&times;</button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <button className="add-description-btn" onClick={() => {
            setDescriptionDraft('')
            setEditingDescription(true)
          }}>+ Add Description</button>
        )}
      </div>

      {(isImage || isVideo) && (
        <div className="preview-section media-preview">
          <h4>Preview</h4>
          {isImage ? (
            <img
              src={`/api/files/raw?path=${encodeURIComponent(file.path)}`}
              alt={file.name}
              className="sidebar-preview-image"
              onClick={() => openLightbox('image', `/api/files/raw?path=${encodeURIComponent(file.path)}`)}
            />
          ) : (
            <>
              <img
                src={`/api/files/thumbnail?path=${encodeURIComponent(file.path)}`}
                alt={file.name}
                className="sidebar-preview-image"
                onClick={() => openLightbox('video', `/api/files/raw?path=${encodeURIComponent(file.path)}`)}
              />
              <button className="open-with-mpv" onClick={() => openWithMpv(file.path)}>
                ▶ Open with mpv
              </button>
            </>
          )}
        </div>
      )}

      <div className="file-info-section">
        <h4>File Info</h4>
        <div className="file-info-grid">
          <span className="info-label">Type</span>
          <span className="info-value">{typeLabel}</span>

          <span className="info-label">Size</span>
          <span className="info-value mono">{formatSize(file.size)}</span>

          <span className="info-label">Modified</span>
          <span className="info-value mono">{formatDate(file.modified)}</span>

          <span className="info-label">Created</span>
          <span className="info-value mono">{formatDate(file.created)}</span>

          {file.extension && (
            <>
              <span className="info-label">Extension</span>
              <span className="info-value mono">{file.extension}</span>
            </>
          )}

          {file.mode !== undefined && (
            <>
              <span className="info-label">Permissions</span>
              <span className="info-value mono">{permString}</span>
            </>
          )}

          {mediaInfo.width !== undefined && mediaInfo.height !== undefined && (
            <>
              <span className="info-label">Dimensions</span>
              <span className="info-value mono">{mediaInfo.width} × {mediaInfo.height}</span>
            </>
          )}

          {mediaInfo.duration !== undefined && (
            <>
              <span className="info-label">Duration</span>
              <span className="info-value mono">{formatDuration(mediaInfo.duration)}</span>
            </>
          )}

          {extraRows.map((row, i) => (
            <React.Fragment key={i}>
              <span className="info-label">{row.label}</span>
              <span className="info-value mono">{row.value}</span>
            </React.Fragment>
          ))}
        </div>
      </div>

      {isZip && (
        <div className="preview-section archive-preview">
          <h4>Archive Contents</h4>
          {archiveLoading ? (
            <div className="archive-loading">Loading archive contents...</div>
          ) : archiveError ? (
            <div className="archive-error">{archiveError}</div>
          ) : archiveFiles ? (
            <div className="archive-files-list">
              {archiveFiles.length === 0 ? (
                <div className="archive-empty">No files in archive</div>
              ) : (
                <FileTreeNode node={buildTree(archiveFiles)} level={0} />
              )}
            </div>
          ) : null}
        </div>
      )}

      {isText && (
        <div className="preview-section text-preview">
          <h4>Preview</h4>
          {textLoading ? (
            <div className="archive-loading">Loading file content...</div>
          ) : textError ? (
            <div className="archive-error">{textError}</div>
          ) : textContent !== null ? (
            <div className="text-editor">
              <textarea
                className="text-editor-input"
                value={textDraft ?? textContent}
                onChange={(e) => setTextDraft(e.target.value)}
                spellCheck={false}
              />
              <div className="text-editor-bar">
                {textDraft !== null && (
                  <button className="text-editor-save" onClick={handleSaveText} disabled={textSaving}>
                    {textSaving ? 'Saving...' : 'Save'}
                  </button>
                )}
              </div>
            </div>
          ) : null}
        </div>
      )}

      <div className="metadata-section">
        <h4>Tags</h4>
        <div className="tags-list">
          {tags.map(tag => (
            <span key={tag} className="tag-badge removable" onClick={() => handleRemoveTag(tag)}>
              {tag} &times;
            </span>
          ))}
        </div>
        <div className="add-tag-form">
          <input
            type="text"
            placeholder="Add tag..."
            value={newTag}
            onChange={(e) => setNewTag(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAddTag()}
          />
          <button onClick={handleAddTag}>Add</button>
        </div>
      </div>

      <div className="metadata-section">
        <h4>Fields</h4>
        {otherKeys.map(key => (
          <div key={key} className="metadata-field">
            <span className="field-key">{key}</span>
            {editingKey === key ? (
              <div className="field-edit">
                <input
                  type="text"
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleEditKey(key)}
                  autoFocus
                />
                <button onClick={() => handleEditKey(key)}>Save</button>
                <button onClick={() => setEditingKey(null)}>Cancel</button>
              </div>
            ) : (
              <div className="field-value-row">
                <span className="field-value">{String(metadata[key])}</span>
                <div className="field-actions">
                  <button
                    className="btn-icon"
                    onClick={() => {
                      setEditingKey(key)
                      setEditValue(String(metadata[key]))
                    }}
                    title="Edit"
                  >
                    &#9998;
                  </button>
                  <button
                    className="btn-icon delete"
                    onClick={() => handleDeleteKey(key)}
                    title="Delete"
                  >
                    &times;
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="metadata-section">
        <h4>Add Field</h4>
        <div className="add-field-form">
          <input
            type="text"
            placeholder="Key"
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            list="field-key-suggestions"
          />
          <datalist id="field-key-suggestions">
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
            <option value="key" />
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
          <input
            type="text"
            placeholder="Value"
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAddField()}
          />
          <button onClick={handleAddField}>Add</button>
        </div>
      </div>

      {lightbox && (
        <div className="lightbox-overlay" onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect()
          const x = e.clientX - rect.left
          if (x < rect.width / 3) onNavigateMedia?.(-1)
          else if (x > rect.width * 2 / 3) onNavigateMedia?.(1)
          else closeLightbox()
        }}>
          <div className="lightbox-content" onClick={e => e.stopPropagation()}>
            <button className="lightbox-close" onClick={() => closeLightbox()}>&times;</button>
            <div className="lightbox-nav-hint lightbox-nav-prev" onClick={() => onNavigateMedia?.(-1)} />
            <div className="lightbox-nav-hint lightbox-nav-next" onClick={() => onNavigateMedia?.(1)} />
            {lightbox.type === 'image' ? (
              <img src={lightbox.src} alt="preview" className="lightbox-media" />
            ) : (
              <video src={lightbox.src} className="lightbox-media" controls autoPlay />
            )}
          </div>
        </div>
      )}
    </div>
  )
}
