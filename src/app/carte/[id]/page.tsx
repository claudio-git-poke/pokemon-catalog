import { redirect } from 'next/navigation'
export default function LegacyCardPage({ params }: { params: { id: string } }) {
  redirect(`/carta/${encodeURIComponent(params.id)}`)
}
