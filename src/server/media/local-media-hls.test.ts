import { describe, expect, test } from "bun:test"
import {
  buildLocalMediaMasterPlaylist,
  buildLocalMediaVariantPlaylist,
} from "@/server/media/local-media-hls"

describe("local-media HLS builders", () => {
  test("single-variant fallback master points at parent media playlist", () => {
    const body = buildLocalMediaMasterPlaylist({
      parentId: "00000000-0000-4000-8000-000000000001",
    })
    expect(body).toContain("#EXTM3U")
    expect(body).toContain(
      "/api/media/local/00000000-0000-4000-8000-000000000001/hls/00000000-0000-4000-8000-000000000001",
    )
  })

  test("multi-variant master lists heights highest-first", () => {
    const parent = "00000000-0000-4000-8000-0000000000aa"
    const body = buildLocalMediaMasterPlaylist({
      parentId: parent,
      variants: [
        {
          localMediaId: parent,
          height: 1080,
          bandwidth: 5_000_000,
          label: "Source",
        },
        {
          localMediaId: "00000000-0000-4000-8000-0000000000bb",
          height: 480,
          bandwidth: 1_000_000,
          label: "480p",
        },
        {
          localMediaId: "00000000-0000-4000-8000-0000000000cc",
          height: 720,
          bandwidth: 2_500_000,
          label: "720p",
        },
      ],
    })
    const idx1080 = body.indexOf("NAME=\"Source\"")
    const idx720 = body.indexOf("NAME=\"720p\"")
    const idx480 = body.indexOf("NAME=\"480p\"")
    expect(idx1080).toBeGreaterThan(-1)
    expect(idx720).toBeGreaterThan(idx1080)
    expect(idx480).toBeGreaterThan(idx720)
    expect(body).toContain(`/api/media/local/${parent}/hls/00000000-0000-4000-8000-0000000000cc`)
  })

  test("variant playlist is single-segment VOD", () => {
    const body = buildLocalMediaVariantPlaylist({
      variantLocalMediaId: "00000000-0000-4000-8000-0000000000dd",
      durationSec: 125.4,
    })
    expect(body).toContain("#EXT-X-PLAYLIST-TYPE:VOD")
    expect(body).toContain("#EXT-X-TARGETDURATION:126")
    expect(body).toContain("#EXTINF:126.0,")
    expect(body).toContain(
      "/api/media/local/00000000-0000-4000-8000-0000000000dd",
    )
    expect(body).toContain("#EXT-X-ENDLIST")
  })

  test("viewerQuery is appended to playlist child URLs", () => {
    const master = buildLocalMediaMasterPlaylist({
      parentId: "00000000-0000-4000-8000-000000000001",
      viewerQuery: { vt: "tok", uid: "u1" },
    })
    expect(master).toContain(
      "/api/media/local/00000000-0000-4000-8000-000000000001/hls/00000000-0000-4000-8000-000000000001?vt=tok&uid=u1",
    )

    const variant = buildLocalMediaVariantPlaylist({
      variantLocalMediaId: "00000000-0000-4000-8000-0000000000dd",
      durationSec: 10,
      viewerQuery: { vt: "tok", uid: "u1" },
    })
    expect(variant).toContain(
      "/api/media/local/00000000-0000-4000-8000-0000000000dd?vt=tok&uid=u1",
    )
  })
})

