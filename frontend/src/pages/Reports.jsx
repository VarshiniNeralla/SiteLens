import { useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Calendar, Download, FileText, RefreshCw } from 'lucide-react'
import { generateReport, listObservations, listReports, downloadUrl as buildDownloadHref } from '../api.js'
import { ButtonPrimary, ButtonSecondary } from '../components/ui/Button.jsx'
import { Skeleton } from '../components/ui/Skeleton.jsx'

export function ReportsPage() {
  const [observations, setObservations] = useState([])
  const [reports, setReports] = useState([])
  const [selected, setSelected] = useState(() => new Set())
  const [title, setTitle] = useState('')
  const [includePdf, setIncludePdf] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [freshReport, setFreshReport] = useState(null)

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const [obsRows, reprows] = await Promise.all([listObservations(), listReports()])
      setObservations(obsRows)
      setReports(reprows)
    } catch (e) {
      setError(e.message || 'Unable to load workspace')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    queueMicrotask(() => {
      void load()
    })
  }, [])

  const toggle = (id) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectedProject = useMemo(() => {
    const rows = observations.filter((o) => selected.has(o.id))
    if (!rows.length) return null
    const names = new Set(rows.map((o) => o.project_name))
    return { names, rows }
  }, [observations, selected])

  const sameProject = selectedProject && selectedProject.names.size === 1

  const onGenerate = async () => {
    if (!sameProject) {
      setError('Choose observations from a single project.')
      return
    }
    setBusy(true)
    setError('')
    setFreshReport(null)
    try {
      const orderedIds = observations.filter((o) => selected.has(o.id)).map((o) => o.id)
      const body = {
        observation_ids: orderedIds,
        title: title.trim() || null,
        include_pdf: includePdf,
      }
      const report = await generateReport(body)
      setFreshReport(report)
      await load()
    } catch (e) {
      setError(e.message || 'Report generation failed')
    } finally {
      setBusy(false)
    }
  }

  const gridClasses =
    'group relative flex gap-5 overflow-hidden rounded-2xl bg-white/60 px-5 py-5 ring-1 ring-black/[0.05] transition-[box-shadow,background-color] duration-200 hover:bg-white hover:shadow-[0_14px_40px_-26px_rgb(0,0,0,0.28)] md:gap-6 md:py-6'

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="text-[clamp(1.45rem,2.5vw,1.75rem)] font-semibold tracking-[-0.02em] text-[#111]">Reports</h2>
          <p className="mt-2 max-w-lg text-[15px] leading-relaxed text-[#6e6e73]">
            Pick observations, render a deck, and download PPTX. PDF is optional and requires LibreOffice on the server.
          </p>
        </div>
        <ButtonSecondary type="button" onClick={() => void load()} className="shrink-0 gap-2 self-start md:self-auto">
          <RefreshCw className="h-4 w-4 opacity-70" strokeWidth={1.75} aria-hidden />
          Refresh
        </ButtonSecondary>
      </div>

      <div className="mt-14 space-y-10">
        <section className="space-y-6">
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-[13px] font-medium text-[#6e6e73]" htmlFor="deck_title">
                Deck title
              </label>
              <input
                id="deck_title"
                className="w-full rounded-2xl border border-black/[0.06] bg-white/80 px-4 py-3 text-[15px] text-[#111] shadow-[0_1px_0_rgb(0,0,0,0.02)] outline-none transition focus:bg-white focus:ring-2 focus:ring-[#0071e3]/22"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Optional"
              />
            </div>
            <label className="flex cursor-pointer items-center gap-3 rounded-2xl bg-black/[0.02] px-4 py-4 md:mt-7">
              <input
                type="checkbox"
                className="h-[18px] w-[18px] rounded-md border-[#d2d2d7] text-[#0071e3] focus:ring-[#0071e3]/30"
                checked={includePdf}
                onChange={(e) => setIncludePdf(e.target.checked)}
              />
              <span className="text-[14px] text-[#6e6e73]">Include PDF export (LibreOffice required)</span>
            </label>
          </div>

          <div className="space-y-2">
            <p className="text-[13px] font-medium text-[#6e6e73]">Observations</p>
            <div className="max-h-[min(40vh,320px)] space-y-1 overflow-y-auto overscroll-contain pr-1">
              {loading
                ? Array.from({ length: 5 }).map((_, i) => (
                    <Skeleton key={i} className="h-14 w-full rounded-xl" />
                  ))
                : observations.map((o) => (
                    <motion.label
                      layout
                      key={o.id}
                      className="flex cursor-pointer items-center gap-4 rounded-xl px-3 py-3 transition-colors hover:bg-black/[0.03]"
                    >
                      <input
                        type="checkbox"
                        className="h-[18px] w-[18px] rounded-md border-[#d2d2d7] text-[#0071e3] focus:ring-[#0071e3]/30"
                        checked={selected.has(o.id)}
                        onChange={() => toggle(o.id)}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[15px] font-medium text-[#111]">
                          #{o.id} · {o.project_name}
                        </p>
                        <p className="truncate text-[13px] text-[#6e6e73]">
                          {[o.tower && `Tower ${o.tower}`, o.floor && `Floor ${o.floor}`, o.room && o.room].filter(Boolean).join(' · ') || '—'}
                        </p>
                      </div>
                    </motion.label>
                  ))}
              {!loading && !observations.length ? (
                <p className="py-8 text-center text-[15px] text-[#6e6e73]">No observations yet.</p>
              ) : null}
            </div>
          </div>

          {selected.size > 0 && !sameProject ? (
            <p className="text-[14px] font-medium text-amber-800/90">Narrow selection to one project.</p>
          ) : null}

          <AnimatePresence>
            {error ? (
              <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-[14px] font-medium text-red-600/95">
                {error}
              </motion.p>
            ) : null}
          </AnimatePresence>

          <ButtonPrimary type="button" disabled={selected.size === 0 || !sameProject || busy} onClick={() => void onGenerate()}>
            {busy ? 'Rendering…' : 'Generate report'}
          </ButtonPrimary>

          <AnimatePresence>
            {freshReport ? (
              <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex flex-wrap items-center gap-3 rounded-2xl bg-black/[0.03] px-5 py-4"
              >
                <FileText className="h-5 w-5 text-[#0071e3]" strokeWidth={1.75} aria-hidden />
                <span className="text-[15px] font-medium text-[#111]">
                  #{freshReport.id}
                  <span className="font-normal text-[#6e6e73]"> · {freshReport.status}</span>
                </span>
                {freshReport.error_message ? (
                  <span
                    className={[
                      'w-full text-[14px]',
                      freshReport.error_message.startsWith('PDF export skipped:')
                        ? 'text-amber-700/95'
                        : 'text-red-600/95',
                    ].join(' ')}
                  >
                    {freshReport.error_message}
                  </span>
                ) : null}
                <div className="flex w-full flex-wrap gap-2 sm:ml-auto sm:w-auto">
                  {freshReport.pptx_path ? (
                    <a
                      href={buildDownloadHref(freshReport.id, 'pptx')}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-[#111] px-4 py-2 text-[13px] font-medium text-white transition-opacity hover:opacity-90"
                    >
                      <Download className="h-4 w-4" strokeWidth={2} aria-hidden />
                      PPTX
                    </a>
                  ) : null}
                  {freshReport.pdf_path ? (
                    <a
                      href={buildDownloadHref(freshReport.id, 'pdf')}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-black/[0.1] bg-white/90 px-4 py-2 text-[13px] font-medium text-[#111]"
                    >
                      <Download className="h-4 w-4" strokeWidth={2} aria-hidden />
                      PDF
                    </a>
                  ) : null}
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </section>

        <section className="pt-6">
          <div className="mb-8 flex items-baseline justify-between gap-3">
            <h3 className="text-[1.05rem] font-semibold tracking-tight text-[#111]">Library</h3>
            {!loading ? (
              <span className="text-[13px] text-[#6e6e73]">
                {reports.length} deck{reports.length === 1 ? '' : 's'}
              </span>
            ) : null}
          </div>

          {loading ? (
            <div className="grid gap-4 sm:grid-cols-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-36 rounded-2xl" />
              ))}
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {reports.map((r) => (
                <motion.article
                  layout
                  key={r.id}
                  className={gridClasses}
                  whileHover={{ y: -2 }}
                  transition={{ type: 'spring', stiffness: 420, damping: 28 }}
                >
                  <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl bg-[#f5f5f7] text-[#0071e3] ring-1 ring-black/[0.04]">
                    <FileText className="h-9 w-9" strokeWidth={1.35} aria-hidden />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[16px] font-semibold tracking-tight text-[#111]">{r.title || 'Untitled deck'}</p>
                    {r.primary_project_name ? (
                      <p className="mt-1 truncate text-[14px] text-[#6e6e73]">{r.primary_project_name}</p>
                    ) : null}
                    <p className="mt-3 flex items-center gap-1.5 text-[13px] text-[#6e6e73]">
                      <Calendar className="h-3.5 w-3.5 shrink-0 opacity-80" strokeWidth={2} aria-hidden />
                      {new Date(r.created_at).toLocaleDateString(undefined, {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                      })}
                      <span className="mx-1 text-[#d2d2d7]">·</span>
                      {r.status}
                    </p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {r.has_pptx ? (
                        <a
                          href={buildDownloadHref(r.id, 'pptx')}
                          className="inline-flex items-center gap-1 rounded-xl bg-[#111] px-3.5 py-2 text-[12px] font-medium text-white transition-opacity hover:opacity-90"
                        >
                          <Download className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
                          PPTX
                        </a>
                      ) : null}
                      {r.has_pdf ? (
                        <a
                          href={buildDownloadHref(r.id, 'pdf')}
                          className="inline-flex items-center gap-1 rounded-xl border border-black/[0.08] bg-white/90 px-3.5 py-2 text-[12px] font-medium text-[#111]"
                        >
                          <Download className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
                          PDF
                        </a>
                      ) : null}
                      {!r.has_pptx && !r.has_pdf ? (
                        <span className="text-[12px] text-[#6e6e73]">Processing or unavailable</span>
                      ) : null}
                    </div>
                  </div>
                </motion.article>
              ))}
              {!reports.length ? (
                <p className="col-span-full py-14 text-center text-[15px] text-[#6e6e73]">No reports yet.</p>
              ) : null}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
