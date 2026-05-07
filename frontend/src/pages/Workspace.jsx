import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ImageUp, LoaderCircle, Presentation, Plus, ChevronDown, ChevronUp, Save, ChevronLeft, ChevronRight } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
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

const REQUIRED_KEYS = ['project_name', 'tower', 'floor', 'flat', 'room', 'observation_type', 'severity']
const TOAST_TIMEOUT_MS = 2000
const REPORT_READY_TOAST_TIMEOUT_MS = 7000

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
    localUrl: '',
    file: null,
    imagePath: '',
    form: emptyForm(),
    record: null,
    aiDraft: null,
    uploading: false,
    saving: false,
    dirty: false,
  }
}

function hasCoreMetadata(form) {
  return REQUIRED_KEYS.every((key) => Boolean(String(form[key] ?? '').trim()))
}

function validate(form, imagePath) {
  const e = {}
  for (const key of REQUIRED_KEYS) {
    if (!String(form[key] ?? '').trim()) e[key] = 'Required'
  }
  if (!String(imagePath ?? '').trim()) e.image_path = 'Photo required'
  return e
}

function updateById(items, id, updater) {
  return items.map((i) => (i.id === id ? updater(i) : i))
}

function toStaticImageSrc(imagePath) {
  if (!imagePath) return ''
  if (imagePath.startsWith('/')) return imagePath
  if (imagePath.startsWith('http://') || imagePath.startsWith('https://') || imagePath.startsWith('blob:')) return imagePath
  return `/static/${imagePath.replace(/^\/+/, '')}`
}

export function WorkspacePage() {
  const navigate = useNavigate()
  const inputRef = useRef(null)
  const detailsPanelRef = useRef(null)
  const pendingUploadForId = useRef(1)
  const localUrlRegistry = useRef(new Set())
  const nextId = useRef(2)
  const [items, setItems] = useState([createDraft(1)])
  const [activeId, setActiveId] = useState(1)
  const [expandedAdvanced, setExpandedAdvanced] = useState(false)
  const [globalError, setGlobalError] = useState('')
  const [fieldErrors, setFieldErrors] = useState({})
  const [reportBusy, setReportBusy] = useState(false)
  const [reportNotice, setReportNotice] = useState('')
  const [reportReadyToast, setReportReadyToast] = useState(null)
  const [showDraftReveal, setShowDraftReveal] = useState(false)
  const [imageLoadState, setImageLoadState] = useState({})

  const active = useMemo(() => items.find((i) => i.id === activeId) ?? items[0], [items, activeId])
  const activePreviewSrc = useMemo(() => (active ? active.localUrl || toStaticImageSrc(active.imagePath) : ''), [active])
  const savedIds = useMemo(() => items.map((i) => i.record?.id).filter(Boolean), [items])
  const enrichedItems = useMemo(
    () =>
      items.map((item) => {
        const hasImage = Boolean(item.localUrl || item.imagePath)
        const completed = Boolean(item.record?.id && hasImage && hasCoreMetadata(item.form))
        return {
          ...item,
          previewSrc: item.localUrl || toStaticImageSrc(item.imagePath),
          completed,
          pending: hasImage && !completed,
        }
      }),
    [items],
  )
  const allCompleted = useMemo(
    () => enrichedItems.length > 0 && enrichedItems.every((item) => item.completed),
    [enrichedItems],
  )
  const activeIndex = useMemo(() => enrichedItems.findIndex((item) => item.id === activeId), [enrichedItems, activeId])
  const hasPrevious = activeIndex > 0
  const hasNext = activeIndex >= 0 && activeIndex < enrichedItems.length - 1

  useEffect(() => {
    const registry = localUrlRegistry.current
    return () => {
      for (const url of registry) URL.revokeObjectURL(url)
      registry.clear()
    }
  }, [])

  useEffect(() => {
    if (!globalError) return undefined
    const id = setTimeout(() => setGlobalError(''), TOAST_TIMEOUT_MS)
    return () => clearTimeout(id)
  }, [globalError])

  useEffect(() => {
    if (!reportNotice) return undefined
    const id = setTimeout(() => setReportNotice(''), TOAST_TIMEOUT_MS)
    return () => clearTimeout(id)
  }, [reportNotice])

  useEffect(() => {
    if (!reportReadyToast) return undefined
    const id = setTimeout(() => setReportReadyToast(null), REPORT_READY_TOAST_TIMEOUT_MS)
    return () => clearTimeout(id)
  }, [reportReadyToast])

  const patchById = (id, mutator) => {
    setItems((prev) => updateById(prev, id, mutator))
  }

  const patchActive = (mutator) => {
    if (!activeId) return
    patchById(activeId, mutator)
  }

  const focusObservationForm = () => {
    requestAnimationFrame(() => {
      const target = detailsPanelRef.current?.querySelector('#project_name')
      if (target instanceof HTMLElement) target.focus()
    })
  }

  const setActiveAndFocus = (targetId) => {
    setActiveId(targetId)
    setFieldErrors({})
    focusObservationForm()
  }

  const pickFor = (id) => {
    pendingUploadForId.current = id
    inputRef.current?.click()
  }

  const addDraft = () => {
    const id = nextId.current++
    setItems((prev) => [...prev, createDraft(id)])
    setActiveId(id)
    setFieldErrors({})
    setGlobalError('')
    requestAnimationFrame(() => pickFor(id))
  }

  const pickForActive = () => {
    if (!activeId) return
    pickFor(activeId)
  }

  const goToPreviousImage = () => {
    if (!hasPrevious) return
    const prevItem = enrichedItems[activeIndex - 1]
    if (!prevItem) return
    setActiveAndFocus(prevItem.id)
  }

  const goToNextImage = () => {
    if (!hasNext) return
    const nextItem = enrichedItems[activeIndex + 1]
    if (!nextItem) return
    setActiveAndFocus(nextItem.id)
  }

  const onFile = async (file, targetId) => {
    if (!file || !targetId) return
    if (!/^image\/(jpeg|png|webp)$/i.test(file.type) && !/\.(jpe?g|png|webp)$/i.test(file.name)) {
      setGlobalError('Use JPEG, PNG, or WebP.')
      return
    }
    const localUrl = URL.createObjectURL(file)
    localUrlRegistry.current.add(localUrl)
    patchById(targetId, (prev) => {
      if (prev.localUrl?.startsWith('blob:')) {
        URL.revokeObjectURL(prev.localUrl)
        localUrlRegistry.current.delete(prev.localUrl)
      }
      return {
        ...prev,
        file,
        localUrl,
        imagePath: '',
        record: null,
        aiDraft: null,
        dirty: true,
        uploading: true,
      }
    })
    setActiveId(targetId)
    setGlobalError('')
    try {
      const uploaded = await uploadImage(file)
      patchById(targetId, (prev) => ({ ...prev, uploading: false, imagePath: uploaded.path || '' }))
    } catch (e) {
      patchById(targetId, (prev) => ({ ...prev, uploading: false }))
      setGlobalError(e.message || 'Upload failed.')
    }
  }

  const jumpToNextIncomplete = (fromId) => {
    const start = enrichedItems.findIndex((i) => i.id === fromId)
    const ordered = start >= 0 ? [...enrichedItems.slice(start + 1), ...enrichedItems.slice(0, start + 1)] : enrichedItems
    const next = ordered.find((i) => i.id !== fromId && (!i.record?.id || !hasCoreMetadata(i.form)))
    if (next) setActiveAndFocus(next.id)
    else setReportNotice('All observations completed.')
  }

  const submitObservation = async () => {
    if (!active || !activeId) return
    const targetId = activeId
    const snapshot = items.find((i) => i.id === targetId)
    if (!snapshot) return
    const errors = validate(snapshot.form, snapshot.imagePath)
    setFieldErrors(errors)
    if (Object.keys(errors).length > 0) {
      setGlobalError('Complete required fields to continue.')
      return
    }
    setGlobalError('')
    patchById(targetId, (prev) => ({ ...prev, saving: true }))
    try {
      const payload = {
        ...snapshot.form,
        site_visit_date: snapshot.form.site_visit_date || null,
        slab_casting_date: snapshot.form.slab_casting_date || null,
        inspection_status: snapshot.form.inspection_status || 'Yet to be Confirmed',
        third_party_status: snapshot.form.third_party_status || 'Yet to be Confirmed',
        image_path: snapshot.imagePath,
        generate_text: true,
      }
      const res = await createObservation(payload)
      patchById(targetId, (prev) => ({
        ...prev,
        saving: false,
        record: res,
        dirty: false,
        aiDraft: {
          observation: res.generated_observation || '',
          recommendation: res.generated_recommendation || '',
        },
      }))
      setShowDraftReveal(true)
      setTimeout(() => setShowDraftReveal(false), 1200)
      setReportNotice(`Observation #${res.id} saved. Continue to next image.`)
      jumpToNextIncomplete(targetId)
    } catch (e) {
      patchById(targetId, (prev) => ({ ...prev, saving: false }))
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
    setReportReadyToast(null)
    try {
      const report = await generateReport({ observation_ids: savedIds, title: null, include_pdf: false })
      setReportReadyToast({
        id: report.id,
        message: 'Report generated successfully.',
      })
    } catch (e) {
      setGlobalError(e.message || 'Report generation failed.')
    } finally {
      setReportBusy(false)
    }
  }

  const activeImageState = imageLoadState[activeId]
  const isImageLoading =
    Boolean(activePreviewSrc) &&
    (!activeImageState || activeImageState.src !== activePreviewSrc || activeImageState.loading)
  const isImageBroken =
    Boolean(activePreviewSrc) &&
    Boolean(activeImageState && activeImageState.src === activePreviewSrc && activeImageState.broken)

  return (
    <div className="mx-auto h-[calc(100vh-10.2rem)] max-h-[860px] min-h-[620px] max-w-[1320px]">
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0]
          const targetId = pendingUploadForId.current || activeId
          pendingUploadForId.current = activeId
          void onFile(file, targetId)
          e.target.value = ''
        }}
      />

      <div className="grid h-full grid-cols-1 gap-4 lg:grid-cols-[1.45fr_1fr]">
        <section className="flex min-h-0 flex-col rounded-[26px] bg-white/66 p-4 ring-1 ring-black/[0.05] backdrop-blur-sm">
          <div className="mb-3 flex items-center justify-between px-1">
            <p className="text-[13px] font-medium text-[#6e6e73]">Image workspace</p>
            <div className="flex gap-2">
              <ButtonSecondary className="gap-1.5 px-4 py-2.5 text-[13px]" onClick={pickForActive}>
                <ImageUp className="h-3.5 w-3.5 opacity-75" />
                Add Photos
              </ButtonSecondary>
              <ButtonSecondary className="gap-1.5 px-4 py-2.5 text-[13px]" onClick={addDraft}>
                <Plus className="h-3.5 w-3.5 opacity-75" aria-hidden />
                Add More Photos
              </ButtonSecondary>
            </div>
          </div>

          <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-2xl bg-[radial-gradient(circle_at_20%_12%,rgba(255,255,255,0.75),transparent_44%),radial-gradient(circle_at_86%_88%,rgba(216,220,229,0.72),transparent_42%),#eaebef]">
            {activePreviewSrc ? (
              <>
                <AnimatePresence mode="wait" initial={false}>
                  <motion.img
                    key={`${activeId}:${activePreviewSrc}`}
                    src={activePreviewSrc}
                    alt=""
                    initial={{ opacity: 0.35 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0.2 }}
                    transition={{ duration: 0.22 }}
                    className="h-full w-full object-contain"
                    onLoad={() =>
                      setImageLoadState((prev) => ({
                        ...prev,
                        [activeId]: { src: activePreviewSrc, loading: false, broken: false },
                      }))
                    }
                    onError={() =>
                      setImageLoadState((prev) => ({
                        ...prev,
                        [activeId]: { src: activePreviewSrc, loading: false, broken: true },
                      }))
                    }
                  />
                </AnimatePresence>
                {isImageLoading ? (
                  <div className="pointer-events-none absolute inset-0 animate-pulse bg-[linear-gradient(140deg,rgba(255,255,255,0.3),rgba(255,255,255,0.08),rgba(255,255,255,0.24))]" />
                ) : null}
                {isImageBroken ? (
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                    <div className="rounded-2xl bg-white/85 px-4 py-2 text-[13px] font-medium text-[#6e6e73] ring-1 ring-black/[0.05]">
                      Preview unavailable. Re-upload this image.
                    </div>
                  </div>
                ) : null}
              </>
            ) : (
              <button
                type="button"
                onClick={pickForActive}
                className="flex flex-col items-center text-[#6e6e73] transition hover:text-[#111] hover:scale-[1.01]"
              >
                <ImageUp className="h-10 w-10 stroke-[1.6]" />
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

          <div className="mt-3 flex gap-2 overflow-x-auto rounded-2xl bg-white/45 p-2 ring-1 ring-black/[0.04]">
            {enrichedItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setActiveAndFocus(item.id)
                }}
                className={[
                  'relative h-16 w-24 shrink-0 overflow-hidden rounded-xl ring-1 transition-all duration-200',
                  item.id === activeId
                    ? 'scale-[1.02] ring-black/[0.18]'
                    : 'ring-black/[0.08] hover:-translate-y-0.5 hover:ring-black/[0.18]',
                ].join(' ')}
              >
                {item.previewSrc ? (
                  <img src={item.previewSrc} alt="" className="h-full w-full object-cover" />
                ) : (
                  <span className="flex h-full w-full items-center justify-center bg-[#f1f2f5] text-[11px] text-[#6e6e73]">
                    No image
                  </span>
                )}
                <span
                  className={[
                    'absolute left-1.5 top-1.5 h-2.5 w-2.5 rounded-full ring-2 ring-white/70',
                    item.completed ? 'bg-emerald-500' : 'bg-[#a8acb4]',
                  ].join(' ')}
                />
                {item.dirty ? (
                  <span className="absolute right-1.5 top-1.5 rounded-full bg-[#0071e3] px-1.5 py-0.5 text-[9px] font-medium text-white">
                    Unsaved
                  </span>
                ) : null}
                {item.record?.id ? (
                  <span className="absolute bottom-1 right-1 rounded-full bg-black/75 px-1.5 py-0.5 text-[10px] text-white">
                    #{item.record.id}
                  </span>
                ) : null}
              </button>
            ))}
            {!enrichedItems.length ? (
              <div className="flex h-16 w-full items-center justify-center rounded-xl text-[12px] text-[#6e6e73]">
                Add photos to start the filmstrip
              </div>
            ) : null}
          </div>
        </section>

        <section ref={detailsPanelRef} className="relative flex min-h-0 flex-col rounded-[26px] bg-white/72 p-4 ring-1 ring-black/[0.05] backdrop-blur-sm">
          <div className="mb-2 px-1">
            <h2 className="text-[18px] font-semibold tracking-tight text-[#111]">Observation Details</h2>
            <p className="mt-1 text-[12px] text-[#6e6e73]">Core fields first. Advanced fields only when needed.</p>
            {allCompleted ? <p className="mt-1 text-[12px] font-medium text-emerald-600">All observations completed.</p> : null}
          </div>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pb-24 pr-1">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <FormSelect id="project_name" label="Project" value={active?.form.project_name ?? ''} onChange={(v) => patchActive((p) => ({ ...p, form: { ...p.form, project_name: v }, dirty: true }))} options={PROJECT_NAMES} placeholder="Select" error={fieldErrors.project_name} />
              <FormSelect id="tower" label="Tower" value={active?.form.tower ?? ''} onChange={(v) => patchActive((p) => ({ ...p, form: { ...p.form, tower: v }, dirty: true }))} options={TOWERS} placeholder="Select" error={fieldErrors.tower} />
              <FormSelect id="floor" label="Floor" value={active?.form.floor ?? ''} onChange={(v) => patchActive((p) => ({ ...p, form: { ...p.form, floor: v }, dirty: true }))} options={FLOORS} placeholder="Select" error={fieldErrors.floor} />
              <FormSelect id="flat" label="Flat" value={active?.form.flat ?? ''} onChange={(v) => patchActive((p) => ({ ...p, form: { ...p.form, flat: v }, dirty: true }))} options={FLATS} placeholder="Select" error={fieldErrors.flat} />
              <FormSelect id="room" label="Room" value={active?.form.room ?? ''} onChange={(v) => patchActive((p) => ({ ...p, form: { ...p.form, room: v }, dirty: true }))} options={ROOMS} placeholder="Select" error={fieldErrors.room} className="sm:col-span-2" />
              <FormSelect id="observation_type" label="Observation type" value={active?.form.observation_type ?? ''} onChange={(v) => patchActive((p) => ({ ...p, form: { ...p.form, observation_type: v }, dirty: true }))} options={OBSERVATION_TYPES} placeholder="Select" error={fieldErrors.observation_type} />
              <FormSelect id="severity" label="Severity" value={active?.form.severity ?? ''} onChange={(v) => patchActive((p) => ({ ...p, form: { ...p.form, severity: v }, dirty: true }))} options={SEVERITIES} placeholder="Select" error={fieldErrors.severity} />
            </div>

            <button
              type="button"
              onClick={() => setExpandedAdvanced((v) => !v)}
              className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[#6e6e73] transition hover:text-[#111]"
            >
              {expandedAdvanced ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
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
                      onChange={(e) => patchActive((p) => ({ ...p, form: { ...p.form, site_visit_date: e.target.value }, dirty: true }))}
                      className="w-full rounded-2xl border border-black/[0.06] bg-white/85 px-3 py-3 text-[14px] outline-none focus:ring-2 focus:ring-[#0071e3]/20"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-[13px] font-medium text-[#6e6e73]">Slab casting date</span>
                    <input
                      type="date"
                      value={active?.form.slab_casting_date ?? ''}
                      onChange={(e) => patchActive((p) => ({ ...p, form: { ...p.form, slab_casting_date: e.target.value }, dirty: true }))}
                      className="w-full rounded-2xl border border-black/[0.06] bg-white/85 px-3 py-3 text-[14px] outline-none focus:ring-2 focus:ring-[#0071e3]/20"
                    />
                  </label>
                  <FormSelect id="inspection_status" label="Inspection status" value={active?.form.inspection_status ?? ''} onChange={(v) => patchActive((p) => ({ ...p, form: { ...p.form, inspection_status: v }, dirty: true }))} options={INSPECTION_STATUSES} placeholder="Optional" />
                  <FormSelect id="third_party_status" label="3rd-party status" value={active?.form.third_party_status ?? ''} onChange={(v) => patchActive((p) => ({ ...p, form: { ...p.form, third_party_status: v }, dirty: true }))} options={THIRD_PARTY_INSPECTION_STATUSES} placeholder="Optional" />
                </motion.div>
              ) : null}
            </AnimatePresence>

            <div className="rounded-2xl bg-white/65 p-4 ring-1 ring-black/[0.05]">
              <p className="text-[12px] uppercase tracking-[0.08em] text-[#6e6e73]">Generated Observation</p>
              {active?.record ? (
                <motion.div
                  key={`${active.record.id}-${showDraftReveal}`}
                  initial={{ opacity: 0.45, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.32 }}
                  className="mt-3 space-y-3 text-[13px] text-[#6e6e73]"
                >
                  <p className="line-clamp-4 whitespace-pre-wrap">{active.aiDraft?.observation || active.record.generated_observation || '—'}</p>
                  <div className="h-px bg-black/[0.07]" />
                  <p className="line-clamp-4 whitespace-pre-wrap">{active.aiDraft?.recommendation || active.record.generated_recommendation || '—'}</p>
                </motion.div>
              ) : (
                <div
                  className="mt-2 h-14 rounded-xl bg-[linear-gradient(90deg,rgba(0,0,0,0.04)_20%,rgba(255,255,255,0.7)_50%,rgba(0,0,0,0.04)_80%)] bg-[length:200%_100%]"
                  style={{ animation: 'softShimmer 1.8s linear infinite' }}
                />
              )}
            </div>
          </div>

          <div className="pointer-events-none absolute inset-x-4 bottom-4">
            <div className="pointer-events-auto rounded-[18px] border border-black/[0.06] bg-white/78 p-2.5 shadow-[0_16px_34px_-22px_rgb(0,0,0,0.35)] backdrop-blur-xl">
              <div className="grid grid-cols-4 gap-2">
                <ButtonSecondary className="gap-1 px-2.5 py-2.5 text-[12px]" onClick={goToPreviousImage} disabled={!hasPrevious}>
                  <ChevronLeft className="h-3.5 w-3.5 opacity-75" />
                  Previous
                </ButtonSecondary>
                <ButtonSecondary className="gap-1 px-2.5 py-2.5 text-[12px]" onClick={goToNextImage} disabled={!hasNext}>
                  Next
                  <ChevronRight className="h-3.5 w-3.5 opacity-75" />
                </ButtonSecondary>
                <ButtonSecondary className="gap-1.5 px-3 py-2.5 text-[13px]" onClick={() => void submitObservation()} disabled={Boolean(active?.saving)}>
                  {active?.saving ? <LoaderCircle className="h-3.5 w-3.5 animate-spin opacity-75" /> : <Save className="h-3.5 w-3.5 opacity-75" />}
                  Save
                </ButtonSecondary>
                <ButtonPrimary className="gap-1.5 px-3 py-2.5 text-[13px]" onClick={runReport} disabled={reportBusy}>
                  {reportBusy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Presentation className="h-3.5 w-3.5" />}
                  Generate
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
        {reportReadyToast ? (
          <motion.div
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.2 }}
            className="fixed bottom-6 left-1/2 z-50 w-[min(92vw,430px)] -translate-x-1/2 rounded-2xl border border-black/[0.08] bg-white/86 p-3 shadow-[0_18px_42px_-24px_rgb(0,0,0,0.45)] backdrop-blur-xl"
          >
            <p className="px-1 text-[13px] font-medium text-[#111]">{reportReadyToast.message}</p>
            <div className="mt-2 flex items-center justify-between gap-2">
              <ButtonPrimary
                className="px-4 py-2 text-[12px]"
                onClick={() => {
                  navigate('/output/reports', { state: { highlightReportId: reportReadyToast.id } })
                  setReportReadyToast(null)
                }}
              >
                Go to Reports
              </ButtonPrimary>
              <button
                type="button"
                onClick={() => setReportReadyToast(null)}
                className="rounded-xl px-3 py-2 text-[12px] font-medium text-[#6e6e73] transition hover:bg-black/[0.04] hover:text-[#111]"
              >
                Dismiss
              </button>
            </div>
          </motion.div>
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
