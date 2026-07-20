import { useEffect, useRef, useState } from 'react'

const GIS_SRC = 'https://accounts.google.com/gsi/client'

/** Loads the Google Identity Services script once, shared across mounts. */
function loadGis() {
  if (window.google?.accounts?.id) return Promise.resolve()
  if (!window.__gisPromise) {
    window.__gisPromise = new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[src="${GIS_SRC}"]`)
      const script = existing || document.createElement('script')
      script.src = GIS_SRC
      script.async = true
      script.defer = true
      script.onload = resolve
      script.onerror = () => reject(new Error("Couldn't reach Google to load sign-in."))
      if (!existing) document.head.appendChild(script)
    })
  }
  return window.__gisPromise
}

/**
 * Renders Google's official "Sign in with Google" button.
 * `clientId` comes from the backend at runtime, so no rebuild is needed to
 * change it. Renders nothing when Google sign-in isn't configured.
 */
export default function GoogleButton({ clientId, onCredential, onError, text = 'continue_with' }) {
  const holder = useRef(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!clientId || !holder.current) return
    let cancelled = false

    loadGis()
      .then(() => {
        if (cancelled || !holder.current) return
        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: (res) => {
            if (res?.credential) onCredential(res.credential)
            else onError?.('Google did not return a credential.')
          },
          cancel_on_tap_outside: true,
        })
        holder.current.innerHTML = ''  // re-rendering would otherwise stack buttons
        window.google.accounts.id.renderButton(holder.current, {
          theme: 'outline',
          size: 'large',
          width: 320,
          text,
          shape: 'pill',
          logo_alignment: 'left',
        })
      })
      .catch((err) => {
        if (cancelled) return
        setFailed(true)
        onError?.(err.message)
      })

    return () => { cancelled = true }
  }, [clientId, onCredential, onError, text])

  if (!clientId) return null
  if (failed) {
    return <div className="muted" style={{ textAlign: 'center' }}>Google sign-in is unavailable.</div>
  }
  return <div ref={holder} className="google-btn-holder" />
}
