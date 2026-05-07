import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowRight, ClipboardList, FileImage } from 'lucide-react'
import { listObservations, listReports } from '../api.js'
import { PrimaryLink, SecondaryLink } from '../components/ui/Button.jsx'

export function HomePage() {
  const [obsCount, setObsCount] = useState(null)
  const [reportCount, setReportCount] = useState(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [obs, reps] = await Promise.all([listObservations(), listReports()])
        if (!cancelled) {
          setObsCount(obs.length)
          setReportCount(reps.length)
        }
      } catch {
        if (!cancelled) {
          setObsCount(null)
          setReportCount(null)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="mx-auto max-w-3xl text-center">
      <motion.p
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
        className="text-[13px] font-medium tracking-wide text-[#6e6e73]"
      >
        Quality walkthrough
      </motion.p>

      <motion.h1
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.08 }}
        className="mt-4 text-balance text-[clamp(2rem,5vw,2.85rem)] font-semibold leading-[1.08] tracking-[-0.03em] text-[#111]"
      >
        Calm reporting, structured capture.
      </motion.h1>

      <motion.p
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.12 }}
        className="mx-auto mt-6 max-w-xl text-[17px] font-normal leading-relaxed text-[#6e6e73]"
      >
        Upload a site photo, log metadata with guided fields, then render a polished deck — without the noise of an
        admin console.
      </motion.p>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.16 }}
        className="mt-12 flex flex-col items-center justify-center gap-3 sm:flex-row sm:gap-4"
      >
        <PrimaryLink to="/upload" className="w-full gap-2 sm:w-auto sm:min-w-[12rem]">
          <FileImage className="h-[18px] w-[18px] opacity-90" strokeWidth={1.85} aria-hidden />
          Upload photo
        </PrimaryLink>
        <SecondaryLink to="/observations/new" className="w-full gap-2 sm:w-auto sm:min-w-[12rem]">
          New observation
          <ClipboardList className="h-[18px] w-[18px] opacity-80" strokeWidth={1.85} aria-hidden />
        </SecondaryLink>
      </motion.div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.22 }}
        className="mt-20 border-t border-[#e5e5e7]/90 pt-10"
      >
        <p className="text-[12px] font-medium uppercase tracking-[0.12em] text-[#6e6e73]/85">Workspace</p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-x-10 gap-y-4 text-[15px] text-[#6e6e73]">
          <Link
            to="/reports"
            className="group inline-flex items-center gap-1.5 text-[#111] transition-colors hover:text-[#0071e3]"
          >
            <span>
              {reportCount != null ? `${reportCount} report${reportCount === 1 ? '' : 's'}` : 'Reports'}
            </span>
            <ArrowRight
              className="h-4 w-4 opacity-0 transition-all group-hover:translate-x-0.5 group-hover:opacity-100"
              strokeWidth={1.75}
              aria-hidden
            />
          </Link>
          <span className="hidden h-1 w-1 rounded-full bg-[#d2d2d7] sm:inline" aria-hidden />
          <span>
            {obsCount != null ? `${obsCount} observation${obsCount === 1 ? '' : 's'} saved` : 'Observations sync when saved'}
          </span>
        </div>
      </motion.div>
    </div>
  )
}
