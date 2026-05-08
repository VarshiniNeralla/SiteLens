const DB_NAME = 'sitelens_offline_journal'
const STORE = 'operations'
const VERSION = 1
const listeners = new Set()

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' })
      }
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

function notify() {
  for (const l of listeners) l()
}

export async function enqueueOperation(payload) {
  const item = {
    id: crypto.randomUUID?.() || `op-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    createdAt: Date.now(),
    attempts: 0,
    status: 'queued',
    ...payload,
  }
  await withStore('readwrite', (store) => store.put(item))
  notify()
  return item
}

export async function listOperations() {
  return withStore('readonly', (store) => {
    return new Promise((resolve, reject) => {
      const req = store.getAll()
      req.onsuccess = () => resolve(req.result || [])
      req.onerror = () => reject(req.error)
    })
  })
}

async function updateOperation(item) {
  await withStore('readwrite', (store) => store.put(item))
}

async function deleteOperation(id) {
  await withStore('readwrite', (store) => store.delete(id))
}

export function subscribeOfflineJournal(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export async function replayOperations(executors) {
  if (!navigator.onLine) return { replayed: 0, failed: 0 }
  const rows = await listOperations()
  let replayed = 0
  let failed = 0
  for (const row of rows.sort((a, b) => a.createdAt - b.createdAt)) {
    const exec = executors[row.type]
    if (!exec) continue
    try {
      await exec(row.payload)
      await deleteOperation(row.id)
      replayed += 1
    } catch (e) {
      row.attempts = Number(row.attempts || 0) + 1
      row.status = 'failed'
      row.lastError = String(e?.message || 'Replay failed')
      await updateOperation(row)
      failed += 1
    }
  }
  notify()
  return { replayed, failed }
}
