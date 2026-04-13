export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export interface JobArtifactRecord {
  id: string;
  artifact_type: string;
  object_key: string;
  mime_type?: string;
  created_at?: string;
}

export interface JobRecord {
  id: string;
  project_id: string | null;
  /** 创建任务的操作人（手机号或标识），与 orchestrator jobs.created_by 一致 */
  created_by?: string | null;
  status: JobStatus;
  job_type: string;
  queue_name: "ai" | "media" | string;
  progress: number;
  payload: Record<string, unknown>;
  result: Record<string, unknown> & {
    fallback?: boolean;
    trace_id?: string | null;
    retries?: number;
    upstream_status_code?: number | null;
  };
  error_message: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  artifacts?: JobArtifactRecord[];
  payload_sha256?: string;
}

export interface JobEvent {
  id: number;
  type: string;
  message: string;
  payload: Record<string, unknown>;
  created_at: string;
}
