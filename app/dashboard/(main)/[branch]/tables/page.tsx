import Section from '../../sections/Section'

/* Static route kept so old links work; renders the same section as /dashboard/<branch>/tables. */
export default function BranchTablesPage() {
  return <Section section="orders" />
}
