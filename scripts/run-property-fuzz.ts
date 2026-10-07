/**
 * Deep property-fuzz pass (not part of regular CI).
 *
 * Usage:
 *   bun scripts/run-property-fuzz.ts
 *   bun scripts/run-property-fuzz.ts --runs 10000 --rounds 5
 */
process.env.SKIP_ENV_VALIDATION ??= "1"
process.env.VALKEY_URL ??= "redis://127.0.0.1:6379"

function argValue(name: string, fallback: number) {
  const idx = process.argv.indexOf(name)
  if (idx === -1) return fallback
  const next = process.argv[idx + 1]
  return next === undefined ? fallback : Number(next)
}

const RUNS = argValue("--runs", 5_000)
const ROUNDS = argValue("--rounds", 8)
const BASE = "https://cdn.example.com/live/master.m3u8"

const fc = (await import("fast-check")).default
const { assertPublicHttpUrl } = await import(
  "../src/server/security/url-safety.ts"
)
const {
  collectM3u8ReferencedUrls,
  rewriteM3u8BodyWithProxyMap,
  shouldAttemptPlaylistRewrite,
} = await import("../src/server/media/hls-proxy-rewrite.ts")
const {
  isHttpOrHttpsUrl,
  sanitizeErrorMessage,
  sanitizeMediaTitle,
  sanitizeUsername,
} = await import("../src/lib/sanitize-display.ts")
const { roomJoinSchema, participantUpdateSchema } = await import(
  "../src/zod/schemas.ts"
)

const privateIpv4 = fc
  .oneof(
    fc.tuple(fc.constant(10), fc.nat(255), fc.nat(255), fc.nat(255)),
    fc.tuple(fc.constant(127), fc.nat(255), fc.nat(255), fc.nat(255)),
    fc.tuple(fc.constant(192), fc.constant(168), fc.nat(255), fc.nat(255)),
    fc.tuple(fc.constant(169), fc.constant(254), fc.nat(255), fc.nat(255)),
    fc.tuple(
      fc.constant(172),
      fc.integer({ min: 16, max: 31 }),
      fc.nat(255),
      fc.nat(255),
    ),
    fc.tuple(
      fc.constant(100),
      fc.integer({ min: 64, max: 127 }),
      fc.nat(255),
      fc.nat(255),
    ),
    fc.tuple(fc.constant(0), fc.nat(255), fc.nat(255), fc.nat(255)),
  )
  .map(([a, b, c, d]) => `${a}.${b}.${c}.${d}`)

const publicIpv4 = fc
  .tuple(
    fc.integer({ min: 1, max: 223 }),
    fc.nat(255),
    fc.nat(255),
    fc.integer({ min: 1, max: 254 }),
  )
  .filter(([a, b]) => {
    if (a === 10 || a === 127 || a === 0) return false
    if (a === 169 && b === 254) return false
    if (a === 172 && b >= 16 && b <= 31) return false
    if (a === 192 && b === 168) return false
    if (a === 100 && b >= 64 && b <= 127) return false
    return true
  })
  .map(([a, b, c, d]) => `${a}.${b}.${c}.${d}`)

const dnsLabel = fc.stringMatching(/^[a-z]{1,10}$/)

const publicHostname = fc
  .tuple(dnsLabel, dnsLabel)
  .map(([a, b]) => `${a}.${b}`)
  .filter(
    (host) =>
      host !== "localhost" &&
      host !== "metadata" &&
      !host.endsWith(".localhost") &&
      !host.endsWith(".local") &&
      host !== "metadata.google.internal",
  )

const relativeSegment = fc.stringMatching(/^[a-z0-9][a-z0-9._/-]{0,40}\.ts$/)

const absoluteHttpUrl = fc
  .tuple(
    fc.constantFrom("http", "https"),
    fc.stringMatching(/^[a-z]{2,8}\.[a-z]{2,6}$/),
    fc.stringMatching(/^\/[a-z0-9][a-z0-9/_-]{0,40}\.(ts|m3u8)$/),
  )
  .map(([scheme, host, path]) => `${scheme}://${host}${path}`)

type CheckResult = { name: string; ok: boolean; error?: string }

function check(
  name: string,
  property: Parameters<typeof fc.assert>[0],
  params: Parameters<typeof fc.assert>[1],
): CheckResult {
  try {
    fc.assert(property, params)
    return { name, ok: true }
  } catch (error) {
    return {
      name,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

function runSuite(seed: number) {
  const params = { numRuns: RUNS, seed }
  const results: CheckResult[] = []

  results.push(
    check(
      "url: never throws",
      fc.property(fc.string({ maxLength: 200 }), (raw) => {
        const result = assertPublicHttpUrl(raw)
        if (typeof result.ok !== "boolean") throw new Error("ok not boolean")
        if (!result.ok && typeof result.reason !== "string") {
          throw new Error("reason missing")
        }
      }),
      params,
    ),
  )

  results.push(
    check(
      "url: private IPv4 rejected",
      fc.property(
        privateIpv4,
        fc.constantFrom("http", "https"),
        fc.stringMatching(/^\/[a-z0-9/-]{0,40}$/),
        (ip, scheme, path) => {
          if (assertPublicHttpUrl(`${scheme}://${ip}${path}`).ok) {
            throw new Error(`accepted private ${scheme}://${ip}${path}`)
          }
        },
      ),
      params,
    ),
  )

  results.push(
    check(
      "url: blocked hosts rejected",
      fc.property(
        fc.constantFrom(
          "localhost",
          "metadata",
          "metadata.google.internal",
          "foo.localhost",
          "bar.local",
        ),
        fc.constantFrom("http", "https"),
        fc.constantFrom("", "."),
        (host, scheme, trailingDot) => {
          const url = `${scheme}://${host}${trailingDot}/x`
          if (assertPublicHttpUrl(url).ok) {
            throw new Error(`accepted blocked ${url}`)
          }
        },
      ),
      params,
    ),
  )

  results.push(
    check(
      "url: ipv4-mapped ipv6 private rejected",
      fc.property(
        privateIpv4,
        fc.constantFrom("http", "https"),
        (ip, scheme) => {
          for (const url of [
            `${scheme}://[::ffff:${ip}]/`,
            `${scheme}://[0:0:0:0:0:ffff:${ip}]/`,
          ]) {
            if (assertPublicHttpUrl(url).ok) {
              throw new Error(`accepted mapped ${url}`)
            }
          }
        },
      ),
      params,
    ),
  )

  results.push(
    check(
      "url: non-http schemes rejected",
      fc.property(
        fc.constantFrom("ftp", "ws", "wss"),
        publicHostname,
        (scheme, host) => {
          const result = assertPublicHttpUrl(`${scheme}://${host}/x`)
          if (result.ok) throw new Error(`accepted ${scheme}`)
          if (
            result.reason !== "unsupported_protocol" &&
            result.reason !== "invalid_url"
          ) {
            throw new Error(
              `expected unsupported_protocol|invalid_url got ${result.reason}`,
            )
          }
        },
      ),
      params,
    ),
  )

  results.push(
    check(
      "url: public https accepted",
      fc.property(
        fc.oneof(
          publicHostname.map((h) => `https://${h}/media.mp4`),
          publicIpv4.map((ip) => `https://${ip}/media.mp4`),
        ),
        (url) => {
          if (!assertPublicHttpUrl(url).ok) {
            throw new Error(`rejected public ${url}`)
          }
        },
      ),
      params,
    ),
  )

  results.push(
    check(
      "hls: collect http(s) only",
      fc.property(fc.string({ maxLength: 400 }), (body) => {
        for (const url of collectM3u8ReferencedUrls(body, BASE)) {
          if (!/^https?:\/\//i.test(url)) throw new Error(`non-http ${url}`)
          new URL(url)
        }
      }),
      params,
    ),
  )

  results.push(
    check(
      "hls: collect known refs",
      fc.property(absoluteHttpUrl, relativeSegment, (abs, rel) => {
        const body = [
          "#EXTM3U",
          `#EXT-X-KEY:METHOD=AES-128,URI="${abs}"`,
          `#EXT-X-MAP:URI='${rel}'`,
          abs,
          rel,
        ].join("\n")
        const urls = collectM3u8ReferencedUrls(body, BASE)
        if (!urls.has(abs)) throw new Error(`missing abs ${abs}`)
        if (!urls.has(new URL(rel, BASE).href)) {
          throw new Error(`missing rel ${rel}`)
        }
      }),
      params,
    ),
  )

  results.push(
    check(
      "hls: empty map identity",
      fc.property(fc.string({ maxLength: 300 }), (body) => {
        const normalized = body.split(/\r?\n/).join("\n")
        const rewritten = rewriteM3u8BodyWithProxyMap(body, BASE, new Map())
        if (rewritten !== normalized) {
          throw new Error("identity rewrite failed")
        }
      }),
      params,
    ),
  )

  results.push(
    check(
      "hls: mapped urls rewritten",
      fc.property(absoluteHttpUrl, (abs) => {
        const proxy = `/api/media/proxy/token-${abs.length}`
        const body = [
          "#EXTM3U",
          `#EXT-X-KEY:METHOD=AES-128,URI="${abs}"`,
          abs,
        ].join("\n")
        const rewritten = rewriteM3u8BodyWithProxyMap(
          body,
          BASE,
          new Map([[abs, proxy]]),
        )
        if (!rewritten.includes(`URI="${proxy}"`)) {
          throw new Error("URI attr not rewritten")
        }
        if (rewritten.split("\n").at(-1) !== proxy) {
          throw new Error("segment line not rewritten")
        }
        if (rewritten.includes(abs)) {
          throw new Error("original URL still present")
        }
      }),
      params,
    ),
  )

  results.push(
    check(
      "hls: playlist detection",
      fc.property(
        fc.string({ maxLength: 80 }),
        fc.string({ maxLength: 120 }),
        (noiseCt, noiseBody) => {
          if (
            !shouldAttemptPlaylistRewrite(
              "application/vnd.apple.mpegurl",
              noiseBody,
            )
          ) {
            throw new Error("mpegurl content-type missed")
          }
          if (!shouldAttemptPlaylistRewrite("audio/m3u8", noiseBody)) {
            throw new Error("m3u8 content-type missed")
          }
          if (!shouldAttemptPlaylistRewrite(noiseCt, `#EXTM3U\n${noiseBody}`)) {
            throw new Error("#EXTM3U body missed")
          }
        },
      ),
      params,
    ),
  )

  results.push(
    check(
      "xss: sanitized usernames have no markup/controls",
      fc.property(fc.string({ maxLength: 80 }), (raw) => {
        const next = sanitizeUsername(raw)
        if (next === null) return
        if (/[<>"'`]/.test(next)) throw new Error(`markup leaked: ${next}`)
        if (/[\p{Cc}\p{Cf}]/u.test(next)) {
          throw new Error(`control leaked: ${next}`)
        }
      }),
      params,
    ),
  )

  results.push(
    check(
      "xss: titles never keep markup delimiters",
      fc.property(fc.string({ maxLength: 300 }), (raw) => {
        const next = sanitizeMediaTitle(raw)
        if (next === null) return
        if (/[<>"'`]/.test(next)) throw new Error(`title markup: ${next}`)
      }),
      params,
    ),
  )

  results.push(
    check(
      "xss: classic packages rejected at schema boundary",
      fc.property(
        fc.constantFrom(
          "<script>alert(1)</script>",
          "<img src=x onerror=alert(1)>",
          '"><svg/onload=alert(1)>',
          "javascript:alert(1)",
          "data:text/html,<script>alert(1)</script>",
          "\u0000<script>alert(1)</script>",
        ),
        (payload) => {
          if (sanitizeUsername(payload) !== null) {
            throw new Error(`username accepted ${payload}`)
          }
          if (sanitizeErrorMessage(payload) !== null) {
            throw new Error(`error accepted ${payload}`)
          }
          if (
            roomJoinSchema.safeParse({
              roomId: "room-1",
              userSecret: "secret-value",
              username: payload,
            }).success
          ) {
            throw new Error(`join accepted ${payload}`)
          }
          if (
            participantUpdateSchema.safeParse({ username: payload }).success
          ) {
            throw new Error(`participant accepted ${payload}`)
          }
        },
      ),
      params,
    ),
  )

  results.push(
    check(
      "xss: media url schemes http(s) only",
      fc.property(
        fc.constantFrom("javascript", "data", "blob", "file", "vbscript"),
        fc.string({ maxLength: 40 }),
        (scheme, rest) => {
          if (isHttpOrHttpsUrl(`${scheme}:${rest}`)) {
            throw new Error(`allowed ${scheme}`)
          }
        },
      ),
      params,
    ),
  )

  return results
}

const failures: Array<CheckResult & { round: number; seed: number }> = []
let totalChecks = 0
const started = Date.now()

const PROPERTY_COUNT = 15
console.log(
  `Deep property fuzz: ${ROUNDS} rounds × ${RUNS} runs × ${PROPERTY_COUNT} properties`,
)

for (let round = 1; round <= ROUNDS; round++) {
  const seed = (Date.now() ^ (round * 2654435761)) >>> 0
  process.stdout.write(`round ${round}/${ROUNDS} seed=${seed} … `)
  const results = runSuite(seed)
  totalChecks += results.length
  const failed = results.filter((r) => !r.ok)
  if (failed.length === 0) {
    console.log("ok")
  } else {
    console.log(`FAIL (${failed.length})`)
    for (const f of failed) {
      console.error(`  - ${f.name}: ${f.error}`)
      failures.push({ round, seed, ...f })
    }
  }
}

const elapsedMs = Date.now() - started
console.log(
  `\nDone in ${(elapsedMs / 1000).toFixed(1)}s — checks=${totalChecks}, failures=${failures.length}, approxCases=${ROUNDS * RUNS * PROPERTY_COUNT}`,
)

if (failures.length > 0) {
  process.exitCode = 1
}
