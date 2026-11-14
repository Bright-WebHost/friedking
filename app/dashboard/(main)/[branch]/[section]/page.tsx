import Section from '../../sections/Section'

export default async function BranchSection({ params }: { params: Promise<{ branch: string; section: string }> }) {
  const { section } = await params
  return <Section section={section} />
}
