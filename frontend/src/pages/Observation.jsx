import { useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronRight } from 'lucide-react'
import { createObservation } from '../api.js'
import { FormSelect } from '../components/FormSelect.jsx'
import { ButtonPrimary } from '../components/ui/Button.jsx'
import {
  FLOORS,
  FLATS,
  INSPECTION_STATUSES,
  OBSERVATION_TYPES,
  PROJECT_NAMES,
  ROOMS,
  SEVERITIES,
  THIRD_PARTY_INSPECTION_STATUSES,
  TOWERS,
} from '../constants/observationFormOptions.js'

const emptyForm = () => ({
  project_name: '',
  tower: '',
  floor: '',
  flat: '',
  room: '',
  observation_type: '',
  severity: '',
  site_visit_date: '',
  slab_casting_date: '',
  inspection_status: '',
  third_party_status: '',
  generate_text: true,
})

function validateObservationForm(form, imagePathTrimmed) {
  const e = {}
  const need = [
    ['project_name', 'Select a project.'],
    ['tower', 'Select a tower.'],
    ['floor', 'Select a floor.'],
    ['flat', 'Select a flat / unit.'],
    ['room', 'Select a room.'],
    ['observation_type', 'Select an observation type.'],
    ['severity', 'Select a severity.'],
    ['inspection_status', 'Select an inspection status.'],
    ['third_party_status', 'Select a third-party inspection status.'],
  ]
  for (const [key, msg] of need) {
    if (!String(form[key] ?? '').trim()) e[key] = msg
  }
  if (!imagePathTrimmed) {
    e.image_path = 'Upload a photo first or paste the server path.'
  }
  return e
}

const inputBase =
  'mt-1.5 w-full rounded-2xl border bg-white/80 px-4 py-3 text-[15px] text-[#111] shadow-[0_1px_0_rgb(0,0,0,0.02)] outline-none transition-[box-shadow,background-color,border-color] duration-200 focus:bg-white focus:ring-2 focus:ring-[#0071e3]/22'

export function ObservationPage() {
  const location = useLocation()
  const incomingPath = location.state?.imagePath ?? ''
  const previewUrl = location.state?.previewUrl ?? ''
  const cloudinaryIncoming = location.state?.cloudinary ?? null

  const [form, setForm] = useState(emptyForm())
  const [imagePath, setImagePath] = useState(() => incomingPath)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [record, setRecord] = useState(null)
  const [fieldErrors, setFieldErrors] = useState({})

  const imageTrimmed = useMemo(() => imagePath.trim(), [imagePath])

  const patch = (key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }))
    setFieldErrors((prev) => {
      if (!(key in prev)) return prev
      const next = { ...prev }
      delete next[key]
      return next
    })
  }

  const onImageChange = (v) => {
    setImagePath(v)
    setFieldErrors((prev) => {
      if (!prev.image_path) return prev
      const next = { ...prev }
      delete next.image_path
      return next
    })
  }

  const formValidSilent = useMemo(
    () => Object.keys(validateObservationForm(form, imageTrimmed)).length === 0,
    [form, imageTrimmed],
  )

  const submit = async (ev) => {
    ev.preventDefault()
    const nextErrors = validateObservationForm(form, imageTrimmed)
    setFieldErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) {
      setError('Complete the highlighted fields.')
      return
    }

    setBusy(true)
    setError('')
    try {
      const payload = {
        project_name: form.project_name,
        tower: form.tower,
        floor: form.floor,
        flat: form.flat,
        room: form.room,
        observation_type: form.observation_type,
        severity: form.severity,
        site_visit_date: form.site_visit_date || null,
        slab_casting_date: form.slab_casting_date || null,
        inspection_status: form.inspection_status,
        third_party_status: form.third_party_status,
        image_path: imageTrimmed,
        manually_written_observation: '',
        cloudinary_public_id: cloudinaryIncoming?.public_id ?? null,
        cloudinary_secure_url: cloudinaryIncoming?.secure_url ?? (imageTrimmed.startsWith('http') ? imageTrimmed : null),
        image_uploaded_at: cloudinaryIncoming?.uploaded_at ?? null,
        image_original_filename: cloudinaryIncoming?.original_filename ?? null,
        generate_text: form.generate_text,
      }
      const resp = await createObservation(payload)
      setRecord(resp)
      setFieldErrors({})
    } catch (err) {
      setError(err.message || 'Could not save observation')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="relative mx-auto max-w-5xl pb-28">
      <div className="mb-10 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-[clamp(1.45rem,2.5vw,1.75rem)] font-semibold tracking-[-0.02em] text-[#111]">
            Observation
          </h2>
          <p className="mt-2 max-w-xl text-[15px] leading-relaxed text-[#6e6e73]">
            Structured fields only — open details when you need dates or inspection status.
          </p>
        </div>
        <Link
          to="/upload"
          className="group mt-1 inline-flex items-center gap-0.5 text-[14px] font-medium text-[#0071e3] transition-opacity hover:opacity-80"
        >
          New photo
          <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" strokeWidth={2} aria-hidden />
        </Link>
      </div>

      <motion.section
        layout
        className="overflow-hidden rounded-[28px] bg-[#e8e8ed] ring-1 ring-black/[0.04]"
      >
        <div className="flex aspect-[16/10] max-h-[min(52vh,440px)] w-full items-center justify-center md:aspect-[21/9] md:max-h-[min(48vh,400px)]">
          {previewUrl || (imageTrimmed && imageTrimmed.startsWith('http')) ? (
            <img
              src={previewUrl || imageTrimmed}
              alt="Site reference"
              loading="eager"
              decoding="async"
              className="h-full w-full object-contain"
            />
          ) : (
            <p className="px-8 text-center text-[15px] text-[#6e6e73]">
              Upload a photo first — preview shows here for this session.
            </p>
          )}
        </div>
      </motion.section>

      <form id="observation-form" onSubmit={submit} noValidate className="mt-14 space-y-12">
        <div className="space-y-2">
          <label className="text-[13px] font-medium text-[#6e6e73]" htmlFor="image_path">
            Image URL or server path
          </label>
          <input
            id="image_path"
            title="Cloudinary HTTPS URL or upload path returned after upload"
            value={imagePath}
            placeholder="Optimized Cloud URL or uploads/… path"
            onChange={(e) => onImageChange(e.target.value)}
            className={[
              inputBase,
              fieldErrors.image_path ? 'border-red-300 focus:border-red-400/90 focus:ring-red-200/85' : 'border-black/[0.06]',
            ].join(' ')}
          />
          {fieldErrors.image_path ? (
            <p className="text-[12px] font-medium text-red-600/95">{fieldErrors.image_path}</p>
          ) : null}
        </div>

        <div className="grid grid-cols-1 gap-x-8 gap-y-8 md:grid-cols-2">
          <FormSelect
            id="project_name"
            label="Project"
            value={form.project_name}
            onChange={(v) => patch('project_name', v)}
            placeholder="Select"
            options={PROJECT_NAMES}
            required
            error={fieldErrors.project_name}
          />
          <FormSelect
            id="tower"
            label="Tower"
            value={form.tower}
            onChange={(v) => patch('tower', v)}
            placeholder="Select"
            options={TOWERS}
            required
            error={fieldErrors.tower}
          />
          <FormSelect
            id="floor"
            label="Floor"
            value={form.floor}
            onChange={(v) => patch('floor', v)}
            placeholder="Select"
            options={FLOORS}
            required
            error={fieldErrors.floor}
          />
          <FormSelect
            id="flat"
            label="Flat / unit"
            value={form.flat}
            onChange={(v) => patch('flat', v)}
            placeholder="Select"
            options={FLATS}
            required
            error={fieldErrors.flat}
          />
          <FormSelect
            id="room"
            label="Room"
            value={form.room}
            onChange={(v) => patch('room', v)}
            placeholder="Select"
            options={ROOMS}
            required
            error={fieldErrors.room}
            className="md:col-span-2"
          />
          <FormSelect
            id="observation_type"
            label="Type"
            value={form.observation_type}
            onChange={(v) => patch('observation_type', v)}
            placeholder="Select"
            options={OBSERVATION_TYPES}
            required
            error={fieldErrors.observation_type}
          />
          <FormSelect
            id="severity"
            label="Severity"
            value={form.severity}
            onChange={(v) => patch('severity', v)}
            placeholder="Select"
            options={SEVERITIES}
            required
            error={fieldErrors.severity}
          />
        </div>

        <details className="group rounded-2xl bg-white/50 ring-1 ring-black/[0.05] open:bg-white/80 open:shadow-[0_12px_40px_-32px_rgb(0,0,0,0.2)]">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 text-[15px] font-medium text-[#111] outline-none marker:content-none [&::-webkit-details-marker]:hidden">
            <span>Schedule & inspections</span>
            <span className="text-[13px] font-normal text-[#6e6e73]">
              <span className="group-open:hidden">Show</span>
              <span className="hidden group-open:inline">Hide</span>
            </span>
          </summary>
          <div className="space-y-8 border-t border-black/[0.05] px-5 pb-6 pt-6">
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
              <div>
                <label className="text-[13px] font-medium text-[#6e6e73]" htmlFor="site_visit_date">
                  Site visit
                </label>
                <input
                  id="site_visit_date"
                  type="date"
                  className={`${inputBase} border-black/[0.06]`}
                  value={form.site_visit_date}
                  onChange={(e) => patch('site_visit_date', e.target.value)}
                />
              </div>
              <div>
                <label className="text-[13px] font-medium text-[#6e6e73]" htmlFor="slab_date">
                  Slab casting
                </label>
                <input
                  id="slab_date"
                  type="date"
                  className={`${inputBase} border-black/[0.06]`}
                  value={form.slab_casting_date}
                  onChange={(e) => patch('slab_casting_date', e.target.value)}
                />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              <FormSelect
                id="inspection_status"
                label="Inspection status"
                value={form.inspection_status}
                onChange={(v) => patch('inspection_status', v)}
                placeholder="Select"
                options={INSPECTION_STATUSES}
                required
                error={fieldErrors.inspection_status}
              />
              <FormSelect
                id="third_party_status"
                label="Third-party status"
                value={form.third_party_status}
                onChange={(v) => patch('third_party_status', v)}
                placeholder="Select"
                options={THIRD_PARTY_INSPECTION_STATUSES}
                required
                error={fieldErrors.third_party_status}
              />
            </div>
          </div>
        </details>

        <label className="flex cursor-pointer items-start gap-3 rounded-2xl bg-black/[0.025] px-4 py-4">
          <input
            type="checkbox"
            className="mt-1 h-[18px] w-[18px] shrink-0 rounded-md border-[#d2d2d7] text-[#0071e3] focus:ring-[#0071e3]/30"
            checked={form.generate_text}
            onChange={(chk) => patch('generate_text', chk.target.checked)}
          />
          <span className="text-[14px] leading-relaxed text-[#6e6e73]">
            Draft observation & recommendation copy with the model — fields above are passed exactly as chosen.
          </span>
        </label>

        <AnimatePresence>
          {error ? (
            <motion.p
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              role="alert"
              className="text-center text-[14px] font-medium text-red-600/95"
            >
              {error}
            </motion.p>
          ) : null}
        </AnimatePresence>
      </form>

      <section className="mt-16 space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[12px] font-medium uppercase tracking-[0.1em] text-[#6e6e73]/90">Draft</p>
            <h3 className="mt-1 text-[1.1rem] font-semibold tracking-tight text-[#111]">After you save</h3>
          </div>
          <Link to="/reports" className="text-[14px] font-medium text-[#0071e3] hover:opacity-80">
            Open reports
          </Link>
        </div>

        {record ? (
          <div className="space-y-8 rounded-[24px] bg-gradient-to-b from-white/90 to-white/40 px-6 py-8 ring-1 ring-black/[0.05] md:px-10">
            <div>
              <p className="text-[12px] font-medium text-[#6e6e73]">Observation ID</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight text-[#111]">{record.id}</p>
            </div>
            <div className="space-y-3">
              <h4 className="text-[15px] font-medium text-[#111]">Observation</h4>
              <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-[#6e6e73]">
                {record.generated_observation || '—'}
              </p>
            </div>
            <div className="h-px w-full bg-black/[0.06]" />
            <div className="space-y-3">
              <h4 className="text-[15px] font-medium text-[#111]">Recommendation</h4>
              <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-[#6e6e73]">
                {record.generated_recommendation || '—'}
              </p>
            </div>
          </div>
        ) : (
          <p className="text-[15px] leading-relaxed text-[#6e6e73]">
            Generated text appears here once the record is saved — no extra panels, just context.
          </p>
        )}
      </section>

      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-6 md:pb-8">
        <div className="pointer-events-auto flex max-w-lg flex-col items-center gap-3 rounded-full border border-black/[0.07] bg-white/72 px-4 py-3 shadow-[0_12px_48px_-24px_rgb(0,0,0,0.28)] backdrop-blur-xl backdrop-saturate-150 sm:flex-row sm:px-6">
          <p className="hidden text-[13px] text-[#6e6e73] sm:inline">
            {formValidSilent ? 'Ready when you are' : 'Finish required fields'}
          </p>
          <ButtonPrimary type="submit" form="observation-form" disabled={busy} className="w-full px-10 sm:w-auto">
            {busy ? 'Saving…' : 'Save observation'}
          </ButtonPrimary>
        </div>
      </div>
    </div>
  )
}
