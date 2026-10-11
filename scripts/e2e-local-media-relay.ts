/**
 * Local-media HTTP relay E2E (no mediasoup UDP / File picker).
 *
 * Provider answers `local-media:read` over WS with JSON `local-media:chunk`
 * (dataBase64). Viewer mints a capability token on join and GETs
 * `/api/media/local/{id}` — asserts range bytes match the fixture.
 *
 * SFU and P2P WebRTC paths remain manual-only.
 */
import { randomUUID } from "node:crypto"
import { checkHealth } from "./lib/check-health.ts"
import { createE2eReporter } from "./lib/e2e-report.ts"
import { RoomClient } from "./lib/room-ws-client.ts"

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000"
const ROOM = process.env.E2E_ROOM_ID ?? `e2elm-${Date.now().toString(36)}`

/**
 * Viewer tokens are IP-bound. WS mint uses the upgrade socket address; Fetch
 * `Request` IP is `"unknown"` without forwarding headers. Mirror CI’s
 * loopback hop so HTTP validation matches the WS mint.
 */
const VIEWER_IP_CANDIDATES = BASE.includes("127.0.0.1")
  ? ["127.0.0.1", "::ffff:127.0.0.1", "::1"]
  : ["::1", "127.0.0.1", "::ffff:127.0.0.1"]

/** Deterministic tiny “media” payload (progressive mime, size ≥ 1). */
const FIXTURE = new TextEncoder().encode(
  "web-syncplay-local-media-relay-e2e-fixture-v1",
)

const { record, finish } = createE2eReporter()

function bytesEqual(a: Uint8Array, b: Uint8Array) {
  if (a.byteLength !== b.byteLength) return false
  for (let i = 0; i < a.byteLength; i += 1) {
    if (a[i] !== b[i]) return false
  }
  return true
}

async function fetchLocalMedia(
  url: URL,
  init: RequestInit = {},
): Promise<{ response: Response; boundIp: string }> {
  let last: Response | undefined
  let lastIp = VIEWER_IP_CANDIDATES[0]!
  for (const ip of VIEWER_IP_CANDIDATES) {
    const headers = new Headers(init.headers)
    headers.set("x-forwarded-for", ip)
    headers.set("x-real-ip", ip)
    const response = await fetch(url, { ...init, headers })
    last = response
    lastIp = ip
    if (response.ok || response.status === 206) {
      return { response, boundIp: ip }
    }
    // Capability IP mismatch → try next candidate; other errors fail fast.
    if (response.status !== 403) {
      return { response, boundIp: ip }
    }
  }
  return { response: last!, boundIp: lastIp }
}

async function main() {
  console.log(`Local-media relay E2E base=${BASE} room=${ROOM}`)

  const { ok: healthOk, health } = await checkHealth(BASE)
  record("health endpoint", healthOk, JSON.stringify(health))
  if (!healthOk) {
    process.exit(1)
  }

  const hostId = randomUUID()
  const guestId = randomUUID()
  const hostSecret = randomUUID().replace(/-/g, "") + "aa"
  const guestSecret = randomUUID().replace(/-/g, "") + "bb"
  const localMediaId = randomUUID()

  let readRequests = 0

  const host = new RoomClient({
    baseUrl: BASE,
    roomId: ROOM,
    userId: hostId,
    userSecret: hostSecret,
    username: "RelayHost",
    onMessage: (msg) => {
      if (msg.type !== "local-media:read") return
      const payload = msg.payload as {
        requestId?: string
        localMediaId?: string
        start?: number
        end?: number
      }
      if (
        !payload.requestId ||
        payload.localMediaId !== localMediaId ||
        typeof payload.start !== "number" ||
        typeof payload.end !== "number"
      ) {
        return
      }
      readRequests += 1
      const start = payload.start
      const end = Math.min(payload.end, FIXTURE.byteLength - 1)
      if (start < 0 || start > end || start >= FIXTURE.byteLength) {
        host.send("local-media:chunk", {
          requestId: payload.requestId,
          ok: false,
          error: "invalid_range",
        })
        return
      }
      const slice = FIXTURE.subarray(start, end + 1)
      host.send("local-media:chunk", {
        requestId: payload.requestId,
        ok: true,
        dataBase64: Buffer.from(slice).toString("base64"),
      })
    },
  })

  const guest = new RoomClient({
    baseUrl: BASE,
    roomId: ROOM,
    userId: guestId,
    userSecret: guestSecret,
    username: "RelayGuest",
  })

  try {
    await host.connect()
    await host.waitFor((c) => c.roomState && c.capabilities)
    record("host joined", true)
    record(
      "host received viewer token",
      typeof host.capabilities?.viewerToken === "string",
    )

    host.send("playlist:add:local", {
      localMediaId,
      name: "relay-e2e.bin",
      mimeType: "video/mp4",
      sizeBytes: FIXTURE.byteLength,
      durationSeconds: 1,
    })
    await host.waitFor(
      (c) =>
        (c.roomState?.playlist ?? []).some(
          (item) => item.localMediaId === localMediaId,
        ),
      15_000,
    )
    const item = host.roomState?.playlist.find(
      (entry) => entry.localMediaId === localMediaId,
    )
    record(
      "playlist:add:local registered",
      item?.sourceKind === "local_file" && item?.ingestStatus === "ready",
      `kind=${item?.sourceKind} status=${item?.ingestStatus}`,
    )

    // Keep providerReady explicit (add:local already sets true; ready is the
    // live-tab signal used by clients in production).
    host.send("local-media:ready", { localMediaId, ready: true })

    await guest.connect()
    await guest.waitFor((c) => c.roomState && c.capabilities, 15_000)
    const viewerToken = guest.capabilities?.viewerToken
    record(
      "guest joined with viewer token",
      typeof viewerToken === "string" && viewerToken.length > 0,
    )

    const denied = await fetch(
      `${BASE}/api/media/local/${encodeURIComponent(localMediaId)}`,
    )
    record(
      "HTTP without viewer token denied",
      denied.status === 403 || denied.status === 401,
      `status=${denied.status}`,
    )

    const url = new URL(
      `${BASE}/api/media/local/${encodeURIComponent(localMediaId)}`,
    )
    url.searchParams.set("vt", String(viewerToken))
    url.searchParams.set("uid", guestId)

    const { response: head, boundIp } = await fetchLocalMedia(url, {
      method: "HEAD",
    })
    record(
      "HTTP HEAD with viewer token ok",
      head.ok || head.status === 206,
      `status=${head.status} ip=${boundIp} len=${head.headers.get("content-length")}`,
    )

    const { response: rangeRes } = await fetchLocalMedia(url, {
      headers: { Range: "bytes=0-15" },
    })
    const rangeBuf = new Uint8Array(await rangeRes.arrayBuffer())
    const expected = FIXTURE.subarray(0, Math.min(16, FIXTURE.byteLength))
    record(
      "HTTP GET Range returns fixture bytes",
      (rangeRes.status === 206 || rangeRes.status === 200) &&
        bytesEqual(rangeBuf, expected),
      `status=${rangeRes.status} bytes=${rangeBuf.byteLength} reads=${readRequests}`,
    )
    record(
      "provider answered local-media:read",
      readRequests >= 1,
      `reads=${readRequests}`,
    )

    const { response: fullRes } = await fetchLocalMedia(url)
    const fullBuf = new Uint8Array(await fullRes.arrayBuffer())
    record(
      "HTTP GET full body matches fixture",
      fullRes.ok && bytesEqual(fullBuf, FIXTURE),
      `status=${fullRes.status} bytes=${fullBuf.byteLength}`,
    )
  } catch (error) {
    record(
      "suite crashed",
      false,
      error instanceof Error ? error.message : String(error),
    )
  } finally {
    host.close()
    guest.close()
  }

  process.exit(finish() > 0 ? 1 : 0)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
