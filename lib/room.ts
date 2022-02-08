import { PlayerState, RoomState } from "./types"
import { getRandomName, getTargetTime } from "./utils"
import { getDefaultSrc } from "./env"
import { getRoom, setRoom } from "./cache"

export const updateLastSync = (room: RoomState) => {
  room.targetState.progress = getTargetTime(
    room.targetState.progress,
    room.targetState.lastSync,
    room.targetState.paused,
    room.targetState.playbackRate
  )
  room.targetState.lastSync = new Date().getTime() / 1000
  return room
}

export const createNewUser = async (roomId: string, socketId: string) => {
  const room = await getRoom(roomId)
  if (room === null) {
    throw new Error("Creating user for non existing room:" + roomId)
  }

  const users = room.users
  let name = getRandomName()
  while (users.some((user) => user.name === name)) {
    name = getRandomName()
  }

  room.users.push({
    avatar: "",
    name,
    player: {
      playing: {
        src: [],
        sub: [],
      },
      paused: false,
      progress: 0,
      playbackRate: 1,
      loop: false,
      volume: 1,
      muted: true,
      fullscreen: false,
      duration: 0,
      error: null,
    } as unknown as PlayerState,
    socketIds: [socketId],
    uid: socketId,
  })

  await setRoom(roomId, room)
}

export const createNewRoom = async (roomId: string, socketId: string) => {
  await setRoom(roomId, {
    serverTime: 0,
    commandHistory: [],
    id: roomId,
    ownerId: socketId,
    targetState: {
      playlist: {
        items: [
          {
            src: [{ src: getDefaultSrc(), resolution: "" }],
            sub: [],
          },
        ],
        currentIndex: 0,
      },
      playing: {
        src: [{ src: getDefaultSrc(), resolution: "" }],
        sub: [],
      },
      paused: false,
      progress: 0,
      playbackRate: 1,
      loop: false,
      lastSync: new Date().getTime() / 1000,
    },
    users: [],
  })
}
