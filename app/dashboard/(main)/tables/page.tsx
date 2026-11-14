import { redirectToBranch } from '@/lib/dashboard/routing'

export default async function OldTablesLink() {
  return redirectToBranch('tables')
}
