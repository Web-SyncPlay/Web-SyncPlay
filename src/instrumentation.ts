/**
 * Boot background maintenance without waiting for a WebSocket upgrade.
 * Without this, ghost rooms after a crash linger until someone opens a room.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return
  // Avoid Valkey during `next build` (no Redis in the image build stage).
  if (process.env.NEXT_PHASE === "phase-production-build") return

  try {
    const { ensureBackgroundMaintenance } = await import(
      "@/server/maintenance"
    )
    await ensureBackgroundMaintenance()
    console.info("[maintenance] instrumentation boot ok")
  } catch (error) {
    console.error("[maintenance] instrumentation boot failed", error)
  }
}
