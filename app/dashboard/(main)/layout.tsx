import { redirect } from 'next/navigation'
import { getStaffContext } from '@/lib/auth/staff'
import DashboardShell from './DashboardShell'
import '../dashboard.css'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const staff = await getStaffContext()
  if (!staff) redirect('/dashboard/login?error=unauthorized')
  return <DashboardShell staff={staff}>{children}</DashboardShell>
}
