# @liqhtworks/sophon-sdk

> **Alpha:** This SDK is in alpha. Please report any bugs or errors by opening an [issue](https://github.com/Liqhtworks/sophon-sdk-typescript/issues).

Official TypeScript SDK for the SOPHON Encoding API.

This repository is generated from `Liqhtworks/sophon-api`. The curated
`README.md` and `examples/` directory are preserved across SDK regeneration.

## Install

```bash
npm install @liqhtworks/sophon-sdk
```

Requires Node 18+ or a runtime with `fetch`, `Blob`, `AbortController`, and Web
Crypto.

## Get an API key

1. Sign in at <https://sophon.rs/account/general>.
2. In **API keys**, create a key for your server-side integration.
3. Copy the `xt_live_...` token when it is shown. It is only shown once.
4. Store it as an environment variable:

```bash
export SOPHON_API_KEY=xt_live_...
export SOPHON_BASE_URL=https://api.liqhtworks.xyz
```

Keep API keys on the server. Do not ship them in browser bundles, mobile apps,
public repos, logs, or analytics events.

### Scope keys to least privilege

Issue a **separate key per integration** so you can revoke one without breaking
the others, and grant each key only the scopes it needs (for example, an
encode-only worker does not need webhook-management or billing access). Scope a
key from the **API keys** screen at <https://sophon.rs/account/general> when you
create it.

### Rotate keys

1. Create a new key in the dashboard.
2. Deploy it to your environment (`SOPHON_API_KEY`) alongside the old one.
3. Confirm traffic is flowing on the new key, then **revoke the old key** in the
   dashboard.

Rotate immediately if a key is ever exposed (committed to a repo, printed to a
log, leaked in a bug report). Keys are billing identities — a leaked key can run
up encoding charges on your account.

> The SDK never logs your key, never puts it in a URL, and the `Sophon` facade
> refuses a plaintext `http://` base URL by default (set `allowInsecure: true`
> only for local development).

## Quick Start

This is the smallest complete server-side flow: upload a local video, create an
encode job, wait for completion, and download the MP4 output.

```ts
import {
  Configuration,
  JobProfile,
  JobSource,
  JobStatus,
  JobsApi,
  UploadsApi,
  uploadFile,
  waitForJob,
} from "@liqhtworks/sophon-sdk";
import { Blob } from "node:buffer";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { basename } from "node:path";

const inputPath = process.argv[2] ?? "./source.mov";
const apiKey = process.env.SOPHON_API_KEY;
if (!apiKey) throw new Error("SOPHON_API_KEY is required");

const basePath = process.env.SOPHON_BASE_URL ?? "https://api.liqhtworks.xyz";
const config = new Configuration({
  basePath,
  accessToken: apiKey,
});

const uploads = new UploadsApi(config);
const jobs = new JobsApi(config);

const bytes = await readFile(inputPath);
const mimeType = inputPath.endsWith(".mov") ? "video/quicktime" : "video/mp4";
const source = new Blob([bytes], { type: mimeType });

const upload = await uploadFile({
  api: uploads,
  source,
  fileName: basename(inputPath),
  mimeType,
  concurrency: 4,
  onProgress: (p) => console.log(`${p.partsDone}/${p.partsTotal} parts`),
});

const job = await jobs.createJob({
  idempotencyKey: randomUUID(),
  createJobRequest: {
    source: JobSource.upload(upload.uploadId),
    profile: JobProfile.SOPHON_ESPRESSO,
  },
});

const final = await waitForJob({
  api: jobs,
  jobId: job.id,
  timeoutMs: 30 * 60 * 1000,
});
if (final.status !== JobStatus.COMPLETED) {
  throw new Error(`job ended in ${final.status}`);
}

const redirect = await fetch(`${basePath}/v1/jobs/${final.id}/output`, {
  headers: { authorization: `Bearer ${apiKey}` },
  redirect: "manual",
});
const location = redirect.headers.get("location");
if (!location) throw new Error("missing output redirect");

const download = await fetch(new URL(location, basePath));
await writeFile("sophon-output.mp4", Buffer.from(await download.arrayBuffer()));

console.log(`wrote sophon-output.mp4 from ${final.id}`);
```

For a runnable copy of this flow, see
[`examples/encode-file.mjs`](./examples/encode-file.mjs).

For upload-only integration work, see
[`examples/upload-node-path.mjs`](./examples/upload-node-path.mjs).

### Profile choice

Use `sophon-auto` for production unless you need deterministic encoder
settings. The quickstart uses `sophon-espresso` because it is the fastest
smoke-test profile and always produces a new encoded output.

## Webhooks

Use `verifyWebhookSignature` with the raw request body before JSON parsing.

See [`examples/webhook-server`](./examples/webhook-server) for an Express
handler that preserves the raw body, verifies `X-Turbo-Signature-256`, and only
then parses JSON.

## Helpers

| Helper | Purpose |
|---|---|
| `uploadFile` | Chunked upload orchestration with bounded concurrency, retries, resume, and progress callbacks. |
| `waitForJob` | Poll until terminal status with timeout and typed errors. |
| `verifyWebhookSignature` | Constant-time HMAC verification plus replay-window enforcement. |

## API Docs

Generated endpoint/model docs live under [`docs/`](./docs).

## Development

```bash
npm install
npm run build
```

## Versioning

`@liqhtworks/sophon-sdk` follows [SemVer](https://semver.org/), with one
pre-1.0 caveat: while we are at `v0.x`, **minor bumps may include
breaking changes**. Pin a tilde range until 1.0:

```bash
npm install @liqhtworks/sophon-sdk@~0.1
```

Patch releases (`0.1.x`) are always backward-compatible — they ship bug
fixes, helper-layer improvements, and additive types. Once we cut
`v1.0.0`, regular SemVer applies and breaking changes only land on
major bumps. See [`CHANGELOG.md`](./CHANGELOG.md) for the per-release
log.

## Security & acceptable use

Found a vulnerability? Please report it privately — see [`SECURITY.md`](./SECURITY.md).
Do not open a public issue for security reports.

Your use of the SOPHON API is governed by the SOPHON Terms of Service and
Acceptable Use Policy (illegal content, CSAM, and copyright-infringing material
are prohibited). See <https://sophon.rs> for the current terms.

## License

Apache License 2.0. See [`LICENSE`](./LICENSE).
