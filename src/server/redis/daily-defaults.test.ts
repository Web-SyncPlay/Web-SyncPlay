import { afterEach, describe, expect, mock, test } from "bun:test"
import { dailyDefaultsForRead } from "@/server/redis/daily-defaults"

afterEach(() => {
  mock.restore()
})

describe("dailyDefaultsForRead", () => {
  test("returns titled entries unchanged", () => {
    expect(
      dailyDefaultsForRead([{ title: "  My Video  ", url: "https://x.test/v" }]),
    ).toEqual([{ title: "My Video", url: "https://x.test/v" }])
  })

  test("uses URL as title when missing", () => {
    expect(
      dailyDefaultsForRead([{ title: "", url: "https://x.test/untitled" }]),
    ).toEqual([
      { title: "https://x.test/untitled", url: "https://x.test/untitled" },
    ])
  })
})

describe("hydrateMissingDailyDefaultTitles", () => {
  test("hydrates only entries missing titles", async () => {
    const extract = mock(async (url: string) => ({
      title: `Resolved:${url}`,
    }))
    mock.module("@/server/media/yt-dlp", () => ({
      extractMetadata: extract,
    }))

    const { hydrateMissingDailyDefaultTitles: hydrate } = await import(
      "@/server/redis/daily-defaults"
    )

    const { videos, hydratedCount } = await hydrate([
      { title: "Keep", url: "https://x.test/a" },
      { title: "  ", url: "https://x.test/b" },
    ])

    expect(hydratedCount).toBe(1)
    expect(videos).toEqual([
      { title: "Keep", url: "https://x.test/a" },
      { title: "Resolved:https://x.test/b", url: "https://x.test/b" },
    ])
    expect(extract).toHaveBeenCalledTimes(1)
  })
})
