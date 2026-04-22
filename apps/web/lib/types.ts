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
  /** GET /jobs/:id 可能附带，用于复用创建任务时的 project_name */
  project_name?: string | null;
  /** 创建任务的操作人（手机号或标识），与 orchestrator jobs.created_by 一致 */
  created_by?: string | null;
  /** 列表/详情 JOIN users 后的可读创建者名（display_name → phone → email） */
  creator_label?: string | null;
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
  /** 成功播客成片是否被设为全站创作模板（仅管理员可改） */
  is_podcast_template?: boolean;
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
