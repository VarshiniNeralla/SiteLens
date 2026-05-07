import { LayoutGrid, FileImage, ClipboardList, Library } from 'lucide-react'
import { motion } from 'framer-motion'
import { NavLink } from 'react-router-dom'

const tabs = [
  { to: '/', end: true, label: 'Overview', icon: LayoutGrid },
  { to: '/upload', end: false, label: 'Upload', icon: FileImage },
  { to: '/observations/new', end: false, label: 'Observation', icon: ClipboardList },
  { to: '/reports', end: false, label: 'Reports', icon: Library },
]

export function FloatingNav() {
  return (
    <header className="pointer-events-none fixed inset-x-0 top-0 z-50 flex justify-center px-4 pt-5 md:pt-7">
      <motion.nav
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: [0.25, 0.1, 0.25, 1] }}
        className="pointer-events-auto flex items-center gap-0.5 rounded-full border border-black/[0.06] bg-white/65 px-1.5 py-1.5 shadow-[0_8px_40px_-16px_rgb(0,0,0,0.22)] backdrop-blur-2xl backdrop-saturate-[1.35]"
        aria-label="Primary"
      >
        {tabs.map(({ to, end, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className="relative shrink-0 rounded-full px-0.5 py-0.5 outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/35"
          >
            {({ isActive }) => (
              <span
                className={[
                  'relative flex items-center gap-2 rounded-full px-4 py-2 text-[13px] font-medium tracking-tight transition-colors duration-150',
                  isActive ? 'text-[#111]' : 'text-[#6e6e73] hover:text-[#111]',
                ].join(' ')}
              >
                {isActive ? (
                  <motion.span
                    layoutId="nav-active"
                    className="absolute inset-0 rounded-full bg-black/[0.07]"
                    transition={{ type: 'spring', stiffness: 440, damping: 32 }}
                  />
                ) : null}
                <Icon
                  className="relative z-10 h-[15px] w-[15px] shrink-0 text-current opacity-[0.92]"
                  strokeWidth={1.75}
                  aria-hidden
                />
                <span className="relative z-10 hidden sm:inline">{label}</span>
              </span>
            )}
          </NavLink>
        ))}
      </motion.nav>
    </header>
  )
}
