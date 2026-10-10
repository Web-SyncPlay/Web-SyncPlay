/**
 * Owned local-media session runtime: configure / close / SW bridge / lazy P2P.
 *
 * Call sites should use this instead of touching `__webSyncPlayLocalMedia*`
 * globals. Those globals remain only for HMR survival behind provider/SFU/RTC
 * modules and the active {@link RangeResponder}.
 */

import type { SfuSendRequest } from "@/client/local-media/local-media-sfu"
import {
  clearActiveRangeResponderIf,
  createRangeResponder,
  setActiveRangeResponder,
  type RangeResponder,
} from "@/client/local-media/local-media-range-responder"
import { getLocalMediaFile } from "@/client/local-media/local-media-provider"
import {
  attachLocalMediaServiceWorkerBridge,
  type LocalMediaSwBridgeDeps,
} from "@/client/local-media/local-media-sw"
import { resolveCurrentPlaylistItem } from "@/shared/playlist-current"
import type { ClientRoomState } from "@/contracts/types"

/** Pure invite-target selection for bootstrap / first-range policy. */
export function selectLazyWebrtcInviteMediaId(input: {
  roomState: Pick<ClientRoomState, "playlist" | "currentIndex" | "playback">
  heldLocalMediaIds: ReadonlySet<string> | Iterable<string>
}): string | null {
  const held =
    input.heldLocalMediaIds instanceof Set
      ? input.heldLocalMediaIds
      : new Set(input.heldLocalMediaIds)
  const current = resolveCurrentPlaylistItem(input.roomState)
  const localMediaId = current?.localMediaId
  if (!localMediaId || !held.has(localMediaId)) return null
  return localMediaId
}

export function selectConnectedViewerUserIds(input: {
  participants: ClientRoomState["participants"] | null | undefined
  selfUserId: string
}): string[] {
  if (!input.participants) return []
  return Object.values(input.participants)
    .filter((p) => p.userId !== input.selfUserId && p.connected)
    .map((p) => p.userId)
}

export type LocalMediaRuntimeSend = (
  type: string,
  payload: Record<string, unknown>,
) => boolean | void

export type LocalMediaRuntimeSwBridgeInput = Pick<
  LocalMediaSwBridgeDeps,
  "getSfuAvailable" | "resolveProviderUserId" | "resolveMediaMeta" | "onP2pRangeMiss"
>

export type LocalMediaRuntime = {
  readonly roomId: string
  readonly userId: string
  readonly rangeResponder: RangeResponder
  configureSfu: (sendRequest: SfuSendRequest) => Promise<void>
  configureWebrtc: () => Promise<void>
  attachSwBridge: (deps: LocalMediaRuntimeSwBridgeInput) => () => void
  /** Invite listed viewers onto a DataChannel for one media id (deduped). */
  inviteWebrtcViewers: (
    localMediaId: string,
    viewerUserIds: Iterable<string>,
  ) => void
  /**
   * Bootstrap / playlist policy: invite only for the current item when this
   * tab holds the File.
   */
  inviteWebrtcForCurrentItem: (
    roomState: Pick<
      ClientRoomState,
      "playlist" | "currentIndex" | "playback" | "participants"
    >,
  ) => void
  /** First successful provider range for a media id → invite connected peers. */
  noteRangeServed: (localMediaId: string) => void
  close: () => void
}

export function createLocalMediaRuntime(input: {
  send: LocalMediaRuntimeSend
  roomId: string
  userId: string
  getRoomState: () => ClientRoomState | null
  /** Used so close() only tears down this socket's SFU session. */
  getSfuSendRequest?: () => SfuSendRequest | null
}): LocalMediaRuntime {
  const invited = new Set<string>()
  const servedInvite = new Set<string>()
  let closed = false
  let configuredSfuSendRequest: SfuSendRequest | null = null

  const inviteKey = (localMediaId: string, viewerUserId: string) =>
    `${localMediaId}:${viewerUserId}`

  const inviteWebrtcViewers = (
    localMediaId: string,
    viewerUserIds: Iterable<string>,
  ) => {
    if (closed) return
    if (!getLocalMediaFile(localMediaId)) return
    void import("@/client/local-media/local-media-webrtc").then(
      ({ inviteLocalMediaWebrtcViewer }) => {
        for (const viewerUserId of viewerUserIds) {
          if (!viewerUserId || viewerUserId === input.userId) continue
          const key = inviteKey(localMediaId, viewerUserId)
          if (invited.has(key)) continue
          invited.add(key)
          void inviteLocalMediaWebrtcViewer({
            localMediaId,
            viewerUserId,
          })
        }
      },
    )
  }

  const connectedViewerIds = (
    roomState: Pick<ClientRoomState, "participants"> | null | undefined,
  ): string[] =>
    selectConnectedViewerUserIds({
      participants: roomState?.participants,
      selfUserId: input.userId,
    })

  const noteRangeServed = (localMediaId: string) => {
    if (closed) return
    if (servedInvite.has(localMediaId)) return
    if (!getLocalMediaFile(localMediaId)) return
    servedInvite.add(localMediaId)
    inviteWebrtcViewers(localMediaId, connectedViewerIds(input.getRoomState()))
  }

  const rangeResponder = createRangeResponder({
    getFile: getLocalMediaFile,
    onServed: noteRangeServed,
  })
  setActiveRangeResponder(rangeResponder)

  return {
    roomId: input.roomId,
    userId: input.userId,
    rangeResponder,

    async configureSfu(sendRequest) {
      if (closed) return
      configuredSfuSendRequest = sendRequest
      const { configureLocalMediaSfu } = await import(
        "@/client/local-media/local-media-sfu"
      )
      configureLocalMediaSfu(sendRequest)
    },

    async configureWebrtc() {
      if (closed) return
      const { configureLocalMediaWebrtc } = await import(
        "@/client/local-media/local-media-webrtc"
      )
      configureLocalMediaWebrtc({
        sendSignal: (targetUserId, localMediaId, signal) => {
          input.send("local-media:webrtc:signal", {
            localMediaId,
            targetUserId,
            signal,
          })
        },
      })
    },

    attachSwBridge(deps) {
      if (closed) return () => {}
      return attachLocalMediaServiceWorkerBridge({
        getSfuAvailable: deps.getSfuAvailable,
        resolveProviderUserId: deps.resolveProviderUserId,
        resolveMediaMeta: deps.resolveMediaMeta,
        onP2pRangeMiss: (localMediaId, providerUserId) => {
          deps.onP2pRangeMiss?.(localMediaId, providerUserId)
          // If this tab holds the File (provider / multi-tab), warm P2P for
          // connected peers after a viewer-side miss. Cross-user viewers rely
          // on noteRangeServed from the serving tab.
          if (getLocalMediaFile(localMediaId)) {
            inviteWebrtcViewers(
              localMediaId,
              connectedViewerIds(input.getRoomState()),
            )
          }
        },
      })
    },

    inviteWebrtcViewers,

    inviteWebrtcForCurrentItem(roomState) {
      const currentId = resolveCurrentPlaylistItem(roomState)?.localMediaId
      const held = currentId && getLocalMediaFile(currentId) ? [currentId] : []
      const localMediaId = selectLazyWebrtcInviteMediaId({
        roomState,
        heldLocalMediaIds: held,
      })
      if (!localMediaId) return
      inviteWebrtcViewers(localMediaId, connectedViewerIds(roomState))
    },

    noteRangeServed,

    close() {
      if (closed) return
      closed = true
      clearActiveRangeResponderIf(rangeResponder)
      invited.clear()
      servedInvite.clear()
      const sendRequest =
        configuredSfuSendRequest ?? input.getSfuSendRequest?.() ?? undefined
      configuredSfuSendRequest = null
      void import("@/client/local-media/local-media-webrtc").then(
        ({ closeLocalMediaWebrtcPeers }) => {
          closeLocalMediaWebrtcPeers()
        },
      )
      void import("@/client/local-media/local-media-sfu").then(
        ({ closeLocalMediaSfu }) => {
          closeLocalMediaSfu(sendRequest)
        },
      )
    },
  }
}
