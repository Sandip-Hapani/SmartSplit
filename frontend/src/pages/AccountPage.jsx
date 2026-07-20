import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { api } from '../api'

const THEMES = [
  { id: 'system', label: 'System', hint: 'Follow your device' },
  { id: 'light', label: 'Light', hint: '' },
  { id: 'dark', label: 'Dark', hint: '' },
]

export default function AccountPage({ user, onUser }) {
  const [name, setName] = useState(user.name || '')
  const [username, setUsername] = useState(user.username || '')
  const [check, setCheck] = useState(null)   // {available, reason}
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')

  // live availability check while typing a new handle
  useEffect(() => {
    const candidate = username.trim().toLowerCase()
    if (!candidate || candidate === user.username) { setCheck(null); return }
    const t = setTimeout(() => {
      api.usernameAvailable(candidate).then(setCheck).catch(() => setCheck(null))
    }, 350)
    return () => clearTimeout(t)
  }, [username, user.username])

  const flash = (msg) => { setSaved(msg); setTimeout(() => setSaved(''), 2500) }

  const saveProfile = async (e) => {
    e.preventDefault()
    setSaving(true); setError('')
    try {
      const body = {}
      if (name.trim() && name.trim() !== user.name) body.name = name.trim()
      const u = username.trim().toLowerCase()
      if (u && u !== user.username) body.username = u
      if (!Object.keys(body).length) { flash('Nothing to save.'); return }
      onUser(await api.updateAccount(body))
      flash('Profile saved.')
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const setTheme = async (theme) => {
    setError('')
    try {
      onUser(await api.updateAccount({ theme }))
    } catch (err) { setError(err.message) }
  }

  return (
    <div className="page">
      <div className="card">
        <h2>Profile</h2>
        {error && <div className="error">{error}</div>}
        {saved && <div className="notice">{saved}</div>}
        <form onSubmit={saveProfile} className="stack">
          <label>
            <span className="muted">Display name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
          </label>
          <label>
            <span className="muted">Username — how friends find you</span>
            <div className="prefixed">
              <span>@</span>
              <input value={username} placeholder="yourname"
                     onChange={(e) => setUsername(e.target.value.replace(/[^A-Za-z0-9_.]/g, '').toLowerCase())} />
            </div>
          </label>
          {check && (
            <div className={check.available ? 'notice' : 'error'}>
              {check.available ? `@${username.trim().toLowerCase()} is available.` : check.reason}
            </div>
          )}
          <button disabled={saving || (check && !check.available)}>
            {saving ? 'Saving…' : 'Save profile'}
          </button>
        </form>
      </div>

      <EmailCard user={user} onUser={onUser} />

      <div className="card">
        <h3>Appearance</h3>
        <div className="theme-row">
          {THEMES.map((t) => (
            <button key={t.id} type="button"
                    className={`theme-opt${(user.theme || 'system') === t.id ? ' active' : ''}`}
                    onClick={() => setTheme(t.id)}>
              <span className={`swatch ${t.id}`} aria-hidden="true" />
              <strong>{t.label}</strong>
              {t.hint && <span className="muted">{t.hint}</span>}
            </button>
          ))}
        </div>
      </div>

      <InviteCard user={user} />
    </div>
  )
}

function EmailCard({ user, onUser }) {
  const [stage, setStage] = useState('idle')  // idle | sent
  const [newEmail, setNewEmail] = useState('')
  const [code, setCode] = useState('')
  const [devCode, setDevCode] = useState('')
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const request = async (e) => {
    e.preventDefault()
    setBusy(true); setError('')
    try {
      const r = await api.requestEmailChange(newEmail.trim())
      setDevCode(r.dev_code || '')
      setMsg(r.message)
      setStage('sent')
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  const confirm = async (e) => {
    e.preventDefault()
    setBusy(true); setError('')
    try {
      onUser(await api.confirmEmailChange(newEmail.trim(), code.trim()))
      setStage('idle'); setNewEmail(''); setCode(''); setDevCode('')
      setMsg('Email updated.')
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  return (
    <div className="card">
      <h3>Email</h3>
      <p className="muted" style={{ marginTop: -6 }}>
        Currently <strong>{user.email}</strong>
        {user.email_verified ? ' · verified' : ' · not verified'}
      </p>
      {stage === 'idle' ? (
        <form onSubmit={request} className="stack">
          <input type="email" value={newEmail} placeholder="new@address.com" required
                 onChange={(e) => setNewEmail(e.target.value)} />
          <p className="muted" style={{ margin: 0 }}>
            We'll send a code to the new address to confirm you own it.
          </p>
          {error && <div className="error">{error}</div>}
          {msg && !error && <div className="notice">{msg}</div>}
          <button disabled={busy || !newEmail.trim()}>
            {busy ? 'Sending…' : 'Send code'}
          </button>
        </form>
      ) : (
        <form onSubmit={confirm} className="stack">
          <p className="muted" style={{ margin: 0 }}>Code sent to <strong>{newEmail}</strong>.</p>
          {devCode && <div className="notice">Your code: <strong>{devCode}</strong></div>}
          <input className="otp-input" placeholder="000000" value={code} inputMode="numeric"
                 maxLength={6} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
          {error && <div className="error">{error}</div>}
          <div className="row">
            <button disabled={busy || code.length < 6}>Confirm change</button>
            <button type="button" className="ghost" onClick={() => setStage('idle')}>Cancel</button>
          </div>
        </form>
      )}
    </div>
  )
}

function InviteCard({ user }) {
  const canvasRef = useRef(null)
  const [code, setCode] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    api.inviteCode()
      .then((r) => setCode(r.code))
      .catch((e) => setError(e.message))
  }, [])

  useEffect(() => {
    if (!code || !canvasRef.current) return
    // rendered locally — no external image service involved
    QRCode.toCanvas(canvasRef.current, code, { width: 200, margin: 1 })
      .catch((e) => setError(e.message))
  }, [code])

  return (
    <div className="card">
      <h3>Your friend code</h3>
      <p className="muted" style={{ marginTop: -6 }}>
        Let someone scan this from their Friends tab to add you instantly.
      </p>
      {error && <div className="error">{error}</div>}
      <div className="qr-wrap">
        <canvas ref={canvasRef} />
        <div>
          {user.username && <div><strong>@{user.username}</strong></div>}
          <div className="muted">…or they can search your username.</div>
        </div>
      </div>
    </div>
  )
}
