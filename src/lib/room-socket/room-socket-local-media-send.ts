/**
 * Fire-and-forget room WS envelope (no correlation).
 */
export function createSendEnvelope(ws: WebSocket) {
  return (type: string, payload: Record<string, unknown>): boolean => {
    // Numeric OPEN (1) — avoid relying on global WebSocket (missing in some bun:test contexts).
    if (ws.readyState !== 1) return false
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
