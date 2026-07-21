import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, setSession } from '../api'
import GoogleButton from '../components/GoogleButton'

export default function LoginPage({ onAuth }) {
  const [mode, setMode] = useState('login')       // login | signup
  const [method, setMethod] = useState('otp')     // otp | password
  const [step, setStep] = useState('form')        // form | code
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [isNewUser, setIsNewUser] = useState(false)
  const [devCode, setDevCode] = useState('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  const [googleClientId, setGoogleClientId] = useState(null)
  const [otpEnabled, setOtpEnabled] = useState(true)
  const codeRef = useRef(null)
  const navigate = useNavigate()

  const signup = mode === 'signup'

  useEffect(() => {
    api.authConfig()
      .then((cfg) => {
        setGoogleClientId(cfg.google_enabled ? cfg.google_client_id : null)
        setOtpEnabled(cfg.email_otp_enabled)
        // this server can't send mail, so start on the password form
        if (!cfg.email_otp_enabled) setMethod('password')
      })
      .catch(() => setGoogleClientId(null))
  }, [])

  useEffect(() => {
    if (!cooldown) return
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [cooldown])

  useEffect(() => {
    if (step === 'code') codeRef.current?.focus()
  }, [step])

  const finish = (res) => {
    setSession(res.access_token, res.user)
    onAuth(res.user)
    navigate('/')
  }

  const switchMode = (next) => {
    setMode(next)
    setStep('form')
    setError(''); setNotice(''); setDevCode(''); setCode('')
  }

  const sendCode = async (e) => {
    e?.preventDefault()
    setError(''); setBusy(true)
    try {
      const res = await api.requestOtp(email)
      setIsNewUser(res.is_new_user)
      setDevCode(res.dev_code || '')
      setNotice(res.message)
      setStep('code')
      setCooldown(45)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const verifyCode = async (e) => {
    e.preventDefault()
    setError(''); setBusy(true)
    try {
      finish(await api.verifyOtp(email, code.trim(), isNewUser ? name : undefined))
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const passwordSubmit = async (e) => {
    e.preventDefault()
    setError(''); setBusy(true)
    try {
      finish(signup
        ? await api.register(email, name, password)
        : await api.login(email, password))
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const googleSignIn = useCallback(async (credential) => {
    setError(''); setBusy(true)
    try {
      finish(await api.googleLogin(credential))
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }, [])

  // --- code entry takes over the whole card ---
  if (step === 'code') {
    return (
      <div className="auth-wrap">
        <div className="card">
          <h2>Check your email</h2>
          <p className="muted" style={{ marginTop: -8 }}>
            We sent a 6-digit code to <strong>{email}</strong>.
          </p>
          <form onSubmit={verifyCode}>
            {isNewUser && (
              <input placeholder="Your name" value={name} required
                     onChange={(e) => setName(e.target.value)} />
            )}
            <input ref={codeRef} className="otp-input" placeholder="000000" value={code}
                   required inputMode="numeric" autoComplete="one-time-code" maxLength={6}
                   onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
            {devCode && (
              <div className="notice">
                SMTP isn't configured, so here's your code: <strong>{devCode}</strong>
              </div>
            )}
            {!devCode && notice && <div className="notice">{notice}</div>}
            {error && <div className="error">{error}</div>}
            <button disabled={busy || code.length < 6}>
              {busy ? 'Verifying…' : isNewUser ? 'Create account' : 'Sign in'}
            </button>
          </form>
          <p className="muted">
            <a href="#" onClick={(e) => { e.preventDefault(); if (!cooldown) sendCode() }}
               style={{ opacity: cooldown ? 0.5 : 1 }}>
              {cooldown ? `Resend in ${cooldown}s` : 'Resend code'}
            </a>
            {' · '}
            <a href="#" onClick={(e) => { e.preventDefault(); setStep('form'); setCode(''); setError('') }}>
              Use another email
            </a>
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="auth-wrap">
      <div className="card">
        <div className="auth-tabs">
          <button type="button" className={!signup ? 'active' : ''}
                  onClick={() => switchMode('login')}>Log in</button>
          <button type="button" className={signup ? 'active' : ''}
                  onClick={() => switchMode('signup')}>Sign up</button>
        </div>

        <h2>{signup ? 'Create your account' : 'Welcome back'}</h2>

        {googleClientId && (
          <>
            <GoogleButton clientId={googleClientId} onCredential={googleSignIn}
                          onError={setError}
                          text={signup ? 'signup_with' : 'signin_with'} />
            <div className="divider"><span>or</span></div>
          </>
        )}

        {method === 'otp' ? (
          <>
            <p className="muted" style={{ marginTop: 0 }}>
              {signup
                ? "Enter your email and we'll send a code — no password to remember."
                : "We'll email you a code — no password needed."}
            </p>
            <form onSubmit={sendCode}>
              <input type="email" placeholder="you@gmail.com" value={email} required
                     onChange={(e) => setEmail(e.target.value)} />
              {error && <div className="error">{error}</div>}
              <button disabled={busy}>{busy ? 'Sending…' : 'Send me a code'}</button>
            </form>
            <p className="muted">
              <a href="#" onClick={(e) => { e.preventDefault(); setMethod('password'); setError('') }}>
                {signup ? 'Sign up with a password instead' : 'Use a password instead'}
              </a>
            </p>
          </>
        ) : (
          <>
            <form onSubmit={passwordSubmit}>
              {signup && (
                <input placeholder="Your name" value={name} required
                       onChange={(e) => setName(e.target.value)} />
              )}
              <input type="email" placeholder="Email" value={email} required
                     onChange={(e) => setEmail(e.target.value)} />
              <input type="password" value={password} required
                     placeholder={signup ? 'Password (min 6 characters)' : 'Password'}
                     minLength={signup ? 6 : undefined}
                     autoComplete={signup ? 'new-password' : 'current-password'}
                     onChange={(e) => setPassword(e.target.value)} />
              {error && <div className="error">{error}</div>}
              <button disabled={busy}>
                {busy ? 'Please wait…' : signup ? 'Create account' : 'Log in'}
              </button>
            </form>
            <p className="muted">
              {otpEnabled && (
                <a href="#" onClick={(e) => { e.preventDefault(); setMethod('otp'); setError('') }}>
                  Email me a code instead
                </a>
              )}
            </p>
          </>
        )}
      </div>
    </div>
  )
}
