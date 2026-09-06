import { useState, useEffect } from 'react'
import { setCookie } from '../utils/cookies'

interface UserSettings {
  rootDirectory?: string
  showHiddenFiles?: boolean
  theme?: 'system' | 'light' | 'dark'
  viewMode?: 'list' | 'grid'
}

interface SettingsProps {
  onClose: () => void
  onRootDirChange: (dir: string) => void
  onSettingsChange?: (settings: UserSettings) => void
}

export default function Settings({ onClose, onRootDirChange, onSettingsChange }: SettingsProps) {
  const [settings, setSettings] = useState<UserSettings>({})
  const [globalSettings, setGlobalSettings] = useState<Record<string, string>>({})
  const [message, setMessage] = useState('')

  useEffect(() => {
    fetch('/api/users/settings', { credentials: 'include' })
      .then(r => r.json())
      .then(data => setSettings(data.settings || {}))
      .catch(() => {})
    fetch('/api/users/global-settings', { credentials: 'include' })
      .then(r => r.json())
      .then(data => setGlobalSettings(data.settings || {}))
      .catch(() => {})
  }, [])

  const update = async (partial: Partial<UserSettings>) => {
    const merged = { ...settings, ...partial }
    setSettings(merged)
    setMessage('')
    try {
      const res = await fetch('/api/users/settings', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: merged }),
      })
      const data = await res.json()
      setSettings(data.settings || merged)

      if (partial.theme) { applyTheme(partial.theme); setCookie('theme', partial.theme) }
      if (partial.rootDirectory !== undefined) onRootDirChange(partial.rootDirectory)
      if (partial.viewMode) setCookie('viewMode', partial.viewMode)
      if (onSettingsChange) onSettingsChange(merged)

      setMessage('Saved')
      setTimeout(() => setMessage(''), 2000)
    } catch {
      setMessage('Failed to save')
    }
  }

  const saveGlobal = async (partial: Record<string, string>) => {
    const merged = { ...globalSettings, ...partial }
    setGlobalSettings(merged)
    try {
      await fetch('/api/users/global-settings', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: merged }),
      })
      setMessage('Saved')
      setTimeout(() => setMessage(''), 2000)
    } catch {
      setMessage('Failed to save')
    }
  }

  return (
    <div className="settings-page">
      <div className="settings-header">
        <h2>Settings</h2>
        <button className="settings-close" onClick={onClose}>Back</button>
      </div>

      <div className="settings-body">
        <div className="settings-section">
          <h3>General</h3>

          <label className="settings-field">
            <span className="settings-label hidden">Default Root Directory</span>
            <input
              className='hidden'
              type="text"
              placeholder="/home/user/files"
              value={settings.rootDirectory || ''}
              onChange={e => setSettings({ ...settings, rootDirectory: e.target.value })}
              onBlur={e => update({ rootDirectory: e.target.value })}
            />
          </label>

          <label className="settings-field">
            <span className="settings-label">Show Hidden Files</span>
            <input
              type="checkbox"
              checked={!!settings.showHiddenFiles}
              onChange={e => update({ showHiddenFiles: e.target.checked })}
            />
          </label>
        </div>

        <div className="settings-section">
          <h3>Appearance</h3>

          <label className="settings-field">
            <span className="settings-label">Theme</span>
            <select
              value={settings.theme || 'dark'}
              onChange={e => update({ theme: e.target.value as UserSettings['theme'] })}
            >
              <option value="dark">Dark</option>
              <option value="light">Light</option>
              <option value="system">System</option>
            </select>
          </label>

          <label className="settings-field">
            <span className="settings-label">Default View</span>
            <select
              value={settings.viewMode || 'list'}
              onChange={e => update({ viewMode: e.target.value as UserSettings['viewMode'] })}
            >
              <option value="list">List</option>
              <option value="grid">Grid</option>
            </select>
          </label>
        </div>

        <div className="settings-section">
          <h3>Administration</h3>
          <label className="settings-field">
            <span className="settings-label">Disable Sign-up</span>
            <input
              type="checkbox"
              checked={globalSettings.disable_signup === 'true'}
              onChange={e => saveGlobal({ disable_signup: e.target.checked ? 'true' : 'false' })}
            />
          </label>
          <label className="settings-field">
            <span className="settings-label">Allow guest read-only access</span>
            <input
              type="checkbox"
              checked={globalSettings.guest_readonly === 'true'}
              onChange={e => saveGlobal({ guest_readonly: e.target.checked ? 'true' : 'false' })}
            />
          </label>
          <p className="settings-hint">Guests can browse, preview, and search without logging in. File contents of text files, archive listings, and all edits stay admin-only.</p>
        </div>

        {message && <div className="settings-message">{message}</div>}
      </div>
    </div>
  )
}

export function applyTheme(theme: 'system' | 'light' | 'dark') {
  const resolved = theme === 'system'
    ? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
    : theme
  document.documentElement.setAttribute('data-theme', resolved)
}

export function getEffectiveTheme(settings: UserSettings): 'light' | 'dark' {
  const theme = settings.theme || 'dark'
  return theme === 'system'
    ? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
    : theme
}
