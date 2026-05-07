/**
 * Backend REST lives under `/api/*` so SPA paths like `/upload` are never proxied over GET.
 * Production: set VITE_API_BASE to the API origin including `/api` if needed (e.g. https://host.example/api).
 */
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
    const err = new Error(typeof detail === 'string' ? detail : JSON.stringify(detail))
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

export function createObservation(payload) {
  return apiFetch('/observations', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function listObservations() {
  return apiFetch('/observations')
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

export function downloadUrl(reportId, format) {
  const q = format ? `?format=${encodeURIComponent(format)}` : ''
  return `${base}/reports/${reportId}/download${q}`
}
