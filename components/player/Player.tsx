"use client"
import React, { FC, useEffect, useRef, useState } from "react"
import { type Socket } from "socket.io-client"
import {
  ClientToServerEvents,
  playItemFromPlaylist,
  ServerToClientEvents,
} from "../../lib/socket"
import Controls from "./Controls"
import {
  FullScreen,
  FullScreenProps,
  useFullScreenHandle,
} from "react-full-screen"
import ReactPlayer from "react-player"
import {
  MediaElement,
  MediaOption,
  Playlist,
  RoomState,
  Subtitle,
} from "../../lib/types"
import ConnectingAlert from "../alert/ConnectingAlert"
import { getTargetTime, isSync } from "../../lib/utils"
import BufferAlert from "components/alert/BufferAlert"
import { getDefaultSrc } from "../../lib/env"
import AutoplayAlert from "../alert/AutoplayAlert"

interface Props {
  roomId: string
  socket: Socket<ServerToClientEvents, ClientToServerEvents>
  fullHeight?: boolean
}

let seeking = false

const Player: FC<Props> = ({ roomId, socket, fullHeight }) => {
  // data to be reported to the server
  // updateX is never allowed to be called outside the _setX functions
  // _setX should not be called directly, but set via message from the server
  // setX are the normal plain state hooks
  const [playlist, updatePlaylist] = useState<Playlist>({
    items: [],
    currentIndex: -1,
  })
  const playlistRef = useRef(playlist)
  const _setPlaylist = (newPlaylist: Playlist) => {
    updatePlaylist(newPlaylist)
    playlistRef.current = newPlaylist
  }
  const [playing, updatePlaying] = useState<MediaElement>({ sub: [], src: [] })
  const playingRef = useRef(playing)
  const _setPlaying = (newPlaying: MediaElement) => {
    updatePlaying(newPlaying)
    playingRef.current = newPlaying
  }
  const [paused, updatePaused] = useState(false)
  const pausedRef = useRef(paused)
  const _setPaused = (newPaused: boolean) => {
    updatePaused(newPaused)
    pausedRef.current = newPaused
  }
  const setPaused = (newPaused: boolean) => {
    socket?.emit("setPaused", newPaused)
  }
  const [volume, setVolume] = useState(1)
  const [muted, setMuted] = useState(true)
  const [playbackRate, updatePlaybackRate] = useState(1)
  const playbackRateRef = useRef(playbackRate)
  const _setPlaybackRate = (newPlaybackRate: number) => {
    updatePlaybackRate(newPlaybackRate)
    playbackRateRef.current = newPlaybackRate
  }
  const setPlaybackRate = (newPlaybackRate: number) =>
    socket?.emit("setPlaybackRate", newPlaybackRate)
  const [targetProgress, updateTargetProgress] = useState(0)
  const targetProgressRef = useRef(targetProgress)
  const _setTargetProgress = (newTargetProgress: number) => {
    updateTargetProgress(newTargetProgress)
    targetProgressRef.current = newTargetProgress
  }
  const [progress, _setProgress] = useState(0)
  const setProgress = (newProgress: number) => {
    socket?.emit("setProgress", newProgress)
    _setProgress(newProgress)
  }
  const [loop, updateLoop] = useState(false)
  const loopRef = useRef(loop)
  const _setLoop = (newLoop: boolean) => {
    updateLoop(newLoop)
    loopRef.current = newLoop
  }
  const setLoop = (newLoop: boolean) => socket?.emit("setLoop", newLoop)
  const [lastSync, updateLastSync] = useState(new Date().getTime() / 1000)
  const lastSyncRef = useRef(lastSync)
  const _setLastSync = (newLastSync: number) => {
    updateLastSync(newLastSync)
    lastSyncRef.current = newLastSync
  }
  const [deltaServerTime, _setDeltaServerTime] = useState(0)
  const deltaServerTimeRef = useRef(deltaServerTime)
  const setDeltaServerTime = (newDeltaServerTime: number) => {
    _setDeltaServerTime(newDeltaServerTime)
    deltaServerTimeRef.current = newDeltaServerTime
  }

  const [duration, setDuration] = useState(0)
  const [currentSrc, setCurrentSrc] = useState<MediaOption>({
    src: getDefaultSrc(),
    resolution: "",
  })
  const [currentSub, setCurrentSub] = useState<Subtitle>({ src: "", lang: "" })

  const [error, setError] = useState(null)
  const [ready, _setReady] = useState(false)
  const readyRef = useRef(ready)
  const setReady = (newReady: boolean) => {
    _setReady(newReady)
    readyRef.current = newReady
  }
  const [seeked, _setSeeked] = useState(false)
  const seekedRef = useRef(seeked)
  const setSeeked = (newSeeked: boolean) => {
    _setSeeked(newSeeked)
    seekedRef.current = newSeeked
  }
  const [buffering, setBuffering] = useState(true)
  const [connected, setConnected] = useState(false)
  const [unmuted, setUnmuted] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const fullscreenHandle = useFullScreenHandle()
  const player = useRef<ReactPlayer>(null)

  useEffect(() => {
    if (!muted && !unmuted) {
      setUnmuted(true)
    }
  }, [muted, unmuted])

  useEffect(() => {
    if (
      !readyRef.current ||
      player.current === null ||
      typeof player.current === "undefined"
    )
      return
    if (
      !isSync(
        player.current.getCurrentTime(),
        targetProgress,
        lastSync - deltaServerTime,
        paused,
        playbackRate
      ) &&
      !seeking
    ) {
      const t = getTargetTime(
        targetProgress,
        lastSync - deltaServerTime,
        paused,
        playbackRate
      )
      console.log("Not in sync, seeking to", t)
      player.current.seekTo(t, "seconds")
    }
  }, [
    progress,
    targetProgress,
    lastSync,
    deltaServerTime,
    paused,
    ready,
    playbackRate,
  ])

  useEffect(() => {
    socket.on("connect", () => {
      setConnected(true)
    })
    socket.on("disconnect", () => {
      setConnected(false)
    })
    if (socket.connected) {
      setConnected(true)
    }

    socket.on("update", (room: RoomState) => {
      if (!readyRef.current) {
        return console.log("Not ready yet...")
      }

      if (deltaServerTimeRef.current === 0) {
        setDeltaServerTime((room.serverTime - new Date().getTime()) / 1000)
      }

      const update = room.targetState
      if (update.lastSync !== lastSyncRef.current) {
        _setLastSync(update.lastSync)
      }
      if (update.progress !== targetProgressRef.current) {
        _setTargetProgress(update.progress)
        setSeeked(false)
      }
      if (
        JSON.stringify(update.playing) !== JSON.stringify(playingRef.current)
      ) {
        _setPlaying(update.playing)
        setCurrentSrc(update.playing.src[0])
      }
      if (update.paused !== pausedRef.current) {
        _setPaused(update.paused)
      }
      if (update.playbackRate !== playbackRateRef.current) {
        _setPlaybackRate(update.playbackRate)
      }
      if (update.loop !== loopRef.current) {
        _setLoop(update.loop)
      }
      if (
        JSON.stringify(update.playlist) !== JSON.stringify(playlistRef.current)
      ) {
        _setPlaylist(update.playlist)
      }
    })
  }, [socket])

  useEffect(() => {
    if (ready) {
      socket.emit("fetch")
    }
  }, [ready, socket])

  const FullScreenWithChildren = FullScreen as React.FC<
    React.PropsWithChildren<FullScreenProps>
  >
  return (
    <FullScreenWithChildren
      className={"relative grow flex select-none"}
      handle={fullscreenHandle}
      onChange={(state, _) => {
        if (fullscreen !== state) {
          setFullscreen(state)
        }
      }}
    >
      <ReactPlayer
        style={{
          maxHeight: fullscreen || fullHeight ? "100vh" : "calc(100vh - 210px)",
        }}
        ref={player}
        width={"100%"}
        height={fullscreen || fullHeight ? "100vh" : "calc((9 / 16) * 100vw)"}
        config={{
          youtube: {
            playerVars: {
              disablekb: 1,
              modestbranding: 1,
              origin: window.location.host,
            },
          },
          file: {
            hlsVersion: "1.1.3",
            dashVersion: "4.2.1",
            flvVersion: "1.6.2",
          },
        }}
        url={currentSrc.src}
        pip={false}
        playing={!paused}
        controls={false}
        loop={loop}
        playbackRate={playbackRate}
        volume={volume}
        muted={muted}
        onReady={() => {
          console.log("React-Player is ready")
          setReady(true)
          setBuffering(false)
          // need "long" timeout for yt to be ready
          setTimeout(() => {
            const internalPlayer = player.current?.getInternalPlayer()
            console.log("Internal player:", player)
            if (
              typeof internalPlayer !== "undefined" &&
              internalPlayer.unloadModule
            ) {
              console.log("Unloading cc of youtube player")
              internalPlayer.unloadModule("cc") // Works for AS3 ignored by html5
              internalPlayer.unloadModule("captions") // Works for html5 ignored by AS3
            }
          }, 1000)
        }}
        onPlay={() => {
          console.log("player started to play")
          if (paused) {
            const internalPlayer = player.current?.getInternalPlayer()
            console.warn("Started to play despite being paused", internalPlayer)
            if (typeof internalPlayer !== "undefined") {
              if ("pause" in internalPlayer) {
                internalPlayer.pause()
              }
              if ("pauseVideo" in internalPlayer) {
                internalPlayer.pauseVideo()
              }
            }
          }
        }}
        onPause={() => {
          console.log("player paused")
          if (!paused) {
            const internalPlayer = player.current?.getInternalPlayer()
            console.warn(
              "Started to pause despite being not paused",
              internalPlayer
            )
            if (typeof internalPlayer !== "undefined") {
              if ("play" in internalPlayer) {
                internalPlayer.play()
              }
              if ("playVideo" in internalPlayer) {
                internalPlayer.playVideo()
              }
            }
          }
        }}
        onBuffer={() => setBuffering(true)}
        onBufferEnd={() => setBuffering(false)}
        onEnded={() => socket?.emit("playEnded")}
        onError={(e) => {
          console.error("playback error", e)
          if ("target" in e && "type" in e && e.type === "error") {
            console.log("Trying to get video url via yt-dlp...")
            fetch("/api/source", { method: "POST", body: currentSrc.src })
              .then((res) => {
                if (res.status === 200) {
                  return res.json()
                }
                return res.text()
              })
              .then((data) => {
                console.log("Received data", data)
                if (typeof data === "string") {
                  throw new Error(data)
                }
                if (data.error) {
                  throw new Error(data.stderr)
                }

                const videoSrc: string[] = data.stdout
                  .split("\n")
                  .filter((v: string) => v !== "")
                setCurrentSrc({
                  src: videoSrc[0],
                  resolution: "",
                })
              })
              .catch((error) => {
                console.error("Failed to get video url", error)
              })
            setError(e)
          }
        }}
        onProgress={({ playedSeconds }) => {
          if (!ready) {
            console.warn(
              "React-Player did not report it being ready, but already playing"
            )
            // sometimes onReady doesn't fire, but if there's playback...
            setReady(true)
          }
          if (!seeking || !seeked) {
            setProgress(playedSeconds)
          }
        }}
        onDuration={setDuration}
      />

      <Controls
        roomId={roomId}
        playing={playing}
        setCurrentSrc={setCurrentSrc}
        setCurrentSub={setCurrentSub}
        setPaused={setPaused}
        setVolume={setVolume}
        setMuted={setMuted}
        setProgress={(newProgress) => {
          setSeeked(true)
          socket?.emit("seek", newProgress)
        }}
        setPlaybackRate={setPlaybackRate}
        setLoop={setLoop}
        setFullscreen={async (newFullscreen) => {
          if (fullscreenHandle.active !== newFullscreen) {
            if (newFullscreen) {
              await fullscreenHandle.enter()
            } else {
              await fullscreenHandle.exit()
            }
          }
          setFullscreen(newFullscreen)
        }}
        playlist={playlist}
        currentSrc={currentSrc}
        currentSub={currentSub}
        paused={paused}
        volume={volume}
        muted={muted}
        progress={progress}
        playbackRate={playbackRate}
        fullscreen={fullscreen}
        duration={duration}
        loop={loop}
        playIndex={(index) => {
          playItemFromPlaylist(socket, playlist, index)
        }}
        setSeeking={(newSeeking) => {
          seeking = newSeeking
        }}
        lastSync={lastSync}
        error={error}
        playAgain={() => socket?.emit("playAgain")}
      />

      <div className={"absolute top-1 left-1 flex flex-col gap-1 p-1"}>
        {!connected && <ConnectingAlert canClose={false} />}
        {buffering && <BufferAlert canClose={false} />}
        {!unmuted && (
          <AutoplayAlert
            onClick={() => {
              setUnmuted(true)
              setMuted(false)
            }}
          />
        )}
      </div>
    </FullScreenWithChildren>
  )
}

export default Player
