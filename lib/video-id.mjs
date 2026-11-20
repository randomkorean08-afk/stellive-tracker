// YouTube Video ID normalization (browser + Node compatible, no Node-only imports).
// Contract: docs/schema.md section 1. Case-sensitive; only trimming is applied to the ID itself.

const ID_RE = /^[A-Za-z0-9_-]{11}$/;
const YT_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
]);

export function isValidVideoId(s) {
  return typeof s === "string" && ID_RE.test(s);
}

/** @returns {string|null} 11-char video ID or null when input is not recognizable. */
export function normalizeVideoId(input) {
  if (typeof input !== "string") return null;
  let s = input.trim();
  if (!s) return null;
  if (ID_RE.test(s)) return s;

  if (/^yt:video:/i.test(s)) {
    s = s.slice("yt:video:".length).trim();
    return ID_RE.test(s) ? s : null;
  }

  let url;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  const segs = url.pathname.split("/").filter(Boolean);
  let candidate = null;

  if (host === "youtu.be" || host === "www.youtu.be") {
    candidate = segs[0] ?? null;
  } else if (YT_HOSTS.has(host)) {
    if (segs[0] === "watch") candidate = url.searchParams.get("v");
    else if (["shorts", "live", "embed", "v"].includes(segs[0])) candidate = segs[1] ?? null;
  }
  return candidate && ID_RE.test(candidate) ? candidate : null;
}
