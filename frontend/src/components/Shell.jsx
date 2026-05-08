import { motion, AnimatePresence } from 'framer-motion'
import { useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { FloatingNav } from './FloatingNav.jsx'
import { retryOfflineOperationsNow, subscribeOperationJournal } from '../api.js'

export function Shell() {
  const { pathname } = useLocation()
  const [ops, setOps] = useState({ queued: 0, failed: 0 })
  const [retrying, setRetrying] = useState(false)

  useEffect(() => {
    return subscribeOperationJournal((summary) => setOps(summary))
  }, [])

  return (
    <div className="min-h-screen selection:apple bg-[#f5f5f7] text-[#111] antialiased">
      <FloatingNav />
      {(ops.queued > 0 || ops.failed > 0) ? (
        <div className="fixed left-1/2 top-16 z-50 -translate-x-1/2 rounded-xl border border-black/10 bg-white/90 px-3 py-2 text-xs shadow">
          <span className="mr-3">Queued: {ops.queued}</span>
          <span className="mr-3">Failed: {ops.failed}</span>
          <button
            type="button"
            className="rounded border border-black/10 px-2 py-0.5"
            disabled={retrying}
            onClick={async () => {
              setRetrying(true)
              try {
                await retryOfflineOperationsNow()
              } finally {
                setRetrying(false)
              }
            }}
          >
            {retrying ? 'Retrying…' : 'Retry now'}
          </button>
        </div>
      ) : null}
      <main className="mx-auto max-w-[1400px] px-4 pb-10 pt-24 md:px-8 md:pt-32">
        <AnimatePresence mode="wait">
          <motion.div
            key={pathname}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.24, ease: [0.25, 0.1, 0.25, 1] }}
          >
            <Outlet />
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  )
}
