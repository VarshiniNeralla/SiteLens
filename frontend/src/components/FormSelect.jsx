import { ChevronDown } from 'lucide-react'

export function FormSelect({
  id,
  label,
  value,
  onChange,
  options,
  required,
  placeholder,
  error,
  className = '',
}) {
  return (
    <label htmlFor={id} className={`block ${className}`.trim()}>
      <span className="mb-1.5 block text-[13px] font-medium tracking-tight text-[#6e6e73]">{label}</span>
      <div className="relative">
        <select
          id={id}
          name={id}
          value={value}
          required={required}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={error ? true : undefined}
          className={[
            'w-full appearance-none rounded-2xl border bg-[#f7f7f9] px-4 py-3 pr-10 text-[14px] font-normal text-[#111]',
            'shadow-[inset_0_1px_1px_rgb(255,255,255,0.75),0_1px_0_rgb(0,0,0,0.02)] outline-none transition-[box-shadow,background-color,border-color] duration-200',
            'focus:bg-white focus:ring-2 focus:ring-[#0071e3]/22',
            error
              ? 'border-red-300/90 focus:border-red-400/80 focus:ring-red-200/80'
              : 'border-black/[0.06] focus:border-[#0071e3]/38',
          ].join(' ')}
        >
          {placeholder ? (
            <option value="" disabled>
              {placeholder}
            </option>
          ) : null}
          {options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
        <ChevronDown
          className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#6e6e73]/80"
          strokeWidth={1.75}
          aria-hidden
        />
      </div>
      {error ? <p className="mt-1.5 text-[12px] font-medium text-red-600/95">{error}</p> : null}
    </label>
  )
}
