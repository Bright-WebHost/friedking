/**
 * Is a branch open right now (India time)? opens/closes are the branch's "HH:MM[:SS]" values.
 * Works for a closing time after midnight (opens 18:00, closes 02:00). Missing or equal times mean "always open",
 * the same rule the WhatsApp bot uses, so the website and the bot never disagree.
 */
export function isOpenNow(opens: string | null | undefined, closes: string | null | undefined, now: Date = new Date()): boolean {
  const toHours = (t: string | null | undefined) => {
    const m = String(t ?? '').match(/^(\d{1,2}):(\d{2})/)
    return m ? Number(m[1]) + Number(m[2]) / 60 : null
  }
  const open = toHours(opens)
  const close = toHours(closes)
  if (open === null || close === null || open === close) return true
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000)
  const hours = ist.getUTCHours() + ist.getUTCMinutes() / 60
  return open < close ? hours >= open && hours < close : hours >= open || hours < close
}
