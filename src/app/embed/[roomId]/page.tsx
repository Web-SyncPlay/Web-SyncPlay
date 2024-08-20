import { redirect } from "next/navigation";
import Embed from "~/components/Embed";

export default function EmbedPage({ params }: { params: { roomId: string } }) {
  if (params.roomId.length < 4) {
    redirect("/");
  }

  return <Embed id={params.roomId} />;
}
