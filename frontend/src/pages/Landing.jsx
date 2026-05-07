import { useEffect } from 'react'
import { motion, useMotionValue, useSpring, useTransform } from 'framer-motion'
import { ArrowUpRight, Sparkles } from 'lucide-react'
import { Link } from 'react-router-dom'

export function LandingPage() {
  const pointerX = useMotionValue(0)
  const pointerY = useMotionValue(0)
  const smoothX = useSpring(pointerX, { stiffness: 45, damping: 18, mass: 0.8 })
  const smoothY = useSpring(pointerY, { stiffness: 45, damping: 18, mass: 0.8 })
  const panelShiftX = useTransform(smoothX, [-0.5, 0.5], [-12, 12])
  const panelShiftY = useTransform(smoothY, [-0.5, 0.5], [-10, 10])
  const layerNearX = useTransform(smoothX, [-0.5, 0.5], [-24, 24])
  const layerNearY = useTransform(smoothY, [-0.5, 0.5], [-18, 18])

  useEffect(() => {
    const onMove = (e) => {
      const x = e.clientX / window.innerWidth - 0.5
      const y = e.clientY / window.innerHeight - 0.5
      pointerX.set(x)
      pointerY.set(y)
    }
    window.addEventListener('pointermove', onMove)
    return () => window.removeEventListener('pointermove', onMove)
  }, [pointerX, pointerY])

  return (
    <div className="relative h-screen overflow-hidden bg-[#eceeed] text-[#111]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_12%,rgba(255,255,255,0.94),transparent_50%),radial-gradient(circle_at_82%_14%,rgba(224,229,238,0.62),transparent_48%),radial-gradient(circle_at_78%_82%,rgba(173,183,198,0.28),transparent_52%),linear-gradient(130deg,#f4f5f4,#eaedee_46%,#e3e6ea)]" />
      <motion.div
        aria-hidden
        style={{ x: panelShiftX, y: panelShiftY }}
        className="pointer-events-none absolute -right-24 top-8 h-[560px] w-[560px] rounded-full bg-[radial-gradient(circle,rgba(250,251,255,0.85),rgba(202,210,223,0.26)_48%,transparent_74%)] blur-3xl"
      />
      <motion.div
        aria-hidden
        animate={{ opacity: [0.22, 0.35, 0.25], scale: [1, 1.06, 1] }}
        transition={{ duration: 11, repeat: Infinity, ease: 'easeInOut' }}
        className="pointer-events-none absolute right-20 top-28 h-56 w-56 rounded-full bg-[radial-gradient(circle,rgba(155,168,189,0.3),transparent_72%)] blur-2xl"
      />

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
            className="text-[clamp(2.4rem,5.2vw,4.7rem)] font-semibold leading-[0.98] tracking-[-0.035em] [text-shadow:0_14px_34px_rgba(255,255,255,0.45)]"
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
          className="relative h-[540px]"
        >
          <motion.div
            style={{ x: layerNearX, y: layerNearY }}
            animate={{ opacity: [0.22, 0.36, 0.25] }}
            transition={{ duration: 9, repeat: Infinity, ease: 'easeInOut' }}
            className="pointer-events-none absolute -left-8 top-20 h-72 w-72 rounded-full bg-[radial-gradient(circle,rgba(238,242,248,0.9),rgba(181,192,209,0.2)_55%,transparent_74%)] blur-3xl"
          />
          <motion.div
            style={{ x: panelShiftX, y: panelShiftY }}
            animate={{ opacity: [0.45, 0.62, 0.5], y: [0, -5, 0] }}
            transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
            className="pointer-events-none absolute right-5 top-7 h-[470px] w-[620px] rounded-[40px] bg-[radial-gradient(circle_at_50%_42%,rgba(255,255,255,0.72),rgba(207,214,224,0.2)_60%,transparent_76%)] blur-2xl"
          />

          <motion.div
            style={{ x: panelShiftX, y: panelShiftY }}
            animate={{ y: [0, -4, 0], rotate: [0, 0.12, 0] }}
            transition={{ duration: 7, repeat: Infinity, ease: 'easeInOut' }}
            className="absolute right-0 top-4 w-[620px] rounded-[34px] border border-white/40 bg-white/26 p-4 shadow-[0_35px_80px_-42px_rgba(0,0,0,0.5)] backdrop-blur-[22px]"
          >
            <div className="absolute inset-x-14 top-0 h-px bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.88),transparent)]" />

            <motion.div
              style={{ x: useTransform(panelShiftX, (v) => v * -0.45), y: useTransform(panelShiftY, (v) => v * -0.4) }}
              className="relative ml-8 w-[330px] rounded-2xl border border-black/[0.1] bg-[#101216] p-2 shadow-[0_24px_42px_-22px_rgba(0,0,0,0.55)]"
            >
              <div className="h-[188px] rounded-xl bg-[radial-gradient(circle_at_34%_16%,rgba(255,255,255,0.18),transparent_50%),linear-gradient(130deg,#2e333b,#181c22_62%,#101319)]" />
              <div className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full border border-white/20 bg-white/12 px-2 py-1 text-[10px] text-white/90 backdrop-blur-md">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#9de2ff]" />
                Capturing
              </div>
            </motion.div>

            <motion.div
              style={{ x: useTransform(panelShiftX, (v) => v * 0.36), y: useTransform(panelShiftY, (v) => v * 0.34) }}
              className="relative -mt-16 ml-64 w-[300px] rounded-2xl border border-white/55 bg-white/72 p-3 shadow-[0_20px_50px_-30px_rgba(0,0,0,0.45)] backdrop-blur-xl"
            >
              <p className="text-[11px] uppercase tracking-[0.08em] text-[#6e7380]">Generated Report</p>
              <p className="mt-1 text-[14px] font-medium tracking-tight text-[#17191d]">Tower 5 structural QA summary ready</p>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-black/[0.08]">
                <motion.div
                  animate={{ x: ['-100%', '100%'] }}
                  transition={{ duration: 2.8, repeat: Infinity, ease: 'linear' }}
                  className="h-full w-1/2 bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.9),transparent)]"
                />
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2">
                <div className="h-10 rounded-lg border border-black/[0.07] bg-[#f7f8fa]" />
                <div className="h-10 rounded-lg border border-black/[0.07] bg-[#f7f8fa]" />
                <div className="h-10 rounded-lg border border-black/[0.07] bg-[#f7f8fa]" />
              </div>
            </motion.div>

            <motion.div
              style={{ x: useTransform(panelShiftX, (v) => v * -0.25), y: useTransform(panelShiftY, (v) => v * -0.2) }}
              className="absolute -left-8 top-44 w-[220px] rounded-2xl border border-white/52 bg-white/64 p-2.5 backdrop-blur-xl shadow-[0_16px_34px_-24px_rgba(0,0,0,0.38)]"
            >
              <div className="flex items-center justify-between text-[10px] text-[#6f7480]">
                <span>Observation metadata</span>
                <span className="rounded-full bg-[#111]/8 px-1.5 py-0.5">Live</span>
              </div>
              <div className="mt-2 space-y-1.5">
                <div className="h-7 rounded-lg border border-black/[0.07] bg-white/78" />
                <div className="h-7 rounded-lg border border-black/[0.07] bg-white/78" />
                <div className="h-7 rounded-lg border border-black/[0.07] bg-white/78" />
              </div>
            </motion.div>

            <motion.div
              animate={{ opacity: [0.16, 0.28, 0.16], y: [0, 3, 0] }}
              transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
              className="pointer-events-none absolute inset-0 rounded-[34px] bg-[linear-gradient(180deg,rgba(255,255,255,0.22),transparent_32%,rgba(255,255,255,0.08))]"
            />
          </motion.div>
        </motion.section>
      </main>
    </div>
  )
}
