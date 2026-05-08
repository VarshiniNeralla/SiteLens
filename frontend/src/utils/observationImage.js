/**
 * Resolved image URL for an observation (Cloudinary HTTPS, /static local, or absolute path).
 */
export function observationImageSrc(o) {
  if (!o) return ''
  const direct = o.cloudinary_secure_url?.trim() || o.image_path?.trim()
  if (!direct) return ''
  if (direct.startsWith('http://') || direct.startsWith('https://')) return direct
  if (direct.startsWith('/')) return direct
  const p = direct.replace(/^\/+/, '')
  return `/static/${p}`
}
