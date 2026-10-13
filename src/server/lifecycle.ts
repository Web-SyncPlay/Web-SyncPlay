type ShutdownFn = () => Promise<void>

/** Settle after WS close frames so clients observe 1001 before the process exits. */
export const SHUTDOWN_SETTLE_MS = 1_500

const slot = (() => {
  const g = globalThis as typeof globalThis & {
    __webSyncPlayShutdown?: {
      installed: boolean
      running: boolean
      draining: boolean
      handlers: ShutdownFn[]
      /** When false, skip process.exit after signal shutdown (tests). Default true. */
      exitProcess: boolean
    }
  }
  g.__webSyncPlayShutdown ??= {
    installed: false,
    running: false,
    draining: false,
    handlers: [],
    exitProcess: true,
  }
  return g.__webSyncPlayShutdown
})()

/** True after SIGTERM/SIGINT (or test mark) until process exit. */
export function isProcessDraining(): boolean {
  return slot.draining
}

/** Flip readiness false immediately; idempotent. */
export function markProcessDraining(): void {
  slot.draining = true
}

/** LIFO: last registered runs first (WebSocket before Redis). */
export function registerShutdownHandler(fn: ShutdownFn) {
  slot.handlers.unshift(fn)
}

async function runShutdownHandlers(options: {
  exitAfter: boolean
}): Promise<void> {
  if (slot.running) {
    return
  }
  slot.running = true
  markProcessDraining()

  const handlers = [...slot.handlers]
  for (const h of handlers) {
    try {
      await h()
    } catch (e) {
      console.error("[shutdown] handler failed", e)
    }
  }

  if (!options.exitAfter || !slot.exitProcess) {
    return
  }

  await new Promise<void>((resolve) => {
    const t = setTimeout(resolve, SHUTDOWN_SETTLE_MS)
    t.unref?.()
  })
  process.exit(0)
}

export function installShutdownOnce() {
  if (slot.installed) {
    return
  }
  slot.installed = true

  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.once(sig, () => {
      void runShutdownHandlers({ exitAfter: true })
    })
  }
  process.once("beforeExit", () => {
    // Cleanup only — event loop is already emptying; do not process.exit.
    void runShutdownHandlers({ exitAfter: false })
  })
}

/** Test-only: reset drain/shutdown slot between cases. */
export function resetLifecycleForTests(options?: { exitProcess?: boolean }) {
  slot.installed = false
  slot.running = false
  slot.draining = false
  slot.handlers = []
  slot.exitProcess = options?.exitProcess ?? false
}

/** Test-only: run registered handlers without installing signal hooks or exiting. */
export async function runShutdownHandlersForTests(): Promise<void> {
  slot.exitProcess = false
  slot.running = false
  await runShutdownHandlers({ exitAfter: false })
}
