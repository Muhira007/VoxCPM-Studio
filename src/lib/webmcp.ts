import type { StudioService } from "./types";

interface ModelContext {
  registerTool(
    tool: {
      name: string;
      description: string;
      inputSchema: object;
      annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
      execute(input: unknown): unknown;
    },
    options: { signal: AbortSignal },
  ): void | Promise<void>;
}

// Optional progressive enhancement. No browser support is required for the UI.
export function registerStudioTools(service: StudioService): () => void {
  const context = (document as Document & { modelContext?: ModelContext })
    .modelContext;
  if (!context?.registerTool) return () => {};
  const lifecycle = new AbortController();
  const tools = [
    {
      name: "read_demo_studio_status",
      description:
        "Read local VoxCPM demo GPU and latest job status. No real GPU or AI audio is produced.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      execute() {
        const state = service.getSnapshot();
        return {
          demo: true,
          gpuStatus: state.session.status,
          latestJobStatus: state.jobs[0]?.status ?? null,
          jobCount: state.jobs.length,
        };
      },
    },
    {
      name: "set_demo_script",
      description:
        "Replace the locally saved Studio script. This stages a draft only; it does not start a session or synthesize audio.",
      inputSchema: {
        type: "object",
        properties: { text: { type: "string", minLength: 1, maxLength: 5000 } },
        required: ["text"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute(input: unknown) {
        if (!input || typeof input !== "object" || Array.isArray(input))
          throw new Error("Expected { text: string }.");
        const data = input as Record<string, unknown>;
        if (
          Object.keys(data).length !== 1 ||
          typeof data.text !== "string" ||
          !data.text.trim() ||
          data.text.length > 5000
        )
          throw new Error("Script must contain 1–5000 characters.");
        service.updateDraft({ text: data.text });
        return {
          staged: true,
          characters: service.getSnapshot().draft.text.length,
          demo: true,
        };
      },
    },
  ];
  for (const tool of tools) {
    try {
      void Promise.resolve(
        context.registerTool(tool, { signal: lifecycle.signal }),
      ).catch(() => lifecycle.abort());
    } catch {
      lifecycle.abort();
      break;
    }
  }
  return () => lifecycle.abort();
}
