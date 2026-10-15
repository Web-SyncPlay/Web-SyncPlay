/**
 * Attach a user-picked File to a media element for metadata-only probing.
 *
 * Prefer `srcObject` so the File never flows into a URL/HTML sink (CodeQL
 * `js/xss-through-dom`). Chromium only accepts MediaStream | MediaSourceHandle
 * on `srcObject` and throws TypeError for File/Blob — fall back to a
 * same-origin `blob:` object URL in that case.
 */

export function attachLocalMediaFileForProbe(
  el: HTMLMediaElement,
  file: File,
): () => void {
  try {
    el.srcObject = file
    return () => {
      el.srcObject = null
      el.load()
    }
  } catch (error) {
    if (!(error instanceof TypeError)) throw error
  }

  const objectUrl = URL.createObjectURL(file)
  if (!objectUrl.startsWith("blob:")) {
    URL.revokeObjectURL(objectUrl)
    throw new Error("Unexpected object URL scheme")
  }
  // createObjectURL always returns a same-origin blob: URL for the File bytes;
  // <video>/<audio> decode it as media, not HTML. Required where File is
  // rejected by srcObject (Chromium).
  // codeql[js/xss-through-dom]: blob: object URL from user File for media probe
  el.src = objectUrl
  return () => {
    el.removeAttribute("src")
    el.load()
    URL.revokeObjectURL(objectUrl)
  }
}
