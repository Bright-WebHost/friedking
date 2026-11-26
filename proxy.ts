import { createServerClient } from '@supabase/ssr'
import { secondaryBranch, publicProject } from '@/lib/supabase/project'
import { NextResponse, type NextRequest } from 'next/server'

export async function proxy(request: NextRequest) {
  const segment = request.nextUrl.pathname.split('/')[2]
  const branch = segment === 'login' ? request.nextUrl.searchParams.get('branch') : segment
  const requestHeaders = new Headers(request.headers)
  requestHeaders.delete('x-fk-dashboard-branch')
  const selectedBranch = secondaryBranch(branch)
  if (selectedBranch) requestHeaders.set('x-fk-dashboard-branch', selectedBranch)
  let response = NextResponse.next({ request: { headers: requestHeaders } })
  let project: ReturnType<typeof publicProject>
  try {
    project = publicProject(branch)
  } catch {
    return new NextResponse('Dashboard temporarily unavailable', { status: 503 })
  }
  const supabase = createServerClient(
    project.url,
    project.key,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          requestHeaders.set('cookie', request.cookies.toString())
          response = NextResponse.next({ request: { headers: requestHeaders } })
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
        },
      },
    },
  )

  await supabase.auth.getUser()
  return response
}

export const config = {
  matcher: ['/dashboard/:path*'],
}
