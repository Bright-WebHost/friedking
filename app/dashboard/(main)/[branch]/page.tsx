import { redirect } from 'next/navigation'
import { SECTIONS } from '@/lib/dashboard/access'
import { redirectToBranch } from '@/lib/dashboard/routing'

/** /dashboard/<branch> opens Orders; an old /dashboard/<section> link goes to that section on the staff member's branch. */
export default async function BranchHome({ params }: { params: Promise<{ branch: string }> }) {
  const { branch } = await params
  if (SECTIONS.some((s) => s.key === branch)) return redirectToBranch(branch)
  redirect(`/dashboard/${branch}/orders`)
}
