import { describe, expect, test } from "bun:test"
import { attachLocalMediaFileForProbe } from "./local-media-probe-attach"

function createMockMediaElement(options: {
  acceptSrcObjectFile: boolean
}): HTMLMediaElement {
  let srcObject: File | MediaStream | MediaSource | null = null
  let src = ""
  let loadCount = 0
  const el = {
    get srcObject() {
      return srcObject
    },
    set srcObject(value: File | MediaStream | MediaSource | null) {
      if (
        value !== null &&
        typeof File !== "undefined" &&
        value instanceof File &&
        !options.acceptSrcObjectFile
      ) {
        throw new TypeError(
          "Failed to set the 'srcObject' property: The provided value is not of type '(MediaStream or MediaSourceHandle)'.",
        )
      }
      srcObject = value
    },
    get src() {
      return src
    },
    set src(value: string) {
      src = value
    },
    removeAttribute(name: string) {
      if (name === "src") src = ""
    },
    load() {
      loadCount += 1
    },
    get loadCount() {
      return loadCount
    },
  }
  return el as unknown as HTMLMediaElement
}

describe("attachLocalMediaFileForProbe", () => {
  test("uses srcObject when the engine accepts File", () => {
    const el = createMockMediaElement({ acceptSrcObjectFile: true })
    const file = new File([new Uint8Array([1])], "a.mp4", { type: "video/mp4" })
    const detach = attachLocalMediaFileForProbe(el, file)
    expect(el.srcObject).toBe(file)
    expect(el.src).toBe("")
    detach()
    expect(el.srcObject).toBeNull()
  })

  test("falls back to a blob: object URL when srcObject rejects File", () => {
    const el = createMockMediaElement({ acceptSrcObjectFile: false })
    const file = new File([new Uint8Array([1])], "a.mp4", { type: "video/mp4" })
    const detach = attachLocalMediaFileForProbe(el, file)
    expect(el.srcObject).toBeNull()
    expect(el.src.startsWith("blob:")).toBe(true)
    const attached = el.src
    detach()
    expect(el.src).toBe("")
    // Revoked URLs should not be reused as a live source.
    expect(attached.startsWith("blob:")).toBe(true)
  })
})
