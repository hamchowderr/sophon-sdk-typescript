// First-class download helper, mirroring `uploadFile` on the upload side.
//
// The generated `JobsApi.getJobOutput` is `Promise<void>` because the route
// returns a 302 redirect that the generator can't model. This helper drives
// the redirect dance manually:
//
//   1. `GET {basePath}/v1/jobs/{id}/output` with `redirect: "manual"` so we
//      can read the `Location` header for the 24h presigned URL.
//   2. `GET <presigned URL>` (one hop only) to actually stream the bytes.
//
// Security: the presigned URL is validated against an allowlist before it is
// fetched — only HTTPS and only Backblaze B2 (or the API origin / a
// caller-supplied host) are followed, and the presigned fetch uses
// `redirect: "error"` so the helper is never an open redirect follower. The
// caller's Authorization header is NOT forwarded to the presigned host.
//
// Returns the presigned response so callers can stream into their own storage,
// `arrayBuffer()` for tests, or pipe through `Response.body` (Web ReadableStream).

import type { Configuration } from "../runtime";

/**
 * Hosts the output redirect is allowed to point at, in addition to the API
 * origin. SOPHON serves encoded outputs from Backblaze B2 signed URLs
 * (`f00X.backblazeb2.com`, `s3.<region>.backblazeb2.com`). A leading `*.`
 * matches any sub-domain; a bare host matches exactly.
 */
export const DEFAULT_ALLOWED_REDIRECT_HOSTS = ["*.backblazeb2.com", "backblazeb2.com"];

export interface DownloadOutputParams {
  /** The Configuration you handed to `JobsApi`. Used for basePath + auth. */
  config: Configuration;
  /** ID of the completed job whose output you want. */
  jobId: string;
  /** Override fetch (matches `Configuration.fetchApi` contract). */
  fetchApi?: typeof fetch;
  /** Optional cancellation signal — aborts both the redirect lookup
   *  and the presigned-URL request. */
  signal?: AbortSignal;
  /** Extra hosts the output redirect may point at, on top of
   *  {@link DEFAULT_ALLOWED_REDIRECT_HOSTS} and the API origin. Use a leading
   *  `*.` to allow sub-domains. Pass this only if your deployment serves
   *  outputs from a non-B2 origin. */
  allowedRedirectHosts?: string[];
}

export interface DownloadOutputResult {
  /** The presigned-URL response; consume with `.body`, `.arrayBuffer()`, etc. */
  response: Response;
  /** The presigned URL the bytes were fetched from (24h TTL). */
  url: string;
  /** Convenience: total bytes if the response advertises a Content-Length. */
  bytes: number | undefined;
}

/** Thrown when the output redirect points somewhere not on the allowlist. */
export class UnsafeRedirectError extends Error {
  override name = "UnsafeRedirectError";
  readonly target: string;
  constructor(target: string, message: string) {
    super(message);
    this.target = target;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Drives the SOPHON two-step output download. Resolves once the presigned
 * URL has returned a successful response; bytes are NOT buffered. Stream
 * `result.response.body` into your storage or call `arrayBuffer()` for tests.
 */
export async function downloadJobOutput(
  params: DownloadOutputParams,
): Promise<DownloadOutputResult> {
  const { config, jobId, fetchApi, signal, allowedRedirectHosts } = params;
  if (!jobId) throw new TypeError("downloadJobOutput: jobId is required");

  const doFetch: typeof fetch = (fetchApi ?? config.fetchApi ?? fetch) as typeof fetch;
  const base = config.basePath.replace(/\/+$/, "");
  // The API origin is always allowed (outputs may be served same-origin), plus
  // B2 and any caller-supplied hosts.
  const apiHost = safeHost(base);
  const allowed = [
    ...DEFAULT_ALLOWED_REDIRECT_HOSTS,
    ...(apiHost ? [apiHost] : []),
    ...(allowedRedirectHosts ?? []),
  ];

  const headers: Record<string, string> = {};
  // Reuse the Configuration's accessToken (bearer API key). This is sent ONLY
  // to the API origin below — never forwarded to the presigned host.
  const tokenAccessor = (config as any).accessToken;
  if (tokenAccessor) {
    const t =
      typeof tokenAccessor === "function"
        ? await tokenAccessor("bearerApiKey", [])
        : await tokenAccessor;
    if (t) headers["Authorization"] = `Bearer ${t}`;
  }

  const redirect = await doFetch(`${base}/v1/jobs/${encodeURIComponent(jobId)}/output`, {
    method: "GET",
    headers,
    redirect: "manual",
    signal,
  });

  // Fetch may either return status 302 (with Location header) or already
  // follow the redirect depending on runtime semantics. Handle both — and in
  // the auto-followed case, validate the host the bytes actually came from.
  if (redirect.ok) {
    assertAllowedRedirect(redirect.url, allowed);
    const len = redirect.headers.get("content-length");
    return { response: redirect, url: redirect.url, bytes: len ? Number(len) : undefined };
  }

  const location = redirect.headers.get("location");
  if (!location) {
    throw new Error(
      `downloadJobOutput: expected 302 redirect for job ${jobId}, got ${redirect.status}`,
    );
  }
  const presignedUrl = new URL(location, base).toString();
  assertAllowedRedirect(presignedUrl, allowed);

  // `redirect: "error"` — follow EXACTLY this one hop. If the presigned host
  // tries to bounce us elsewhere, fail loudly instead of open-following.
  const download = await doFetch(presignedUrl, { method: "GET", redirect: "error", signal });
  if (!download.ok) {
    throw new Error(
      `downloadJobOutput: presigned URL fetch failed (${download.status}) for job ${jobId}`,
    );
  }
  const len = download.headers.get("content-length");
  return { response: download, url: presignedUrl, bytes: len ? Number(len) : undefined };
}

/**
 * Convenience wrapper: drive the redirect, buffer the bytes, return a Buffer
 * (Node) or `Uint8Array` (browser). Use only for small outputs — for video
 * files, prefer `downloadJobOutput` and stream `response.body`.
 */
export async function downloadJobOutputBytes(
  params: DownloadOutputParams,
): Promise<Uint8Array> {
  const { response } = await downloadJobOutput(params);
  const buf = await response.arrayBuffer();
  return new Uint8Array(buf);
}

/** Parse a host from a URL string, returning undefined if it can't be parsed. */
function safeHost(url: string): string | undefined {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return undefined;
  }
}

/**
 * Throws {@link UnsafeRedirectError} unless `target` is HTTPS and its host is
 * on `allowed` (exact match, or sub-domain match for `*.`-prefixed entries).
 */
function assertAllowedRedirect(target: string, allowed: string[]): void {
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    throw new UnsafeRedirectError(target, `downloadJobOutput: malformed redirect target "${target}"`);
  }
  if (url.protocol !== "https:") {
    throw new UnsafeRedirectError(
      target,
      `downloadJobOutput: refusing non-HTTPS redirect target "${target}"`,
    );
  }
  const host = url.host.toLowerCase();
  if (!hostMatchesAny(host, allowed)) {
    throw new UnsafeRedirectError(
      target,
      `downloadJobOutput: redirect host "${host}" is not on the allowlist ` +
        `(${allowed.join(", ")}). Pass allowedRedirectHosts to permit it.`,
    );
  }
}

function hostMatchesAny(host: string, patterns: string[]): boolean {
  return patterns.some((raw) => {
    const pattern = raw.toLowerCase();
    if (pattern.startsWith("*.")) {
      const suffix = pattern.slice(1); // ".backblazeb2.com"
      return host.endsWith(suffix) && host.length > suffix.length;
    }
    return host === pattern;
  });
}
