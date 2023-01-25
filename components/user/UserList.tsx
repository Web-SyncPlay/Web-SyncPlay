import { FC, useEffect, useRef, useState } from "react"
import { RoomState, UserState } from "../../lib/types"
import { Socket } from "socket.io-client"
import { ClientToServerEvents, ServerToClientEvents } from "../../lib/socket"
import UserItem from "./UserItem"

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
  const [owner, _setOwner] = useState("")
  const ownerRef = useRef(owner)
  const setOwner = (newOwner: string) => {
    ownerRef.current = newOwner
    _setOwner(newOwner)
  }

  useEffect(() => {
    socket.on("update", (room: RoomState) => {
      if (ownerRef.current !== room.ownerId) {
        setOwner(room.ownerId)
      }
      setUsers(room.users)
    })

    socket.emit("fetch")
  }, [socket])

  return (
    <div
      className={
        "grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-1"
      }
    >
      {users.map((user) => (
        <UserItem
          user={user}
          socketId={socket.id}
          ownerId={owner}
          key={user.uid}
          updateName={(name) => {
            const newUser = JSON.parse(JSON.stringify(user))
            newUser.name = name
            socket.emit("updateUser", newUser)
          }}
        />
      ))}
    </div>
  )
}

export default UserList
