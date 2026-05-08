import {
  apiFetch,
} from '../api.js'

const DB_NAME = 'sitelens_upload_sessions'
const STORE = 'sessions'
const VERSION = 1

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function withStore(mode, fn) {
  const db = await openDb()
  try {
    const tx = db.transaction(STORE, mode)
    const store = tx.objectStore(STORE)
    const out = await fn(store)
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
    return out
  } finally {
    db.close()
  }
}

async function saveSession(row) {
  await withStore('readwrite', (s) => s.put(row))
}

function assertSessionPayload(session) {
  if (!session || typeof session !== 'object' || !session.session_id) {
    throw new Error('Upload session initialization failed. Please retry image upload.')
  }
  return session
}

export async function listUploadSessions() {
  return withStore('readonly', (s) => new Promise((resolve, reject) => {
    const req = s.getAll()
    req.onsuccess = () => resolve(req.result || [])
    req.onerror = () => reject(req.error)
  }))
}

export async function uploadResumableFile(file, options = {}) {
  const { onProgress, signal, key } = options
  const sessionKey = key || `${file.name}:${file.size}:${file.lastModified}`
  let local = await withStore('readonly', (s) => new Promise((resolve, reject) => {
    const req = s.get(sessionKey)
    req.onsuccess = () => resolve(req.result || null)
    req.onerror = () => reject(req.error)
  }))

  let session
  if (!local?.sessionId) {
    session = assertSessionPayload(await apiFetch('/upload/sessions', {
      method: 'POST',
      body: JSON.stringify({
        filename: file.name,
        content_type: file.type || 'application/octet-stream',
        total_size: file.size,
      }),
    }))
    local = { id: sessionKey, sessionId: session.session_id, uploadedBytes: 0, file }
    await saveSession(local)
  } else {
    session = assertSessionPayload(await apiFetch(`/upload/sessions/${encodeURIComponent(local.sessionId)}`))
    local.uploadedBytes = session.uploaded_bytes || 0
    local.file = file
    await saveSession(local)
  }

  const chunkSize = session.chunk_size || 524288
  let offset = Number(local.uploadedBytes || 0)
  while (offset < file.size) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const nextChunk = file.slice(offset, Math.min(file.size, offset + chunkSize))
    const bytes = await nextChunk.arrayBuffer()
    const sessionRow = await apiFetch(`/upload/sessions/${encodeURIComponent(local.sessionId)}/chunk`, {
      method: 'PUT',
      headers: {
        'X-Chunk-Offset': String(offset),
        'Content-Type': 'application/octet-stream',
      },
      body: bytes,
      signal,
      timeoutMs: 120000,
    })
    offset = Number(sessionRow.uploaded_bytes || 0)
    local.uploadedBytes = offset
    await saveSession(local)
    if (typeof onProgress === 'function') onProgress(Math.min(100, Math.round((offset / file.size) * 100)))
  }

  const uploaded = await apiFetch(`/upload/sessions/${encodeURIComponent(local.sessionId)}/complete`, {
    method: 'POST',
    timeoutMs: 120000,
  })
  await withStore('readwrite', (s) => s.delete(sessionKey))
  if (typeof onProgress === 'function') onProgress(100)
  return uploaded
}
