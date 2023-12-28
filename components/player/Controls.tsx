import React, { FC, useState } from "react"
import { MediaOption, PlayerState, Subtitle } from "../../lib/types"
import InteractionHandler from "../action/InteractionHandler"
import IconBigPause from "../icon/IconBigPause"
import IconBigPlay from "../icon/IconBigPlay"
import classNames from "classnames"
import InputSlider from "../input/InputSlider"
import IconPlay from "../icon/IconPlay"
import IconPause from "../icon/IconPause"
import IconReplay from "../icon/IconReplay"
import { secondsToTime, SYNC_DELTA } from "../../lib/utils"
import IconCompress from "../icon/IconCompress"
import IconExpand from "../icon/IconExpand"
import ControlButton from "../input/ControlButton"
import VolumeControl from "./VolumeControl"
import IconBackward from "../icon/IconBackward"
import IconForward from "../icon/IconForward"
import PlayerMenu from "./PlayerMenu"
import { Tooltip } from "react-tooltip"
import IconNewTab from "../icon/IconNewTab"
import Link from "next/link"

interface Props extends PlayerState {
  roomId: string
  setCurrentSrc: (src: MediaOption) => void
  setCurrentSub: (sub: Subtitle) => void
  setPaused: (paused: boolean) => void
  setVolume: (volume: number) => void
  setMuted: (muted: boolean) => void
  setProgress: (progress: number) => void
  setPlaybackRate: (playbackRate: number) => void
  setFullscreen: (fullscreen: boolean) => void
  setLoop: (loop: boolean) => void
  playIndex: (index: number) => void
  setSeeking: (seeking: boolean) => void
  playAgain: () => void
}

let interaction = false
let doubleClick = false
let interactionTime = 0
let lastMouseMove = 0

const Controls: FC<Props> = ({
  roomId,
  playing,
  playlist,
  currentSrc,
  setCurrentSrc,
  currentSub,
  setCurrentSub,
  paused,
  setPaused,
  volume,
  setVolume,
  muted,
  setMuted,
  progress,
  setProgress,
  playbackRate,
  loop,
  setLoop,
  setPlaybackRate,
  fullscreen,
  setFullscreen,
  duration,
  playIndex,
  setSeeking,
  playAgain,
}) => {
  const [showControls, setShowControls] = useState(true)
  const [showTimePlayed, setShowTimePlayed] = useState(true)
  const [menuOpen, setMenuOpen] = useState(false)

  const interact = () => {
    interaction = true
    interactionTime = new Date().getTime()

    setTimeout(() => {
      if (new Date().getTime() - interactionTime > 350) {
        if (interaction && !doubleClick) {
          doubleClick = false
          if (playEnded()) {
            playAgain()
          } else {
            setPaused(!paused)
          }
        }

        interaction = false
      }
    }, 400)
  }

  const showControlsAction = (touch: boolean | null) => {
    if (!showControls) {
      setShowControls(true)
    }
    mouseMoved(touch)
  }

  const playEnded = () => {
    return paused && progress > duration - SYNC_DELTA
  }

  const mouseMoved = (touch: boolean | null = null) => {
    lastMouseMove = new Date().getTime()

    setTimeout(
      () => {
        if (new Date().getTime() - lastMouseMove > (touch ? 3150 : 1550)) {
          setShowControls(false)
        }
      },
      touch ? 3200 : 1600
    )
  }

  const show = showControls || menuOpen

  return (
    <>
      <InteractionHandler
        className={classNames(
          "absolute top-0 left-0 w-full h-full transition-opacity flex flex-col",
          show ? "opacity-100" : "opacity-0"
        )}
        onMove={(_, touch) => {
          setShowControls(!touch)
        }}
        tabIndex={1}
        onKey={(key) => {
          console.log("Key down", key)
          if (key === " ") {
            setPaused(!paused)
          }
        }}
      >
        <InteractionHandler
          className={
            "flex grow cursor-pointer items-center align-middle justify-items-center justify-center"
          }
          onClick={(_, touch) => {
            if (interaction) {
              doubleClick = true
              interaction = false
              console.log("Toggled fullscreen")
              setFullscreen(!fullscreen)
            } else if (touch) {
              setShowControls(!showControls)
              setMenuOpen(false)
            }

            interact()
            mouseMoved(touch)
          }}
          onMove={(_, touch) => {
            showControlsAction(!touch)
          }}
        >
          {paused ? <IconBigPlay /> : <IconBigPause />}
        </InteractionHandler>

        <InputSlider
          className={"bg-dark-900/20"}
          value={progress}
          onChange={(value) => {
            setProgress(value)
            mouseMoved()
          }}
          max={duration}
          setSeeking={setSeeking}
          showValueHover={true}
        />

        <div className={"flex flex-row p-1 items-stretch bg-dark-900/20"}>
          {playlist.currentIndex > 0 && (
            <ControlButton
              tooltip={"Play previous"}
              onClick={() => {
                if (show && playlist.currentIndex > 0) {
                  playIndex(playlist.currentIndex - 1)
                }
              }}
              interaction={showControlsAction}
            >
              <IconBackward />
            </ControlButton>
          )}
          <ControlButton
            tooltip={playEnded() ? "Play again" : paused ? "Play" : "Pause"}
            onClick={() => {
              if (show) {
                if (playEnded()) {
                  playAgain()
                } else {
                  setPaused(!paused)
                }
              }
            }}
            interaction={showControlsAction}
          >
            {playEnded() ? (
              <IconReplay />
            ) : paused ? (
              <IconPlay />
            ) : (
              <IconPause />
            )}
          </ControlButton>
          {playlist.currentIndex < playlist.items.length - 1 && (
            <ControlButton
              tooltip={"Skip"}
              onClick={() => {
                if (show && playlist.currentIndex < playlist.items.length - 1) {
                  playIndex(playlist.currentIndex + 1)
                }
              }}
              interaction={showControlsAction}
            >
              <IconForward />
            </ControlButton>
          )}
          <VolumeControl
            muted={muted}
            setMuted={setMuted}
            volume={volume}
            setVolume={setVolume}
            interaction={showControlsAction}
          />
          <ControlButton
            tooltip={"Current progress"}
            className={"ml-auto flex items-center py-1"}
            onClick={() => {
              if (show) {
                setShowTimePlayed(!showTimePlayed)
              }
            }}
            interaction={showControlsAction}
          >
            <span>
              {(showTimePlayed
                ? secondsToTime(progress)
                : "-" + secondsToTime(duration - progress)) +
                " / " +
                secondsToTime(duration)}
            </span>
          </ControlButton>

          <ControlButton
            tooltip={"Open source in new tab"}
            onClick={() => {
              window.open(currentSrc.src, "_blank")?.focus()
            }}
            interaction={showControlsAction}
          >
            <Link href={currentSrc.src} target={"_blank"} rel={"noreferrer"}>
              <IconNewTab sizeClassName={"w-5 h-5"} />
            </Link>
          </ControlButton>

          <PlayerMenu
            roomId={roomId}
            playing={playing}
            currentSrc={currentSrc}
            setCurrentSrc={setCurrentSrc}
            currentSub={currentSub}
            setCurrentSub={setCurrentSub}
            loop={loop}
            setLoop={setLoop}
            interaction={showControlsAction}
            playbackRate={playbackRate}
            setPlaybackRate={setPlaybackRate}
            menuOpen={menuOpen}
            setMenuOpen={setMenuOpen}
          />

          <ControlButton
            tooltip={fullscreen ? "Leave fullscreen" : "Enter fullscreen"}
            onClick={() => {
              console.log("Toggled fullscreen")
              setFullscreen(!fullscreen)
            }}
            interaction={showControlsAction}
          >
            {fullscreen ? <IconCompress /> : <IconExpand />}
          </ControlButton>
        </div>
      </InteractionHandler>

      <Tooltip
        style={{
          backgroundColor: "var(--dark-700)",
        }}
      />
    </>
  )
}

export default Controls
