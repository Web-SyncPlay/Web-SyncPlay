import { describe, expect, test } from "bun:test"
import { readLocalMediaRange } from "./local-media-file-read"

describe("readLocalMediaRange", () => {
  test("reads an inclusive byte range from a Blob", async () => {
    const file = new Blob([new Uint8Array([10, 20, 30, 40, 50])])
    const bytes = await readLocalMediaRange(file, 1, 3)
    expect([...bytes]).toEqual([20, 30, 40])
  })

  test("reads a single-byte range", async () => {
    const file = new File([new Uint8Array([7, 8, 9])], "clip.bin")
    const bytes = await readLocalMediaRange(file, 1, 1)
    expect([...bytes]).toEqual([8])
  })
})
