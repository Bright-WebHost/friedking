/**
 * Quick in-browser check of an MP4 before it is used as a WhatsApp video header.
 * WhatsApp accepts H.264 video + AAC audio, up to 16 MB. Files that break these rules either fail
 * or arrive as "This video is not available because something is wrong with the video file",
 * and WhatsApp does NOT report that back to us, so we catch it here before sending.
 * It reads the MP4 box structure only (no decoding), so it is fast and needs no library.
 */
export interface Mp4Report {
  errors: string[]   // will not work: do not upload
  warnings: string[] // may not play on some phones: convert if possible
  info: string       // short summary, e.g. "720×1280 · 45 s · 8.9 MB · H.264 Main + AAC"
}

const MAX_BYTES = 16 * 1024 * 1024

export async function checkMp4(file: File): Promise<Mp4Report> {
  const errors: string[] = []
  const warnings: string[] = []
  const mb = (file.size / 1024 / 1024).toFixed(1)
  if (file.size > MAX_BYTES) errors.push(`The file is ${mb} MB. WhatsApp allows at most 16 MB.`)

  const buf = new Uint8Array(await file.arrayBuffer())
  const view = new DataView(buf.buffer)
  const tag = (o: number) => String.fromCharCode(buf[o], buf[o + 1], buf[o + 2], buf[o + 3])

  // Top-level boxes: ftyp, moov (the index), mdat (the media).
  const top: Record<string, number> = {}
  let o = 0
  while (o + 8 <= buf.length) {
    let size = view.getUint32(o)
    const t = tag(o + 4)
    if (size === 1 && o + 16 <= buf.length) size = Number(view.getBigUint64(o + 8))
    if (size === 0) size = buf.length - o
    if (size < 8) break
    if (!(t in top)) top[t] = o
    if (t === 'moov') top.moovSize = size
    o += size
  }
  if (!('ftyp' in top) || !('moov' in top)) {
    errors.push('This is not a normal MP4 file. Export it again as MP4 (H.264).')
    return { errors, warnings, info: `${mb} MB` }
  }

  // Look only inside moov for codec details.
  const moov = buf.subarray(top.moov, top.moov + top.moovSize)
  const find = (s: string, from = 0) => {
    const c = [0, 1, 2, 3].map((k) => s.charCodeAt(k))
    for (let i = from; i + 3 < moov.length; i++) if (moov[i] === c[0] && moov[i + 1] === c[1] && moov[i + 2] === c[2] && moov[i + 3] === c[3]) return i
    return -1
  }
  const has = (s: string) => find(s)

  let codec = 'unknown'
  if (has('avc1') >= 0 || has('avc3') >= 0) codec = 'H.264'
  else if (has('hvc1') >= 0 || has('hev1') >= 0) codec = 'HEVC'
  else if (has('vp09') >= 0) codec = 'VP9'
  else if (has('av01') >= 0) codec = 'AV1'
  if (codec !== 'H.264') {
    errors.push(codec === 'HEVC'
      ? 'The video is HEVC (H.265), the iPhone default. WhatsApp needs H.264: convert it first.'
      : `The video codec is ${codec}. WhatsApp needs H.264: convert it first.`)
  }

  let profile = ''
  const avcC = has('avcC')
  if (avcC >= 0) {
    const p = moov[avcC + 5]
    profile = p === 66 ? 'Baseline' : p === 77 ? 'Main' : p === 100 ? 'High' : `profile ${p}`
    // No warning for High profile: tested 2026-11-25, a High-profile 478×850 video played fine on WhatsApp.
  }

  const hasAudio = has('soun') >= 0
  if (hasAudio && has('mp4a') < 0) errors.push('The sound is not AAC. WhatsApp needs AAC audio (or no sound).')

  // Video size from the first track header with a width.
  let w = 0, h = 0
  for (let i = find('tkhd'); i >= 0 && !(w && h); i = find('tkhd', i + 4)) {
    const p = top.moov + i + 4 + (moov[i + 4] ? 88 : 76)
    if (p + 8 <= buf.length) { w = view.getUint32(p) / 65536; h = view.getUint32(p + 4) / 65536 }
  }
  if (Math.max(w, h) > 1280) warnings.push(`The video is ${Math.round(w)}×${Math.round(h)}. 720p (720×1280) plays more reliably and is smaller.`)

  if (top.moov > (top.mdat ?? Infinity)) warnings.push('The file is not "fast start" (web optimized), so it may not load on some phones.')

  // Duration from mvhd.
  let secs = 0
  const mvhd = has('mvhd')
  if (mvhd >= 0) {
    const v = moov[mvhd + 4]
    const p = top.moov + mvhd + 4 + 4
    const scale = v ? view.getUint32(p + 16) : view.getUint32(p + 8)
    const dur = v ? Number(view.getBigUint64(p + 20)) : view.getUint32(p + 12)
    if (scale) secs = Math.round(dur / scale)
  }

  const info = [w && h ? `${Math.round(w)}×${Math.round(h)}` : '', secs ? `${secs} s` : '', `${mb} MB`,
    `${codec}${profile ? ` ${profile}` : ''}${!hasAudio ? ', no sound' : has('mp4a') >= 0 ? ' + AAC' : ' + other sound'}`].filter(Boolean).join(' · ')
  return { errors, warnings, info }
}
