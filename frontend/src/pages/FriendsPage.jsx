import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api } from '../api'
import AddFriend from '../components/AddFriend'
import Chat from '../components/Chat'

export default function FriendsPage({ user }) {
  const { friendId } = useParams()
  const navigate = useNavigate()
  const [friends, setFriends] = useState([])
  const [requests, setRequests] = useState([])
  const [error, setError] = useState('')
  const [adding, setAdding] = useState(false)
  const [loaded, setLoaded] = useState(false)

  const load = useCallback(async () => {
    try {
      const [f, r] = await Promise.all([api.friends(), api.friendRequests()])
      setFriends(f)
      setRequests(r)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoaded(true)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const open = friends.find((f) => String(f.user.id) === String(friendId))

  const accept = async (fid) => {
    try { await api.acceptFriend(fid); load() } catch (e) { setError(e.message) }
  }
  const drop = async (fid) => {
    try { await api.dropRequest(fid); load() } catch (e) { setError(e.message) }
  }
  const unfriend = async (f) => {
    if (!confirm(`Remove ${f.user.name} from your friends? Your chat history goes too.`)) return
    try {
      await api.unfriend(f.user.id)
      if (String(friendId) === String(f.user.id)) navigate('/friends')
      load()
    } catch (e) { setError(e.message) }
  }

  if (open) {
    return <Chat friend={open.user} me={user} onBack={() => { navigate('/friends'); load() }} />
  }

  const incoming = requests.filter((r) => r.direction === 'incoming')
  const outgoing = requests.filter((r) => r.direction === 'outgoing')

  return (
    <div className="page">
      {error && <div className="error">{error}</div>}

      {incoming.length > 0 && (
        <div className="card">
          <h3>Friend requests</h3>
          {incoming.map((r) => (
            <div className="list-item" key={r.friendship_id}>
              <div>
                <strong>{r.user.name}</strong>
                {r.user.username && <span className="muted"> @{r.user.username}</span>}
              </div>
              <div className="row">
                <button onClick={() => accept(r.friendship_id)}>Accept</button>
                <button className="ghost" onClick={() => drop(r.friendship_id)}>Decline</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <div className="row spread">
          <h2 style={{ margin: 0 }}>Friends</h2>
          <button onClick={() => setAdding(true)}>Add friend</button>
        </div>

        {loaded && friends.length === 0 && (
          <p className="muted">No friends yet — add someone by username or QR code.</p>
        )}

        {friends.map((f) => (
          <div className="list-item" key={f.user.id}>
            <div className="row" style={{ gap: 10 }}>
              {f.user.avatar_url
                ? <img className="avatar" src={f.user.avatar_url} alt="" />
                : <span className="avatar initials">{f.user.name[0].toUpperCase()}</span>}
              <div>
                <strong>{f.user.name}</strong>
                {f.user.username && <div className="muted">@{f.user.username}</div>}
              </div>
            </div>
            <div className="row">
              <button onClick={() => navigate(`/friends/${f.user.id}`)}>
                Message{f.unread ? ` (${f.unread})` : ''}
              </button>
              <button className="ghost danger" onClick={() => unfriend(f)}>Unfriend</button>
            </div>
          </div>
        ))}
      </div>

      {outgoing.length > 0 && (
        <div className="card">
          <h3>Sent requests</h3>
          {outgoing.map((r) => (
            <div className="list-item" key={r.friendship_id}>
              <span>{r.user.name} <span className="muted">— waiting</span></span>
              <button className="ghost" onClick={() => drop(r.friendship_id)}>Cancel</button>
            </div>
          ))}
        </div>
      )}

      {adding && (
        <AddFriend onClose={() => setAdding(false)} onDone={() => { setAdding(false); load() }} />
      )}
    </div>
  )
}
