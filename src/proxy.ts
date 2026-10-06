import {
  buildContentSecurityPolicy,
  getPublicOrigin,
  isOriginAllowed,
} from "@/lib/public-domain"
import { NextResponse, type NextRequest } from "next/server"

export function proxy(request: NextRequest) {
  const response = NextResponse.next()
  const origin = request.headers.get("origin")
  const publicOrigin = getPublicOrigin()

  response.headers.set("Content-Security-Policy", buildContentSecurityPolicy())
  response.headers.set("X-Content-Type-Options", "nosniff")
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin")

  if (origin && isOriginAllowed(origin)) {
    response.headers.set("Access-Control-Allow-Origin", origin)
    response.headers.set("Vary", "Origin")
    response.headers.set(
      "Access-Control-Allow-Methods",
      "GET,HEAD,POST,OPTIONS",
    )
    response.headers.set(
      "Access-Control-Allow-Headers",
      request.headers.get("access-control-request-headers") ??
        "content-type, authorization, range",
    )
    response.headers.set("Access-Control-Expose-Headers", "content-range, accept-ranges, content-length")
  } else if (!origin && publicOrigin) {
    // Same-origin navigations have no Origin; CSP still binds the app.
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
