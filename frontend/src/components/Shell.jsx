import { motion, AnimatePresence } from 'framer-motion'
import { Outlet, useLocation } from 'react-router-dom'
import { FloatingNav } from './FloatingNav.jsx'

export function Shell() {
  const { pathname } = useLocation()

  return (
    <div className="min-h-screen selection:apple bg-[#f5f5f7] text-[#111] antialiased">
      <FloatingNav />
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
