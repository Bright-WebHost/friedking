import DashboardClient from '../../DashboardClient'

export default async function BranchOrdersPage({ params }: { params: Promise<{ branch: string }> }) {
  const { branch } = await params
  return <DashboardClient branchSlug={branch} tab="orders" />
}
