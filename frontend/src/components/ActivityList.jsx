import { Link } from 'react-router-dom'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { activityIcon } from '../icons'

const when = (iso) => {
  const d = new Date(iso + (iso.endsWith('Z') ? '' : 'Z'))
  const mins = Math.round((Date.now() - d) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`
  return d.toLocaleDateString([], { day: 'numeric', month: 'short' })
}

export default function ActivityList({ rows, onUndo, showGroup = false }) {
  return (
    <div className="activity-list">
      {rows.map((a) => {
        const { icon, tone } = activityIcon(a)
        return (
          <div className={`activity-row${a.undone ? ' undone' : ''}`} key={a.id}>
            <span className={`act-icon tone-${tone}`}>
              <FontAwesomeIcon icon={icon} fixedWidth />
            </span>
            <div className="act-body">
              <div>{a.description}</div>
              <div className="muted">
                {when(a.created_at)}
                {showGroup && a.group_name && (
                  <> · <Link to={`/groups/${a.group_id}`}>{a.group_name}</Link></>
                )}
                {a.undone && <> · <span className="pill">undone</span></>}
              </div>
            </div>
            {a.can_undo && onUndo && (
              <button className="ghost" onClick={() => onUndo(a)}>Undo</button>
            )}
          </div>
        )
      })}
    </div>
  )
}
