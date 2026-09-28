export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PIPED_INSTANCES = [
  "https://pipedapi.ducks.party",
  "https://api.piped.private.coffee"
];
const searchCache = new Map<string, { expiresAt: number; payload: { items: unknown[] } }>();

async function fetchJsonWithTimeout(url: string, timeoutMs = 5000): Promise<Record<string, any>> {
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
    return result as Record<string, any>;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchSearch(query: string, filter: string): Promise<Record<string, any> | null> {
  const encoded = new URLSearchParams({ q: query, filter }).toString();
  const attempts = PIPED_INSTANCES.map((base) => fetchJsonWithTimeout(`${base}/search?${encoded}`));
  try {
    return await Promise.any(attempts);
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = (url.searchParams.get("q") || "").trim().slice(0, 120);
  const filter = url.searchParams.get("filter") || "music_songs";
  if (!query) return Response.json({ ok: false, error: "Enter a search query." }, { status: 400 });
  if (filter !== "music_songs" && filter !== "videos") {
    return Response.json({ ok: false, error: "Unsupported YouTube search filter." }, { status: 400 });
  }

  const cacheKey = `${filter}:${query.toLocaleLowerCase()}`;
  const cached = searchCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return Response.json(cached.payload, { headers: { "Cache-Control": "no-store" } });
  }

  const data = await fetchSearch(query, filter);
  if (!data) {
    return Response.json({ ok: false, error: "YouTube search is temporarily unavailable. Try again shortly." }, { status: 502 });
  }
  const allowed = ["url", "title", "thumbnail", "uploaderName", "uploader", "duration", "views"];
  const upstreamItems = Array.isArray(data.items) ? data.items : [];
  const items = upstreamItems.filter((item: unknown) => item && typeof item === "object")
    .map((item: Record<string, unknown>) => Object.fromEntries(
      allowed.filter((key) => item[key] !== undefined && item[key] !== null).map((key) => [key, item[key]])
    ));
  const payload = { items };
  searchCache.set(cacheKey, { expiresAt: Date.now() + 60_000, payload });
  return Response.json(payload, { headers: { "Cache-Control": "no-store" } });
}
