/**
 * Node-only instrumentation boot. Kept in a separate module so webpack's edge
 * compilation of `instrumentation.ts` can DCE this import when
 * `NEXT_RUNTIME !== "nodejs"` (see Next.js instrumentation docs).
 */
export async function registerNodeInstrumentation() {
  // Avoid Valkey during `next build` (no Redis in the image build stage).
  if (process.env.NEXT_PHASE === "phase-production-build") return

  try {
    const { ensureBackgroundMaintenance } = await import("@/server/maintenance")
    await ensureBackgroundMaintenance()
    console.info("[maintenance] instrumentation boot ok")
  } catch (error) {
    console.error("[maintenance] instrumentation boot failed", error)
  }
}
