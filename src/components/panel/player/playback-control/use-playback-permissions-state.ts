"use client"

import { canControlPlayback } from "@/shared/permissions-utils"
import type { RoomState } from "@/contracts/types"

export function getPlaybackPermissionsState(config: {
  roomState: RoomState
  userId: string
  canControlBySession: boolean
  unauthorizedHint?: string
}) {
  const { roomState, userId, canControlBySession, unauthorizedHint } = config
  const myRole = roomState.participants[userId]?.role
  const canControlByRole = canControlPlayback(myRole)
  const canControl = canControlByRole && canControlBySession

  const remoteSeekPreview = roomState.playback.seekPreview
  const isOtherUserSeeking =
    remoteSeekPreview?.active === true && remoteSeekPreview.userId !== userId
  const remoteSeekerName =
    remoteSeekPreview?.userId &&
    roomState.participants[remoteSeekPreview.userId]?.username
      ? roomState.participants[remoteSeekPreview.userId]?.username
      : "Another user"

  const controlsDisabled = !canControl || isOtherUserSeeking
  const disabledHint = isOtherUserSeeking
    ? `${remoteSeekerName} is seeking: controls are temporarily disabled.`
    : undefined
  const authorizationHint = canControl ? undefined : unauthorizedHint

  return {
    canControlByRole,
    canControl,
    controlsDisabled,
    isOtherUserSeeking,
    remoteSeekerName,
    disabledHint,
    authorizationHint,
  }
}
