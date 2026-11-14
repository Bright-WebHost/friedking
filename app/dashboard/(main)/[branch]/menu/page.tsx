import Section from '../../sections/Section'

/* Static route kept so old links work; renders the same section as /dashboard/<branch>/menu. */
export default function BranchMenuPage() {
  return <Section section="menu" />
}
