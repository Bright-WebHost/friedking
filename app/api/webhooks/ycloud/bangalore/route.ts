import { createHmac, timingSafeEqual } from 'node:crypto'

export const runtime = 'nodejs'
export const maxDuration = 10

const MAX_BODY_BYTES = 1024 * 1024
const SIGNATURE_TOLERANCE_SECONDS = 300
const supportedEvents = new Set(['whatsapp.inbound_message.received', 'whatsapp.message.updated'])

function verifySignature(body: Buffer, header: string, secret: string): boolean {
  const parts = header.split(',').map((part) => part.trim())
  const timestamps = parts.filter((part) => /^t=\d{10}$/.test(part))
  if (timestamps.length !== 1) return false
  const timestamp = timestamps[0].slice(2)
  if (Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp)) > SIGNATURE_TOLERANCE_SECONDS) return false

  const expected = createHmac('sha256', secret).update(timestamp + '.').update(body).digest()
  return parts.some((part) =>
    /^s=[a-f0-9]{64}$/i.test(part) && timingSafeEqual(expected, Buffer.from(part.slice(2), 'hex')),
  )
}

function forwardingUrl(value?: string): URL | null {
  if (!value) return null
  try {
    const url = new URL(value)
    if (url.origin !== 'https://staff.brightmedia.tech' || url.username || url.password || url.search || url.hash) return null
    return /^\/webhook\/friedking-bangalore-[a-f0-9]{40}$/.test(url.pathname) ? url : null
  } catch {
    return null
  }
}

export async function POST(request: Request) {
  const signingSecret = process.env.BANGALORE_YCLOUD_WEBHOOK_SECRET
  const forwardToken = process.env.BANGALORE_N8N_WEBHOOK_TOKEN
  const destination = forwardingUrl(process.env.BANGALORE_N8N_WEBHOOK_URL)
  if (!signingSecret || !forwardToken || !destination) return new Response(null, { status: 503 })

  const signature = request.headers.get('ycloud-signature')
  if (!signature) return new Response(null, { status: 401 })
  if (Number(request.headers.get('content-length')) > MAX_BODY_BYTES) return new Response(null, { status: 413 })

  const rawBody = await request.arrayBuffer()
  if (rawBody.byteLength > MAX_BODY_BYTES) return new Response(null, { status: 413 })
  const body = Buffer.from(rawBody)
  if (!verifySignature(body, signature, signingSecret)) return new Response(null, { status: 401 })

  try {
    const event = JSON.parse(body.toString('utf8'))
    if (!event || typeof event.id !== 'string' || typeof event.type !== 'string') return new Response(null, { status: 400 })
    if (!supportedEvents.has(event.type)) return new Response(null, { status: 204 })
  } catch {
    return new Response(null, { status: 400 })
  }

  try {
    const result = await fetch(destination, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Friedking-Webhook-Token': forwardToken },
      body: rawBody,
      redirect: 'error',
      signal: AbortSignal.timeout(4500),
      cache: 'no-store',
    })
    return new Response(null, { status: result.ok ? 204 : 502 })
  } catch {
    return new Response(null, { status: 502 })
  }
}
