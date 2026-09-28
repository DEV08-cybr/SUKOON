export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type JsonRecord = Record<string, any>;
type PlaylistPayload = {
  name: string;
  thumbnailUrl: string;
  uploader: string;
  videos: number;
  relatedStreams: JsonRecord[];
  nextpage: string;
};

type RouteContext = { params: Promise<{ segments: string[] }> };

const PIPED_INSTANCES = [
  "https://pipedapi.ducks.party",
  "https://api.piped.private.coffee"
];
const playlistCache = new Map<string, { expiresAt: number; payload: PlaylistPayload }>();
const PLAYLIST_ID_RE = /^[A-Za-z0-9_-]{5,128}$/;
const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

async function fetchJsonWithTimeout(url: string, timeoutMs = 5000): Promise<JsonRecord> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      cache: "no-store",
      headers: { Accept: "application/json", "User-Agent": "SukoonPlayer/1.0 (playlist metadata)" }
    });
    if (!response.ok) throw new Error(`Metadata source returned ${response.status}`);
    const result: unknown = await response.json();
    if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error("Invalid metadata response");
    return result as JsonRecord;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchPiped(path: string, query: URLSearchParams, requireTracks: boolean): Promise<JsonRecord | null> {
  const suffix = query.size ? `?${query.toString()}` : "";
  const attempts = PIPED_INSTANCES.map(async (base) => {
    const data = await fetchJsonWithTimeout(`${base}${path}${suffix}`);
    if (requireTracks && (!Array.isArray(data.relatedStreams) || data.relatedStreams.length === 0)) {
      throw new Error("Piped returned an empty playlist listing");
    }
    return data;
  });
  try {
    return await Promise.any(attempts);
  } catch {
    return null;
  }
}

function textValue(value: any): string {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  if (typeof value.content === "string") return value.content;
  if (typeof value.simpleText === "string") return value.simpleText;
  if (Array.isArray(value.runs)) return value.runs.map((run: any) => typeof run?.text === "string" ? run.text : "").join("");
  return "";
}

function durationSeconds(value: unknown): number {
  if (typeof value !== "string" || !value.trim()) return 0;
  const parts = value.trim().split(":").map(Number);
  if (parts.length < 1 || parts.length > 3 || parts.some((part) => !Number.isInteger(part))) return 0;
  return parts.reduce((total, part) => total * 60 + part, 0);
}

function parseInitialData(html: string): JsonRecord | null {
  const markerAt = html.indexOf("ytInitialData =");
  if (markerAt < 0) return null;
  const start = html.indexOf("{", markerAt);
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < html.length; index++) {
    const char = html[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") depth++;
    else if (char === "}" && --depth === 0) {
      try {
        const result: unknown = JSON.parse(html.slice(start, index + 1));
        return result && typeof result === "object" && !Array.isArray(result) ? result as JsonRecord : null;
      } catch {
        return null;
      }
    }
  }
  return null;
}

async function fetchPublicYoutubePlaylist(playlistId: string): Promise<PlaylistPayload | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`https://www.youtube.com/playlist?list=${encodeURIComponent(playlistId)}`, {
      signal: controller.signal,
      cache: "no-store",
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
      }
    });
    if (!response.ok) return null;
    const html = await response.text();
    const initialData = parseInitialData(html);
    if (!initialData) return null;

    const playlistMeta = initialData.metadata?.playlistMetadataRenderer || {};
    const name = typeof playlistMeta.title === "string" ? playlistMeta.title : "";
    const tabs = initialData.contents?.twoColumnBrowseResultsRenderer?.tabs || [];
    const tabContents = tabs.map((tab: any) => tab?.tabRenderer?.content).filter(Boolean);
    const relatedStreams: JsonRecord[] = [];
    const seen = new Set<string>();

    const addStream = (videoId: unknown, title = "", thumbnail = "", uploader = "", duration = 0) => {
      if (typeof videoId !== "string" || !VIDEO_ID_RE.test(videoId) || seen.has(videoId)) return;
      seen.add(videoId);
      const item: JsonRecord = {
        url: `https://www.youtube.com/watch?v=${videoId}`,
        title: title || "YouTube video",
        thumbnail,
        uploaderName: uploader || "YouTube"
      };
      if (duration > 0) item.duration = duration;
      relatedStreams.push(item);
    };

    const walk = (node: any): void => {
      if (Array.isArray(node)) {
        for (const child of node) walk(child);
        return;
      }
      if (!node || typeof node !== "object") return;

      const lockup = node.lockupViewModel;
      if (lockup && typeof lockup === "object" && (!lockup.contentType || lockup.contentType === "LOCKUP_CONTENT_TYPE_VIDEO")) {
        const metadata = lockup.metadata?.lockupMetadataViewModel || {};
        const rows = metadata.metadata?.contentMetadataViewModel?.metadataRows || [];
        const uploader = rows[0]?.metadataParts?.[0]?.text ? textValue(rows[0].metadataParts[0].text) : "";
        const sources = lockup.contentImage?.thumbnailViewModel?.image?.sources || [];
        const thumbnail = sources.length && typeof sources[sources.length - 1]?.url === "string" ? sources[sources.length - 1].url : "";
        const overlays = lockup.contentImage?.thumbnailViewModel?.overlays || [];
        let lengthText = "";
        for (const overlay of overlays) {
          const badges = overlay?.thumbnailBottomOverlayViewModel?.badges || [];
          const badge = badges.find((entry: any) => typeof entry?.thumbnailBadgeViewModel?.text === "string");
          if (badge) { lengthText = badge.thumbnailBadgeViewModel.text; break; }
        }
        addStream(lockup.contentId, textValue(metadata.title), thumbnail, uploader, durationSeconds(lengthText));
      }

      const oldVideo = node.playlistVideoRenderer;
      if (oldVideo && typeof oldVideo === "object") {
        const thumbs = oldVideo.thumbnail?.thumbnails || [];
        const thumbnail = thumbs.length && typeof thumbs[thumbs.length - 1]?.url === "string" ? thumbs[thumbs.length - 1].url : "";
        const duration = durationSeconds(textValue(oldVideo.lengthText)) || Number(oldVideo.lengthSeconds) || 0;
        addStream(oldVideo.videoId, textValue(oldVideo.title), thumbnail,
          textValue(oldVideo.shortBylineText || oldVideo.longBylineText), duration);
      }
      for (const value of Object.values(node)) walk(value);
    };

    for (const content of tabContents) walk(content);
    if (relatedStreams.length === 0) return null;
    return {
      name,
      thumbnailUrl: "",
      uploader: "",
      videos: relatedStreams.length,
      relatedStreams: relatedStreams.slice(0, 300),
      nextpage: ""
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function cleanPlaylistPayload(data: JsonRecord): PlaylistPayload {
  const incoming = Array.isArray(data.relatedStreams) ? data.relatedStreams : [];
  const relatedStreams = incoming.slice(0, 300).filter((item: any) => item && typeof item === "object")
    .map((item: any) => {
      const clean: JsonRecord = {};
      for (const key of ["url", "title", "thumbnail", "uploaderName", "uploadedDate"]) {
        if (typeof item[key] === "string") clean[key] = item[key].slice(0, 2048);
      }
      for (const key of ["duration", "views"]) {
        if (Number.isFinite(Number(item[key]))) clean[key] = Number(item[key]);
      }
      return clean;
    });
  const videos = Number(data.videos);
  return {
    name: typeof data.name === "string" ? data.name.slice(0, 200) : "",
    thumbnailUrl: typeof data.thumbnailUrl === "string" ? data.thumbnailUrl.slice(0, 2048) : "",
    uploader: typeof data.uploader === "string" ? data.uploader.slice(0, 200) : "",
    videos: Number.isFinite(videos) && videos > 0 ? videos : relatedStreams.length,
    relatedStreams,
    nextpage: typeof data.nextpage === "string" ? data.nextpage.slice(0, 50000) : ""
  };
}

export async function GET(request: Request, context: RouteContext) {
  const { segments } = await context.params;
  if (!Array.isArray(segments) || (segments.length !== 1 && segments.length !== 2)) {
    return Response.json({ ok: false, error: "Playlist endpoint not found." }, { status: 404 });
  }
  const playlistId = segments[0];
  if (!PLAYLIST_ID_RE.test(playlistId)) {
    return Response.json({ ok: false, error: "Invalid YouTube playlist ID." }, { status: 400 });
  }
  const isNext = segments.length === 2 && segments[1] === "nextpage";
  if (segments.length === 2 && !isNext) {
    return Response.json({ ok: false, error: "Playlist endpoint not found." }, { status: 404 });
  }

  const url = new URL(request.url);
  const nextpage = url.searchParams.get("nextpage") || "";
  if (isNext && (!nextpage || nextpage.length > 50000)) {
    return Response.json({ ok: false, error: "Missing or oversized playlist page token." }, { status: 400 });
  }
  const cacheKey = `${playlistId}:${isNext ? `next:${nextpage}` : "first"}`;
  const cached = playlistCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return Response.json(cached.payload, { headers: { "Cache-Control": "no-store" } });
  }

  const query = new URLSearchParams();
  if (isNext) query.set("nextpage", nextpage);
  const path = isNext ? `/nextpage/playlists/${playlistId}` : `/playlists/${playlistId}`;
  let data = await fetchPiped(path, query, !isNext);
  let streams = Array.isArray(data?.relatedStreams) ? data.relatedStreams : [];

  if (!streams.length && !isNext) {
    const fallback = await fetchPublicYoutubePlaylist(playlistId);
    if (fallback) {
      data = {
        ...fallback,
        name: data?.name || fallback.name,
        uploader: data?.uploader || "",
        videos: Number(data?.videos) || fallback.videos
      };
      streams = fallback.relatedStreams;
    }
  }

  if (!data || !streams.length) {
    return Response.json({ ok: false, error: "No public track metadata is available for this playlist right now." }, { status: 502 });
  }
  const payload = cleanPlaylistPayload(data);
  if (!payload.relatedStreams.length) {
    return Response.json({ ok: false, error: "No public track metadata is available for this playlist right now." }, { status: 502 });
  }
  playlistCache.set(cacheKey, { expiresAt: Date.now() + 300_000, payload });
  if (playlistCache.size > 256) {
    const firstKey = playlistCache.keys().next().value;
    if (firstKey) playlistCache.delete(firstKey);
  }
  return Response.json(payload, { headers: { "Cache-Control": "no-store" } });
}
