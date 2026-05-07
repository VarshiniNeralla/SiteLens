export function Skeleton({ className = '' }) {
  return <div aria-hidden className={`animate-pulse rounded-xl bg-black/[0.06] ${className}`.trim()} />
}
