import { describe, expect, test } from "bun:test"

import { omitKey } from "./omit-key"

describe("omitKey", () => {
  test("returns a shallow clone without the key", () => {
    const input = { a: 1, b: 2, c: 3 }
    expect(omitKey(input, "b")).toEqual({ a: 1, c: 3 })
    expect(input).toEqual({ a: 1, b: 2, c: 3 })
  })

  test("leaves other keys intact when key is missing", () => {
    const input = { a: 1 } as { a: number; b?: number }
    expect(omitKey(input, "b")).toEqual({ a: 1 })
  })
})
