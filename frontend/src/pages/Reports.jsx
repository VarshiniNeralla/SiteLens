import { useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useLocation } from 'react-router-dom'
import {
  ArrowUpDown,
  Calendar,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  CircleOff,
  Download,
  FileText,
  Layers,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Trash2,
} from 'lucide-react'
import {
  deleteObservation,
  deleteReport,
  generateReport,
  getReport,
  listObservations,
  listReports,
  renameReport,
  updateObservation,
  downloadUrl as buildDownloadHref,
} from '../api.js'
import { ButtonPrimary, ButtonSecondary } from '../components/ui/Button.jsx'
import { Skeleton } from '../components/ui/Skeleton.jsx'
import { FormSelect } from '../components/FormSelect.jsx'
import {
  FLOORS,
  FLATS,
  INSPECTION_STATUSES,
  OBSERVATION_TYPES,
  ROOMS,
  SEVERITIES,
  THIRD_PARTY_INSPECTION_STATUSES,
  TOWERS,
} from '../constants/observationFormOptions.js'

const TOAST_TIMEOUT_MS = 2000

function SeverityBadge({ severity }) {
  const tone =
    severity === 'Critical'
      ? 'bg-red-100 text-red-700'
      : severity === 'Major'
        ? 'bg-amber-100 text-amber-700'
        : 'bg-slate-100 text-slate-700'
  return <span className={`rounded-full px-2 py-1 text-[11px] font-medium ${tone}`}>{severity || '—'}</span>
}

function ConfirmDialog({ open, title, body, confirmLabel = 'Delete', busy, onConfirm, onCancel }) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/25 px-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl">
        <h3 className="text-[18px] font-semibold tracking-tight text-[#111]">{title}</h3>
        <p className="mt-2 text-[14px] leading-relaxed text-[#6e6e73]">{body}</p>
        <div className="mt-6 flex justify-end gap-2">
          <ButtonSecondary className="px-4 py-2 text-[13px]" onClick={onCancel}>
            Cancel
          </ButtonSecondary>
          <ButtonPrimary className="px-4 py-2 text-[13px]" onClick={onConfirm} disabled={busy}>
            {busy ? 'Please wait…' : confirmLabel}
          </ButtonPrimary>
        </div>
      </div>
    </div>
  )
}

export function ReportsPage() {
  const location = useLocation()
  const QUEUE_PAGE_SIZE = 4
  const reportCardRefs = useRef(new Map())
  const [observations, setObservations] = useState([])
  const [reports, setReports] = useState([])
  const [selected, setSelected] = useState(() => new Set())
  const [title, setTitle] = useState('')
  const [includePdf, setIncludePdf] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [editingObs, setEditingObs] = useState(null)
  const [menuOpen, setMenuOpen] = useState(null)
  const [confirmState, setConfirmState] = useState(null)
  const [queuePage, setQueuePage] = useState(1)
  const [highlightedReportId, setHighlightedReportId] = useState(null)
  const [selectedReportIds, setSelectedReportIds] = useState(() => new Set())
  const [queueProjectFilter, setQueueProjectFilter] = useState('all')
  const [queueSortAsc, setQueueSortAsc] = useState(true)

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const [obsRows, repRows] = await Promise.all([listObservations(), listReports()])
      setObservations(obsRows)
      setReports(repRows)
      setSelectedReportIds((prev) => {
        const valid = new Set(repRows.map((r) => r.id))
        const next = new Set()
        for (const id of prev) if (valid.has(id)) next.add(id)
        return next
      })
    } catch (e) {
      setError(e.message || 'Unable to load report workspace')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    queueMicrotask(() => void load())
  }, [])

  useEffect(() => {
    const id = location.state?.highlightReportId
    if (!id) return
    const startId = setTimeout(() => setHighlightedReportId(id), 0)
    const clearId = setTimeout(() => setHighlightedReportId(null), 2600)
    const scrollId = setTimeout(() => {
      const el = reportCardRefs.current.get(id)
      if (el instanceof HTMLElement) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' })
      }
    }, 120)
    return () => {
      clearTimeout(startId)
      clearTimeout(scrollId)
      clearTimeout(clearId)
    }
  }, [location.state])

  useEffect(() => {
    if (!error) return undefined
    const id = setTimeout(() => setError(''), TOAST_TIMEOUT_MS)
    return () => clearTimeout(id)
  }, [error])

  useEffect(() => {
    if (!notice) return undefined
    const id = setTimeout(() => setNotice(''), TOAST_TIMEOUT_MS)
    return () => clearTimeout(id)
  }, [notice])

  const selectedRows = useMemo(() => observations.filter((o) => selected.has(o.id)), [observations, selected])
  const queueProjects = useMemo(
    () => Array.from(new Set(observations.map((o) => o.project_name).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [observations],
  )
  const queueRows = useMemo(() => {
    const base = queueProjectFilter === 'all'
      ? observations
      : observations.filter((o) => o.project_name === queueProjectFilter)
    const rows = [...base]
    rows.sort((a, b) => {
      const cmp = (a.project_name || '').localeCompare(b.project_name || '')
      if (cmp !== 0) return queueSortAsc ? cmp : -cmp
      return b.id - a.id
    })
    return rows
  }, [observations, queueProjectFilter, queueSortAsc])
  const queueTotalPages = Math.max(1, Math.ceil(queueRows.length / QUEUE_PAGE_SIZE))
  const currentQueuePage = Math.min(queuePage, queueTotalPages)
  const pagedObservations = useMemo(() => {
    const start = (currentQueuePage - 1) * QUEUE_PAGE_SIZE
    return queueRows.slice(start, start + QUEUE_PAGE_SIZE)
  }, [queueRows, currentQueuePage])
  const sameProject = useMemo(
    () => selectedRows.length > 0 && new Set(selectedRows.map((o) => o.project_name)).size === 1,
    [selectedRows],
  )

  const toggleSelect = (id) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectAllVisible = () => {
    if (!pagedObservations.length) return
    setSelected((prev) => {
      const next = new Set(prev)
      for (const o of pagedObservations) next.add(o.id)
      return next
    })
  }

  const deselectAll = () => {
    setSelected(new Set())
  }

  const toggleReportSelect = (id) => {
    setSelectedReportIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectAllReports = () => {
    setSelectedReportIds(new Set(reports.map((r) => r.id)))
  }

  const deselectAllReports = () => {
    setSelectedReportIds(new Set())
  }

  const onGenerate = async (ids = null, forcedTitle = null) => {
    const observationIds = ids ?? selectedRows.map((o) => o.id)
    if (!observationIds.length) return setError('Select at least one observation.')
    if (!ids && !sameProject) return setError('Selected observations must belong to one project.')
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const report = await generateReport({
        observation_ids: observationIds,
        title: forcedTitle ?? (title.trim() || null),
        include_pdf: includePdf,
      })
      setNotice(`Report #${report.id} generated.`)
      await load()
    } catch (e) {
      setError(e.message || 'Report generation failed')
    } finally {
      setBusy(false)
    }
  }

  const deleteObservationFlow = async () => {
    if (!confirmState?.obsId) return
    const obsId = confirmState.obsId
    const force = !!confirmState.force
    setConfirmState((s) => ({ ...s, busy: true }))
    try {
      await deleteObservation(obsId, { force })
      setObservations((prev) => prev.filter((o) => o.id !== obsId))
      setSelected((prev) => {
        const next = new Set(prev)
        next.delete(obsId)
        return next
      })
      setNotice(`Observation #${obsId} removed.`)
      setConfirmState(null)
    } catch (e) {
      if (e?.status === 409 && !force) {
        setConfirmState({
          obsId,
          force: true,
          title: 'Observation used in existing deck(s)',
          body: `${e.message} Delete anyway? Existing decks stay generated, but this observation link will be removed from them.`,
          busy: false,
        })
      } else {
        setError(e.message || 'Could not delete observation')
        setConfirmState(null)
      }
    }
  }

  const bulkDeleteObservationsFlow = async () => {
    const ids = confirmState?.obsIds ?? []
    if (!ids.length) return
    const force = !!confirmState.force
    setConfirmState((s) => ({ ...s, busy: true }))
    const failed = []
    const blocked = []
    for (const id of ids) {
      try {
        await deleteObservation(id, { force })
      } catch (e) {
        if (e?.status === 409 && !force) blocked.push({ id, message: e.message })
        else failed.push(id)
      }
    }
    const deletedSet = new Set(ids.filter((id) => !failed.includes(id)))
    if (deletedSet.size) {
      setObservations((prev) => prev.filter((o) => !deletedSet.has(o.id)))
      setSelected((prev) => {
        const next = new Set(prev)
        for (const id of deletedSet) next.delete(id)
        return next
      })
    }
    if (blocked.length && !force) {
      setConfirmState({
        obsIds: blocked.map((b) => b.id),
        force: true,
        title: `Force delete ${blocked.length} observation(s)?`,
        body: `${blocked[0].message}${blocked.length > 1 ? ` + ${blocked.length - 1} more linked to decks.` : ''} Continue and detach them from those deck records?`,
        busy: false,
      })
      return
    }
    if (failed.length) {
      setError(
        `Could not delete ${failed.length} observation(s). They may already be used in reports.`,
      )
    } else {
      setNotice(`${deletedSet.size} observation(s) deleted.`)
    }
    setConfirmState(null)
  }

  const deleteReportFlow = async () => {
    if (!confirmState?.reportId) return
    const reportId = confirmState.reportId
    setConfirmState((s) => ({ ...s, busy: true }))
    try {
      await deleteReport(reportId)
      setReports((prev) => prev.filter((r) => r.id !== reportId))
      setSelectedReportIds((prev) => {
        const next = new Set(prev)
        next.delete(reportId)
        return next
      })
      setNotice(`Deck #${reportId} deleted.`)
      setConfirmState(null)
    } catch (e) {
      setError(e.message || 'Could not delete deck')
      setConfirmState(null)
    }
  }

  const bulkDeleteReportsFlow = async () => {
    const ids = confirmState?.reportIds ?? []
    if (!ids.length) return
    setConfirmState((s) => ({ ...s, busy: true }))
    const failed = []
    for (const id of ids) {
      try {
        await deleteReport(id)
      } catch {
        failed.push(id)
      }
    }
    const deletedSet = new Set(ids.filter((id) => !failed.includes(id)))
    if (deletedSet.size) {
      setReports((prev) => prev.filter((r) => !deletedSet.has(r.id)))
      setSelectedReportIds((prev) => {
        const next = new Set(prev)
        for (const id of deletedSet) next.delete(id)
        return next
      })
    }
    if (failed.length) setError(`Could not delete ${failed.length} deck(s).`)
    else setNotice(`${deletedSet.size} deck(s) deleted.`)
    setConfirmState(null)
  }

  const saveEditObservation = async () => {
    if (!editingObs) return
    const payload = {
      tower: editingObs.tower,
      floor: editingObs.floor,
      flat: editingObs.flat,
      room: editingObs.room,
      observation_type: editingObs.observation_type,
      severity: editingObs.severity,
      site_visit_date: editingObs.site_visit_date || null,
      slab_casting_date: editingObs.slab_casting_date || null,
      inspection_status: editingObs.inspection_status || null,
      third_party_status: editingObs.third_party_status || null,
      regenerate_text: false,
    }
    try {
      const updated = await updateObservation(editingObs.id, payload)
      setObservations((prev) => prev.map((o) => (o.id === updated.id ? updated : o)))
      setEditingObs(updated)
      setNotice(`Observation #${updated.id} updated.`)
    } catch (e) {
      setError(e.message || 'Save failed')
    }
  }

  const runCardAction = async (action, report) => {
    setMenuOpen(null)
    if (action === 'rename') {
      const nextTitle = window.prompt('Rename report', report.title || `Report #${report.id}`)
      if (!nextTitle?.trim()) return
      try {
        const updated = await renameReport(report.id, nextTitle.trim())
        setReports((prev) => prev.map((r) => (r.id === updated.id ? { ...r, title: updated.title } : r)))
      } catch (e) {
        setError(e.message || 'Rename failed')
      }
      return
    }
    if (action === 'duplicate') {
      try {
        const full = await getReport(report.id)
        await onGenerate(full.observation_ids, `${full.title} (copy)`)
      } catch (e) {
        setError(e.message || 'Duplicate failed')
      }
      return
    }
    if (action === 'delete') {
      setConfirmState({
        reportId: report.id,
        title: 'Delete deck?',
        body: 'This removes deck metadata and generated files. This action cannot be undone.',
        busy: false,
      })
    }
  }

  return (
    <div className="mx-auto max-w-[1320px] space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[clamp(1.55rem,2.4vw,1.9rem)] font-semibold tracking-tight text-[#111]">Reports</h2>
          <p className="mt-1 text-[14px] text-[#6e6e73]">Select observations, configure a deck, generate, and export.</p>
        </div>
        <div className="flex gap-2">
          <ButtonSecondary className="gap-1.5 px-4 py-2.5 text-[13px]" onClick={() => void load()}>
            <RefreshCw className="h-4 w-4" />
            Refresh
          </ButtonSecondary>
          {/* <ButtonPrimary className="px-4 py-2.5 text-[13px]" disabled={busy || !selectedRows.length || !sameProject} onClick={() => void onGenerate()}>
            {busy ? 'Generating…' : 'Generate report'}
          </ButtonPrimary> */}
        </div>
      </header>

      <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <section className="min-h-[440px] rounded-3xl bg-white/70 p-4 ring-1 ring-black/[0.05]">
          <div className="mb-3 flex items-center justify-between px-1">
            <h3 className="text-[14px] font-medium text-[#111]">Observation queue</h3>
            <div className="flex items-center gap-2">
              <span className="text-[12px] text-[#6e6e73]">{selectedRows.length} selected</span>
              <motion.div
                initial={{ opacity: 0, y: -3 }}
                animate={{ opacity: 1, y: 0 }}
                className="inline-flex items-center gap-1 rounded-full border border-black/[0.06] bg-white/70 px-1.5 py-1 shadow-[0_5px_16px_-12px_rgb(0,0,0,0.25)] backdrop-blur-lg"
              >
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  type="button"
                  onClick={selectAllVisible}
                  className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium text-[#6e6e73] transition hover:bg-black/[0.04] hover:text-[#111]"
                >
                  <CheckCheck className="h-3.5 w-3.5" />
                  Select all
                </motion.button>
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  type="button"
                  onClick={deselectAll}
                  disabled={!selectedRows.length}
                  className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium text-[#6e6e73] transition hover:bg-black/[0.04] hover:text-[#111] disabled:opacity-40"
                >
                  <CircleOff className="h-3.5 w-3.5" />
                  Deselect
                </motion.button>
                <motion.button
                  whileTap={{ scale: 0.94 }}
                  type="button"
                  disabled={!selectedRows.length}
                  onClick={() =>
                    setConfirmState({
                      obsIds: selectedRows.map((o) => o.id),
                      title: `Delete ${selectedRows.length} selected observations?`,
                      body: 'If selected observations are already used in generated decks, they will be detached from those deck records and then deleted.',
                      busy: false,
                      force: true,
                    })
                  }
                  className="rounded-full p-1.5 text-[#6e6e73] transition hover:bg-black/[0.05] hover:text-[#111] disabled:opacity-40"
                  aria-label="Delete selected observations"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </motion.button>
              </motion.div>
            </div>
          </div>
          <div className="mb-3 flex flex-wrap items-center gap-2 px-1">
            <div className="inline-flex items-center gap-1 rounded-full border border-black/[0.06] bg-white/72 p-1">
              <button
                type="button"
                onClick={() => {
                  setQueueProjectFilter('all')
                  setQueuePage(1)
                }}
                className={[
                  'rounded-full px-2.5 py-1 text-[11px] font-medium transition',
                  queueProjectFilter === 'all' ? 'bg-black/[0.08] text-[#111]' : 'text-[#6e6e73] hover:text-[#111]',
                ].join(' ')}
              >
                All
              </button>
              {queueProjects.map((project) => (
                <button
                  key={project}
                  type="button"
                  onClick={() => {
                    setQueueProjectFilter(project)
                    setQueuePage(1)
                  }}
                  className={[
                    'rounded-full px-2.5 py-1 text-[11px] font-medium transition',
                    queueProjectFilter === project ? 'bg-black/[0.08] text-[#111]' : 'text-[#6e6e73] hover:text-[#111]',
                  ].join(' ')}
                >
                  {project}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setQueueSortAsc((v) => !v)}
              className="inline-flex items-center gap-1 rounded-full border border-black/[0.08] bg-white/75 px-3 py-1 text-[11px] font-medium text-[#6e6e73] transition hover:text-[#111]"
            >
              <ArrowUpDown className="h-3.5 w-3.5" />
              Sort: Site name {queueSortAsc ? '↑' : '↓'}
            </button>
          </div>
          <div className="space-y-2 pr-1" style={{ minHeight: '360px' }}>
            {loading
              ? Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-[84px] rounded-2xl" />)
              : pagedObservations.map((o) => (
                  <motion.article
                    key={o.id}
                    layout
                    className={[
                      'group grid grid-cols-[84px_1fr_auto] items-center gap-3 rounded-2xl p-2 ring-1 transition',
                      selected.has(o.id)
                        ? 'bg-[#0071e3]/[0.07] ring-[#0071e3]/30 shadow-[0_8px_24px_-18px_rgb(0,113,227,0.4)]'
                        : 'bg-white/80 ring-black/[0.05] hover:bg-white',
                    ].join(' ')}
                  >
                    <button
                      type="button"
                      onClick={() => setEditingObs(o)}
                      className="relative h-16 w-20 overflow-hidden rounded-xl bg-[#eceef2]"
                    >
                      <img
                        src={o.image_path.startsWith('/') ? o.image_path : `/static/${o.image_path.replace(/^uploads\//, 'uploads/')}`}
                        onError={(e) => {
                          e.currentTarget.style.display = 'none'
                        }}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    </button>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-[14px] font-medium text-[#111]">
                          #{o.id} · {o.project_name}
                        </p>
                        <SeverityBadge severity={o.severity} />
                      </div>
                      <p className="truncate text-[12px] text-[#6e6e73]">
                        {[o.tower && `T${o.tower}`, o.floor && `F${o.floor}`, o.room && o.room].filter(Boolean).join(' · ')}
                      </p>
                      <p className="truncate text-[12px] text-[#6e6e73]">
                        {o.observation_type || 'Observation'} · {new Date(o.created_at).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={selected.has(o.id)}
                        onChange={() => toggleSelect(o.id)}
                        className="h-4 w-4 rounded border-slate-300 text-[#0071e3]"
                      />
                      <button
                        type="button"
                        onClick={() => setEditingObs(o)}
                        className="rounded-lg p-1.5 text-[#6e6e73] opacity-0 transition group-hover:opacity-100 hover:bg-black/[0.04]"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setConfirmState({
                            obsId: o.id,
                            title: 'Delete observation?',
                            body: 'If this observation exists in generated decks, it will be detached from those deck records and then deleted.',
                            busy: false,
                            force: true,
                          })
                        }
                        className="rounded-lg p-1.5 text-[#6e6e73] opacity-0 transition group-hover:opacity-100 hover:bg-black/[0.04]"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </motion.article>
                ))}
            {!loading && !queueRows.length ? (
              <div className="rounded-2xl bg-[#f8f8fa] p-8 text-center">
                <p className="text-[14px] font-medium text-[#111]">No observations yet</p>
                <p className="mt-1 text-[13px] text-[#6e6e73]">Capture observations first, then build decks here.</p>
              </div>
            ) : null}
          </div>
          {!loading && observations.length > QUEUE_PAGE_SIZE ? (
            <div className="mt-3 flex items-center justify-between px-1">
              <p className="text-[12px] text-[#6e6e73]">
                Page {currentQueuePage} of {queueTotalPages}
              </p>
              <div className="flex gap-2">
                <ButtonSecondary
                  className="px-2.5 py-1.5 text-[12px]"
                  onClick={() => setQueuePage((p) => Math.max(1, p - 1))}
                  disabled={currentQueuePage === 1}
                  aria-label="Previous page"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </ButtonSecondary>
                <ButtonSecondary
                  className="px-2.5 py-1.5 text-[12px]"
                  onClick={() => setQueuePage((p) => Math.min(queueTotalPages, p + 1))}
                  disabled={currentQueuePage === queueTotalPages}
                  aria-label="Next page"
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </ButtonSecondary>
              </div>
            </div>
          ) : null}
        </section>

        <section className="rounded-3xl bg-white/70 p-5 ring-1 ring-black/[0.05]">
          <h3 className="text-[14px] font-medium text-[#111]">Report generator</h3>
          <p className="mt-1 text-[12px] text-[#6e6e73]">Configure export and generate from selected observations.</p>

          <div className="mt-5 space-y-4">
            <label className="block">
              <span className="mb-1.5 block text-[12px] font-medium text-[#6e6e73]">Deck title</span>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full rounded-2xl border border-black/[0.06] bg-white px-3 py-3 text-[14px] outline-none focus:ring-2 focus:ring-[#0071e3]/25"
                placeholder="Optional"
              />
            </label>
            {/* <label className="flex items-center gap-2 rounded-xl bg-black/[0.03] p-3">
              <input type="checkbox" checked={includePdf} onChange={(e) => setIncludePdf(e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-[#0071e3]" />
              <span className="text-[13px] text-[#6e6e73]">Include PDF export</span>
            </label> */}

            <div className="rounded-xl bg-[#f8f8fa] p-3 text-[13px] text-[#6e6e73]">
              <p>
                <span className="font-medium text-[#111]">{selectedRows.length}</span> observations selected
              </p>
              <p className="mt-1">
                Project scope:{' '}
                <span className={sameProject || selectedRows.length === 0 ? 'text-[#111]' : 'text-amber-700'}>
                  {selectedRows.length === 0
                    ? '—'
                    : sameProject
                      ? selectedRows[0].project_name
                      : 'Mixed (select one project)'}
                </span>
              </p>
            </div>

            <ButtonPrimary
              className="w-full py-3"
              disabled={busy || !selectedRows.length || !sameProject}
              onClick={() => void onGenerate()}
            >
              {busy ? 'Generating…' : 'Generate deck'}
            </ButtonPrimary>
          </div>
        </section>
      </div>

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-[16px] font-semibold tracking-tight text-[#111]">Recent decks</h3>
          <div className="flex items-center gap-2">
            <span className="text-[12px] text-[#6e6e73]">{reports.length} total</span>
            <span className="text-[12px] text-[#6e6e73]">{selectedReportIds.size} selected</span>
            <motion.div
              initial={{ opacity: 0, y: -3 }}
              animate={{ opacity: 1, y: 0 }}
              className="inline-flex items-center gap-1 rounded-full border border-black/[0.06] bg-white/70 px-1.5 py-1 shadow-[0_5px_16px_-12px_rgb(0,0,0,0.25)] backdrop-blur-lg"
            >
              <motion.button
                whileTap={{ scale: 0.97 }}
                type="button"
                onClick={selectAllReports}
                className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium text-[#6e6e73] transition hover:bg-black/[0.04] hover:text-[#111]"
              >
                <CheckCheck className="h-3.5 w-3.5" />
                Select all
              </motion.button>
              <motion.button
                whileTap={{ scale: 0.97 }}
                type="button"
                onClick={deselectAllReports}
                disabled={!selectedReportIds.size}
                className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium text-[#6e6e73] transition hover:bg-black/[0.04] hover:text-[#111] disabled:opacity-40"
              >
                <CircleOff className="h-3.5 w-3.5" />
                Deselect
              </motion.button>
              <motion.button
                whileTap={{ scale: 0.94 }}
                type="button"
                disabled={!selectedReportIds.size}
                onClick={() =>
                  setConfirmState({
                    reportIds: Array.from(selectedReportIds),
                    title: `Delete ${selectedReportIds.size} selected deck(s)?`,
                    body: 'This removes deck metadata and generated files for all selected decks. This action cannot be undone.',
                    busy: false,
                  })
                }
                className="rounded-full p-1.5 text-[#6e6e73] transition hover:bg-black/[0.05] hover:text-[#111] disabled:opacity-40"
                aria-label="Delete selected decks"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </motion.button>
            </motion.div>
          </div>
        </div>
        {loading ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-44 rounded-3xl" />
            ))}
          </div>
        ) : reports.length ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {reports.map((r) => (
              <motion.article
                key={r.id}
                ref={(node) => {
                  if (node) reportCardRefs.current.set(r.id, node)
                  else reportCardRefs.current.delete(r.id)
                }}
                layout
                whileHover={{ y: -2 }}
                className={[
                  'relative rounded-3xl bg-white/75 p-4 ring-1 transition-shadow hover:shadow-[0_14px_40px_-28px_rgb(0,0,0,0.32)]',
                  highlightedReportId === r.id
                    ? 'ring-[#0071e3]/45 shadow-[0_18px_44px_-26px_rgb(0,113,227,0.45)]'
                    : 'ring-black/[0.05]',
                ].join(' ')}
              >
                <label className="absolute left-3 top-3 z-10 inline-flex items-center">
                  <input
                    type="checkbox"
                    checked={selectedReportIds.has(r.id)}
                    onChange={() => toggleReportSelect(r.id)}
                    className="h-4 w-4 rounded border-slate-300 text-[#0071e3]"
                    aria-label={`Select deck ${r.id}`}
                  />
                </label>
                <button
                  type="button"
                  onClick={() => setMenuOpen(menuOpen === r.id ? null : r.id)}
                  className="absolute right-3 top-3 rounded-lg p-1.5 text-[#6e6e73] hover:bg-black/[0.04]"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </button>
                {menuOpen === r.id ? (
                  <div className="absolute right-3 top-11 z-10 w-40 rounded-xl border border-black/[0.08] bg-white p-1 shadow-lg">
                    {[
                      ['Rename', 'rename'],
                      ['Duplicate', 'duplicate'],
                      ['Delete', 'delete'],
                    ].map(([label, action]) => (
                      <button
                        key={action}
                        type="button"
                        onClick={() => void runCardAction(action, r)}
                        className="block w-full rounded-lg px-3 py-2 text-left text-[13px] text-[#111] hover:bg-black/[0.04]"
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                ) : null}

                <div className="mb-4 flex h-28 items-center justify-center rounded-2xl bg-[#f3f4f7] text-[#0071e3] ring-1 ring-black/[0.04]">
                  <FileText className="h-10 w-10" />
                </div>
                <p className="truncate text-[15px] font-semibold text-[#111]">{r.title || `Deck #${r.id}`}</p>
                <p className="truncate text-[13px] text-[#6e6e73]">{r.primary_project_name || 'Unknown project'}</p>
                <p className="mt-2 flex items-center gap-1.5 text-[12px] text-[#6e6e73]">
                  <Calendar className="h-3.5 w-3.5" />
                  {new Date(r.created_at).toLocaleString()}
                </p>
                <p className="mt-1 flex items-center gap-1.5 text-[12px] text-[#6e6e73]">
                  <Layers className="h-3.5 w-3.5" />
                  {r.observation_count} observations
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <a href={buildDownloadHref(r.id, 'pptx')} className="inline-flex items-center gap-1 rounded-xl bg-[#111] px-3 py-1.5 text-[12px] text-white">
                    <Download className="h-3.5 w-3.5" />
                    PPTX
                  </a>
                  {r.has_pdf ? (
                    <a href={buildDownloadHref(r.id, 'pdf')} className="inline-flex items-center gap-1 rounded-xl border border-black/[0.09] bg-white px-3 py-1.5 text-[12px] text-[#111]">
                      <Download className="h-3.5 w-3.5" />
                      PDF
                    </a>
                  ) : null}
                  {r.has_xlsx ? (
                    <a href={buildDownloadHref(r.id, 'xlsx')} className="inline-flex items-center gap-1 rounded-xl border border-black/[0.09] bg-white px-3 py-1.5 text-[12px] text-[#111]">
                      <Download className="h-3.5 w-3.5" />
                      Excel
                    </a>
                  ) : null}
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        const full = await getReport(r.id)
                        const first = observations.find((o) => o.id === full.observation_ids[0])
                        if (first) setEditingObs(first)
                      } catch {
                        setError('Could not open deck preview context')
                      }
                    }}
                    className="inline-flex items-center gap-1 rounded-xl border border-black/[0.09] bg-white px-3 py-1.5 text-[12px] text-[#111]"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    Edit
                  </button>
                </div>
              </motion.article>
            ))}
          </div>
        ) : (
          <div className="rounded-3xl bg-white/70 p-10 text-center ring-1 ring-black/[0.05]">
            <p className="text-[15px] font-medium text-[#111]">No reports yet</p>
            <p className="mt-1 text-[13px] text-[#6e6e73]">Select observations in the queue and generate your first deck.</p>
          </div>
        )}
      </section>

      <AnimatePresence>
        {editingObs ? (
          <motion.aside
            initial={{ x: 440, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 440, opacity: 0 }}
            transition={{ duration: 0.22 }}
            className="fixed inset-y-0 right-0 z-[85] w-full max-w-md border-l border-black/[0.06] bg-white/95 p-5 backdrop-blur-xl"
          >
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-[17px] font-semibold tracking-tight text-[#111]">Edit observation #{editingObs.id}</h3>
                <p className="text-[12px] text-[#6e6e73]">Side panel edit flow</p>
              </div>
              <ButtonSecondary className="px-3 py-2 text-[12px]" onClick={() => setEditingObs(null)}>
                Close
              </ButtonSecondary>
            </div>
            <div className="mt-4 space-y-3 overflow-y-auto pb-24" style={{ maxHeight: 'calc(100vh - 130px)' }}>
              <FormSelect id="tower" label="Tower" value={editingObs.tower || ''} onChange={(v) => setEditingObs((p) => ({ ...p, tower: v }))} options={TOWERS} placeholder="Select" />
              <FormSelect id="floor" label="Floor" value={editingObs.floor || ''} onChange={(v) => setEditingObs((p) => ({ ...p, floor: v }))} options={FLOORS} placeholder="Select" />
              <FormSelect id="flat" label="Flat" value={editingObs.flat || ''} onChange={(v) => setEditingObs((p) => ({ ...p, flat: v }))} options={FLATS} placeholder="Select" />
              <FormSelect id="room" label="Room" value={editingObs.room || ''} onChange={(v) => setEditingObs((p) => ({ ...p, room: v }))} options={ROOMS} placeholder="Select" />
              <FormSelect id="observation_type" label="Type" value={editingObs.observation_type || ''} onChange={(v) => setEditingObs((p) => ({ ...p, observation_type: v }))} options={OBSERVATION_TYPES} placeholder="Select" />
              <FormSelect id="severity" label="Severity" value={editingObs.severity || ''} onChange={(v) => setEditingObs((p) => ({ ...p, severity: v }))} options={SEVERITIES} placeholder="Select" />
              <FormSelect id="inspection_status" label="Inspection status" value={editingObs.inspection_status || ''} onChange={(v) => setEditingObs((p) => ({ ...p, inspection_status: v }))} options={INSPECTION_STATUSES} placeholder="Select" />
              <FormSelect id="third_party_status" label="3rd-party status" value={editingObs.third_party_status || ''} onChange={(v) => setEditingObs((p) => ({ ...p, third_party_status: v }))} options={THIRD_PARTY_INSPECTION_STATUSES} placeholder="Select" />
              <div className="rounded-2xl bg-black/[0.025] p-3">
                <p className="text-[11px] uppercase tracking-[0.1em] text-[#6e6e73]">AI preview</p>
                <p className="mt-2 line-clamp-4 text-[13px] text-[#6e6e73]">{editingObs.generated_observation || '—'}</p>
              </div>
            </div>
            <div className="absolute bottom-5 left-5 right-5">
              <ButtonPrimary className="w-full py-3" onClick={() => void saveEditObservation()}>
                Save changes
              </ButtonPrimary>
            </div>
          </motion.aside>
        ) : null}
      </AnimatePresence>

      <ConfirmDialog
        open={!!confirmState}
        title={confirmState?.title ?? ''}
        body={confirmState?.body ?? ''}
        busy={confirmState?.busy}
        onCancel={() => setConfirmState(null)}
        onConfirm={() =>
          void (confirmState?.obsId
            ? deleteObservationFlow()
            : confirmState?.obsIds
              ? bulkDeleteObservationsFlow()
              : confirmState?.reportIds
                ? bulkDeleteReportsFlow()
              : deleteReportFlow())
        }
      />

      <AnimatePresence>
        {error ? (
          <motion.p
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="fixed bottom-4 left-1/2 z-[95] -translate-x-1/2 rounded-full bg-red-500 px-4 py-2 text-[12px] text-white"
          >
            {error}
          </motion.p>
        ) : null}
      </AnimatePresence>
      <AnimatePresence>
        {notice ? (
          <motion.p
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="fixed bottom-4 left-1/2 z-[95] -translate-x-1/2 rounded-full bg-[#111] px-4 py-2 text-[12px] text-white"
          >
            {notice}
          </motion.p>
        ) : null}
      </AnimatePresence>
    </div>
  )
}
