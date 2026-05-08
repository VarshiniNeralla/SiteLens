import { enqueueOperation, replayOperations, subscribeOfflineJournal, listOperations } from './utils/offlineJournal.js'

/**
 * Backend REST lives under `/api/*` so SPA paths like `/upload` are never proxied over GET.
 * Production: set VITE_API_BASE to the API origin including `/api` if needed (e.g. https://host.example/api).
 */
/** Maps infra-style errors (LLM refused connection, WinError codes) to concise UX copy. */
export function toFriendlyApiMessage(raw) {
  const s = String(raw ?? '').trim()
  if (!s) return 'Something went wrong. Please try again.'
  const flat = s.replace(/\s+/g, ' ')
  if (/winerror\s*10061|\b10061\b|actively refused|connection refused|econnrefused|\bupstream llm\b/i.test(flat)) {
    return 'The drafting service is temporarily unreachable. Core actions should still work—try saving or exporting again in a moment.'
  }
  if (/upstream llm http error/i.test(flat)) {
    return 'AI drafting is temporarily unavailable. Please try again later.'
  }
  return flat.length > 220 ? `${flat.slice(0, 217)}…` : flat
}

const envBase = import.meta.env.VITE_API_BASE
const base =
  envBase !== undefined && String(envBase).trim() !== ''
    ? String(envBase).replace(/\/$/, '')
    : '/api'

const DEFAULT_TIMEOUT_MS = 30000
const inflight = new Map()
const journalListeners = new Set()
const executors = {}

async function refreshJournalMetrics() {
  const rows = await listOperations()
  const summary = {
    queued: rows.filter((r) => r.status === 'queued').length,
    failed: rows.filter((r) => r.status === 'failed').length,
  }
  for (const l of journalListeners) l(summary)
}

subscribeOfflineJournal(() => {
  void refreshJournalMetrics()
})

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    void replayOperations(executors)
    void refreshJournalMetrics()
  })
  void refreshJournalMetrics()
}

async function withRetries(task, retries = 2) {
  let attempt = 0
  while (true) {
    attempt += 1
    try {
      return await task()
    } catch (err) {
      const retriable = err?.status === 429 || err?.status >= 500 || err?.status === undefined
      if (!retriable || attempt > retries) throw err
      await new Promise((r) => setTimeout(r, 250 * 2 ** (attempt - 1)))
    }
  }
}

function newCorrelationId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return `cid-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function withTimeout(signal, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(new DOMException('Timeout', 'AbortError')), timeoutMs)
  const abort = () => controller.abort(new DOMException('Aborted', 'AbortError'))
  if (signal) {
    if (signal.aborted) abort()
    else signal.addEventListener('abort', abort, { once: true })
  }
  return {
    signal: controller.signal,
    cleanup: () => clearTimeout(timeoutId),
  }
}

export async function apiFetch(path, options = {}) {
  const method = String(options.method || 'GET').toUpperCase()
  const url = `${base}${path}`
  const dedupeKey = options.dedupeKey && `${method}:${url}:${options.dedupeKey}`
  if (dedupeKey && inflight.has(dedupeKey)) return inflight.get(dedupeKey)
  const requestPromise = (async () => {
    const correlationId = options.correlationId || newCorrelationId()
    const timeout = withTimeout(options.signal, options.timeoutMs)
    try {
      const res = await fetch(url, {
        ...options,
        signal: timeout.signal,
        headers: {
          Accept: 'application/json',
          'X-Correlation-Id': correlationId,
          ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
          ...options.headers,
        },
      })
      const text = await res.text()
      let data
      try {
        data = text ? JSON.parse(text) : null
      } catch {
        data = text
      }
      if (!res.ok) {
        const detail = (data?.detail ?? data?.message ?? text) || res.statusText
        const rawDetail = typeof detail === 'string' ? detail : JSON.stringify(detail)
        const err = new Error(toFriendlyApiMessage(rawDetail))
        err.status = res.status
        err.data = data
        err.correlationId = correlationId
        throw err
      }
      return data
    } finally {
      timeout.cleanup()
    }
  })()
  if (dedupeKey) inflight.set(dedupeKey, requestPromise)
  try {
    return await requestPromise
  } finally {
    if (dedupeKey) inflight.delete(dedupeKey)
  }
}

export function uploadImage(file) {
  const fd = new FormData()
  fd.append('file', file)
  return apiFetch('/upload', { method: 'POST', body: fd })
}

/**
 * XMLHttpRequest upload with progress events and automatic retries on transient failures.
 */
export function uploadImageWithProgress(file, options = {}) {
  const { onProgress, signal, maxRetries = 3 } = options
  const url = `${base}/upload`

  return new Promise((resolve, reject) => {
    let attempt = 0

    const scheduleRetry = (delayMs) => {
      setTimeout(run, delayMs)
    }

    const fail = (message, status) => {
      const err = new Error(message)
      err.status = status
      reject(err)
    }

    const run = () => {
      attempt += 1
      if (signal?.aborted) {
        reject(new DOMException('Aborted', 'AbortError'))
        return
      }

      const xhr = new XMLHttpRequest()
      xhr.responseType = 'json'

      xhr.upload.onprogress = (ev) => {
        if (ev.lengthComputable && typeof onProgress === 'function') {
          onProgress(Math.min(100, Math.round((ev.loaded / ev.total) * 100)))
        }
      }

      xhr.onerror = () => {
        if (attempt < maxRetries) {
          scheduleRetry(450 * 2 ** (attempt - 1))
          return
        }
        fail('Network error while uploading.', 0)
      }

      xhr.onabort = () => {
        reject(new DOMException('Aborted', 'AbortError'))
      }

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          if (typeof onProgress === 'function') onProgress(100)
          resolve(xhr.response)
          return
        }
        const retriable = xhr.status === 0 || xhr.status === 429 || xhr.status >= 500
        if (retriable && attempt < maxRetries) {
          scheduleRetry(450 * 2 ** (attempt - 1))
          return
        }
        const body = xhr.response?.detail ?? xhr.response?.message ?? xhr.statusText ?? 'Upload failed'
        const msg = typeof body === 'string' ? body : JSON.stringify(body)
        fail(toFriendlyApiMessage(msg) || 'Upload failed.', xhr.status)
      }

      xhr.open('POST', url)
      xhr.setRequestHeader('Accept', 'application/json')
      let onAbort
      if (signal) {
        onAbort = () => xhr.abort()
        signal.addEventListener('abort', onAbort)
      }
      const cleanupAbort = () => {
        if (signal && onAbort) signal.removeEventListener('abort', onAbort)
      }
      const prevError = xhr.onerror
      xhr.onerror = () => {
        cleanupAbort()
        prevError?.()
      }
      const prevAbort = xhr.onabort
      xhr.onabort = () => {
        cleanupAbort()
        prevAbort?.()
      }
      const prevLoad = xhr.onload
      xhr.onload = () => {
        cleanupAbort()
        prevLoad?.()
      }

      const fd = new FormData()
      fd.append('file', file)
      xhr.send(fd)
    }

    run()
  })
}

export function createObservation(payload) {
  if (!navigator.onLine) {
    return enqueueOperation({ type: 'createObservation', payload }).then(() => ({
      notice: 'Saved to offline queue. Will sync when connection returns.',
      id: 0,
      generated_observation: '',
      generated_recommendation: '',
      manually_written_observation: '',
      ai_status: 'queued',
    }))
  }
  return apiFetch('/observations', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function listObservations() {
  return withRetries(() => apiFetch('/observations', { dedupeKey: 'listObservations' }))
}

export function updateObservation(id, payload) {
  if (!navigator.onLine) {
    return enqueueOperation({ type: 'updateObservation', payload: { id, payload } }).then(() => ({
      id,
      ...payload,
    }))
  }
  return apiFetch(`/observations/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
}

export function deleteObservation(id, options = {}) {
  const q = options.force ? '?force=true' : ''
  if (!navigator.onLine) {
    return enqueueOperation({ type: 'deleteObservation', payload: { id, options } }).then(() => null)
  }
  return apiFetch(`/observations/${id}${q}`, { method: 'DELETE' })
}

export function generateReport(body) {
  if (!navigator.onLine) {
    return enqueueOperation({ type: 'generateReport', payload: body }).then(() => ({
      report_id: 0,
      job_id: '',
      status: 'queued-offline',
    }))
  }
  return apiFetch('/reports/generate', {
    method: 'POST',
    body: JSON.stringify(body),
    dedupeKey: JSON.stringify(body),
  })
}

export function getReportJob(jobId) {
  return apiFetch(`/reports/jobs/${encodeURIComponent(jobId)}`, {
    dedupeKey: jobId,
  })
}

export function listReports() {
  return withRetries(() => apiFetch('/reports', { dedupeKey: 'listReports' }))
}

export function getReport(reportId) {
  return withRetries(() => apiFetch(`/reports/${reportId}`, { dedupeKey: `report:${reportId}` }))
}

export function renameReport(reportId, title) {
  if (!navigator.onLine) {
    return enqueueOperation({ type: 'renameReport', payload: { reportId, title } }).then(() => ({ id: reportId, title }))
  }
  return apiFetch(`/reports/${reportId}`, {
    method: 'PATCH',
    body: JSON.stringify({ title }),
  })
}

export function deleteReport(reportId) {
  if (!navigator.onLine) {
    return enqueueOperation({ type: 'deleteReport', payload: { reportId } }).then(() => null)
  }
  return apiFetch(`/reports/${reportId}`, { method: 'DELETE' })
}

export function downloadUrl(reportId, format) {
  const q = format ? `?format=${encodeURIComponent(format)}` : ''
  return `${base}/reports/${reportId}/download${q}`
}

export function getOpsHealth() {
  return apiFetch('/ops/health', { dedupeKey: 'opsHealth' })
}

export function getOpsJobs() {
  return apiFetch('/ops/jobs', { dedupeKey: 'opsJobs' })
}

export function getOpsOverview() {
  return apiFetch('/ops/overview', { dedupeKey: 'opsOverview' })
}

executors.createObservation = (payload) =>
  apiFetch('/observations', { method: 'POST', body: JSON.stringify(payload) })
executors.updateObservation = ({ id, payload }) =>
  apiFetch(`/observations/${id}`, { method: 'PUT', body: JSON.stringify(payload) })
executors.deleteObservation = ({ id, options }) =>
  apiFetch(`/observations/${id}${options?.force ? '?force=true' : ''}`, { method: 'DELETE' })
executors.generateReport = (body) =>
  apiFetch('/reports/generate', { method: 'POST', body: JSON.stringify(body) })
executors.renameReport = ({ reportId, title }) =>
  apiFetch(`/reports/${reportId}`, { method: 'PATCH', body: JSON.stringify({ title }) })
executors.deleteReport = ({ reportId }) =>
  apiFetch(`/reports/${reportId}`, { method: 'DELETE' })

export function subscribeOperationJournal(listener) {
  journalListeners.add(listener)
  void refreshJournalMetrics()
  return () => journalListeners.delete(listener)
}

export async function retryOfflineOperationsNow() {
  const result = await replayOperations(executors)
  await refreshJournalMetrics()
  return result
}
