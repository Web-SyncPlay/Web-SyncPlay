import { afterEach, describe, expect, test } from "bun:test"
import {
  getOrFetchLocalMediaBlock,
  invalidateAllLocalMediaBlockCache,
  invalidateLocalMediaBlockCache,
  localMediaBlockCacheStats,
} from "@/server/media/local-media-block-cache"

describe("local-media-block-cache", () => {
  const usedMediaIds: string[] = []

  function freshMediaId(label: string) {
    const id = `${label}-${crypto.randomUUID()}`
    usedMediaIds.push(id)
    return id
  }

  afterEach(async () => {
    invalidateAllLocalMediaBlockCache()
    // Unique ids avoid L2 collisions across runs; still wipe Redis for this suite.
    await Promise.all(
      usedMediaIds.splice(0).map((id) => invalidateLocalMediaBlockCache(id)),
    )
  })

  test("singleflight coalesces concurrent fetches for the same block", async () => {
    const mediaId = freshMediaId("m1")
    let fetches = 0
    const fetch = async () => {
      fetches += 1
      await Bun.sleep(20)
      return new Uint8Array([1, 2, 3])
    }

    const [a, b] = await Promise.all([
      getOrFetchLocalMediaBlock({
        mediaId,
        blockStart: 0,
        fetch,
      }),
      getOrFetchLocalMediaBlock({
        mediaId,
        blockStart: 0,
        fetch,
      }),
    ])

    expect(fetches).toBe(1)
    expect(a.cacheHit).toBe(false)
    expect(b.cacheHit).toBe(true)
    expect([...a.bytes]).toEqual([1, 2, 3])
    expect([...b.bytes]).toEqual([1, 2, 3])
  })

  test("second sequential call is a cache hit", async () => {
    const mediaId = freshMediaId("m2")
    let fetches = 0
    const fetch = async () => {
      fetches += 1
      return new Uint8Array([9])
    }

    const first = await getOrFetchLocalMediaBlock({
      mediaId,
      blockStart: 0,
      fetch,
    })
    const second = await getOrFetchLocalMediaBlock({
      mediaId,
      blockStart: 0,
      fetch,
    })

    expect(fetches).toBe(1)
    expect(first.cacheHit).toBe(false)
    expect(second.cacheHit).toBe(true)
    expect(localMediaBlockCacheStats().entries).toBe(1)
  })

  test("invalidate clears blocks for one media id", async () => {
    const keep = freshMediaId("keep")
    const drop = freshMediaId("drop")
    await getOrFetchLocalMediaBlock({
      mediaId: keep,
      blockStart: 0,
      fetch: async () => new Uint8Array([1]),
    })
    await getOrFetchLocalMediaBlock({
      mediaId: drop,
      blockStart: 0,
      fetch: async () => new Uint8Array([2]),
    })

    await invalidateLocalMediaBlockCache(drop)
    expect(localMediaBlockCacheStats().entries).toBe(1)

    let fetches = 0
    await getOrFetchLocalMediaBlock({
      mediaId: drop,
      blockStart: 0,
      fetch: async () => {
        fetches += 1
        return new Uint8Array([3])
      },
    })
    expect(fetches).toBe(1)
  })

  test("continues with L1 + provider when Redis is unavailable", async () => {
    // No live Redis required: getCommandClient failures are swallowed and
    // write-through / L2 reads no-op with occasional warn.
    const mediaId = freshMediaId("redis-down")
    let fetches = 0
    const first = await getOrFetchLocalMediaBlock({
      mediaId,
      blockStart: 0,
      fetch: async () => {
        fetches += 1
        return new Uint8Array([4, 5])
      },
    })
    const second = await getOrFetchLocalMediaBlock({
      mediaId,
      blockStart: 0,
      fetch: async () => {
        fetches += 1
        return new Uint8Array([4, 5])
      },
    })

    expect(fetches).toBe(1)
    expect(first.cacheHit).toBe(false)
    expect(second.cacheHit).toBe(true)
    expect([...first.bytes]).toEqual([4, 5])
  })
})
