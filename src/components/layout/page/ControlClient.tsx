"use client"

import { RoomConnectingView } from "@/components/layout/RoomConnectingView"
import { useRoomRail } from "@/hooks/use-room-rail"
import { useRoomSession } from "@/hooks/use-room-session"
import { getRoomUrl } from "@/client/realtime/control-url"
import { isClientControlAuthorized } from "@/shared/permissions-utils"
import { resolveCatalogDurationMs } from "@/shared/playlist-duration"
import { ControlPanel } from "../../panel/control/ControlPanel"
import { bindSeekPreview } from "../../panel/player/playback-control/bind-seek-preview"
import { getPlaybackPermissionsState } from "../../panel/player/playback-control/use-playback-permissions-state"
import { usePlaybackTimelineController } from "../../panel/player/playback-control/use-playback-timeline-controller"
import { SidePanel } from "../SidePanel"
import { SiteNavbar } from "../SiteNavbar"
import type { RoomPanelProps } from "./types"
import {
  useRoomPanelModel,
  type RoomPanelModelReady,
} from "./use-room-panel-model"

function ControlClientReady(props: {
  model: RoomPanelModelReady
  copied: boolean
  shareUrl: string
  handleCopyShareUrl: () => void
  playerEmbedUrl: string
  controlEmbedUrl: string
}) {
  const {
    model,
    copied,
    shareUrl,
    handleCopyShareUrl,
    playerEmbedUrl,
    controlEmbedUrl,
  } = props
  const {
    roomId,
    roomState,
    sessionCapabilities,
    send,
    userId,
    current,
    canManageRoomSecurity,
    panelProps: basePanelProps,
  } = model

  const { railTab, setRailTab } = useRoomRail()
  const canControlBySession = isClientControlAuthorized(sessionCapabilities)
  const myRole = roomState.participants[userId]?.role
  const unauthorizedHint = !canControlBySession
    ? "Control token missing or expired — open Control again from the room View menu, or refresh after rejoining as owner/moderator."
    : myRole !== "owner" && myRole !== "moderator"
      ? "View-only: owner or moderator role is required to control playback."
      : "This session is view-only until authenticated."
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
    unauthorizedHint,
  })
  const timeline = usePlaybackTimelineController({
    roomState,
    send,
    controlsDisabled,
  })
  const totalDurationMs = resolveCatalogDurationMs(current)
  const panelProps: RoomPanelProps = {
    ...basePanelProps,
    capabilities: {
      ...sessionCapabilities,
      canControlPlayback: canControl,
      canManagePlaylist: canControl,
    },
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
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
        canManageRoomSecurity={canManageRoomSecurity}
        send={send}
        showEmbedsMenu={canControlByRole}
        showRailControls
        railTab={railTab}
        onRailTabChange={setRailTab}
      />
      <section className="mx-auto flex min-h-0 w-full flex-1 flex-col gap-3 overflow-hidden px-3 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <SidePanel
          panelProps={panelProps}
          hideTabBar
          tab={railTab}
          onTabChange={setRailTab}
          className="min-h-0 flex-1 overflow-hidden"
        />
        <ControlPanel
          className="shrink-0"
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
          onSeekPreview={bindSeekPreview(timeline)}
          onSeekCommit={timeline.commitSeek}
        />
      </section>
    </div>
  )
}

export function ControlClient(props: { roomId: string }) {
  const { roomId } = props
  const session = useRoomSession(roomId, { sessionKind: "control" })
  const model = useRoomPanelModel({ roomId, session })

  if (!model.ready) {
    return (
      <RoomConnectingView
        roomId={roomId}
        status={model.status}
        joinError={model.joinError}
        onSubmitJoinPassword={model.submitJoinPassword}
      />
    )
  }

  return (
    <ControlClientReady
      model={model}
      copied={session.copied}
      shareUrl={session.shareUrl}
      handleCopyShareUrl={session.handleCopyShareUrl}
      playerEmbedUrl={session.playerEmbedUrl}
      controlEmbedUrl={session.controlEmbedUrl}
    />
  )
}
