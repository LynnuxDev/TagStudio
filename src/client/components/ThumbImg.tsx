import { useState, useEffect } from 'react'
import { extOf } from '../utils/media'

/** Raster images safe to serve through the cached /thumbnail endpoint.
 *  SVG / RPGMaker assets have no ffmpeg thumbnail support — those fall back
 *  to /raw directly. */
const THUMB_IMAGE_EXTS = new Set([
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tif', 'tiff',
])

export function hasCachedThumb(name: string): boolean {
  return THUMB_IMAGE_EXTS.has(extOf(name))
}

interface ThumbImgProps {
  path: string
  name: string
  /** Use the cached /thumbnail endpoint first (videos, thumbnail-eligible images). */
  thumb: boolean
  /** Set for videos: a raw video file can never render in an <img>, so on
   *  thumbnail failure we go straight to the icon instead of a doomed request. */
  video?: boolean
  fallbackIcon?: string
  className?: string
  alt?: string
}

/** Grid thumbnail: cached 320px webp via /thumbnail, falling back to the
 *  full file via /raw for images, or to a file-type icon when nothing can
 *  render (e.g. video with no thumbnail yet). */
export default function ThumbImg({ path, name, thumb, video, fallbackIcon = '📄', className, alt }: ThumbImgProps) {
  const [stage, setStage] = useState<'thumb' | 'raw' | 'dead'>(thumb ? 'thumb' : 'raw')
  useEffect(() => { setStage(thumb ? 'thumb' : 'raw') }, [path, thumb])
  if (stage === 'dead') {
    return <span className="grid-card-icon">{fallbackIcon}</span>
  }
  const src =
    stage === 'thumb'
      ? `/api/files/thumbnail?path=${encodeURIComponent(path)}`
      : `/api/files/raw?path=${encodeURIComponent(path)}`
  return (
    <img
      src={src}
      alt={alt ?? name}
      loading="lazy"
      decoding="async"
      className={className}
      onError={() => setStage(s => (s === 'thumb' && !video ? 'raw' : 'dead'))}
    />
  )
}
