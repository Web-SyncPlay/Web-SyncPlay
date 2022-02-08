import * as socketIo from "socket.io"
import { Server } from "socket.io"
import { NextApiRequest, NextApiResponse } from "next"
import { ClientToServerEvents, ServerToClientEvents } from "../../lib/socket"
import {
  decUsers,
  deleteRoom,
  getRoom,
  incUsers,
  roomExists,
  setRoom,
} from "../../lib/cache"
import { createNewRoom, createNewUser, updateLastSync } from "../../lib/room"
import { Playlist, RoomState, UserState } from "../../lib/types"
import { isUrl } from "../../lib/utils"

const ioHandler = (_: NextApiRequest, res: NextApiResponse) => {
  // @ts-ignore
  if (res.socket !== null && "server" in res.socket && !res.socket.server.io) {
    console.log("*First use, starting socket.io")

    const io = new Server<ClientToServerEvents, ServerToClientEvents>(
      // @ts-ignore
      res.socket.server,
      {
        path: "/api/socketio",
      }
    )

    const broadcast = async (room: string | RoomState) => {
      const roomId = typeof room === "string" ? room : room.id

      if (typeof room !== "string") {
        await setRoom(roomId, room)
      } else {
        const d = await getRoom(roomId)
        if (d === null) {
          throw Error("Impossible room state of null for room: " + roomId)
        }
        room = d
      }

      room.serverTime = new Date().getTime()
      io.to(roomId).emit("update", room)
    }

    io.on(
      "connection",
      async (
        socket: socketIo.Socket<ClientToServerEvents, ServerToClientEvents>
      ) => {
        if (
          !("roomId" in socket.handshake.query) ||
          typeof socket.handshake.query.roomId !== "string"
        ) {
          socket.disconnect()
          return
        }

        const roomId = socket.handshake.query.roomId.toLowerCase()
        const log = (...props: any[]) => {
          console.log(
            "[" + new Date().toUTCString() + "][room " + roomId + "]",
            socket.id,
            ...props
          )
        }

        if (!(await roomExists(roomId))) {
          await createNewRoom(roomId, socket.id)
          log("created room")
        }

        socket.join(roomId)
        await incUsers()
        log("joined")

        await createNewUser(roomId, socket.id)

        socket.on("disconnect", async () => {
          await decUsers()
          log("disconnected")
          const room = await getRoom(roomId)
          if (room === null) return

          room.users = room.users.filter(
            (user) => user.socketIds[0] !== socket.id
          )
          if (room.users.length === 0) {
            await deleteRoom(roomId)
            log("deleted empty room")
          } else {
            if (room.ownerId === socket.id) {
              room.ownerId = room.users[0].uid
            }
            await broadcast(room)
          }
        })

        socket.on("setPaused", async (paused) => {
          let room = await getRoom(roomId)
          if (room === null) {
            throw new Error("Setting pause for non existing room:" + roomId)
          }
          log("set paused to", paused)

          room = updateLastSync(room)
          room.targetState.paused = paused
          await broadcast(room)
        })

        socket.on("setLoop", async (loop) => {
          const room = await getRoom(roomId)
          if (room === null) {
            throw new Error("Setting loop for non existing room:" + roomId)
          }
          log("set loop to", loop)

          room.targetState.loop = loop
          await broadcast(updateLastSync(room))
        })

        socket.on("setProgress", async (progress) => {
          const room = await getRoom(roomId)
          if (room === null) {
            throw new Error("Setting progress for non existing room:" + roomId)
          }

          room.users = room.users.map((user) => {
            if (user.socketIds[0] === socket.id) {
              user.player.progress = progress
            }
            return user
          })

          await broadcast(room)
        })

        socket.on("setPlaybackRate", async (playbackRate) => {
          let room = await getRoom(roomId)
          if (room === null) {
            throw new Error(
              "Setting playbackRate for non existing room:" + roomId
            )
          }
          log("set playbackRate to", playbackRate)

          room = updateLastSync(room)
          room.targetState.playbackRate = playbackRate
          await broadcast(room)
        })

        socket.on("seek", async (progress) => {
          const room = await getRoom(roomId)
          if (room === null) {
            throw new Error("Setting progress for non existing room:" + roomId)
          }
          log("seeking to", progress)

          room.targetState.progress = progress
          room.targetState.lastSync = new Date().getTime() / 1000
          await broadcast(room)
        })

        socket.on("playEnded", async () => {
          let room = await getRoom(roomId)
          if (room === null) {
            throw new Error("Play ended for non existing room:" + roomId)
          }
          log("playback ended")

          if (room.targetState.loop) {
            room.targetState.progress = 0
            room.targetState.paused = false
          } else if (
            room.targetState.playlist.currentIndex + 1 <
            room.targetState.playlist.items.length
          ) {
            room.targetState.playing =
              room.targetState.playlist.items[
                room.targetState.playlist.currentIndex + 1
              ]
            room.targetState.playlist.currentIndex += 1
            room.targetState.progress = 0
            room.targetState.paused = false
          } else {
            room.targetState.progress =
              room.users.find((user) => user.socketIds[0] === socket.id)?.player
                .progress || 0
            room.targetState.paused = true
          }
          room.targetState.lastSync = new Date().getTime() / 1000
          await broadcast(room)
        })

        socket.on("playAgain", async () => {
          let room = await getRoom(roomId)
          if (room === null) {
            throw new Error("Play again for non existing room:" + roomId)
          }
          log("play same media again")

          room.targetState.progress = 0
          room.targetState.paused = false
          room.targetState.lastSync = new Date().getTime() / 1000
          await broadcast(room)
        })

        socket.on("playItemFromPlaylist", async (index) => {
          let room = await getRoom(roomId)
          if (room === null) {
            throw new Error("Play ended for non existing room:" + roomId)
          }

          if (index < 0 || index >= room.targetState.playlist.items.length) {
            return log(
              "out of index:",
              index,
              "playlist.length:",
              room.targetState.playlist.items.length
            )
          }

          log("playing item", index, "from playlist")
          room.targetState.playing = room.targetState.playlist.items[index]
          room.targetState.playlist.currentIndex = index
          room.targetState.progress = 0
          room.targetState.lastSync = new Date().getTime() / 1000
          await broadcast(room)
        })

        socket.on("updatePlaylist", async (playlist: Playlist) => {
          const room = await getRoom(roomId)
          if (room === null) {
            throw new Error("Setting playlist for non existing room:" + roomId)
          }
          log("playlist update", playlist)

          if (
            playlist.currentIndex < -1 ||
            playlist.currentIndex >= playlist.items.length
          ) {
            return log(
              "out of index:",
              playlist.currentIndex,
              "playlist.length:",
              playlist.items.length
            )
          }

          room.targetState.playlist = playlist
          await broadcast(room)
        })

        socket.on("updateUser", async (user: UserState) => {
          const room = await getRoom(roomId)
          if (room === null) {
            throw new Error("Setting user for non existing room:" + roomId)
          }
          log("user update", user)

          room.users = room.users.map((u) => {
            if (u.socketIds[0] !== socket.id) {
              return u
            }
            if (u.avatar !== user.avatar) {
              u.avatar = user.avatar
            }
            if (u.name !== user.name) {
              u.name = user.name
            }
            return u
          })

          await broadcast(room)
        })

        socket.on("playUrl", async (url) => {
          const room = await getRoom(roomId)
          if (room === null) {
            throw new Error(
              "Impossible non existing room, cannot send anything:" + roomId
            )
          }
          log("playing url", url)

          if (!isUrl(url)) {
            return
          }

          room.targetState.playing = {
            src: [{ src: url, resolution: "" }],
            sub: [],
          }
          room.targetState.playlist.currentIndex = -1
          room.targetState.progress = 0
          room.targetState.lastSync = new Date().getTime() / 1000
          await broadcast(room)
        })

        socket.on("fetch", async () => {
          const room = await getRoom(roomId)
          if (room === null) {
            throw new Error(
              "Impossible non existing room, cannot send anything:" + roomId
            )
          }

          room.serverTime = new Date().getTime()
          socket.emit("update", room)
        })
      }
    )

    // @ts-ignore
    res.socket.server.io = io
  }

  res.end()
}

export const config = {
  api: {
    bodyParser: false,
  },
}

export default ioHandler
