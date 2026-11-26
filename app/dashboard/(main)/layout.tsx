import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getStaffContext } from '@/lib/auth/staff'
import DashboardShell from './DashboardShell'
import '../dashboard.css'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const branch = (await headers()).get('x-fk-dashboard-branch')
  const staff = await getStaffContext(branch)
  if (!staff) redirect(branch ? '/dashboard/login?error=unauthorized&branch=' + encodeURIComponent(branch) : '/dashboard/login?error=unauthorized')
  return <DashboardShell staff={staff}>{children}</DashboardShell>
}
