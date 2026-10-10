"use client"

import type { RoomRole } from "@/contracts/types"
import {
  canControlPlayback,
  canMutateFromClientSession,
} from "@/shared/permissions-utils"
import { resolveCurrentPlaylistItem } from "@/shared/playlist-current"
import { useRouter } from "next/navigation"
import { useEffect } from "react"
import type { useRoomSession } from "@/hooks/use-room-session"
import type { RoomPanelProps } from "./types"

type RoomSession = ReturnType<typeof useRoomSession>

export type RoomPanelModelConnecting = {
  ready: false
  mediaUnsupported: boolean
  roomId: string
  status: RoomSession["status"]
  joinError: RoomSession["joinError"]
  submitJoinPassword: RoomSession["submitJoinPassword"]
}

export type RoomPanelModelReady = {
  ready: true
  mediaUnsupported: false
  roomId: string
  roomState: NonNullable<RoomSession["roomState"]>
  panelProps: RoomPanelProps
  send: RoomSession["send"]
  userId: string
  sessionCapabilities: RoomSession["sessionCapabilities"]
  myRole: RoomRole | undefined
  canControlByRole: boolean
  canMutateFromThisSession: boolean
  current: ReturnType<typeof resolveCurrentPlaylistItem>
  canManageRoomSecurity: boolean
}

export type RoomPanelModel = RoomPanelModelConnecting | RoomPanelModelReady

/**
 * Shared page-client model: optional `?media=` strip after join, connecting
 * gate, and {@link RoomPanelProps} with mutate capabilities derived from the
 * session + role.
 */
export function useRoomPanelModel(input: {
  roomId: string
  session: RoomSession
  /** Raw create-time `?media=` value; stripped from the URL after join. */
  seedMediaUrl?: string
}): RoomPanelModel {
  const { roomId, session, seedMediaUrl } = input
  const {
    roomState,
    sessionCapabilities,
    send,
    userId,
    status,
    joinError,
    submitJoinPassword,
  } = session
  const router = useRouter()

  useEffect(() => {
    if (!roomState || !seedMediaUrl) return
    if (typeof window === "undefined") return
    const url = new URL(window.location.href)
    if (!url.searchParams.has("media")) return
    url.searchParams.delete("media")
    const next = `${url.pathname}${url.search}${url.hash}`
    router.replace(next)
  }, [roomState, seedMediaUrl, router])

  if (!roomState) {
    return {
      ready: false,
      mediaUnsupported: status === "media_unsupported",
      roomId,
      status,
      joinError,
      submitJoinPassword,
    }
  }

  const myRole = roomState.participants[userId]?.role
  const canControlByRole = canControlPlayback(myRole)
  const canMutateFromThisSession = canMutateFromClientSession({
    role: myRole,
    isControlSession: sessionCapabilities.isControlSession,
    controlAuthorized: sessionCapabilities.controlAuthorized,
    sessionKind: sessionCapabilities.sessionKind,
  })

  const panelProps: RoomPanelProps = {
    roomId,
    roomState,
    send,
    userId,
    capabilities: {
      ...sessionCapabilities,
      canControlPlayback: canMutateFromThisSession,
      canManagePlaylist: canMutateFromThisSession,
    },
  }

  return {
    ready: true,
    mediaUnsupported: false,
    roomId,
    roomState,
    panelProps,
    send,
    userId,
    sessionCapabilities,
    myRole,
    canControlByRole,
    canMutateFromThisSession,
    current: resolveCurrentPlaylistItem(roomState),
    canManageRoomSecurity:
      roomState.ownerId === userId &&
      sessionCapabilities.canManageRoomSecurity,
  }
}
