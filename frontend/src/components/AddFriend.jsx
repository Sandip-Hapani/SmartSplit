import { useEffect, useRef, useState } from 'react'
import jsQR from 'jsqr'
import { api } from '../api'

/** Add by search, or by pointing the camera at someone's SmartSplit QR code. */
export default function AddFriend({ onClose, onDone }) {
  const [mode, setMode] = useState('search') // search | scan
  const [q, setQ] = useState('')
  const [results, setResults] = useState([])
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const term = q.trim()
    if (term.length < 2) { setResults([]); return }
    const t = setTimeout(() => {
      api.searchPeople(term).then(setResults).catch((e) => setError(e.message))
    }, 250)
    return () => clearTimeout(t)
  }, [q])

  const invite = async (body, label) => {
    setBusy(true); setError(''); setInfo('')
    try {
      await api.addFriend(body)
      setInfo(`Request sent to ${label}.`)
      setTimeout(onDone, 700)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="row spread">
          <h3 style={{ margin: 0 }}>Add a friend</h3>
          <button className="ghost" onClick={onClose}>✕</button>
        </div>

        <div className="auth-tabs" style={{ marginTop: 12 }}>
          <button type="button" className={mode === 'search' ? 'active' : ''}
                  onClick={() => { setMode('search'); setError('') }}>Search</button>
          <button type="button" className={mode === 'scan' ? 'active' : ''}
                  onClick={() => { setMode('scan'); setError('') }}>Scan QR</button>
        </div>

        {mode === 'search' ? (
          <>
            <input autoFocus placeholder="Username, name, or email" value={q}
                   onChange={(e) => setQ(e.target.value)} />
            {results.map((p) => (
              <div className="list-item" key={p.id}>
                <div>
                  <strong>{p.name}</strong>
                  {p.username && <span className="muted"> @{p.username}</span>}
                </div>
                <button disabled={busy} onClick={() => invite({ user_id: p.id, username: p.username }, p.name)}>
                  Add
                </button>
              </div>
            ))}
            {q.trim().length >= 2 && results.length === 0 && (
              <p className="muted">Nobody matches "{q.trim()}".</p>
            )}
          </>
        ) : (
          <Scanner onCode={(code) => invite({ code }, 'them')} onError={setError} />
        )}

        {info && <div className="notice">{info}</div>}
        {error && <div className="error">{error}</div>}
      </div>
    </div>
  )
}

function Scanner({ onCode, onError }) {
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const [status, setStatus] = useState('starting')

  useEffect(() => {
    let stream, raf, done = false

    const scan = () => {
      const video = videoRef.current
      const canvas = canvasRef.current
      if (!done && video && canvas && video.readyState === video.HAVE_ENOUGH_DATA) {
        const w = video.videoWidth, h = video.videoHeight
        canvas.width = w; canvas.height = h
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        ctx.drawImage(video, 0, 0, w, h)
        const found = jsQR(ctx.getImageData(0, 0, w, h).data, w, h)
        if (found?.data) {
          done = true
          setStatus('found')
          onCode(found.data.trim())
          return
        }
      }
      if (!done) raf = requestAnimationFrame(scan)
    }

    navigator.mediaDevices?.getUserMedia({ video: { facingMode: 'environment' } })
      .then((s) => {
        stream = s
        if (videoRef.current) {
          videoRef.current.srcObject = s
          videoRef.current.play()
          setStatus('scanning')
          raf = requestAnimationFrame(scan)
        }
      })
      .catch(() => {
        setStatus('denied')
        onError('Camera unavailable — allow camera access, or use Search instead.')
      })

    return () => {
      done = true
      cancelAnimationFrame(raf)
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [onCode, onError])

  return (
    <div className="scanner">
      <video ref={videoRef} playsInline muted />
      <canvas ref={canvasRef} hidden />
      <p className="muted">
        {status === 'scanning' ? 'Point the camera at their SmartSplit QR code.'
          : status === 'denied' ? 'No camera access.'
          : status === 'found' ? 'Code found!' : 'Starting camera…'}
      </p>
    </div>
  )
}
