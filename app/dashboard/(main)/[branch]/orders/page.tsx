import Section from '../../sections/Section'

/* Static route kept so old links work; renders the same section as /dashboard/<branch>/orders. */
export default function BranchOrdersPage() {
  return <Section section="orders" />
}
