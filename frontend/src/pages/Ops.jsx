import { useCallback, useEffect, useMemo, useState } from 'react'
import { Activity, AlertTriangle, CheckCircle2, Clock3, Gauge, RefreshCw } from 'lucide-react'
import { getOpsOverview } from '../api.js'
import { ButtonSecondary } from '../components/ui/Button.jsx'

function formatLastUpdated(date) {
  if (!date) return 'Not updated yet'
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function toneClasses(tone) {
  if (tone === 'healthy') return 'bg-emerald-50 text-emerald-700 ring-emerald-200/70'
  if (tone === 'warning') return 'bg-amber-50 text-amber-700 ring-amber-200/70'
  if (tone === 'critical') return 'bg-rose-50 text-rose-700 ring-rose-200/70'
  return 'bg-slate-100 text-slate-700 ring-slate-200/70'
}

function mapStatusTone(status) {
  const s = String(status || '').toLowerCase()
  if (['operational', 'stable'].includes(s)) return 'healthy'
  if (['recovering', 'degraded', 'processing'].includes(s)) return 'warning'
  if (['offline', 'partial_outage', 'failed'].includes(s)) return 'critical'
  return 'muted'
}

function HealthCard({ icon: Icon, label, value, hint, tone = 'muted' }) {
  return (
    <article className="rounded-3xl border border-white/70 bg-white/75 p-5 shadow-[0_20px_60px_-36px_rgba(15,23,42,0.35)] backdrop-blur-xl">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[#6e6e73]">{label}</p>
          <p className="mt-2 text-3xl font-semibold tracking-tight text-[#111]">{value}</p>
          <p className="mt-1 text-sm text-[#6e6e73]">{hint}</p>
        </div>
        <span className={`inline-flex h-10 w-10 items-center justify-center rounded-2xl ring-1 ${toneClasses(tone)}`}>
          <Icon className="h-5 w-5" strokeWidth={1.9} />
        </span>
      </div>
    </article>
  )
}

export function OpsPage() {
  const [overview, setOverview] = useState(null)
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [lastUpdated, setLastUpdated] = useState(null)
  const [autoRefresh, setAutoRefresh] = useState(true)

  useEffect(() => {
    const prevHtmlOverflow = document.documentElement.style.overflow
    const prevBodyOverflow = document.body.style.overflow
    document.documentElement.style.overflow = 'hidden'
    document.body.style.overflow = 'hidden'
    return () => {
      document.documentElement.style.overflow = prevHtmlOverflow
      document.body.style.overflow = prevBodyOverflow
    }
  }, [])

  const load = useCallback(async (silent = false) => {
    if (!silent) setRefreshing(true)
    setError('')
    try {
      const data = await getOpsOverview()
      setOverview(data)
      setLastUpdated(new Date())
    } catch (e) {
      setError(e.message || 'Unable to load operations monitor')
    } finally {
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    const bootId = setTimeout(() => {
      void load(false)
    }, 0)
    const id = setInterval(() => {
      if (autoRefresh) void load(true)
    }, 5000)
    return () => {
      clearTimeout(bootId)
      clearInterval(id)
    }
  }, [autoRefresh, load])

  const counts = overview?.counts || {}
  const dependencies = useMemo(() => overview?.dependencies || [], [overview])
  const jobState = overview?.jobs || {}
  const confidence = overview?.confidence || { score_pct: 0, label: 'Watch' }

  const activeIssueCount = useMemo(() => {
    const dependencyIssues = dependencies.filter((x) => mapStatusTone(x.status) === 'critical').length
    return dependencyIssues + Number(jobState.failed || 0)
  }, [dependencies, jobState.failed])

  const systemHealthy = activeIssueCount === 0

  return (
    <div className="h-[calc(100vh-10.6rem)] overflow-hidden space-y-8">
      <section className="rounded-3xl border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.86),rgba(248,250,252,0.78))] p-6 shadow-[0_26px_80px_-42px_rgba(15,23,42,0.45)] backdrop-blur-2xl md:p-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#6e6e73]">Monitor</p>
            <h2 className="mt-1 text-[clamp(1.35rem,2.8vw,1.9rem)] font-semibold tracking-tight text-[#111]">
              System Health at a Glance
            </h2>
            <p className="mt-2 text-sm text-[#6e6e73]">
              {systemHealthy
                ? 'All critical services are stable and operating normally.'
                : 'Some areas need attention. Review highlighted cards below.'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setAutoRefresh((v) => !v)}
              className={[
                'rounded-full px-3 py-1.5 text-xs font-medium ring-1 transition',
                autoRefresh
                  ? 'bg-emerald-50 text-emerald-700 ring-emerald-200/70'
                  : 'bg-slate-100 text-slate-700 ring-slate-200/70',
              ].join(' ')}
            >
              Auto refresh {autoRefresh ? 'On' : 'Off'}
            </button>
            <ButtonSecondary onClick={() => void load(false)} className="gap-1.5">
              <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
              Refresh
            </ButtonSecondary>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-[#6e6e73]">
          <span className="inline-flex items-center gap-1.5">
            <Clock3 className="h-4 w-4" />
            Last updated: {formatLastUpdated(lastUpdated)}
          </span>
          <span
            className={[
              'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1',
              systemHealthy ? toneClasses('healthy') : toneClasses('critical'),
            ].join(' ')}
          >
            {systemHealthy ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
            {systemHealthy ? 'Platform Stable' : `${activeIssueCount} Active Issue${activeIssueCount === 1 ? '' : 's'}`}
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-700 ring-1 ring-sky-200/70">
            <Gauge className="h-3.5 w-3.5" />
            Platform Confidence: {confidence.score_pct}% ({confidence.label})
          </span>
        </div>
      </section>

      {error ? (
        <div className="rounded-2xl border border-rose-200/70 bg-rose-50/80 px-4 py-3 text-sm text-rose-700 shadow-[0_16px_44px_-32px_rgba(244,63,94,0.45)]">
          {error}
        </div>
      ) : null}

      <section className="space-y-4">
        <h3 className="text-sm font-semibold uppercase tracking-[0.1em] text-[#6e6e73]">System Health Overview</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <HealthCard
            icon={Activity}
            label="Total Reports"
            value={counts.reports_total ?? '—'}
            hint="All generated and queued reports"
            tone="muted"
          />
          <HealthCard
            icon={Activity}
            label="Reports Processing"
            value={counts.reports_processing ?? '—'}
            hint="Currently in queue or generating"
            tone={(counts.reports_processing || 0) > 0 ? 'warning' : 'healthy'}
          />
          <HealthCard
            icon={AlertTriangle}
            label="Failed Reports"
            value={counts.reports_failed ?? '—'}
            hint="Requires follow-up or retry"
            tone={(counts.reports_failed || 0) > 0 ? 'critical' : 'healthy'}
          />
          <HealthCard
            icon={Activity}
            label="Total Observations"
            value={counts.observations_total ?? '—'}
            hint="Captured field observations"
            tone="muted"
          />
          <HealthCard
            icon={Activity}
            label="Active Upload Sessions"
            value={counts.active_upload_sessions ?? '—'}
            hint="In-progress upload activity"
            tone={(counts.active_upload_sessions || 0) > 0 ? 'warning' : 'healthy'}
          />
        </div>
      </section>

      <section className="space-y-4">
        <h3 className="text-sm font-semibold uppercase tracking-[0.1em] text-[#6e6e73]">Dependency Status</h3>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {dependencies.map((dep) => {
            const tone = mapStatusTone(dep.status)
            return (
              <article
                key={dep.service}
                className="rounded-3xl border border-white/70 bg-white/75 p-5 shadow-[0_20px_60px_-36px_rgba(15,23,42,0.35)] backdrop-blur-xl"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <span className={`inline-flex h-9 w-9 items-center justify-center rounded-xl ring-1 ${toneClasses(tone)}`}>
                      <Activity className="h-4.5 w-4.5" strokeWidth={1.9} />
                    </span>
                    <p className="text-sm font-semibold text-[#111]">{dep.service}</p>
                  </div>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-medium capitalize ring-1 ${toneClasses(tone)}`}>
                    {String(dep.status || 'stable').replace('_', ' ')}
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-[#6e6e73]">
                  <span>Uptime: {dep.uptime_pct}%</span>
                  <span>Success: {dep.success_rate_pct}%</span>
                  <span>Latency: {dep.avg_latency_ms ?? 'n/a'} ms</span>
                  <span>Retries: {dep.retry_count}</span>
                </div>
                <p className="mt-2 text-xs text-[#6e6e73]">
                  Last success: {dep.last_success_at ? new Date(dep.last_success_at).toLocaleTimeString() : 'No calls yet'}
                </p>
              </article>
            )
          })}
        </div>
      </section>

      <div className="h-2" />
    </div>
  )
}
