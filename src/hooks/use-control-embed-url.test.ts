import { describe, expect, test } from "bun:test"
import { pickControlEmbedUrl } from "./use-control-embed-url"

describe("pickControlEmbedUrl", () => {
  test("guests use identity URL without requiring a minted token", () => {
    expect(
      pickControlEmbedUrl({
        canMutate: false,
        identityControlEmbedUrl: "/room/r1/control#uid=u&secret=s",
        mintedUrl: null,
      }),
    ).toBe("/room/r1/control#uid=u&secret=s")
  })

  test("mutators never fall back to a tokenless control URL", () => {
    expect(
      pickControlEmbedUrl({
        canMutate: true,
        identityControlEmbedUrl: "/room/r1/control#uid=u&secret=s",
        mintedUrl: null,
      }),
    ).toBe("")
  })

  test("mutators return the minted URL when available", () => {
    expect(
      pickControlEmbedUrl({
        canMutate: true,
        identityControlEmbedUrl: "/room/r1/control#uid=u&secret=s",
        mintedUrl: "/room/r1/control#uid=u&secret=s&ct=tok",
      }),
    ).toBe("/room/r1/control#uid=u&secret=s&ct=tok")
  })
})
