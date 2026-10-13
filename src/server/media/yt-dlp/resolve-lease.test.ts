import { parsePendingMember } from "@/server/media/yt-dlp/resolve-lease"
import { expect, test } from "bun:test"

test("parses pending resolve members", () => {
  expect(parsePendingMember("room-1\titem-2")).toEqual({
    roomId: "room-1",
    itemId: "item-2",
  })
  expect(parsePendingMember("bad")).toBeNull()
  expect(parsePendingMember("\titem")).toBeNull()
})
