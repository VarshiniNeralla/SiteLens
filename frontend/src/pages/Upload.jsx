import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { ImagePlus, UploadCloud } from 'lucide-react'
import { uploadImage } from '../api.js'
import { ButtonPrimary, ButtonSecondary } from '../components/ui/Button.jsx'

/**
 * Stable blob URLs with cleanup: Strict Mode invokes cleanup then re-runs effect, yielding a fresh URL for the same `file`.
 * Return `''` whenever `file` is null so we don't need to clear React state synchronously inside the effect.
 */
function usePreviewObjectUrl(file) {
  const [objectUrl, setObjectUrl] = useState('')
  useEffect(() => {
    if (!file) return undefined
    const blobUrl = URL.createObjectURL(file)
    let active = true
    const id = requestAnimationFrame(() => {
      if (active) setObjectUrl(blobUrl)
    })
    return () => {
      active = false
      cancelAnimationFrame(id)
      URL.revokeObjectURL(blobUrl)
    }
  }, [file])
  return file ? objectUrl : ''
}

export function UploadPage() {
  const navigate = useNavigate()
  const inputRef = useRef(null)
  const [file, setFile] = useState(null)
  const previewUrl = usePreviewObjectUrl(file)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)
  const [dragOver, setDragOver] = useState(false)

  const applyFile = useCallback((f) => {
    setError('')
    setResult(null)
    setFile(f ?? null)
  }, [])

  const onPick = (ev) => {
    const f = ev.target.files?.[0]
    applyFile(f ?? null)
    // Allow choosing the same file again
    ev.target.value = ''
  }

  const onUpload = async () => {
    if (!file) {
      setError('Choose an image to continue.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const data = await uploadImage(file)
      setResult(data)
    } catch (e) {
      setError(e.message || 'Upload failed')
    } finally {
      setBusy(false)
    }
  }

  const continueWithPath = () => {
    if (!result?.path) return
    navigate('/observations/new', { state: { imagePath: result.path, previewUrl } })
  }

  const looksLikeAllowedImage = useCallback((f) => {
    if (!f) return false
    if (/^image\/(jpeg|png|webp)$/i.test(f.type)) return true
    // Windows / some browsers omit or mislabel MIME on drag-drop
    return /\.(jpe?g|png|webp)$/i.test(f.name)
  }, [])

  const onDrop = useCallback(
    (ev) => {
      ev.preventDefault()
      setDragOver(false)
      const f = ev.dataTransfer.files?.[0]
      if (f && looksLikeAllowedImage(f)) applyFile(f)
      else setError('Use JPEG, PNG, or WebP.')
    },
    [applyFile, looksLikeAllowedImage],
  )

  return (
    <div className="mx-auto flex max-w-3xl flex-col items-center">
      <div className="text-center">
        <h2 className="text-[clamp(1.5rem,3vw,1.85rem)] font-semibold tracking-[-0.02em] text-[#111]">Upload</h2>
        <p className="mx-auto mt-3 max-w-md text-[15px] leading-relaxed text-[#6e6e73]">
          JPEG, PNG, or WebP. Files are validated and stored on the server.
        </p>
      </div>

      <motion.div layout className="mt-14 w-full">
        <input
          ref={inputRef}
          id="file"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="sr-only"
          onChange={onPick}
        />

        <motion.button
          type="button"
          layout
          onDragEnter={(e) => {
            e.preventDefault()
            setDragOver(true)
          }}
          onDragOver={(e) => {
            e.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          whileTap={{ scale: 0.995 }}
          transition={{ duration: 0.18 }}
          className={[
            'group relative flex w-full flex-col overflow-hidden rounded-[28px]',
            'min-h-[min(52vh,420px)] cursor-pointer text-left outline-none transition-[background-color,box-shadow] duration-300',
            'focus-visible:ring-2 focus-visible:ring-[#0071e3]/35 focus-visible:ring-offset-4 focus-visible:ring-offset-[#f5f5f7]',
            dragOver ? 'bg-white shadow-[0_20px_60px_-28px_rgb(0,113,227,0.35)]' : 'bg-white/70 shadow-[0_16px_48px_-32px_rgb(0,0,0,0.18)]',
            'ring-1 ring-black/[0.05]',
          ].join(' ')}
        >
          <div className="flex flex-1 flex-col items-center justify-center px-8 py-14">
            <AnimatePresence mode="wait">
              {previewUrl ? (
                <motion.div
                  key="preview"
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.25 }}
                  className="flex h-full w-full flex-col items-center"
                >
                  <div className="relative max-h-[min(38vh,320px)] w-full max-w-md overflow-hidden rounded-2xl bg-[#ececee]">
                    <img src={previewUrl} alt="" className="max-h-[min(38vh,320px)] w-full object-contain" />
                  </div>
                  <p className="mt-6 text-center text-[14px] text-[#6e6e73]">
                    <span className="text-[#111]">{file?.name}</span>
                    {file?.size ? ` · ${(file.size / 1024 / 1024).toFixed(2)} MB` : null}
                  </p>
                  <p className="mt-1 text-center text-[13px] text-[#6e6e73]/90">Tap to replace</p>
                </motion.div>
              ) : (
                <motion.div
                  key="empty"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex max-w-sm flex-col items-center text-center"
                >
                  <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-black/[0.04] text-[#0071e3] transition-transform duration-300 group-hover:scale-105">
                    <ImagePlus className="h-8 w-8" strokeWidth={1.5} aria-hidden />
                  </div>
                  <p className="mt-8 text-[17px] font-medium tracking-tight text-[#111]">Drop a photo here</p>
                  <p className="mt-2 text-[15px] leading-relaxed text-[#6e6e73]">or click to browse — like adding to Files.</p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.button>
      </motion.div>

      <div className="mt-10 flex w-full max-w-md flex-col gap-3 sm:flex-row sm:justify-center">
        <ButtonPrimary type="button" disabled={!file || busy} onClick={onUpload} className="w-full gap-2 sm:w-auto">
          <UploadCloud className="h-[18px] w-[18px] opacity-90" strokeWidth={1.75} aria-hidden />
          {busy ? 'Uploading…' : 'Upload to server'}
        </ButtonPrimary>
        <ButtonSecondary type="button" onClick={() => inputRef.current?.click()} className="w-full sm:w-auto">
          Browse
        </ButtonSecondary>
      </div>

      <AnimatePresence>
        {error ? (
          <motion.p
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            role="alert"
            className="mt-6 max-w-md text-center text-[14px] font-medium text-red-600/95"
          >
            {error}
          </motion.p>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {result?.path ? (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-10 w-full max-w-lg text-center"
          >
            <p className="text-[13px] font-medium text-[#6e6e73]">Saved</p>
            <p className="mt-2 break-all text-[14px] text-[#111]">{result.path}</p>
            <div className="mt-8 flex justify-center">
              <ButtonPrimary type="button" onClick={continueWithPath} className="min-w-[14rem]">
                Continue to observation
              </ButtonPrimary>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}
