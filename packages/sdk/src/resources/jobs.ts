import type { HttpClient, QueryValue } from "../client.js";
import type { Job, JobStatus, ListJobsQuery, WaitOptions } from "../types.js";
import { OpenPostError } from "../errors.js";
import { resolveWaitOptions } from "../wait.js";

const TERMINAL_JOB_STATUSES: JobStatus[] = ["completed", "failed"];

export class Jobs {
  constructor(private readonly http: HttpClient) {}

  async list(query: ListJobsQuery = {}): Promise<Job[]> {
    const params: Record<string, QueryValue> = {
      workspace_id: query.workspace_id,
      status: query.status,
      limit: query.limit,
      offset: query.offset,
    };
    return (await this.http.get("/api/v1/jobs", { query: params })) as Job[];
  }

  async get(id: string): Promise<Job> {
    return (await this.http.get(`/api/v1/jobs/${encodeURIComponent(id)}`)) as Job;
  }

  // wait polls a durable job until it completes or fails. Publishing actions
  // return a job_id; use this when the caller needs the final outcome.
  async wait(id: string, options: WaitOptions = {}): Promise<Job> {
    const { timeoutMs, intervalMs } = resolveWaitOptions(options);
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const job = await this.get(id);
      if (TERMINAL_JOB_STATUSES.includes(job.status)) {
        if (job.status === "failed") {
          // Terminal, never retryable: retrying would re-run the operation
          // that created the job.
          throw new OpenPostError(
            `Job ${id} failed${job.last_error ? `: ${job.last_error}` : ""}`,
            {
              code: "operation_failed",
              details: job,
            },
          );
        }
        return job;
      }
      if (Date.now() >= deadline) {
        throw new OpenPostError(`Timed out waiting for job ${id} (still ${job.status})`, {
          code: "timeout",
          details: { status: job.status },
        });
      }
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(intervalMs, deadline - Date.now())),
      );
    }
  }
}
