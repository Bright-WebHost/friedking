import { redirectToBranch } from '@/lib/dashboard/routing'

export default async function OldOrdersLink() {
  return redirectToBranch('orders')
}
