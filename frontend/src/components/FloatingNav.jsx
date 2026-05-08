import { Activity, LayoutGrid, Presentation } from 'lucide-react'
import { motion } from 'framer-motion'
import { NavLink } from 'react-router-dom'

const items = [
  { to: '/workspace', end: false, label: 'Dashboard', icon: LayoutGrid },
  { to: '/output/reports', end: false, label: 'Reports', icon: Presentation },
  { to: '/ops/monitor', end: false, label: 'Ops', icon: Activity },
]

export function FloatingNav() {
  return (
    <header className="pointer-events-none fixed inset-x-0 top-0 z-50 flex justify-center px-4 pt-5 md:pt-7">
      <motion.nav
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: [0.25, 0.1, 0.25, 1] }}
        className="pointer-events-auto flex items-center gap-1.5 rounded-full border border-black/[0.06] bg-white/66 px-2 py-1.5 shadow-[0_8px_36px_-20px_rgb(0,0,0,0.24)] backdrop-blur-2xl backdrop-saturate-[1.35]"
        aria-label="Primary"
      >
        <span className="hidden px-2 text-[10px] uppercase tracking-[0.12em] text-[#6e6e73] lg:inline">Workspace</span>
        {items.map(({ to, end, label, icon: Icon }) => (
          <div key={to} className="contents">
            {to === '/output/reports' ? (
              <span className="hidden px-2 text-[10px] uppercase tracking-[0.12em] text-[#6e6e73] lg:inline">Output</span>
            ) : null}
            {to === '/ops/monitor' ? (
              <span className="hidden px-2 text-[10px] uppercase tracking-[0.12em] text-[#6e6e73] lg:inline">Monitor</span>
            ) : null}
            <NavLink
              to={to}
              end={end}
              className="relative shrink-0 rounded-full px-0.5 py-0.5 outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30"
            >
              {({ isActive }) => (
                <span
                  className={[
                    'relative flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-medium tracking-tight transition-colors duration-150',
                    isActive ? 'text-[#111]' : 'text-[#6e6e73] hover:text-[#111]',
                  ].join(' ')}
                >
                  {isActive ? (
                    <motion.span
                      layoutId="nav-active"
                      className="absolute inset-0 rounded-full bg-black/[0.075]"
                      transition={{ type: 'spring', stiffness: 440, damping: 32 }}
                    />
                  ) : null}
                  <Icon className="relative z-10 h-[14px] w-[14px] shrink-0 text-current opacity-[0.82]" strokeWidth={1.6} aria-hidden />
                  <span className="relative z-10 hidden sm:inline">{label}</span>
                </span>
              )}
            </NavLink>
          </div>
        ))}
      </motion.nav>
    </header>
  )
}
