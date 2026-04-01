export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface JobRecord {
  id: string;
  project_id: string | null;
  status: JobStatus;
  job_type: string;
  queue_name: 'ai' | 'media' | string;
  progress: number;
  payload: Record<string, unknown>;
  result: Record<string, unknown>;
  error_message: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export interface JobEvent {
  id: number;
  type: 'progress' | 'log' | 'error' | 'complete' | 'terminal' | string;
  message: string;
  payload: Record<string, unknown>;
  created_at: string;
}
