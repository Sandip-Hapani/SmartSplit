const TOKEN_KEY = 'smartsplit_token'
const USER_KEY = 'smartsplit_user'

export const getToken = () => localStorage.getItem(TOKEN_KEY)
export const getUser = () => JSON.parse(localStorage.getItem(USER_KEY) || 'null')
export const setSession = (token, user) => {
  localStorage.setItem(TOKEN_KEY, token)
  localStorage.setItem(USER_KEY, JSON.stringify(user))
}
export const clearSession = () => {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(USER_KEY)
}

/** FastAPI returns a string for our own errors and a list for schema validation. */
function errorMessage(detail, status) {
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    return detail
      .map((d) => {
        const field = d.loc?.filter((p) => p !== 'body').join(' ')
        return field ? `${field}: ${d.msg}` : d.msg
      })
      .join('; ')
  }
  return `Something went wrong (HTTP ${status}).`
}

async function request(path, { method = 'GET', body, form, headers = {} } = {}) {
  const opts = { method, headers: { ...headers } }
  const token = getToken()
  if (token) opts.headers.Authorization = `Bearer ${token}`
  if (form) {
    opts.body = form // FormData: browser sets content-type
  } else if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json'
    opts.body = JSON.stringify(body)
  }
  const res = await fetch(path, opts)
  if (res.status === 401) {
    clearSession()
    window.location.href = '/login'
    throw new Error('Session expired')
  }
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new Error(errorMessage(data?.detail, res.status))
  return data
}

export const api = {
  register: (email, name, password) =>
    request('/api/auth/register', { method: 'POST', body: { email, name, password } }),
  login: (email, password) => {
    const form = new URLSearchParams({ username: email, password })
    return fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form,
    }).then(async (res) => {
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.detail || 'Login failed')
      return data
    })
  },
  authConfig: () => request('/api/auth/config'),
  googleLogin: (credential) =>
    request('/api/auth/google', { method: 'POST', body: { credential } }),
  requestOtp: (email) => request('/api/auth/otp/request', { method: 'POST', body: { email } }),
  verifyOtp: (email, code, name) =>
    request('/api/auth/otp/verify', { method: 'POST', body: { email, code, name } }),
  me: () => request('/api/auth/me'),
  requestEmailVerification: () => request('/api/auth/verify-email/request', { method: 'POST' }),
  confirmEmailVerification: (code) =>
    request('/api/auth/verify-email/confirm', { method: 'POST', body: { code } }),
  groups: () => request('/api/groups'),
  createGroup: (name) => request('/api/groups', { method: 'POST', body: { name } }),
  group: (id) => request(`/api/groups/${id}`),
  addMember: (id, body) => request(`/api/groups/${id}/members`, { method: 'POST', body }),
  balances: (id) => request(`/api/groups/${id}/balances`),
  simplify: (id) => request(`/api/groups/${id}/simplify`),
  settlements: (id) => request(`/api/groups/${id}/settlements`),
  settle: (id, body) => request(`/api/groups/${id}/settlements`, { method: 'POST', body }),
  activity: (id) => request(`/api/groups/${id}/activity`),
  expenses: (id) => request(`/api/groups/${id}/expenses`),
  createExpense: (id, body) => request(`/api/groups/${id}/expenses`, { method: 'POST', body }),
  updateExpense: (id, expId, body) =>
    request(`/api/groups/${id}/expenses/${expId}`, { method: 'PUT', body }),
  deleteExpense: (id, expId) =>
    request(`/api/groups/${id}/expenses/${expId}`, { method: 'DELETE' }),
  recurring: (id) => request(`/api/groups/${id}/recurring`),
  createRecurring: (id, body) => request(`/api/groups/${id}/recurring`, { method: 'POST', body }),
  deleteRecurring: (id, recId) =>
    request(`/api/groups/${id}/recurring/${recId}`, { method: 'DELETE' }),
  updateGroup: (id, body) => request(`/api/groups/${id}`, { method: 'PUT', body }),
  notes: (id) => request(`/api/groups/${id}/notes`),
  addNote: (id, body) => request(`/api/groups/${id}/notes`, { method: 'POST', body: { body } }),
  editNote: (id, noteId, body) =>
    request(`/api/groups/${id}/notes/${noteId}`, { method: 'PUT', body: { body } }),
  deleteNote: (id, noteId) =>
    request(`/api/groups/${id}/notes/${noteId}`, { method: 'DELETE' }),
  undoActivity: (id, actId) =>
    request(`/api/groups/${id}/activity/${actId}/undo`, { method: 'POST' }),

  myActivity: () => request('/api/activity'),

  friends: () => request('/api/friends'),
  friendRequests: () => request('/api/friends/requests'),
  inviteCode: () => request('/api/friends/invite-code'),
  addFriend: (body) => request('/api/friends/request', { method: 'POST', body }),
  acceptFriend: (fid) => request(`/api/friends/requests/${fid}/accept`, { method: 'POST' }),
  dropRequest: (fid) => request(`/api/friends/requests/${fid}`, { method: 'DELETE' }),
  unfriend: (uid) => request(`/api/friends/${uid}`, { method: 'DELETE' }),
  messages: (uid) => request(`/api/friends/${uid}/messages`),
  sendMessage: (uid, body) =>
    request(`/api/friends/${uid}/messages`, { method: 'POST', body: { body } }),

  updateAccount: (body) => request('/api/account', { method: 'PUT', body }),
  usernameAvailable: (u) =>
    request(`/api/account/username-available?username=${encodeURIComponent(u)}`),
  searchPeople: (q) => request(`/api/account/search?q=${encodeURIComponent(q)}`),
  requestEmailChange: (new_email) =>
    request('/api/account/email/request', { method: 'POST', body: { new_email } }),
  confirmEmailChange: (new_email, code) =>
    request('/api/account/email/confirm', { method: 'POST', body: { new_email, code } }),

  parseBill: (id, file) => {
    const form = new FormData()
    form.append('file', file)
    return request(`/api/groups/${id}/bills/parse`, { method: 'POST', form })
  },
}

export const fmt = (n) => `€${(n ?? 0).toFixed(2)}`
