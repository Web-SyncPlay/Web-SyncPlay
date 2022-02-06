import { FC, useEffect, useRef, useState } from "react"
import { RoomState, UserState } from "../../lib/types"
import { Socket } from "socket.io-client"
import { ClientToServerEvents, ServerToClientEvents } from "../../lib/socket"

interface Props {
  socket: Socket<ServerToClientEvents, ClientToServerEvents>
}

const UserList: FC<Props> = ({ socket }) => {
  const [users, _setUsers] = useState<UserState[]>([])
  const userRef = useRef(users)
  const setUsers = (newUsers: UserState[]) => {
    userRef.current = newUsers
    _setUsers(newUsers)
  }

  useEffect(() => {
    socket.on("update", (room: RoomState) => {
      setUsers(room.users)
    })

    socket.emit("fetch")
  }, [socket])

  return <div>{users.map((user) => user.name)}</div>
}

export default UserList
