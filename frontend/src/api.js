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

export async function apiFetch(path, options = {}) {
  const url = `${base}${path}`
  const res = await fetch(url, {
    ...options,
    headers: {
      Accept: 'application/json',
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
    throw err
  }
  return data
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
      if (signal) {
        const onAbort = () => xhr.abort()
        signal.addEventListener('abort', onAbort)
      }

      const fd = new FormData()
      fd.append('file', file)
      xhr.send(fd)
    }

    run()
  })
}

export function createObservation(payload) {
  return apiFetch('/observations', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function listObservations() {
  return apiFetch('/observations')
}

export function updateObservation(id, payload) {
  return apiFetch(`/observations/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
}

export function deleteObservation(id, options = {}) {
  const q = options.force ? '?force=true' : ''
  return apiFetch(`/observations/${id}${q}`, { method: 'DELETE' })
}

export function generateReport(body) {
  return apiFetch('/reports/generate', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function listReports() {
  return apiFetch('/reports')
}

export function getReport(reportId) {
  return apiFetch(`/reports/${reportId}`)
}

export function renameReport(reportId, title) {
  return apiFetch(`/reports/${reportId}`, {
    method: 'PATCH',
    body: JSON.stringify({ title }),
  })
}

export function deleteReport(reportId) {
  return apiFetch(`/reports/${reportId}`, { method: 'DELETE' })
}

export function downloadUrl(reportId, format) {
  const q = format ? `?format=${encodeURIComponent(format)}` : ''
  return `${base}/reports/${reportId}/download${q}`
}
