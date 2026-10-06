"use client"

import { RoomJoinPasswordPrompt } from "@/components/dialog/RoomJoinPasswordPrompt"
import { useRoomSession } from "@/hooks/use-room-session"
import { getRoomUrl } from "@/lib/control-url"
import { ControlPanel } from "../../panel/control/ControlPanel"
import { getPlaybackPermissionsState } from "../../panel/player/playback-control/use-playback-permissions-state"
import { usePlaybackTimelineController } from "../../panel/player/playback-control/use-playback-timeline-controller"
import { OwnUserPanel } from "../../panel/user/OwnUserPanel"
import { SidePanel } from "../SidePanel"
import { SiteNavbar } from "../SiteNavbar"
import { SocketStatus } from "../SocketStatus"

function ControlClientReady(props: {
  roomId: string
  roomState: NonNullable<ReturnType<typeof useRoomSession>["roomState"]>
  sessionCapabilities: ReturnType<typeof useRoomSession>["sessionCapabilities"]
  send: ReturnType<typeof useRoomSession>["send"]
  userId: string
  userSecret: string
  copied: boolean
  shareUrl: string
  handleCopyShareUrl: () => void
  playerEmbedUrl: string
  controlEmbedUrl: string
}) {
  const {
    roomId,
    roomState,
    sessionCapabilities,
    send,
    userId,
    userSecret,
    copied,
    shareUrl,
    handleCopyShareUrl,
    playerEmbedUrl,
    controlEmbedUrl,
  } = props

  const canControlBySession =
    !sessionCapabilities.isControlSession ||
    sessionCapabilities.controlAuthorized
  const {
    canControlByRole,
    canControl,
    controlsDisabled,
    disabledHint,
    authorizationHint,
  } = getPlaybackPermissionsState({
    roomState,
    userId,
    canControlBySession,
    unauthorizedHint:
      "Secret verification failed: this session is view-only until authenticated.",
  })
  const current = roomState.playlist[roomState.currentIndex]
  const timeline = usePlaybackTimelineController({
    roomState,
    send,
    controlsDisabled,
  })
  const totalDurationMs = Math.floor((current?.durationSeconds ?? 0) * 1000)
  const panelProps = {
    roomId,
    roomState,
    send,
    userId,
    userSecret,
    capabilities: {
      ...sessionCapabilities,
      canControlPlayback: canControl,
      canManagePlaylist: canControl,
    },
  }

  return (
    <>
      <SiteNavbar
        roomId={roomId}
        paused={roomState.playback.paused}
        currentName={current?.name}
        viewMode="control"
        roomUrl={getRoomUrl(roomId)}
        playerEmbedUrl={playerEmbedUrl}
        controlEmbedUrl={controlEmbedUrl}
        shareUrl={shareUrl}
        copied={copied}
        onCopyShareUrl={handleCopyShareUrl}
        roomSecurity={roomState.roomSecurity}
        canManageRoomSecurity={
          roomState.ownerId === userId &&
          sessionCapabilities.canManageRoomSecurity
        }
        send={send}
        showViewMenu={canControlByRole}
      />
      <section className="mx-auto flex w-full flex-1 flex-col gap-3 px-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <OwnUserPanel {...panelProps} />
        <SidePanel panelProps={panelProps} />
        <ControlPanel
          title="Remote Control"
          currentName={current?.name}
          paused={roomState.playback.paused}
          elapsedMs={timeline.elapsedMs}
          totalDurationMs={totalDurationMs}
          controlsDisabled={controlsDisabled}
          canControl={canControl}
          authorizationHint={authorizationHint}
          disabledHint={disabledHint}
          onPlay={timeline.play}
          onPause={timeline.pause}
          onSelectAdjacent={timeline.selectAdjacent}
          onStepBy={timeline.stepBy}
          onSeekPreview={(targetMs, active) => {
            if (active) {
              if (timeline.seekPhase === "idle") {
                timeline.beginSeek(targetMs)
                return
              }
              timeline.updateSeek(targetMs)
              return
            }
            timeline.endSeekPreview(targetMs)
          }}
          onSeekCommit={timeline.commitSeek}
        />
      </section>
    </>
  )
}

export function ControlClient(props: { roomId: string }) {
  const { roomId } = props
  const {
    roomState,
    sessionCapabilities,
    send,
    userId,
    userSecret,
    status,
    joinError,
    submitJoinPassword,
    copied,
    shareUrl,
    handleCopyShareUrl,
    playerEmbedUrl,
    controlEmbedUrl,
  } = useRoomSession(roomId, { sessionKind: "control" })

  if (!roomState) {
    if (status === "awaiting_password") {
      return (
        <RoomJoinPasswordPrompt
          roomId={roomId}
          title={joinError}
          onSubmit={submitJoinPassword}
        />
      )
    }

    return <SocketStatus status={status} />
  }

  return (
    <ControlClientReady
      roomId={roomId}
      roomState={roomState}
      sessionCapabilities={sessionCapabilities}
      send={send}
      userId={userId}
      userSecret={userSecret}
      copied={copied}
      shareUrl={shareUrl}
      handleCopyShareUrl={handleCopyShareUrl}
      playerEmbedUrl={playerEmbedUrl}
      controlEmbedUrl={controlEmbedUrl}
    />
  )
}
