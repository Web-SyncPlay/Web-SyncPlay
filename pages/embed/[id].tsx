import Embed from "../../components/Embed"
import { GetServerSideProps } from "next"

export default function RoomPage({ roomId }: { roomId: string }) {
  return (
      <Embed id={roomId} />
  )
}

export const getServerSideProps: GetServerSideProps = async ({ params }) => {
  const roomId = params?.id

  // force min length of 4
  if (!roomId || typeof roomId !== "string" || roomId.length < 4) {
    return {
      notFound: true,
    }
  }

  return {
    props: {
      roomId,
    },
  }
}
