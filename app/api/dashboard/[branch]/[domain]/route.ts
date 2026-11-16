import { NextRequest, NextResponse } from 'next/server'
import { canSee } from '@/lib/dashboard/access'
import { HANDLERS, type Body } from '@/lib/dashboard/handlers'
import { HttpError, resolveCtx } from '@/lib/dashboard/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

function fail(error: unknown) {
  if (error instanceof HttpError) return NextResponse.json({ message: error.message }, { status: error.status })
  console.error('[dashboard api]', error instanceof Error ? error.message : error)
  return NextResponse.json({ message: 'Something went wrong. Try again.' }, { status: 500 })
}

async function setup(branch: string, domain: string) {
  const handler = HANDLERS[domain]
  if (!handler) throw new HttpError(404, 'Not found')
  const ctx = await resolveCtx(branch)
  if (!handler.sections.some((s) => canSee(ctx.staff.role, s))) throw new HttpError(403, 'Your role cannot open this page')
  return { handler, ctx }
}

/** GET /api/dashboard/<branch>/<domain>?… */
export async function GET(req: NextRequest, rc: { params: Promise<{ branch: string; domain: string }> }) {
  try {
    const { branch, domain } = await rc.params
    const { handler, ctx } = await setup(branch, domain)
    if (!handler.get) throw new HttpError(405, 'Not supported')
    return NextResponse.json(await handler.get(ctx, req.nextUrl.searchParams), { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return fail(error)
  }
}

/** POST /api/dashboard/<branch>/<domain> with JSON { action, … } or multipart (field "action"). */
export async function POST(req: NextRequest, rc: { params: Promise<{ branch: string; domain: string }> }) {
  try {
    const { branch, domain } = await rc.params
    const { handler, ctx } = await setup(branch, domain)
    let body: Body
    if ((req.headers.get('content-type') ?? '').includes('multipart/form-data')) {
      const form = await req.formData()
      body = Object.fromEntries(form.entries())
    } else {
      body = await req.json().catch(() => { throw new HttpError(400, 'Invalid request') })
    }
    const action = handler.actions?.[String(body.action ?? '')]
    if (!action) throw new HttpError(400, 'Unknown action')
    return NextResponse.json(await action(ctx, body) ?? { ok: true })
  } catch (error) {
    return fail(error)
  }
}
