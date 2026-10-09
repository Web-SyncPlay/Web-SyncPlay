import { extractMetadata } from "@/server/media/yt-dlp"
import type { DailyDefaultVideo } from "@/server/realtime/ports"

/** Read path: never blocks on yt-dlp; missing titles fall back to the URL. */
export function dailyDefaultsForRead(
  entries: DailyDefaultVideo[],
): DailyDefaultVideo[] {
  return entries.map((entry) => {
    const cleanTitle = entry.title?.trim() ?? ""
    if (cleanTitle) {
      return { title: cleanTitle, url: entry.url }
    }
    return { title: entry.url, url: entry.url }
  })
}

/**
 * Background hydration for persisted defaults missing titles.
 * Returns the number of entries updated via yt-dlp.
 */
export async function hydrateMissingDailyDefaultTitles(
  entries: DailyDefaultVideo[],
): Promise<{ videos: DailyDefaultVideo[]; hydratedCount: number }> {
  let hydratedCount = 0
  const videos = await Promise.all(
    entries.map(async (entry) => {
      const cleanTitle = entry.title?.trim() ?? ""
      if (cleanTitle) {
        return { title: cleanTitle, url: entry.url }
      }

      const metadata = await extractMetadata(entry.url)
      hydratedCount += 1
      return {
        title: metadata.title ?? "Resolved media",
        url: entry.url,
      }
    }),
  )

  return { videos, hydratedCount }
}
