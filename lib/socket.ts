import {
  MediaElement,
  PlayerState,
  Playlist,
  RoomState,
  UserState,
} from "./types"
import io, { Socket } from "socket.io-client"

export interface ServerToClientEvents {
  playlistUpdate: (playlist: Playlist) => void
  userUpdates: (users: UserState[]) => void
  update: (room: RoomState) => void
}

export interface ClientToServerEvents {
  playItemFromPlaylist: (index: number) => void
  updatePlaylist: (playlist: Playlist) => void
  updatePlayer: (player: PlayerState) => void
  updatePlaying: (playing: MediaElement) => void
  updateUser: (user: UserState) => void

  setPaused: (paused: boolean) => void
  setLoop: (loop: boolean) => void
  setProgress: (progress: number) => void
  setPlaybackRate: (playbackRate: number) => void

  seek: (progress: number) => void
  playUrl: (src: string) => void
  playAgain: () => void
  playEnded: () => void
  fetch: () => void
  error: () => void
}

export function playItemFromPlaylist(
  socket: Socket<ServerToClientEvents, ClientToServerEvents>,
  playlist: Playlist,
  index: number
) {
  if (
    typeof playlist.items[index] === "undefined" ||
    playlist.items[index] === null
  ) {
    console.error("Impossible to play", index, "from", playlist)
    return
  }
  socket.emit("playItemFromPlaylist", index)
}

export function createClientSocket(roomId: string) {
  console.log("Trying to join room", roomId)
  const socket = io({
    query: {
      roomId,
    },
    transports: ["websocket"],
    path: "/api/socketio",
  })

  socket.on("connect", () => {
    console.log("Established ws connection to io server", socket.id)
  })

  socket.on("disconnect", (reason) => {
    if (!["io client disconnect", "io server disconnect"].includes(reason)) {
      console.error(
        "Socket connection closed due to:",
        reason,
        "socket:",
        socket
      )
    }
  })

  return socket
}
