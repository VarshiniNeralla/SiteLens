import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ImagePlus, LoaderCircle, Sparkles, WandSparkles, FileOutput, Plus } from 'lucide-react'
import { createObservation, generateReport, uploadImage } from '../api.js'
import { FormSelect } from '../components/FormSelect.jsx'
import { ButtonPrimary, ButtonSecondary } from '../components/ui/Button.jsx'
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
})

function createDraft(id) {
  return {
    id,
    previewUrl: '',
    file: null,
    imagePath: '',
    form: emptyForm(),
    record: null,
    uploading: false,
    saving: false,
  }
}

function validate(form, imagePath) {
  const e = {}
  for (const key of ['project_name', 'tower', 'floor', 'flat', 'room', 'observation_type', 'severity']) {
    if (!String(form[key] ?? '').trim()) e[key] = 'Required'
  }
  if (!String(imagePath ?? '').trim()) e.image_path = 'Upload required'
  return e
}

function updateById(items, id, updater) {
  return items.map((i) => (i.id === id ? updater(i) : i))
}

export function WorkspacePage() {
  const inputRef = useRef(null)
  const nextId = useRef(2)
  const [items, setItems] = useState([createDraft(1)])
  const [activeId, setActiveId] = useState(1)
  const [expandedAdvanced, setExpandedAdvanced] = useState(false)
  const [globalError, setGlobalError] = useState('')
  const [fieldErrors, setFieldErrors] = useState({})
  const [reportBusy, setReportBusy] = useState(false)
  const [reportNotice, setReportNotice] = useState('')

  const active = useMemo(() => items.find((i) => i.id === activeId) ?? items[0], [items, activeId])
  const savedIds = useMemo(() => items.map((i) => i.record?.id).filter(Boolean), [items])

  useEffect(() => {
    return () => {
      for (const item of items) {
        if (item.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(item.previewUrl)
      }
    }
  }, [items])

  const patchActive = (mutator) => {
    setItems((prev) => updateById(prev, activeId, mutator))
  }

  const addDraft = () => {
    const id = nextId.current++
    setItems((prev) => [...prev, createDraft(id)])
    setActiveId(id)
    setFieldErrors({})
    setGlobalError('')
    requestAnimationFrame(() => inputRef.current?.click())
  }

  const pickForActive = () => inputRef.current?.click()

  const onFile = async (file) => {
    if (!file) return
    if (!/^image\/(jpeg|png|webp)$/i.test(file.type) && !/\.(jpe?g|png|webp)$/i.test(file.name)) {
      setGlobalError('Use JPEG, PNG, or WebP.')
      return
    }
    const previewUrl = URL.createObjectURL(file)
    patchActive((prev) => {
      if (prev.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(prev.previewUrl)
      return { ...prev, file, previewUrl, uploading: true, imagePath: '', record: null }
    })
    setGlobalError('')
    try {
      const uploaded = await uploadImage(file)
      patchActive((prev) => ({ ...prev, uploading: false, imagePath: uploaded.path }))
    } catch (e) {
      patchActive((prev) => ({ ...prev, uploading: false }))
      setGlobalError(e.message || 'Upload failed.')
    }
  }

  const submitObservation = async (generateText) => {
    if (!active) return
    const errors = validate(active.form, active.imagePath)
    setFieldErrors(errors)
    if (Object.keys(errors).length > 0) {
      setGlobalError('Complete required fields to continue.')
      return
    }
    setGlobalError('')
    patchActive((prev) => ({ ...prev, saving: true }))
    try {
      const payload = {
        ...active.form,
        site_visit_date: active.form.site_visit_date || null,
        slab_casting_date: active.form.slab_casting_date || null,
        inspection_status: active.form.inspection_status || 'Yet to be Confirmed',
        third_party_status: active.form.third_party_status || 'Yet to be Confirmed',
        image_path: active.imagePath,
        generate_text: generateText,
      }
      const res = await createObservation(payload)
      patchActive((prev) => ({ ...prev, saving: false, record: res }))
      setReportNotice(`Saved observation #${res.id}`)
    } catch (e) {
      patchActive((prev) => ({ ...prev, saving: false }))
      setGlobalError(e.message || 'Save failed.')
    }
  }

  const runReport = async () => {
    if (!savedIds.length) {
      setGlobalError('Save at least one observation first.')
      return
    }
    setReportBusy(true)
    setGlobalError('')
    setReportNotice('')
    try {
      const report = await generateReport({ observation_ids: savedIds, title: null, include_pdf: false })
      setReportNotice(`Report #${report.id} is ${report.status}. Open Reports to download.`)
    } catch (e) {
      setGlobalError(e.message || 'Report generation failed.')
    } finally {
      setReportBusy(false)
    }
  }

  return (
    <div className="mx-auto h-[calc(100vh-10.2rem)] max-h-[860px] min-h-[620px] max-w-[1320px]">
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0]
          void onFile(file)
          e.target.value = ''
        }}
      />

      <div className="grid h-full grid-cols-1 gap-4 lg:grid-cols-[1.45fr_1fr]">
        <section className="flex min-h-0 flex-col rounded-[26px] bg-white/68 p-4 ring-1 ring-black/[0.05] backdrop-blur-sm">
          <div className="mb-3 flex items-center justify-between px-1">
            <p className="text-[13px] font-medium text-[#6e6e73]">Image workspace</p>
            <div className="flex gap-2">
              <ButtonSecondary className="px-4 py-2.5 text-[13px]" onClick={pickForActive}>
                Upload
              </ButtonSecondary>
              <ButtonSecondary className="gap-1.5 px-4 py-2.5 text-[13px]" onClick={addDraft}>
                <Plus className="h-4 w-4" aria-hidden />
                Add observation
              </ButtonSecondary>
            </div>
          </div>

          <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-2xl bg-[#eaebef]">
            {active?.previewUrl ? (
              <img src={active.previewUrl} alt="" className="h-full w-full object-contain" />
            ) : (
              <button
                type="button"
                onClick={pickForActive}
                className="flex flex-col items-center text-[#6e6e73] transition hover:text-[#111]"
              >
                <ImagePlus className="h-10 w-10" />
                <span className="mt-3 text-[14px] font-medium">Drop or upload an image</span>
              </button>
            )}
            {active?.uploading ? (
              <div className="absolute right-3 top-3 inline-flex items-center gap-2 rounded-full bg-white/85 px-3 py-1.5 text-[12px] text-[#111] ring-1 ring-black/[0.06]">
                <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                Uploading
              </div>
            ) : null}
          </div>

          <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setActiveId(item.id)
                  setFieldErrors({})
                }}
                className={[
                  'relative h-16 w-24 shrink-0 overflow-hidden rounded-xl ring-1 transition',
                  item.id === activeId ? 'ring-[#0071e3]/45' : 'ring-black/[0.08] hover:ring-black/[0.18]',
                ].join(' ')}
              >
                {item.previewUrl ? (
                  <img src={item.previewUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <span className="flex h-full w-full items-center justify-center bg-[#f1f2f5] text-[11px] text-[#6e6e73]">
                    Empty
                  </span>
                )}
                {item.record?.id ? (
                  <span className="absolute bottom-1 right-1 rounded-full bg-black/75 px-1.5 py-0.5 text-[10px] text-white">
                    #{item.record.id}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        </section>

        <section className="relative flex min-h-0 flex-col rounded-[26px] bg-white/72 p-4 ring-1 ring-black/[0.05] backdrop-blur-sm">
          <div className="mb-2 px-1">
            <h2 className="text-[18px] font-semibold tracking-tight text-[#111]">Capture details</h2>
            <p className="mt-1 text-[12px] text-[#6e6e73]">Core fields first. Advanced fields only when needed.</p>
          </div>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1 pb-24">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <FormSelect id="project_name" label="Project" value={active?.form.project_name ?? ''} onChange={(v) => patchActive((p) => ({ ...p, form: { ...p.form, project_name: v } }))} options={PROJECT_NAMES} placeholder="Select" error={fieldErrors.project_name} />
              <FormSelect id="tower" label="Tower" value={active?.form.tower ?? ''} onChange={(v) => patchActive((p) => ({ ...p, form: { ...p.form, tower: v } }))} options={TOWERS} placeholder="Select" error={fieldErrors.tower} />
              <FormSelect id="floor" label="Floor" value={active?.form.floor ?? ''} onChange={(v) => patchActive((p) => ({ ...p, form: { ...p.form, floor: v } }))} options={FLOORS} placeholder="Select" error={fieldErrors.floor} />
              <FormSelect id="flat" label="Flat" value={active?.form.flat ?? ''} onChange={(v) => patchActive((p) => ({ ...p, form: { ...p.form, flat: v } }))} options={FLATS} placeholder="Select" error={fieldErrors.flat} />
              <FormSelect id="room" label="Room" value={active?.form.room ?? ''} onChange={(v) => patchActive((p) => ({ ...p, form: { ...p.form, room: v } }))} options={ROOMS} placeholder="Select" error={fieldErrors.room} className="sm:col-span-2" />
              <FormSelect id="observation_type" label="Observation type" value={active?.form.observation_type ?? ''} onChange={(v) => patchActive((p) => ({ ...p, form: { ...p.form, observation_type: v } }))} options={OBSERVATION_TYPES} placeholder="Select" error={fieldErrors.observation_type} />
              <FormSelect id="severity" label="Severity" value={active?.form.severity ?? ''} onChange={(v) => patchActive((p) => ({ ...p, form: { ...p.form, severity: v } }))} options={SEVERITIES} placeholder="Select" error={fieldErrors.severity} />
            </div>

            <button
              type="button"
              onClick={() => setExpandedAdvanced((v) => !v)}
              className="inline-flex items-center gap-2 text-[13px] font-medium text-[#0071e3] hover:opacity-80"
            >
              <Sparkles className="h-4 w-4" />
              {expandedAdvanced ? 'Hide advanced details' : 'Show advanced details'}
            </button>

            <AnimatePresence initial={false}>
              {expandedAdvanced ? (
                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 4 }}
                  className="grid grid-cols-1 gap-3 sm:grid-cols-2"
                >
                  <label className="block">
                    <span className="mb-1.5 block text-[13px] font-medium text-[#6e6e73]">Site visit date</span>
                    <input
                      type="date"
                      value={active?.form.site_visit_date ?? ''}
                      onChange={(e) => patchActive((p) => ({ ...p, form: { ...p.form, site_visit_date: e.target.value } }))}
                      className="w-full rounded-2xl border border-black/[0.06] bg-white/85 px-3 py-3 text-[14px] outline-none focus:ring-2 focus:ring-[#0071e3]/20"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-[13px] font-medium text-[#6e6e73]">Slab casting date</span>
                    <input
                      type="date"
                      value={active?.form.slab_casting_date ?? ''}
                      onChange={(e) => patchActive((p) => ({ ...p, form: { ...p.form, slab_casting_date: e.target.value } }))}
                      className="w-full rounded-2xl border border-black/[0.06] bg-white/85 px-3 py-3 text-[14px] outline-none focus:ring-2 focus:ring-[#0071e3]/20"
                    />
                  </label>
                  <FormSelect id="inspection_status" label="Inspection status" value={active?.form.inspection_status ?? ''} onChange={(v) => patchActive((p) => ({ ...p, form: { ...p.form, inspection_status: v } }))} options={INSPECTION_STATUSES} placeholder="Optional" />
                  <FormSelect id="third_party_status" label="3rd-party status" value={active?.form.third_party_status ?? ''} onChange={(v) => patchActive((p) => ({ ...p, form: { ...p.form, third_party_status: v } }))} options={THIRD_PARTY_INSPECTION_STATUSES} placeholder="Optional" />
                </motion.div>
              ) : null}
            </AnimatePresence>

            <div className="rounded-2xl bg-black/[0.025] p-4">
              <p className="text-[12px] uppercase tracking-[0.08em] text-[#6e6e73]">AI draft preview</p>
              {active?.record ? (
                <div className="mt-3 space-y-3 text-[13px] text-[#6e6e73]">
                  <p className="line-clamp-4 whitespace-pre-wrap">{active.record.generated_observation || '—'}</p>
                  <div className="h-px bg-black/[0.07]" />
                  <p className="line-clamp-4 whitespace-pre-wrap">{active.record.generated_recommendation || '—'}</p>
                </div>
              ) : (
                <p className="mt-2 text-[13px] text-[#6e6e73]">Draft appears after “Generate draft”.</p>
              )}
            </div>
          </div>

          <div className="pointer-events-none absolute inset-x-4 bottom-4">
            <div className="pointer-events-auto rounded-2xl border border-black/[0.06] bg-white/90 p-2 shadow-[0_10px_30px_-18px_rgb(0,0,0,0.3)] backdrop-blur-xl">
              <div className="grid grid-cols-3 gap-2">
                <ButtonSecondary className="gap-1.5 px-3 py-2.5 text-[13px]" onClick={() => void submitObservation(false)}>
                  Save
                </ButtonSecondary>
                <ButtonSecondary className="gap-1.5 px-3 py-2.5 text-[13px]" onClick={() => void submitObservation(true)}>
                  <WandSparkles className="h-4 w-4" />
                  Draft
                </ButtonSecondary>
                <ButtonPrimary className="gap-1.5 px-3 py-2.5 text-[13px]" onClick={runReport} disabled={reportBusy}>
                  {reportBusy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <FileOutput className="h-4 w-4" />}
                  Report
                </ButtonPrimary>
              </div>
            </div>
          </div>
        </section>
      </div>

      <AnimatePresence>
        {globalError ? (
          <motion.p
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full bg-red-500/95 px-4 py-2 text-[12px] font-medium text-white shadow-lg"
          >
            {globalError}
          </motion.p>
        ) : null}
      </AnimatePresence>
      <AnimatePresence>
        {reportNotice ? (
          <motion.p
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full bg-[#111]/95 px-4 py-2 text-[12px] font-medium text-white shadow-lg"
          >
            {reportNotice}
          </motion.p>
        ) : null}
      </AnimatePresence>
    </div>
  )
}
