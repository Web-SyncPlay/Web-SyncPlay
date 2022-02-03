import Room from "../../components/Room"
import { GetServerSideProps } from "next"
import Layout from "../../components/Layout"

export default function RoomPage({ roomId }: { roomId: string }) {
  return (
    <Layout
      meta={{
        title: "Room " + roomId,
        description: "Watch in sync and join the watch party with your friends",
      }}
      roomId={roomId}
    >
      <Room id={roomId} />
    </Layout>
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
