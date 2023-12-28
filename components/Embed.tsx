"use client"
import { FC, useEffect, useState } from "react"
import Player from "./player/Player"
import {
  ClientToServerEvents,
  createClientSocket,
  ServerToClientEvents,
} from "../lib/socket"
import { Socket } from "socket.io-client"
import ConnectingAlert from "./alert/ConnectingAlert"

interface Props {
  id: string
}

let connecting = false

const Embed: FC<Props> = ({ id }) => {
  const [connected, setConnected] = useState(false)
  const [socket, setSocket] = useState<Socket<
    ServerToClientEvents,
    ClientToServerEvents
  > | null>(null)

  useEffect(() => {
    fetch("/api/socketio").finally(() => {
      if (socket !== null) {
        setConnected(socket.connected)
      } else {
        const newSocket = createClientSocket(id)
        newSocket.on("connect", () => {
          setConnected(true)
        })
        setSocket(newSocket)
      }
    })

    return () => {
      if (socket !== null) {
        socket.disconnect()
      }
    }
  }, [id, socket])

  const connectionCheck = () => {
    if (socket !== null && socket.connected) {
      connecting = false
      setConnected(true)
      return
    }
    setTimeout(connectionCheck, 100)
  }

  if (!connected || socket === null) {
    if (!connecting) {
      connecting = true
      connectionCheck()
    }
    return (
      <div className={"flex justify-center"}>
        <ConnectingAlert />
      </div>
    )
  }

  return (
      <Player roomId={id} socket={socket}  fullHeight={true}/>
  )
}

export default Embed
