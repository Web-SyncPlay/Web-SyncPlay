/**
 * Boot background maintenance without waiting for a WebSocket upgrade.
 * Without this, ghost rooms after a crash linger until someone opens a room.
 *
 * Node-only work lives in `./instrumentation-node` so webpack can eliminate it
 * from the edge instrumentation graph (avoids redis/`node:` builtin errors).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { registerNodeInstrumentation } = await import(
      "./instrumentation-node"
    )
    await registerNodeInstrumentation()
  }
}
