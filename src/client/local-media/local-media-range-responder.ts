/**
 * Shared provider-side byte-range core for SFU / WebRTC / HTTP-relay paths.
 *
 * Adapters own framing and transport; this module owns validation, max-block
 * policy, timed reads, and stable error codes. Delivery-mode selection stays in
 * {@link planLocalMediaDeliveryAttempts}.
 */

import {
  LOCAL_MEDIA_BLOCK_REQUEST_ID_LENGTH,
  LOCAL_MEDIA_MAX_BLOCK_BYTES,
} from "@/shared/local-media/local-media-block-protocol"
import { readLocalMediaRange } from "@/client/local-media/local-media-file-read"

export type RangeResponderErrorCode =
  | "provider_unavailable"
  | "invalid_range"
  | "range_too_large"
  | "read_failed"
  | "timeout"

export type RangeServeOk = {
  ok: true
  bytes: Uint8Array<ArrayBuffer>
  start: number
  end: number
  requestId?: string
}

export type RangeServeErr = {
  ok: false
  error: RangeResponderErrorCode
  requestId?: string
}

export type RangeServeResult = RangeServeOk | RangeServeErr

export type RangeServeInput = {
  file: Blob | null | undefined
  start: unknown
  end: unknown
  requestId?: unknown
  /** SFU path requires a 36-char request id on the wire. */
  requireRequestIdLength?: boolean
  maxBlockBytes?: number
  signal?: AbortSignal
  timeoutMs?: number
}

export type RangeResponder = {
  /** Validate + read; returns bytes or a stable error code. */
  serve: (request: {
    localMediaId: string
    start: unknown
    end: unknown
    requestId?: unknown
    requireRequestIdLength?: boolean
    signal?: AbortSignal
    timeoutMs?: number
  }) => Promise<RangeServeResult>
  /** Convenience: bytes or null (any error → null). */
  fetch: (range: {
    localMediaId: string
    start: number
    end: number
    signal?: AbortSignal
    timeoutMs?: number
  }) => Promise<Uint8Array<ArrayBuffer> | null>
}

export type CreateRangeResponderInput = {
  getFile: (localMediaId: string) => Blob | null
  maxBlockBytes?: number
  defaultTimeoutMs?: number
  /** Fired once a range was read successfully (lazy P2P / telemetry). */
  onServed?: (localMediaId: string) => void
}

function asRequestId(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

/**
 * Validate an inclusive byte range and read it from `file`.
 * Pure relative to the File registry — callers supply the Blob.
 */
export async function serveLocalMediaRange(
  input: RangeServeInput,
): Promise<RangeServeResult> {
  const requestId = asRequestId(input.requestId)
  const maxBlockBytes = input.maxBlockBytes ?? LOCAL_MEDIA_MAX_BLOCK_BYTES

  if (input.requireRequestIdLength) {
    if (
      typeof input.requestId !== "string" ||
      input.requestId.length !== LOCAL_MEDIA_BLOCK_REQUEST_ID_LENGTH
    ) {
      return { ok: false, error: "provider_unavailable", requestId }
    }
  }

  if (!input.file) {
    return { ok: false, error: "provider_unavailable", requestId }
  }

  const { start, end } = input
  if (
    typeof start !== "number" ||
    typeof end !== "number" ||
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start < 0 ||
    end < start
  ) {
    return { ok: false, error: "invalid_range", requestId }
  }

  if (end - start + 1 > maxBlockBytes) {
    return { ok: false, error: "range_too_large", requestId }
  }

  if (input.signal?.aborted) {
    return { ok: false, error: "timeout", requestId }
  }

  try {
    const bytes = await readWithTimeout(
      input.file,
      start,
      end,
      input.signal,
      input.timeoutMs,
    )
    return { ok: true, bytes, start, end, requestId }
  } catch (error) {
    if (isTimeoutError(error) || input.signal?.aborted) {
      return { ok: false, error: "timeout", requestId }
    }
    return { ok: false, error: "read_failed", requestId }
  }
}

/** Timed File.slice read; returns null on any failure (viewer convenience). */
export async function fetchLocalMediaRangeBytes(
  file: Blob,
  start: number,
  end: number,
  options?: { signal?: AbortSignal; timeoutMs?: number },
): Promise<Uint8Array<ArrayBuffer> | null> {
  const result = await serveLocalMediaRange({
    file,
    start,
    end,
    signal: options?.signal,
    timeoutMs: options?.timeoutMs,
  })
  return result.ok ? result.bytes : null
}

export function createRangeResponder(
  input: CreateRangeResponderInput,
): RangeResponder {
  const maxBlockBytes = input.maxBlockBytes ?? LOCAL_MEDIA_MAX_BLOCK_BYTES

  const serve: RangeResponder["serve"] = async (request) => {
    const result = await serveLocalMediaRange({
      file: input.getFile(request.localMediaId),
      start: request.start,
      end: request.end,
      requestId: request.requestId,
      requireRequestIdLength: request.requireRequestIdLength,
      maxBlockBytes,
      signal: request.signal,
      timeoutMs: request.timeoutMs ?? input.defaultTimeoutMs,
    })
    if (result.ok) {
      input.onServed?.(request.localMediaId)
    }
    return result
  }

  const fetch: RangeResponder["fetch"] = async (range) => {
    const result = await serve({
      localMediaId: range.localMediaId,
      start: range.start,
      end: range.end,
      signal: range.signal,
      timeoutMs: range.timeoutMs,
    })
    return result.ok ? result.bytes : null
  }

  return { serve, fetch }
}

type GlobalRangeResponderSlot = {
  __webSyncPlayLocalMediaRangeResponder?: RangeResponder | null
}

/**
 * Process-wide active responder installed by {@link createLocalMediaRuntime}.
 * HMR / same-origin multi-socket survival only — prefer the runtime's own
 * `rangeResponder`. Clear only via {@link clearActiveRangeResponderIf} so
 * closing one tab/session does not wipe another session's responder.
 */
export function setActiveRangeResponder(responder: RangeResponder | null) {
  const g = globalThis as typeof globalThis & GlobalRangeResponderSlot
  g.__webSyncPlayLocalMediaRangeResponder = responder
}

/** Clear the global slot only when it still points at `responder`. */
export function clearActiveRangeResponderIf(responder: RangeResponder) {
  const g = globalThis as typeof globalThis & GlobalRangeResponderSlot
  if (g.__webSyncPlayLocalMediaRangeResponder === responder) {
    g.__webSyncPlayLocalMediaRangeResponder = null
  }
}

export function getActiveRangeResponder(): RangeResponder | null {
  const g = globalThis as typeof globalThis & GlobalRangeResponderSlot
  return g.__webSyncPlayLocalMediaRangeResponder ?? null
}

/** Prefer the runtime-installed responder; otherwise a getFile-backed default. */
export function resolveRangeResponder(
  fallbackGetFile: (localMediaId: string) => Blob | null,
): RangeResponder {
  return (
    getActiveRangeResponder() ??
    createRangeResponder({ getFile: fallbackGetFile })
  )
}

async function readWithTimeout(
  file: Blob,
  start: number,
  end: number,
  signal: AbortSignal | undefined,
  timeoutMs: number | undefined,
): Promise<Uint8Array<ArrayBuffer>> {
  if (timeoutMs == null || timeoutMs <= 0) {
    if (signal) {
      return awaitPromiseWithAbort(readLocalMediaRange(file, start, end), signal)
    }
    return readLocalMediaRange(file, start, end)
  }

  const timeoutController = new AbortController()
  const onAbort = () => timeoutController.abort()
  signal?.addEventListener("abort", onAbort, { once: true })

  const timer = setTimeout(() => timeoutController.abort(), timeoutMs)
  try {
    return await awaitPromiseWithAbort(
      readLocalMediaRange(file, start, end),
      timeoutController.signal,
      "timeout",
    )
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener("abort", onAbort)
  }
}

function awaitPromiseWithAbort<T>(
  promise: Promise<T>,
  signal: AbortSignal,
  message = "aborted",
): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(new Error(message))
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new Error(message))
    signal.addEventListener("abort", onAbort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort)
        resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort)
        reject(error)
      },
    )
  })
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && error.message === "timeout"
}
