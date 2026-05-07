import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'

const tap = { scale: 0.985 }

/** Shared primary control surface (pill, dark fill). Use with `<Link>` via `PrimaryLink`. */
export const primarySurfaceClass =
  'inline-flex cursor-pointer items-center justify-center rounded-2xl px-6 py-2.5 text-[14px] font-medium tracking-tight ' +
  'bg-[#111] text-white transition-[opacity,box-shadow,background-color] duration-200 ' +
  'hover:bg-[#1b1b1d] hover:shadow-[0_10px_30px_-18px_rgb(0,0,0,0.42)] ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/35 focus-visible:ring-offset-2 focus-visible:ring-offset-[#f5f5f7]'

export const secondarySurfaceClass =
  'inline-flex cursor-pointer items-center justify-center rounded-2xl border border-black/[0.08] px-5 py-2.5 ' +
  'bg-white/60 text-[14px] font-medium tracking-tight text-[#111] backdrop-blur-sm ' +
  'transition-[background-color,box-shadow] hover:bg-white/90 hover:shadow-[0_8px_24px_-20px_rgb(0,0,0,0.35)] ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30 focus-visible:ring-offset-2 focus-visible:ring-offset-[#f5f5f7]'

/** Primary — near-black pill */
export function ButtonPrimary({
  children,
  className = '',
  disabled,
  type = 'button',
  form,
  onClick,
}) {
  return (
    <motion.button
      type={type}
      form={form}
      disabled={disabled}
      onClick={onClick}
      whileTap={disabled ? undefined : tap}
      transition={{ duration: 0.15 }}
      className={[primarySurfaceClass, 'disabled:pointer-events-none disabled:opacity-[0.38]', className].join(' ')}
    >
      {children}
    </motion.button>
  )
}

const MotionLink = motion.create(Link)

/** Same look as primary, for in-app navigation. */
export function PrimaryLink({ to, children, className = '' }) {
  return (
    <MotionLink
      to={to}
      whileTap={tap}
      transition={{ duration: 0.15 }}
      className={[primarySurfaceClass, className].join(' ')}
    >
      {children}
    </MotionLink>
  )
}

/** Secondary — translucent edge */
export function SecondaryLink({ to, children, className = '' }) {
  return (
    <MotionLink
      to={to}
      whileTap={tap}
      transition={{ duration: 0.15 }}
      className={[secondarySurfaceClass, className].join(' ')}
    >
      {children}
    </MotionLink>
  )
}

export function ButtonSecondary({ children, className = '', type = 'button', onClick }) {
  return (
    <motion.button
      type={type}
      onClick={onClick}
      whileTap={tap}
      transition={{ duration: 0.15 }}
      className={[secondarySurfaceClass, className].join(' ')}
    >
      {children}
    </motion.button>
  )
}
