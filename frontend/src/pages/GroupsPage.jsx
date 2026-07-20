import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import VerifyEmailBanner from '../components/VerifyEmailBanner'

export default function GroupsPage() {
  const [groups, setGroups] = useState([])
  const [name, setName] = useState('')
  const [error, setError] = useState('')

  const load = () => api.groups().then(setGroups).catch((e) => setError(e.message))
  useEffect(() => { load() }, [])

  const create = async (e) => {
    e.preventDefault()
    if (!name.trim()) return
    try {
      await api.createGroup(name.trim())
      setName('')
      load()
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <div className="page">
      <VerifyEmailBanner />
      <div className="card">
        <h2>Your groups</h2>
        {error && <div className="error">{error}</div>}
        {groups.length === 0 && <p className="muted">No groups yet — create one below.</p>}
        {groups.map((g) => (
          <div className="list-item" key={g.id}>
            <Link to={`/groups/${g.id}`}><strong>{g.name}</strong></Link>
            <span className="muted">{g.members.length} member{g.members.length !== 1 ? 's' : ''}</span>
          </div>
        ))}
        <form className="row" style={{ marginTop: 14 }} onSubmit={create}>
          <input placeholder="New group name" value={name} onChange={(e) => setName(e.target.value)} />
          <button>Create group</button>
        </form>
      </div>
    </div>
  )
}
