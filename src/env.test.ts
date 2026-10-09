import { describe, expect, test } from "bun:test"
import { z } from "zod"
import {
  LOCAL_MEDIA_INTERNAL_PAIR_MESSAGE,
  refineLocalMediaInternalEnvPair,
} from "@/env"

const pairSchema = z
  .object({
    INTERNAL_NODE_BASE_URL: z.url().optional(),
    LOCAL_MEDIA_INTERNAL_SECRET: z.string().min(16).optional(),
  })
  .superRefine(refineLocalMediaInternalEnvPair)

describe("local-media internal env pair", () => {
  test("allows both unset", () => {
    expect(pairSchema.safeParse({}).success).toBe(true)
  })

  test("allows both set", () => {
    const result = pairSchema.safeParse({
      INTERNAL_NODE_BASE_URL: "http://web:3000",
      LOCAL_MEDIA_INTERNAL_SECRET: "change-me-to-at-least-16-chars",
    })
    expect(result.success).toBe(true)
  })

  test("rejects only INTERNAL_NODE_BASE_URL", () => {
    const result = pairSchema.safeParse({
      INTERNAL_NODE_BASE_URL: "http://web:3000",
    })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error.issues.some((i) => i.message === LOCAL_MEDIA_INTERNAL_PAIR_MESSAGE)).toBe(
      true,
    )
  })

  test("rejects only LOCAL_MEDIA_INTERNAL_SECRET", () => {
    const result = pairSchema.safeParse({
      LOCAL_MEDIA_INTERNAL_SECRET: "change-me-to-at-least-16-chars",
    })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error.issues.some((i) => i.message === LOCAL_MEDIA_INTERNAL_PAIR_MESSAGE)).toBe(
      true,
    )
  })
})
