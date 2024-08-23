import { type Metadata, type ResolvingMetadata } from "next";
import { redirect } from "next/navigation";
import Embed from "~/components/Embed";
import { env } from "~/env";
import { getRoom } from "~/lib/cache/redis";

export async function generateMetadata(
  { params }: { params: { roomId: string } },
  parent: ResolvingMetadata,
): Promise<Metadata> {
  // read route params
  const id = params.roomId;

  // fetch data
  const room = await getRoom(id);

  // optionally access and extend (rather than replace) parent metadata
  const previousImages = (await parent).openGraph?.images ?? [];

  const metadata: Metadata = {
    title:
      (room !== null
        ? ("[" + id + "] Playing " + room.targetState.playing.title ??
          room.targetState.playing.src[0]?.url)
        : "Null room...") +
      " | " +
      env.NEXT_PUBLIC_SITE_NAME,
    description: "Watch videos or play music in sync with your friends",
    openGraph: {
      images: ["/apple-touch-icon.png", ...previousImages],
    },
    icons: [
      { rel: "icon", url: "/apple-touch-icon.png" },
      { rel: "icon", url: "/favicon.ico" },
    ],
    robots: "noindex, noarchive, nofollow",
  };
  return metadata;
}

export default function EmbedPage({ params }: { params: { roomId: string } }) {
  if (params.roomId.length < 4) {
    redirect("/");
  }

  return <Embed id={params.roomId} />;
}
