import { NextRequest, NextResponse } from 'next/server'
import { clearCustomerSession } from '@/lib/customer/session'

export async function POST(req: NextRequest) {
  const branch = req.nextUrl.searchParams.get('branch')
  await clearCustomerSession(branch)
  return NextResponse.json({ ok: true })
}
