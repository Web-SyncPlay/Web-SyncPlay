(() => {
  // src/lib/local-media-block-protocol.ts
  var LOCAL_MEDIA_MAX_BLOCK_BYTES = 256 * 1024;
  var LOCAL_MEDIA_MAX_FRAME_PAYLOAD = 60 * 1024;

  // src/lib/local-media-range.ts
  function parseRawBytesRangeHeader(rangeHeader) {
    if (!rangeHeader) {
      return null;
    }
    const match = /^bytes=(\d+)-(\d+)?$/i.exec(rangeHeader.trim());
    if (!match) {
      return null;
    }
    const start = Number.parseInt(match[1] ?? "0", 10);
    const end = match[2] != null ? Number.parseInt(match[2], 10) : null;
    if (!Number.isFinite(start) || end != null && !Number.isFinite(end)) {
      return null;
    }
    return { start, end };
  }

  // src/sw/local-media-sw.ts
  var sw = self;
  var viewerCapability = null;
  sw.addEventListener("install", (event) => {
    event.waitUntil?.(sw.skipWaiting());
  });
  sw.addEventListener("activate", (event) => {
    event.waitUntil?.(sw.clients.claim());
  });
  sw.addEventListener("message", (event) => {
    const data = event.data;
    if (!data || data.type !== "local-media-sw-viewer-capability")
      return;
    const token = data.record?.token?.trim();
    const userId = data.record?.userId?.trim();
    viewerCapability = token && userId ? { token, userId } : null;
  });
  function withViewerCapabilityOnRequest(request) {
    if (!viewerCapability)
      return request;
    try {
      const url = new URL(request.url);
      if (!url.pathname.startsWith("/api/media/local/"))
        return request;
      if (url.pathname.includes("/internal/"))
        return request;
      if (url.searchParams.has("vt") && url.searchParams.has("uid")) {
        return request;
      }
      url.searchParams.set("vt", viewerCapability.token);
      url.searchParams.set("uid", viewerCapability.userId);
      return new Request(url.toString(), request);
    } catch {
      return request;
    }
  }
  async function askClientForRange(client, mediaId, start, end) {
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return new Promise((resolve) => {
      const channel = new MessageChannel;
      const timer = setTimeout(() => {
        resolve(null);
      }, 12000);
      channel.port1.onmessage = (event) => {
        clearTimeout(timer);
        const data = event.data;
        if (!data || data.requestId !== requestId) {
          resolve(null);
          return;
        }
        if (!data.ok || !data.buffer) {
          resolve(null);
          return;
        }
        resolve({
          buffer: data.buffer,
          mimeType: typeof data.mimeType === "string" && data.mimeType ? data.mimeType : undefined,
          totalSize: typeof data.totalSize === "number" && data.totalSize > 0 ? data.totalSize : undefined,
          source: data.source === "webrtc" ? "webrtc" : "sfu"
        });
      };
      client.postMessage({
        type: "local-media-sw-range",
        requestId,
        mediaId,
        start,
        end
      }, [channel.port2]);
    });
  }
  sw.addEventListener("fetch", (event) => {
    if (!event.request || !event.respondWith)
      return;
    const url = new URL(event.request.url);
    if (!url.pathname.startsWith("/api/media/local/"))
      return;
    if (url.pathname.includes("/internal/"))
      return;
    if (url.pathname.includes("/hls/"))
      return;
    const parts = url.pathname.split("/").filter(Boolean);
    const mediaId = parts[3];
    if (!mediaId)
      return;
    const request = event.request;
    event.respondWith((async () => {
      const range = parseRawBytesRangeHeader(request.headers.get("range"));
      if (!range) {
        return fetch(withViewerCapabilityOnRequest(request));
      }
      const clients = await sw.clients.matchAll({
        type: "window",
        includeUncontrolled: true
      });
      const end = range.end ?? range.start + LOCAL_MEDIA_MAX_BLOCK_BYTES - 1;
      for (const client of clients) {
        const result = await askClientForRange(client, mediaId, range.start, end);
        if (result) {
          const bytes = new Uint8Array(result.buffer);
          const total = result.totalSize != null ? result.totalSize : "*";
          return new Response(bytes, {
            status: 206,
            headers: {
              "Content-Type": result.mimeType || "application/octet-stream",
              "Accept-Ranges": "bytes",
              "Content-Length": String(bytes.byteLength),
              "Content-Range": `bytes ${range.start}-${range.start + bytes.byteLength - 1}/${total}`,
              "Cache-Control": "private, max-age=15",
              "X-Local-Media-Source": result.source
            }
          });
        }
      }
      return fetch(withViewerCapabilityOnRequest(request));
    })());
  });
})();
