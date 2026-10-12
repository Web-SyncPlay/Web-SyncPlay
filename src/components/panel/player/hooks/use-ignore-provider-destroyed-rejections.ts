"use client"

import { useEffect } from "react"

function isProviderDestroyedReason(reason: unknown): boolean {
  if (reason === "provider destroyed") {
    return true
  }
  if (reason instanceof Error && reason.message === "provider destroyed") {
    return true
  }
  return typeof reason === "string" && reason === "provider destroyed"
}

/**
 * Vidstack YouTube/Vimeo providers reject in-flight remote calls with the
 * string `"provider destroyed"` when the provider is torn down (src change,
 * unmount, metadata probe finish). Those rejections are expected and otherwise
 * surface as noisy unhandledrejection / pageerror noise.
 */
export function useIgnoreProviderDestroyedRejections(): void {
  useEffect(() => {
    const onRejection = (event: PromiseRejectionEvent) => {
      if (!isProviderDestroyedReason(event.reason)) {
        return
      }
      event.preventDefault()
    }
    window.addEventListener("unhandledrejection", onRejection)
    return () => {
      window.removeEventListener("unhandledrejection", onRejection)
    }
  }, [])
}
