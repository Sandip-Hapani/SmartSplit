import { useEffect, useState } from 'react'
import { Navigate, NavLink, Route, Routes, useNavigate } from 'react-router-dom'
import { clearSession, getUser, setSession, getToken } from './api'
import LoginPage from './pages/LoginPage'
import GroupsPage from './pages/GroupsPage'
import GroupPage from './pages/GroupPage'
import FriendsPage from './pages/FriendsPage'
import ActivityPage from './pages/ActivityPage'
import AccountPage from './pages/AccountPage'

const TABS = [
  { to: '/groups', label: 'Groups', icon: '👥' },
  { to: '/friends', label: 'Friends', icon: '🙋' },
  { to: '/activity', label: 'Activity', icon: '🕘' },
  { to: '/account', label: 'Account', icon: '⚙️' },
]

/** Applies the saved theme; "system" follows the OS setting. */
function useTheme(theme) {
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && media.matches)
      document.documentElement.dataset.theme = dark ? 'dark' : 'light'
    }
    apply()
    if (theme === 'system') {
      media.addEventListener('change', apply)
      return () => media.removeEventListener('change', apply)
    }
  }, [theme])
}

export default function App() {
  const [user, setUser] = useState(getUser())
  const navigate = useNavigate()
  useTheme(user?.theme || 'system')

  // keep the cached user in sync when settings change
  const updateUser = (u) => {
    setSession(getToken(), u)
    setUser(u)
  }

  const logout = () => {
    clearSession()
    setUser(null)
    navigate('/login')
  }

  const guard = (el) => (user ? el : <Navigate to="/login" replace />)

  return (
    <>
      {user && (
        <>
          <div className="topbar">
            <a className="logo" href="/groups">SmartSplit</a>
            <div className="who">
              {user.avatar_url
                ? <img className="avatar" src={user.avatar_url} alt="" />
                : <span className="avatar initials">{(user.name || '?')[0].toUpperCase()}</span>}
              <span>{user.name}</span>
              <button onClick={logout}>Log out</button>
            </div>
          </div>
          <nav className="mainnav">
            {TABS.map((t) => (
              <NavLink key={t.to} to={t.to}
                       className={({ isActive }) => (isActive ? 'active' : '')}>
                <span className="tabicon" aria-hidden="true">{t.icon}</span>
                <span>{t.label}</span>
              </NavLink>
            ))}
          </nav>
        </>
      )}

      <Routes>
        <Route path="/login" element={
          user ? <Navigate to="/groups" replace /> : <LoginPage onAuth={setUser} />} />
        <Route path="/groups" element={guard(<GroupsPage />)} />
        <Route path="/groups/:groupId" element={guard(<GroupPage user={user} />)} />
        <Route path="/friends" element={guard(<FriendsPage user={user} />)} />
        <Route path="/friends/:friendId" element={guard(<FriendsPage user={user} />)} />
        <Route path="/activity" element={guard(<ActivityPage />)} />
        <Route path="/account" element={guard(<AccountPage user={user} onUser={updateUser} />)} />
        <Route path="*" element={<Navigate to={user ? '/groups' : '/login'} replace />} />
      </Routes>
    </>
  )
}
