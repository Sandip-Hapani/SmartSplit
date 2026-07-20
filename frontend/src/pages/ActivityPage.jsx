import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import ActivityList from '../components/ActivityList'

export default function ActivityPage() {
  const [rows, setRows] = useState([])
  const [error, setError] = useState('')
  const [loaded, setLoaded] = useState(false)

  const load = useCallback(() => {
    api.myActivity()
      .then(setRows)
      .catch((e) => setError(e.message))
      .finally(() => setLoaded(true))
  }, [])

  useEffect(() => { load() }, [load])

  const undo = async (row) => {
    try {
      await api.undoActivity(row.group_id, row.id)
      load()
    } catch (e) {
      setError(e.message)
    }
  }

  return (
    <div className="page">
      <div className="card">
        <h2>Activity</h2>
        <p className="muted" style={{ marginTop: -6 }}>
          Everything happening across your groups. Undoing something adds a new
          entry rather than erasing the old one.
        </p>
        {error && <div className="error">{error}</div>}
        {loaded && rows.length === 0 && (
          <p className="muted">Nothing yet. Activity from all your groups shows up here.</p>
        )}
        <ActivityList rows={rows} onUndo={undo} showGroup />
      </div>
    </div>
  )
}
