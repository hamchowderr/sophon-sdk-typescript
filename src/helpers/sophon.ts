// Top-level facade. Wraps `Configuration` + the generated APIs + the helper
// layer behind a single `Sophon` object so consumers don't have to wire up
// three separate imports just to make a call.
//
//   const sophon = new Sophon({ apiKey: process.env.SOPHON_API_KEY! });
//   const upload = await sophon.uploads.uploadFile({ source, fileName, mimeType });
//   const job = await sophon.jobs.create({ source: JobSource.upload(upload.uploadId), profile });
//   const final = await sophon.jobs.waitFor(job.id);
//   const out = await sophon.jobs.downloadOutput(final.id);

import { BASE_PATH, Configuration, type ConfigurationParameters, type Middleware } from "../runtime";
import { UploadsApi } from "../apis/UploadsApi";
import { JobsApi } from "../apis/JobsApi";
import { WebhooksApi } from "../apis/WebhooksApi";
import { HealthApi } from "../apis/HealthApi";
import {
  uploadFile,
  type UploadFileParams,
  type UploadFileResult,
} from "./uploads";
import {
  waitForJob,
  createJob as createJobFlat,
  type CreateJobFlatParams,
  type JobLike,
  type WaitForJobParams,
} from "./jobs";
import {
  downloadJobOutput,
  downloadJobOutputBytes,
  type DownloadOutputParams,
  type DownloadOutputResult,
} from "./downloads";
import { withTypedErrors } from "./errors";
import { withRetry, withTimeout, type RetryOptions } from "./middleware";

export interface SophonOptions extends Omit<ConfigurationParameters, "accessToken"> {
  /** SOPHON API key (e.g. `xt_live_...`). */
  apiKey?: string;
  /** Pass through if you'd rather use the raw OAuth accessor. */
  accessToken?: ConfigurationParameters["accessToken"];
  /** Enable automatic retry on 408/429/5xx for every endpoint. Default: on
   *  with sensible defaults. Pass `false` to disable, or an options object. */
  retry?: boolean | RetryOptions;
  /** Per-request network timeout in ms. Default 60_000. Pass `false` to disable. */
  timeoutMs?: number | false;
  /** Enable typed-error rewriting (AuthenticationError, RateLimitError, …).
   *  Default: on. */
  typedErrors?: boolean;
  /** Allow a plaintext `http://` `basePath`. Default `false`: the SDK throws
   *  rather than send your `Authorization: Bearer` key over an unencrypted
   *  connection. Set `true` only for local development against an http origin;
   *  doing so logs a loud warning on every client construction. */
  allowInsecure?: boolean;
}

/** Top-level entry point. */
export class Sophon {
  readonly config: Configuration;
  readonly uploads: SophonUploads;
  readonly jobs: SophonJobs;
  readonly webhooks: WebhooksApi;
  readonly health: HealthApi;

  constructor(options: SophonOptions = {}) {
    const {
      apiKey,
      accessToken,
      retry = true,
      timeoutMs = 60_000,
      typedErrors = true,
      allowInsecure = false,
      middleware: userMiddleware = [],
      ...rest
    } = options;

    assertSecureBasePath(rest.basePath ?? BASE_PATH, allowInsecure);

    const middleware: Middleware[] = [...userMiddleware];
    if (timeoutMs !== false && Number.isFinite(timeoutMs)) {
      middleware.unshift(withTimeout(timeoutMs as number));
    }
    if (retry) {
      middleware.push(withRetry(retry === true ? undefined : retry));
    }
    if (typedErrors) {
      middleware.push(withTypedErrors());
    }

    this.config = new Configuration({
      ...rest,
      accessToken: accessToken ?? apiKey,
      middleware,
    });
    const uploadsApi = new UploadsApi(this.config);
    const jobsApi = new JobsApi(this.config);
    this.uploads = new SophonUploads(uploadsApi);
    this.jobs = new SophonJobs(jobsApi, this.config);
    this.webhooks = new WebhooksApi(this.config);
    this.health = new HealthApi(this.config);
  }
}

export class SophonUploads {
  constructor(readonly api: UploadsApi) {}
  /** Chunked upload with retries, resume, progress, and Buffer/path support. */
  uploadFile(params: Omit<UploadFileParams, "api">): Promise<UploadFileResult> {
    return uploadFile({ ...params, api: this.api as any });
  }
}

export class SophonJobs {
  constructor(readonly api: JobsApi, readonly config: Configuration) {}
  /** Flat-options createJob. Wraps the generated nested-shape call. */
  create<T = unknown>(params: Omit<CreateJobFlatParams, "api">): Promise<T> {
    return createJobFlat<T>({ ...params, api: this.api as any });
  }
  /** Poll until terminal status (or `until`), with typed timeout / not-found. */
  waitFor<T extends JobLike = JobLike>(
    jobId: string,
    params: Omit<WaitForJobParams<T>, "api" | "jobId"> = {},
  ): Promise<T> {
    return waitForJob<T>({ ...params, api: this.api as any, jobId });
  }
  /** Drive the 302 → presigned-URL dance and return the response stream. */
  downloadOutput(
    jobId: string,
    params: Omit<DownloadOutputParams, "config" | "jobId"> = {},
  ): Promise<DownloadOutputResult> {
    return downloadJobOutput({ ...params, config: this.config, jobId });
  }
  /** Buffered variant — only use for small outputs. */
  downloadOutputBytes(
    jobId: string,
    params: Omit<DownloadOutputParams, "config" | "jobId"> = {},
  ): Promise<Uint8Array> {
    return downloadJobOutputBytes({ ...params, config: this.config, jobId });
  }
}

/**
 * Refuse a plaintext `http://` base URL unless the caller explicitly opts in.
 * Sending an `Authorization: Bearer` API key over an unencrypted connection
 * exposes it to anyone on the network path. `https://`, relative, and
 * non-`http` schemes pass through untouched.
 */
function assertSecureBasePath(basePath: string, allowInsecure: boolean): void {
  if (!/^http:\/\//i.test(basePath.trim())) return;
  if (!allowInsecure) {
    throw new Error(
      `Sophon: refusing to use insecure base URL "${basePath}". Your API key ` +
        `would be sent in cleartext. Use https://, or set { allowInsecure: true } ` +
        `if you really mean to talk to a local http origin.`,
    );
  }
  // eslint-disable-next-line no-console
  console.warn(
    `Sophon: WARNING — using insecure http base URL "${basePath}". Your API key ` +
      `is sent in cleartext. Never do this against a production endpoint.`,
  );
}
