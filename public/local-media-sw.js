(() => {
  // src/shared/local-media/local-media-block-protocol.ts
  var LOCAL_MEDIA_MAX_BLOCK_BYTES = 256 * 1024;
  var LOCAL_MEDIA_MAX_FRAME_PAYLOAD = 60 * 1024;

  // src/shared/local-media/local-media-range.ts
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

  // src/shared/local-media/local-media-viewer-token.ts
  var LOCAL_MEDIA_VIEWER_TOKEN_PARAM = "vt";
  var LOCAL_MEDIA_VIEWER_USER_PARAM = "uid";

  // src/sw/local-media-sw.ts
  var RANGE_CLIENT_TIMEOUT_MS = 1500;
  var sw = self;
  var viewerCapabilityByClientId = new Map;
  var bridgeReadyClientIds = new Set;
  sw.addEventListener("install", (event) => {
    event.waitUntil?.(sw.skipWaiting());
  });
  sw.addEventListener("activate", (event) => {
    event.waitUntil?.(sw.clients.claim());
  });
  sw.addEventListener("message", (event) => {
    const data = event.data;
    if (!data?.type)
      return;
    const clientId = event.source?.id;
    if (!clientId)
      return;
    if (data.type === "local-media-sw-bridge-ready") {
      bridgeReadyClientIds.add(clientId);
      return;
    }
    if (data.type !== "local-media-sw-viewer-capability")
      return;
    const token = data.record?.token?.trim();
    const userId = data.record?.userId?.trim();
    if (token && userId) {
      viewerCapabilityByClientId.set(clientId, { token, userId });
    } else {
      viewerCapabilityByClientId.delete(clientId);
    }
  });
  function networkFetch(request, clientId) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/media/local/") && !url.pathname.includes("/internal/")) {
      const capability = clientId ? viewerCapabilityByClientId.get(clientId) : undefined;
      if (capability && (!url.searchParams.has(LOCAL_MEDIA_VIEWER_TOKEN_PARAM) || !url.searchParams.has(LOCAL_MEDIA_VIEWER_USER_PARAM))) {
        url.searchParams.set(LOCAL_MEDIA_VIEWER_TOKEN_PARAM, capability.token);
        url.searchParams.set(LOCAL_MEDIA_VIEWER_USER_PARAM, capability.userId);
      }
    }
    const headers = new Headers;
    const range = request.headers.get("range");
    if (range)
      headers.set("Range", range);
    const accept = request.headers.get("accept");
    if (accept)
      headers.set("Accept", accept);
    return fetch(url.toString(), {
      method: "GET",
      headers,
      credentials: "same-origin",
      cache: "no-store",
      redirect: "follow"
    });
  }
  async function askClientForRange(client, mediaId, start, end) {
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return new Promise((resolve) => {
      const channel = new MessageChannel;
      const timer = setTimeout(() => {
        resolve(null);
      }, RANGE_CLIENT_TIMEOUT_MS);
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
        const source = data.source === "webrtc" ? "webrtc" : data.source === "local" ? "local" : "sfu";
        resolve({
          buffer: data.buffer,
          mimeType: typeof data.mimeType === "string" && data.mimeType ? data.mimeType : undefined,
          totalSize: typeof data.totalSize === "number" && data.totalSize > 0 ? data.totalSize : undefined,
          source
        });
      };
      try {
        client.postMessage({
          type: "local-media-sw-range",
          requestId,
          mediaId,
          start,
          end
        }, [channel.port2]);
      } catch {
        clearTimeout(timer);
        resolve(null);
      }
    });
  }
  function rangeResponse(result, rangeStart) {
    const bytes = new Uint8Array(result.buffer);
    const total = result.totalSize != null ? result.totalSize : "*";
    return new Response(bytes, {
      status: 206,
      headers: {
        "Content-Type": result.mimeType || "application/octet-stream",
        "Accept-Ranges": "bytes",
        "Content-Length": String(bytes.byteLength),
        "Content-Range": `bytes ${rangeStart}-${rangeStart + bytes.byteLength - 1}/${total}`,
        "Cache-Control": "private, max-age=15",
        "X-Local-Media-Source": result.source
      }
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
    const clientId = event.clientId;
    event.respondWith((async () => {
      try {
        const range = parseRawBytesRangeHeader(request.headers.get("range"));
        if (!range) {
          return await networkFetch(request, clientId);
        }
        if (!clientId || !bridgeReadyClientIds.has(clientId)) {
          return await networkFetch(request, clientId);
        }
        const end = range.end ?? range.start + LOCAL_MEDIA_MAX_BLOCK_BYTES - 1;
        let client = null;
        try {
          client = await sw.clients.get(clientId);
        } catch {
          client = null;
        }
        if (client) {
          const result = await askClientForRange(client, mediaId, range.start, end);
          if (result) {
            return rangeResponse(result, range.start);
          }
        }
        return await networkFetch(request, clientId);
      } catch {
        try {
          return await networkFetch(request, clientId);
        } catch {
          return new Response("local-media service worker error", {
            status: 502,
            headers: { "Content-Type": "text/plain" }
          });
        }
      }
    })());
  });
})();
