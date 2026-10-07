import {
  buildContentSecurityPolicy,
  isOriginAllowed,
} from "@/lib/public-domain"
import { NextResponse, type NextRequest } from "next/server"

const CORS_ALLOW_METHODS = "GET,HEAD,POST,OPTIONS"
const CORS_EXPOSE_HEADERS =
  "content-range, accept-ranges, content-length"

function applyCorsHeaders(
  headers: Headers,
  request: NextRequest,
  origin: string,
): void {
  headers.set("Access-Control-Allow-Origin", origin)
  headers.set("Vary", "Origin")
  headers.set("Access-Control-Allow-Methods", CORS_ALLOW_METHODS)
  headers.set(
    "Access-Control-Allow-Headers",
    request.headers.get("access-control-request-headers") ??
      "content-type, authorization, range",
  )
  headers.set("Access-Control-Expose-Headers", CORS_EXPOSE_HEADERS)
}

export function proxy(request: NextRequest) {
  const response = NextResponse.next()
  const origin = request.headers.get("origin")

  response.headers.set("Content-Security-Policy", buildContentSecurityPolicy())
  response.headers.set("X-Content-Type-Options", "nosniff")
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin")

  if (origin && isOriginAllowed(origin)) {
    applyCorsHeaders(response.headers, request, origin)
  }

  if (request.method === "OPTIONS" && origin && isOriginAllowed(origin)) {
    return new NextResponse(null, {
      status: 204,
      headers: response.headers,
    })
  }

  return response
}

export const config = {
  matcher: [
    /*
     * Apply CSP/CORS to app + API. Skip Next internals and static assets
     * that do not need these headers on every hit.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|webmanifest)$).*)",
  ],
}
