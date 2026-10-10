import { expect, test } from "bun:test"
import fc from "fast-check"
import {
  isHttpOrHttpsUrl,
  sanitizeErrorMessage,
  sanitizeMediaTitle,
  sanitizeUsername,
} from "@/shared/sanitize-display"
import {
  participantUpdateSchema,
  playlistRenameSchema,
  roomJoinSchema,
} from "@/contracts/schemas"

const xssPackages = [
  "<script>alert(1)</script>",
  "<img src=x onerror=alert(1)>",
  '"><svg/onload=alert(1)>',
  "<math><mi>x</mi></math>",
  "javascript:alert(1)",
  "JaVaScRiPt:alert(1)",
  "data:text/html,<script>alert(1)</script>",
  "\u0000<script>alert(1)</script>",
  "\u202e<script>alert(1)</script>",
  "<iframe src=javascript:alert(1)>",
]

test("username sanitizer never returns markup delimiters or controls", () => {
  fc.assert(
    fc.property(fc.string({ maxLength: 80 }), (raw) => {
      const next = sanitizeUsername(raw)
      if (next === null) return
      expect(/[<>"'`]/.test(next)).toBe(false)
      expect(/[\p{Cc}\p{Cf}]/u.test(next)).toBe(false)
      expect(next.length).toBeGreaterThan(0)
      expect(next.length).toBeLessThanOrEqual(64)
    }),
    { numRuns: 200 },
  )
})

test("media titles never retain markup delimiters", () => {
  fc.assert(
    fc.property(fc.string({ maxLength: 300 }), (raw) => {
      const next = sanitizeMediaTitle(raw)
      if (next === null) return
      expect(/[<>"'`]/.test(next)).toBe(false)
      expect(next.length).toBeLessThanOrEqual(256)
    }),
    { numRuns: 200 },
  )
})

test("classic XSS packages are rejected by username / join schemas", () => {
  for (const payload of xssPackages) {
    expect(sanitizeUsername(payload)).toBeNull()
    expect(
      roomJoinSchema.safeParse({
        roomId: "room-1",
        userSecret: "secret-value",
        username: payload,
      }).success,
    ).toBe(false)
    expect(
      participantUpdateSchema.safeParse({ username: payload }).success,
    ).toBe(false)
  }
})

test("playlist rename rejects markup-only / javascript packages", () => {
  expect(
    playlistRenameSchema.safeParse({
      itemId: "i1",
      name: "javascript:alert(1)",
    }).success,
  ).toBe(false)
  expect(
    playlistRenameSchema.safeParse({
      itemId: "i1",
      name: "Normal Title <Live>",
    }).success,
  ).toBe(true)
  const renamed = playlistRenameSchema.safeParse({
    itemId: "i1",
    name: "Normal Title <Live>",
  })
  expect(renamed.success && renamed.data.name).toBe("Normal Title Live")
})

test("error messages reject HTML packaging", () => {
  fc.assert(
    fc.property(fc.constantFrom(...xssPackages), (payload) => {
      expect(sanitizeErrorMessage(payload)).toBeNull()
      expect(
        participantUpdateSchema.safeParse({ error: payload }).success,
      ).toBe(false)
    }),
    { numRuns: xssPackages.length },
  )
})

test("non-http(s) schemes never count as media URLs", () => {
  fc.assert(
    fc.property(
      fc.constantFrom("javascript", "data", "blob", "file", "vbscript"),
      fc.string({ maxLength: 40 }),
      (scheme, rest) => {
        expect(isHttpOrHttpsUrl(`${scheme}:${rest}`)).toBe(false)
      },
    ),
    { numRuns: 40 },
  )
})
