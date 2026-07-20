import { useState } from 'react'
import { api, getUser, setSession, getToken } from '../api'

/** Prompt for accounts created with a password, whose address is still unproven. */
export default function VerifyEmailBanner() {
  const user = getUser()
  const [dismissed, setDismissed] = useState(false)
  const [stage, setStage] = useState('idle') // idle | sent | done
  const [code, setCode] = useState('')
  const [devCode, setDevCode] = useState('')
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  if (!user || user.email_verified || dismissed || stage === 'done') return null

  const send = async () => {
    setError(''); setBusy(true)
    try {
      const res = await api.requestEmailVerification()
      setDevCode(res.dev_code || '')
      setMsg(res.message)
      setStage('sent')
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const confirm = async (e) => {
    e.preventDefault()
    setError(''); setBusy(true)
    try {
      const updated = await api.confirmEmailVerification(code.trim())
      setSession(getToken(), updated)
      setStage('done')
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="verify-banner">
      {stage === 'idle' ? (
        <>
          <span>Your email <strong>{user.email}</strong> isn't verified yet.</span>
          <button onClick={send} disabled={busy}>{busy ? 'Sending…' : 'Send code'}</button>
          <a href="#" className="muted" onClick={(e) => { e.preventDefault(); setDismissed(true) }}>
            Later
          </a>
        </>
      ) : (
        <>
          <span>{devCode ? <>Your code: <strong>{devCode}</strong></> : msg}</span>
          <form onSubmit={confirm}>
            <input placeholder="000000" value={code} inputMode="numeric" maxLength={6}
                   onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
            <button disabled={busy || code.length < 6}>Verify</button>
          </form>
        </>
      )}
      {error && <span className="error">{error}</span>}
    </div>
  )
}
