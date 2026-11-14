import { redirectToBranch } from '@/lib/dashboard/routing'

export default async function OldMenuLink() {
  return redirectToBranch('menu')
}
