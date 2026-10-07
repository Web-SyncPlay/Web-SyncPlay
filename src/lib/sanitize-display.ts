/**
 * Defense-in-depth for user/extract display strings.
 * React text nodes already escape HTML; these helpers still strip control /
 * bidi spoofing chars and markup delimiters so payloads cannot be "packaged"
 * for a future sink (attributes, logs, CSV, etc.).
 */

export type SanitizeDisplayOptions = {
  maxLength: number
  /** When true, reject (return null) if raw input contains `<` or `>`. */
  rejectMarkup?: boolean
  /** Strip `<>"'`\`` from the value (titles default on; softer than reject). */
  stripMarkupDelimiters?: boolean
}

const MARKUP_CHARS = /[<>"'`]/g

/** Cc + Cf: ASCII/C1 controls and format chars (incl. bidi overrides). */
const CONTROL_OR_FORMAT = /[\p{Cc}\p{Cf}]/gu

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim()
}

/**
 * Returns a safe display string, or `null` when the input is unusable after
 * sanitization (empty) or fails a strict packaging check.
 */
export function sanitizeDisplayText(
  raw: string,
  options: SanitizeDisplayOptions,
): string | null {
  if (typeof raw !== "string") return null

  if (options.rejectMarkup && /[<>]/.test(raw)) {
    return null
  }

  // javascript: packaged as a "name" that might later land in href/src.
  if (/^\s*javascript\s*:/i.test(raw) || /^\s*data\s*:/i.test(raw)) {
    return null
  }

  let value = raw.normalize("NFC")
  value = value.replace(CONTROL_OR_FORMAT, "")
  if (options.stripMarkupDelimiters !== false) {
    value = value.replace(MARKUP_CHARS, "")
  }
  value = collapseWhitespace(value)

  if (!value) return null
  if (value.length > options.maxLength) {
    value = value.slice(0, options.maxLength).trimEnd()
  }
  return value || null
}

export function sanitizeUsername(raw: string): string | null {
  return sanitizeDisplayText(raw, {
    maxLength: 64,
    rejectMarkup: true,
    stripMarkupDelimiters: true,
  })
}

export function sanitizeMediaTitle(raw: string): string | null {
  return sanitizeDisplayText(raw, {
    maxLength: 256,
    rejectMarkup: false,
    stripMarkupDelimiters: true,
  })
}

export function sanitizeErrorMessage(raw: string): string | null {
  return sanitizeDisplayText(raw, {
    maxLength: 300,
    rejectMarkup: true,
    stripMarkupDelimiters: true,
  })
}

/** True only for http(s) URLs — blocks javascript:/data:/blob: in media sinks. */
export function isHttpOrHttpsUrl(raw: string): boolean {
  try {
    const url = new URL(raw)
    return url.protocol === "http:" || url.protocol === "https:"
  } catch {
    return false
  }
}
