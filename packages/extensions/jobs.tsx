import { useEffect, useRef, useState } from "react";
import type { SceneAsset } from "../scene-schema/src/types";
import type { ExtensionPanelProps } from "./editor-contract";
export interface ProcessingJob {
  id: string;
  sourceAssetId: string;
  sourceSha256: string;
  operation: string;
  settingsJson: string;
  settingsHash: string;
  status: string;
  stage: string;
  progress: number;
  logsJson: string;
  resultJson: string | null;
  error: string;
  createdAt: string;
  updatedAt: string;
}
export interface ProcessingResult {
  report: Record<string, unknown>;
  assets: SceneAsset[];
}
export function useProcessingJobs(services: ExtensionPanelProps["services"]) {
  const [jobs, setJobs] = useState<ProcessingJob[]>([]),
    [error, setError] = useState("");
  useEffect(() => {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const result = await services.request<ProcessingJob[]>("/jobs", {
          signal: abort.signal,
        });
        if (!abort.signal.aborted) {
          setJobs(result);
          setError("");
        }
      } catch (error) {
        if (!abort.signal.aborted) setError(String(error));
      }
      if (!abort.signal.aborted) timer = setTimeout(refresh, 1500);
    };
    void refresh();
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [services.request]);
  return {
    jobs,
    error,
    refresh: async () => setJobs(await services.request("/jobs")),
  };
}
export function JobMonitor({
  services,
  jobs,
  onApply,
}: {
  services: ExtensionPanelProps["services"];
  jobs: ProcessingJob[];
  onApply?: (job: ProcessingJob, result: ProcessingResult) => Promise<void>;
}) {
  const current = useRef(onApply);
  current.current = onApply;
  return (
    <div className="job-monitor">
      {jobs.map((job) => (
        <section key={job.id}>
          <div className="designer-toolbar">
            <strong>
              {job.operation} · {job.status}
            </strong>
            <span>{job.stage}</span>
            <progress value={job.progress} max={1} />
            <code>{job.id.slice(0, 8)}</code>
            {["Queued", "Running"].includes(job.status) ? (
              <button
                onClick={() =>
                  void services.run("取消作业", async () => {
                    await services.request("/jobs/" + job.id, {
                      method: "DELETE",
                    });
                  })
                }
              >
                取消
              </button>
            ) : (
              <button
                onClick={() =>
                  void services.run("重试作业", async () => {
                    await services.request("/jobs/" + job.id + "/retry", {
                      method: "POST",
                    });
                  })
                }
              >
                重试为新作业
              </button>
            )}
            {job.status === "Succeeded" && job.resultJson && onApply && (
              <button
                onClick={() =>
                  void services.run("使用处理结果", () =>
                    current.current!(job, JSON.parse(job.resultJson!)),
                  )
                }
              >
                应用结果
              </button>
            )}
          </div>
          {job.error && <p role="alert">{job.error}</p>}
          <details>
            <summary>SHA / 配置 / 日志</summary>
            <code>
              输入 {job.sourceSha256}
              <br />
              策略 {job.settingsHash}
            </code>
            <pre>{JSON.parse(job.logsJson).join("\n")}</pre>
            {job.resultJson && (
              <pre>
                {JSON.stringify(JSON.parse(job.resultJson).report, null, 2)}
              </pre>
            )}
          </details>
        </section>
      ))}
    </div>
  );
}
