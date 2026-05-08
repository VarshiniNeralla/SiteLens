import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ImageUp,
  LoaderCircle,
  Presentation,
  ChevronDown,
  ChevronUp,
  Save,
  ChevronLeft,
  ChevronRight,
  CloudCheck,
  RotateCcw,
  Eraser,
  X,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { createObservation, generateReport, getReport, getReportJob } from '../api.js'
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
import { listUploadSessions, uploadResumableFile } from '../utils/resumableUpload.js'

const REQUIRED_KEYS = ['project_name', 'tower', 'floor', 'flat', 'room', 'observation_type', 'severity']
const TOAST_TIMEOUT_MS = 2000
const REPORT_READY_TOAST_TIMEOUT_MS = 7000
const WORKSPACE_DRAFTS_KEY = 'sitelens.workspace.v1'
const WORKSPACE_PERSIST_DEBOUNCE_MS = 220

const workspaceMemoryCache = {
  items: null,
  activeId: null,
  expandedAdvanced: false,
  detailsScrollTop: 0,
}

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
    cloudinaryPublicId: '',
    cloudinarySecureUrl: '',
    imageUploadedAt: null,
    imageOriginalFilename: '',
    uploadProgress: 0,
    uploadStatus: 'idle',
    uploadError: '',
    form: emptyForm(),
    record: null,
    aiDraft: null,
    uploading: false,
    saving: false,
    dirty: false,
    uploadToken: 0,
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

function serializeDraft(item) {
  return {
    id: item.id,
    localUrl: item.localUrl,
    imagePath: item.imagePath,
    cloudinaryPublicId: item.cloudinaryPublicId,
    cloudinarySecureUrl: item.cloudinarySecureUrl,
    imageUploadedAt: item.imageUploadedAt,
    imageOriginalFilename: item.imageOriginalFilename,
    uploadProgress: item.uploadProgress,
    uploadStatus: item.uploadStatus,
    uploadError: item.uploadError,
    form: item.form,
    record: item.record,
    aiDraft: item.aiDraft,
    dirty: item.dirty,
  }
}

function deserializeDraft(raw) {
  const base = createDraft(Number(raw?.id) || Date.now())
  return {
    ...base,
    id: Number(raw?.id) || base.id,
    localUrl: typeof raw?.localUrl === 'string' ? raw.localUrl : '',
    imagePath: typeof raw?.imagePath === 'string' ? raw.imagePath : '',
    cloudinaryPublicId: typeof raw?.cloudinaryPublicId === 'string' ? raw.cloudinaryPublicId : '',
    cloudinarySecureUrl: typeof raw?.cloudinarySecureUrl === 'string' ? raw.cloudinarySecureUrl : '',
    imageUploadedAt: raw?.imageUploadedAt ?? null,
    imageOriginalFilename: typeof raw?.imageOriginalFilename === 'string' ? raw.imageOriginalFilename : '',
    uploadProgress: Number(raw?.uploadProgress) || 0,
    uploadStatus: raw?.uploadStatus || (raw?.imagePath ? 'success' : 'idle'),
    uploadError: typeof raw?.uploadError === 'string' ? raw.uploadError : '',
    form: { ...emptyForm(), ...(raw?.form || {}) },
    record: raw?.record || null,
    aiDraft: raw?.aiDraft || null,
    dirty: Boolean(raw?.dirty),
  }
}

export function WorkspacePage() {
  const navigate = useNavigate()
  const inputRef = useRef(null)
  const detailsPanelRef = useRef(null)
  const detailsScrollRef = useRef(null)
  const pendingUploadForId = useRef(1)
  const localUrlRegistry = useRef(new Set())
  const itemsRef = useRef(null)
  const nextId = useRef(2)
  const [items, setItems] = useState(() => workspaceMemoryCache.items || [createDraft(1)])
  const [activeId, setActiveId] = useState(() => workspaceMemoryCache.activeId || 1)
  const [expandedAdvanced, setExpandedAdvanced] = useState(() => Boolean(workspaceMemoryCache.expandedAdvanced))
  const [globalError, setGlobalError] = useState('')
  const [fieldErrors, setFieldErrors] = useState({})
  const [reportBusy, setReportBusy] = useState(false)
  const [reportNotice, setReportNotice] = useState('')
  const [reportReadyToast, setReportReadyToast] = useState(null)
  const [activeOperation, setActiveOperation] = useState({ state: 'idle', label: '' })
  const [showDraftReveal, setShowDraftReveal] = useState(false)
  const [imageLoadState, setImageLoadState] = useState({})
  const [resetBusy, setResetBusy] = useState(false)
  const [pendingDeleteId, setPendingDeleteId] = useState(null)
  const [persistenceNotice, setPersistenceNotice] = useState('')

  useEffect(() => {
    itemsRef.current = items
  }, [items])

  const active = useMemo(() => items.find((i) => i.id === activeId) ?? items[0], [items, activeId])
  const activePreviewSrc = useMemo(() => (active ? active.localUrl || toStaticImageSrc(active.imagePath) : ''), [active])
  const savedIds = useMemo(() => items.map((i) => i.record?.id).filter(Boolean), [items])
  const hasAnyUploaded = useMemo(() => items.some((i) => Boolean(i.imagePath || i.localUrl)), [items])
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
    // Keep in-session blob previews stable while navigating between tabs/routes.
    // URLs are still revoked on explicit replace/remove/reset flows.
    return undefined
  }, [])

  useEffect(() => {
    try {
      if (workspaceMemoryCache.items?.length) return
      const raw = localStorage.getItem(WORKSPACE_DRAFTS_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw)
      const rows = Array.isArray(parsed?.items) ? parsed.items.map(deserializeDraft).filter(Boolean) : []
      if (!rows.length) return
      setItems(rows)
      setActiveId(Number(parsed?.activeId) || rows[0].id)
      setExpandedAdvanced(Boolean(parsed?.expandedAdvanced))
      nextId.current = Math.max(...rows.map((x) => Number(x.id) || 0), 0) + 1
      workspaceMemoryCache.items = rows
      workspaceMemoryCache.activeId = Number(parsed?.activeId) || rows[0].id
      workspaceMemoryCache.expandedAdvanced = Boolean(parsed?.expandedAdvanced)
      workspaceMemoryCache.detailsScrollTop = Number(parsed?.detailsScrollTop) || 0
      setPersistenceNotice('Restored previous session')
    } catch {
      // Ignore malformed local cache; workspace falls back to default draft.
    }
  }, [])

  useEffect(() => {
    const id = window.setTimeout(() => {
      try {
        workspaceMemoryCache.items = items
        workspaceMemoryCache.activeId = activeId
        workspaceMemoryCache.expandedAdvanced = expandedAdvanced
        const payload = {
          activeId,
          expandedAdvanced,
          detailsScrollTop: workspaceMemoryCache.detailsScrollTop || 0,
          items: items.map(serializeDraft),
        }
        localStorage.setItem(WORKSPACE_DRAFTS_KEY, JSON.stringify(payload))
        if (!reportBusy) setPersistenceNotice('All changes saved')
      } catch {
        // Ignore storage quota/errors; app still works in-memory.
      }
    }, WORKSPACE_PERSIST_DEBOUNCE_MS)
    return () => clearTimeout(id)
  }, [items, activeId, expandedAdvanced, reportBusy])

  useEffect(() => {
    if (!persistenceNotice) return undefined
    const id = setTimeout(() => setPersistenceNotice(''), TOAST_TIMEOUT_MS)
    return () => clearTimeout(id)
  }, [persistenceNotice])

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

  useEffect(() => {
    if (!items.length) return
    if (!items.some((i) => i.id === activeId)) {
      setActiveId(items[0].id)
    }
  }, [items, activeId])

  useEffect(() => {
    void (async () => {
      const sessions = await listUploadSessions()
      if (!sessions.length) return
      setReportNotice(`${sessions.length} interrupted upload(s) detected. Reattach matching files to resume.`)
    })()
  }, [])

  useEffect(() => {
    const hasInFlight = items.some((i) => i.uploading || i.saving || i.dirty) || reportBusy
    if (!hasInFlight) return undefined
    const onBeforeUnload = (e) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [items, reportBusy])

  useEffect(() => {
    const node = detailsScrollRef.current
    if (!node) return
    if (workspaceMemoryCache.detailsScrollTop > 0) {
      node.scrollTop = workspaceMemoryCache.detailsScrollTop
    }
    const onScroll = () => {
      workspaceMemoryCache.detailsScrollTop = node.scrollTop
    }
    node.addEventListener('scroll', onScroll, { passive: true })
    return () => node.removeEventListener('scroll', onScroll)
  }, [])

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

  const setActiveAndFocus = (targetId, options = {}) => {
    const { focus = false } = options
    setActiveId(targetId)
    setFieldErrors({})
    if (focus) focusObservationForm()
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

  const addPhotoAdaptive = () => {
    if (!hasAnyUploaded) {
      pickForActive()
      return
    }
    addDraft()
  }

  const removeDraft = (targetId) => {
    const current = itemsRef.current || []
    const idx = current.findIndex((x) => x.id === targetId)
    if (idx < 0) return

    const row = current[idx]
    if (row?.localUrl?.startsWith('blob:')) {
      try {
        URL.revokeObjectURL(row.localUrl)
      } catch {
        // ignore
      }
      localUrlRegistry.current.delete(row.localUrl)
    }

    const next = current.filter((x) => x.id !== targetId)
    if (!next.length) {
      nextId.current = 2
      pendingUploadForId.current = 1
      setItems([createDraft(1)])
      setActiveId(1)
      return
    }

    setItems(next)
    if (activeId === targetId) {
      const candidate = next[Math.min(idx, next.length - 1)] || next[0]
      setActiveAndFocus(candidate.id)
    }
  }

  const resetWorkspaceSession = () => {
    if (resetBusy) return
    const shouldReset = window.confirm(
      'Reset workspace session?\n\nThis clears current draft cards and local session cache for this browser.',
    )
    if (!shouldReset) return
    setResetBusy(true)
    try {
      const registry = localUrlRegistry.current
      for (const url of registry) URL.revokeObjectURL(url)
      registry.clear()
      localStorage.removeItem(WORKSPACE_DRAFTS_KEY)
      workspaceMemoryCache.items = [createDraft(1)]
      workspaceMemoryCache.activeId = 1
      workspaceMemoryCache.expandedAdvanced = false
      workspaceMemoryCache.detailsScrollTop = 0
      nextId.current = 2
      pendingUploadForId.current = 1
      setItems([createDraft(1)])
      setActiveId(1)
      setExpandedAdvanced(false)
      setFieldErrors({})
      setGlobalError('')
      setReportNotice('Workspace session reset.')
      setReportReadyToast(null)
      setImageLoadState({})
      setPersistenceNotice('Draft cleared')
    } finally {
      setResetBusy(false)
    }
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
    const uploadToken = Date.now()
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
        cloudinaryPublicId: '',
        cloudinarySecureUrl: '',
        imageUploadedAt: null,
        imageOriginalFilename: '',
        uploadProgress: 0,
        uploadStatus: 'uploading',
        uploadError: '',
        record: null,
        aiDraft: null,
        dirty: true,
        uploading: true,
        uploadToken,
      }
    })
    setActiveId(targetId)
    setGlobalError('')
    try {
      const uploaded = await uploadResumableFile(file, {
        key: `${targetId}:${file.name}:${file.size}:${file.lastModified}`,
        onProgress: (pct) =>
          patchById(targetId, (prev) =>
            prev.uploadToken === uploadToken ? { ...prev, uploadProgress: pct } : prev
          ),
      })
      patchById(targetId, (prev) => {
        if (prev.uploadToken !== uploadToken) return prev
        if (prev.localUrl?.startsWith('blob:')) {
          URL.revokeObjectURL(prev.localUrl)
          localUrlRegistry.current.delete(prev.localUrl)
        }
        const optimized = uploaded.optimized_url || uploaded.path || ''
        const secure = uploaded.secure_url || optimized
        const originalName = uploaded.filename || file.name || ''
        const uploadedAt = uploaded.uploaded_at ?? null
        return {
          ...prev,
          uploading: false,
          uploadProgress: 100,
          uploadStatus: 'success',
          uploadError: '',
          localUrl: '',
          file: null,
          imagePath: optimized || uploaded.path || '',
          cloudinaryPublicId: uploaded.public_id || '',
          cloudinarySecureUrl: secure || '',
          imageUploadedAt: uploadedAt,
          imageOriginalFilename: originalName,
        }
      })
    } catch (e) {
      patchById(targetId, (prev) =>
        prev.uploadToken === uploadToken
          ? {
              ...prev,
              uploading: false,
              uploadStatus: 'error',
              uploadError: e.message || 'Upload failed.',
            }
          : prev
      )
      setGlobalError(e.message || 'Upload failed.')
    }
  }

  const retryUploadFor = (targetId) => {
    const row = itemsRef.current?.find((i) => i.id === targetId)
    if (row?.file) void onFile(row.file, targetId)
    else pickFor(targetId)
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
        cloudinary_public_id: snapshot.cloudinaryPublicId || null,
        cloudinary_secure_url: snapshot.cloudinarySecureUrl || null,
        image_uploaded_at: snapshot.imageUploadedAt || null,
        image_original_filename: snapshot.imageOriginalFilename || null,
        generate_text: true,
      }
      const res = await createObservation(payload)
      if (!res?.id || Number(res.id) <= 0) {
        patchById(targetId, (prev) => ({
          ...prev,
          saving: false,
          dirty: true,
        }))
        setReportNotice(res?.notice || 'Observation queued for sync.')
        return
      }
      const narrative =
        String(res.generated_observation || '').trim() || String(res.manually_written_observation || '').trim() || ''
      patchById(targetId, (prev) => ({
        ...prev,
        saving: false,
        record: res,
        dirty: false,
        aiDraft: {
          observation: narrative,
          recommendation: res.generated_recommendation || '',
        },
      }))
      setShowDraftReveal(true)
      setTimeout(() => setShowDraftReveal(false), 1200)
      const extras = []
      extras.push(`Observation #${res.id} saved. You can continue to the next image.`)
      if (res.notice) extras.push(res.notice)
      setReportNotice(extras.join(' '))
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
    setActiveOperation({ state: 'generating', label: 'Queueing report generation…' })
    setGlobalError('')
    setReportNotice('')
    setReportReadyToast(null)
    try {
      const accepted = await generateReport({ observation_ids: savedIds, title: null, include_pdf: false })
      if (!accepted?.job_id || !accepted?.report_id) {
        throw new Error('Report generation did not return a valid job.')
      }
      let jobStatus = 'queued'
      while (jobStatus === 'queued' || jobStatus === 'processing') {
        setActiveOperation({
          state: jobStatus === 'queued' ? 'processing' : 'generating',
          label: jobStatus === 'queued' ? 'Report queued…' : 'Generating report…',
        })
        await new Promise((r) => setTimeout(r, 1000))
        const job = await getReportJob(accepted.job_id)
        jobStatus = String(job?.status || '')
      }
      const report = await getReport(accepted.report_id)
      if (report?.status !== 'ready') {
        throw new Error(report?.error_message || 'Report generation failed.')
      }
      setReportReadyToast({
        id: accepted.report_id,
        message: 'Report generated successfully.',
      })
    } catch (e) {
      setGlobalError(e.message || 'Report generation failed.')
    } finally {
      setActiveOperation({ state: 'idle', label: '' })
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
    <div className="mx-auto h-[calc(100vh-10.6rem)] max-h-[820px] min-h-[600px] max-w-[1320px]">
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

      <div className="grid h-full grid-cols-1 gap-4 lg:grid-cols-[1.55fr_0.9fr]">
        <section className="flex min-h-0 flex-col rounded-[26px] bg-white/66 p-4 ring-1 ring-black/[0.05] backdrop-blur-sm">
          <div className="mb-3 flex items-center justify-between px-1">
            <p className="text-[13px] font-medium text-[#6e6e73]">Image workspace</p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={resetWorkspaceSession}
                disabled={resetBusy}
                className={[
                  'inline-flex items-center gap-1.5 rounded-xl border px-3.5 py-2 text-[12px] font-medium tracking-[0.01em] transition-all duration-200',
                  'border-black/[0.09] bg-white/82 text-[#444] shadow-[0_8px_20px_-16px_rgb(0,0,0,0.45)] backdrop-blur-sm',
                  'hover:border-black/[0.18] hover:bg-white hover:text-[#111] hover:shadow-[0_14px_24px_-18px_rgb(0,0,0,0.5)]',
                  'disabled:cursor-not-allowed disabled:opacity-55',
                ].join(' ')}
                title="Clear local workspace draft session"
              >
                <Eraser className="h-3.5 w-3.5" />
                {resetBusy ? 'Resetting…' : 'Reset Session'}
              </button>
              <button
                type="button"
                onClick={addPhotoAdaptive}
                className={[
                  'inline-flex items-center gap-1.5 rounded-xl border px-3.5 py-2 text-[12px] font-medium tracking-[0.01em] transition-all duration-200',
                  'border-black/[0.09] bg-white/82 text-[#444] shadow-[0_8px_20px_-16px_rgb(0,0,0,0.45)] backdrop-blur-sm',
                  'hover:border-black/[0.18] hover:bg-white hover:text-[#111] hover:shadow-[0_14px_24px_-18px_rgb(0,0,0,0.5)]',
                ].join(' ')}
              >
                <ImageUp className="h-3.5 w-3.5" />
                {hasAnyUploaded ? 'Add More Photos' : 'Add Photo'}
              </button>
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
                    loading="eager"
                    decoding="async"
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
              <div className="absolute right-3 top-3 inline-flex items-center gap-2 rounded-full bg-white/90 px-3 py-1.5 text-[12px] font-medium text-[#111] shadow-[0_4px_18px_-10px_rgb(0,0,0,0.35)] ring-1 ring-black/[0.05] backdrop-blur-md">
                <LoaderCircle className="h-3.5 w-3.5 animate-spin text-[#0071e3]" />
                Uploading{' '}
                <span className="tabular-nums text-[#6e6e73]">{Math.max(active.uploadProgress ?? 0, 0)}%</span>
              </div>
            ) : active?.uploadStatus === 'success' && active.imagePath?.startsWith?.('https') ? (
              <div className="absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-emerald-500/92 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-white shadow-[0_4px_18px_-10px_rgb(16,120,72,0.55)] backdrop-blur-sm">
                <CloudCheck className="h-3.5 w-3.5" strokeWidth={2.25} />
                Synced
              </div>
            ) : active?.uploadStatus === 'error' ? (
              <button
                type="button"
                onClick={() => retryUploadFor(activeId)}
                className="absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-[#111]/92 px-3 py-1.5 text-[12px] font-medium text-white shadow-lg ring-1 ring-white/10 backdrop-blur-sm transition hover:bg-black"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Retry
              </button>
            ) : null}
            {active?.uploading ? (
              <div className="pointer-events-none absolute inset-x-5 bottom-3 h-[3px] overflow-hidden rounded-full bg-black/[0.06]">
                <div
                  className="h-full rounded-full bg-[#0071e3]/85 transition-[width] duration-150 ease-out"
                  style={{ width: `${Math.max(8, Math.min(100, active.uploadProgress ?? 0))}%` }}
                />
              </div>
            ) : null}
          </div>

          <div className="mt-3 flex gap-2 overflow-x-auto rounded-2xl bg-white/45 p-2 ring-1 ring-black/[0.04]">
            <AnimatePresence initial={false}>
              {enrichedItems.map((item) => (
                <motion.div
                  layout
                  key={item.id}
                  initial={{ opacity: 0, scale: 0.96, y: 4 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.96, y: 6 }}
                  transition={{ duration: 0.18 }}
                  role="button"
                  tabIndex={0}
                  onClick={() => setActiveAndFocus(item.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      setActiveAndFocus(item.id)
                    }
                  }}
                  className={[
                    'group relative h-16 w-24 shrink-0 overflow-hidden rounded-xl ring-1 transition-all duration-200',
                    item.id === activeId
                      ? 'scale-[1.02] ring-black/[0.18]'
                      : 'ring-black/[0.08] hover:-translate-y-0.5 hover:ring-black/[0.18]',
                    'cursor-pointer',
                  ].join(' ')}
                >
                  {item.previewSrc ? (
                    <>
                      <img
                        src={item.previewSrc}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        className={[
                          'h-full w-full object-cover transition duration-300 ease-out',
                          item.uploadStatus === 'uploading' ? 'opacity-45' : 'opacity-100',
                        ].join(' ')}
                      />

                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          setPendingDeleteId(item.id)
                        }}
                        title="Remove photo"
                        aria-label="Remove photo"
                        className={[
                          'absolute right-1.5 top-1.5 inline-flex h-7 min-w-7 items-center justify-center rounded-full px-1.5',
                          'border border-white/60 bg-[linear-gradient(180deg,rgba(255,255,255,0.92),rgba(247,247,249,0.78))]',
                          'text-[#1d1d1f] shadow-[0_14px_24px_-18px_rgb(0,0,0,0.65)] backdrop-blur-md',
                          'opacity-0 transition-all duration-200 hover:scale-[1.04] hover:bg-white group-hover:opacity-100',
                        ].join(' ')}
                      >
                        <X className="h-3.5 w-3.5" strokeWidth={2.4} />
                      </button>

                      {item.uploadStatus === 'error' ? (
                        <span className="absolute inset-0 flex items-center justify-center bg-black/[0.32] backdrop-blur-[1px]" aria-hidden />
                      ) : null}
                      {item.uploadStatus === 'error' ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            retryUploadFor(item.id)
                          }}
                          title="Retry upload"
                          aria-label={`Retry upload for ${item.imageOriginalFilename ?? 'image'}`}
                          className="absolute left-1/2 top-1/2 inline-flex -translate-x-1/2 -translate-y-1/2 items-center rounded-full bg-white/95 p-2 text-[#111] shadow-lg ring-1 ring-black/[0.08] transition hover:scale-[1.04]"
                        >
                          <RotateCcw className="h-4 w-4" />
                        </button>
                      ) : item.uploadStatus === 'success' && item.imagePath?.startsWith('https') ? (
                        <CloudCheck
                          className="pointer-events-none absolute bottom-1 left-1 h-4 w-4 text-emerald-500 drop-shadow"
                          strokeWidth={2.35}
                          aria-hidden
                        />
                      ) : null}
                    </>
                  ) : (
                    <div className="flex h-full w-full flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-black/[0.12] bg-white/55 text-center">
                      <ImageUp className="h-4 w-4 text-black/40" strokeWidth={1.8} />
                      <span className="px-1 text-[10px] font-medium text-[#6e6e73]">Add a photo</span>
                    </div>
                  )}
                  <span
                    className={[
                      'absolute left-1.5 top-1.5 h-2.5 w-2.5 rounded-full ring-2 ring-white/70',
                      item.completed ? 'bg-emerald-500' : 'bg-[#a8acb4]',
                    ].join(' ')}
                  />
                  {item.dirty ? (
                    <span className="absolute right-1.5 bottom-1.5 rounded-full bg-[#0071e3] px-1.5 py-0.5 text-[9px] font-medium text-white">
                      Unsaved
                    </span>
                  ) : null}
                  {item.record?.id ? (
                    <span className="absolute bottom-1 right-1 rounded-full bg-black/75 px-1.5 py-0.5 text-[10px] text-white">
                      #{item.record.id}
                    </span>
                  ) : null}
                </motion.div>
              ))}
            </AnimatePresence>
            {!enrichedItems.length ? (
              <div className="flex h-16 w-full items-center justify-center rounded-xl text-[12px] text-[#6e6e73]">
                Add photos to start the filmstrip
              </div>
            ) : null}
          </div>
        </section>

        <section ref={detailsPanelRef} className="relative flex min-h-0 flex-col rounded-[26px] bg-white/72 p-3 ring-1 ring-black/[0.05] backdrop-blur-sm">
          <div className="mb-1.5 px-1">
            <h2 className="text-[18px] font-semibold tracking-tight text-[#111]">Observation Details</h2>
            <p className="mt-0.5 text-[12px] text-[#6e6e73]">Core fields first. Advanced fields only when needed.</p>
            {allCompleted ? <p className="mt-1 text-[12px] font-medium text-emerald-600">All observations completed.</p> : null}
            {activeOperation.state !== 'idle' ? (
              <p className="mt-1 text-[12px] font-medium text-[#0071e3]">{activeOperation.label}</p>
            ) : null}
            {persistenceNotice ? <p className="mt-1 text-[12px] font-medium text-[#6e6e73]">{persistenceNotice}</p> : null}
          </div>

          <div ref={detailsScrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto pb-[5.25rem] pr-1">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <FormSelect neutralFocus id="project_name" label="Project" value={active?.form.project_name ?? ''} onChange={(v) => patchActive((p) => ({ ...p, form: { ...p.form, project_name: v }, dirty: true }))} options={PROJECT_NAMES} placeholder="Select" error={fieldErrors.project_name} />
              <FormSelect neutralFocus id="tower" label="Tower" value={active?.form.tower ?? ''} onChange={(v) => patchActive((p) => ({ ...p, form: { ...p.form, tower: v }, dirty: true }))} options={TOWERS} placeholder="Select" error={fieldErrors.tower} />
              <FormSelect neutralFocus id="floor" label="Floor" value={active?.form.floor ?? ''} onChange={(v) => patchActive((p) => ({ ...p, form: { ...p.form, floor: v }, dirty: true }))} options={FLOORS} placeholder="Select" error={fieldErrors.floor} />
              <FormSelect neutralFocus id="flat" label="Flat" value={active?.form.flat ?? ''} onChange={(v) => patchActive((p) => ({ ...p, form: { ...p.form, flat: v }, dirty: true }))} options={FLATS} placeholder="Select" error={fieldErrors.flat} />
              <FormSelect neutralFocus id="room" label="Room" value={active?.form.room ?? ''} onChange={(v) => patchActive((p) => ({ ...p, form: { ...p.form, room: v }, dirty: true }))} options={ROOMS} placeholder="Select" error={fieldErrors.room} className="sm:col-span-2" />
              <FormSelect neutralFocus id="observation_type" label="Observation type" value={active?.form.observation_type ?? ''} onChange={(v) => patchActive((p) => ({ ...p, form: { ...p.form, observation_type: v }, dirty: true }))} options={OBSERVATION_TYPES} placeholder="Select" error={fieldErrors.observation_type} />
              <FormSelect neutralFocus id="severity" label="Severity" value={active?.form.severity ?? ''} onChange={(v) => patchActive((p) => ({ ...p, form: { ...p.form, severity: v }, dirty: true }))} options={SEVERITIES} placeholder="Select" error={fieldErrors.severity} />
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
                      className="w-full rounded-2xl border border-black/[0.06] bg-white/85 px-3 py-3 text-[14px] outline-none transition-[border-color] duration-200 focus:border-black/[0.22] focus:ring-0"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-[13px] font-medium text-[#6e6e73]">Slab casting date</span>
                    <input
                      type="date"
                      value={active?.form.slab_casting_date ?? ''}
                      onChange={(e) => patchActive((p) => ({ ...p, form: { ...p.form, slab_casting_date: e.target.value }, dirty: true }))}
                      className="w-full rounded-2xl border border-black/[0.06] bg-white/85 px-3 py-3 text-[14px] outline-none transition-[border-color] duration-200 focus:border-black/[0.22] focus:ring-0"
                    />
                  </label>
                  <FormSelect neutralFocus id="inspection_status" label="Inspection status" value={active?.form.inspection_status ?? ''} onChange={(v) => patchActive((p) => ({ ...p, form: { ...p.form, inspection_status: v }, dirty: true }))} options={INSPECTION_STATUSES} placeholder="Optional" />
                  <FormSelect neutralFocus id="third_party_status" label="3rd-party status" value={active?.form.third_party_status ?? ''} onChange={(v) => patchActive((p) => ({ ...p, form: { ...p.form, third_party_status: v }, dirty: true }))} options={THIRD_PARTY_INSPECTION_STATUSES} placeholder="Optional" />
                </motion.div>
              ) : null}
            </AnimatePresence>

            <div className="rounded-2xl bg-white/65 p-3 ring-1 ring-black/[0.05]">
              <p className="text-[12px] uppercase tracking-[0.08em] text-[#6e6e73]">Observation text</p>
              {active?.record &&
              ['unavailable', 'failed', 'skipped'].includes(String(active.record.ai_status || '').toLowerCase()) ? (
                <p className="mt-1 text-[11px] leading-snug text-[#6e6e73]">
                  AI drafting is off or unreachable—your fields and attachments still export normally.
                </p>
              ) : null}
              {active?.record ? (
                <motion.div
                  key={`${active.record.id}-${showDraftReveal}`}
                  initial={{ opacity: 0.45, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.32 }}
                  className="mt-3 space-y-3 text-[13px] text-[#6e6e73]"
                >
                  <p className="line-clamp-4 whitespace-pre-wrap">
                    {(
                      active.aiDraft?.observation ||
                      active.record.generated_observation ||
                      active.record.manually_written_observation ||
                      ''
                    ).trim() || '—'}
                  </p>
                  <div className="h-px bg-black/[0.07]" />
                  <p className="line-clamp-4 whitespace-pre-wrap">
                    {(active.aiDraft?.recommendation || active.record.generated_recommendation || '').trim() || '—'}
                  </p>
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
      <AnimatePresence>
        {pendingDeleteId ? (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[70] bg-black/35 backdrop-blur-[2px]"
              onClick={() => setPendingDeleteId(null)}
            />
            <motion.div
              initial={{ opacity: 0, y: 16, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.98 }}
              transition={{ duration: 0.2 }}
              className="fixed left-1/2 top-1/2 z-[71] w-[min(92vw,420px)] -translate-x-1/2 -translate-y-1/2 rounded-3xl border border-white/35 bg-[linear-gradient(180deg,rgba(255,255,255,0.92),rgba(246,247,250,0.86))] p-5 shadow-[0_34px_70px_-30px_rgb(0,0,0,0.55)] backdrop-blur-xl"
            >
              <p className="text-[16px] font-semibold tracking-tight text-[#111]">Remove photo?</p>
              <p className="mt-1.5 text-[13px] leading-relaxed text-[#6e6e73]">
                This will remove the selected photo from the workspace queue.
              </p>
              <div className="mt-4 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setPendingDeleteId(null)}
                  className="rounded-xl border border-black/[0.09] bg-white/75 px-4 py-2 text-[13px] font-medium text-[#444] transition hover:border-black/[0.16] hover:bg-white hover:text-[#111]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const id = pendingDeleteId
                    setPendingDeleteId(null)
                    if (id) removeDraft(id)
                  }}
                  className="rounded-xl border border-black/[0.08] bg-[#111] px-4 py-2 text-[13px] font-semibold text-white shadow-[0_12px_24px_-16px_rgb(0,0,0,0.65)] transition hover:bg-black"
                >
                  Remove
                </button>
              </div>
            </motion.div>
          </>
        ) : null}
      </AnimatePresence>
    </div>
  )
}
