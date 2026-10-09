/**
 * Fire-and-forget room WS envelope (no correlation).
 */
export function createSendEnvelope(ws: WebSocket) {
  return (type: string, payload: Record<string, unknown>): boolean => {
    if (ws.readyState !== WebSocket.OPEN) return false
    ws.send(
      JSON.stringify({
        type,
        payload,
        requestId: crypto.randomUUID(),
      }),
    )
    return true
  }
}

export type SendEnvelope = ReturnType<typeof createSendEnvelope>
