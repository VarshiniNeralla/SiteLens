import { motion } from 'framer-motion'
import { ArrowUpRight, Sparkles, SquareStack } from 'lucide-react'
import { Link } from 'react-router-dom'

export function LandingPage() {
  return (
    <div className="relative h-screen overflow-hidden bg-[#f3f3f1] text-[#111]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_12%_10%,rgba(255,255,255,0.95),transparent_52%),radial-gradient(circle_at_88%_88%,rgba(219,223,231,0.55),transparent_44%)]" />

      <header className="relative z-10 mx-auto flex w-full max-w-[1320px] items-center justify-between px-6 pt-7 md:px-10">
        <div className="inline-flex items-center gap-2 rounded-full border border-black/[0.06] bg-white/65 px-4 py-2 backdrop-blur-xl">
          <span className="h-2.5 w-2.5 rounded-full bg-[#111]" />
          <span className="text-[13px] font-semibold tracking-tight">SiteLens</span>
        </div>
        <Link
          to="/workspace"
          className="inline-flex items-center gap-1.5 rounded-full border border-black/[0.08] bg-white/70 px-4 py-2 text-[12px] font-medium text-[#111] backdrop-blur-xl transition hover:bg-white"
        >
          Open SiteLens
          <ArrowUpRight className="h-3.5 w-3.5" />
        </Link>
      </header>

      <main className="relative z-10 mx-auto grid h-[calc(100vh-92px)] w-full max-w-[1320px] grid-cols-1 items-center gap-10 px-6 pb-8 md:px-10 lg:grid-cols-[1fr_1.1fr]">
        <section className="max-w-[560px]">
          <motion.p
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35 }}
            className="mb-5 inline-flex items-center gap-2 rounded-full border border-black/[0.06] bg-white/65 px-3 py-1.5 text-[11px] font-medium tracking-[0.08em] text-[#6e6e73] uppercase backdrop-blur-xl"
          >
            <Sparkles className="h-3.5 w-3.5" />
            Construction intelligence
          </motion.p>
          <motion.h1
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, delay: 0.05 }}
            className="text-[clamp(2.4rem,5.2vw,4.7rem)] font-semibold leading-[0.98] tracking-[-0.035em]"
          >
            Capture. Observe.
            <br />
            Deliver.
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, delay: 0.12 }}
            className="mt-5 max-w-[470px] text-[15px] leading-relaxed text-[#55585f]"
          >
            Site walkthroughs transformed into polished quality reports with calm precision.
          </motion.p>
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, delay: 0.18 }}
            className="mt-8"
          >
            <Link
              to="/workspace"
              className="inline-flex items-center gap-2 rounded-2xl bg-[#111] px-5 py-3 text-[14px] font-medium text-white transition hover:bg-[#1b1b1d]"
            >
              Enter Workspace
              <ArrowUpRight className="h-4 w-4" />
            </Link>
          </motion.div>
        </section>

        <motion.section
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.52, delay: 0.1 }}
          whileHover={{ y: -2 }}
          className="relative"
        >
          <motion.div
            aria-hidden
            animate={{ opacity: [0.35, 0.55, 0.4], scale: [1, 1.04, 1] }}
            transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut' }}
            className="pointer-events-none absolute -inset-x-8 -top-8 h-[74%] rounded-[120px] bg-[radial-gradient(circle_at_50%_45%,rgba(255,255,255,0.7),rgba(233,236,242,0.26)_48%,transparent_72%)] blur-3xl"
          />
          <motion.div
            aria-hidden
            animate={{ opacity: [0.24, 0.38, 0.24], x: [0, 10, 0], y: [0, -6, 0] }}
            transition={{ duration: 12, repeat: Infinity, ease: 'easeInOut' }}
            className="pointer-events-none absolute -right-10 top-16 h-44 w-44 rounded-full bg-[radial-gradient(circle,rgba(150,161,179,0.36),transparent_70%)] blur-2xl"
          />
          <motion.div
            animate={{ y: [0, -4, 0] }}
            transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
            className="relative rounded-[30px] border border-black/[0.06] bg-white/62 p-4 shadow-[0_28px_70px_-42px_rgb(0,0,0,0.45)] backdrop-blur-2xl"
          >
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-10 top-0 h-px bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.85),transparent)]"
            />
            <div className="mb-3 flex items-center justify-between rounded-2xl border border-black/[0.05] bg-white/75 px-3 py-2">
              <div className="inline-flex items-center gap-2 text-[12px] font-medium text-[#6b7079]">
                <SquareStack className="h-3.5 w-3.5" />
                SiteLens Workspace
              </div>
              <span className="text-[11px] text-[#8a9099]">Live capture flow</span>
            </div>
            <div className="grid grid-cols-[1.2fr_0.9fr] gap-3">
              <div className="rounded-2xl border border-black/[0.06] bg-[linear-gradient(160deg,#f5f6f9,#eaedf2)] p-3">
                <div className="h-[220px] rounded-xl border border-black/[0.07] bg-[radial-gradient(circle_at_30%_10%,#ffffff,transparent_58%),#dfe3ea]" />
                <div className="mt-3 flex gap-2">
                  <div className="h-14 w-20 rounded-lg border border-black/[0.08] bg-[#d9dde4]" />
                  <div className="h-14 w-20 rounded-lg border border-black/[0.08] bg-[#e2e5eb]" />
                  <div className="h-14 w-20 rounded-lg border border-black/[0.08] bg-[#eceff4]" />
                </div>
              </div>
              <div className="rounded-2xl border border-black/[0.06] bg-white/82 p-3">
                <div className="space-y-2.5">
                  <div className="h-9 rounded-xl border border-black/[0.06] bg-[#f6f7fa]" />
                  <div className="h-9 rounded-xl border border-black/[0.06] bg-[#f6f7fa]" />
                  <div className="h-9 rounded-xl border border-black/[0.06] bg-[#f6f7fa]" />
                  <div className="h-20 rounded-xl border border-black/[0.06] bg-[linear-gradient(90deg,#f2f3f6,#fafbfc,#f2f3f6)]" />
                </div>
              </div>
            </div>
          </motion.div>
        </motion.section>
      </main>
    </div>
  )
}
