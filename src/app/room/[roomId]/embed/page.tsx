import { EmbedClient } from "@/components/layout/page/EmbedClient"
import { readMediaQueryParam } from "@/lib/initial-media-url"

export default async function RoomEmbedPage({
  params,
  searchParams,
}: {
  params: Promise<{ roomId: string }>
  searchParams: Promise<{ media?: string | string[] }>
}) {
  const { roomId } = await params
  const query = await searchParams
  // Pass the raw query through — create-time validation happens on join.
  const initialMediaUrl = readMediaQueryParam(query.media)
  return <EmbedClient roomId={roomId} initialMediaUrl={initialMediaUrl} />
}
