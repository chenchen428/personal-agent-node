import { createRuntimeEnvironmentStore } from "./store.ts";
import { testRuntimeConnectivity } from "./connectivity.ts";
import { detectRuntimeEnvironment } from "./detection.ts";
import { protocolFor, validateEngine } from "./validation.ts";
import type { StoreOptions } from "./store.ts";
import type { ConnectivityOptions } from "./connectivity.ts";
import type { DetectionOptions } from "./detection.ts";
import type { ConnectivityResult, ProfileDraft, RuntimeEngine } from "./types.ts";

export * from "./types.ts";
export { runtimeProviderBaseUrl } from "./validation.ts";
export type { RuntimeSaveInput } from "./store.ts";
export function createRuntimeEnvironmentService(options: StoreOptions & ConnectivityOptions & DetectionOptions) {
  const store = createRuntimeEnvironmentStore(options);
  return {
    read: store.read, view: store.view, save: store.save, readExecution: store.readExecution,
    async detect(input: { engine: RuntimeEngine; profile?: ProfileDraft }) {
      const engine = validateEngine(input?.engine);
      return detectRuntimeEnvironment(store.resolveDraft(engine, input.profile), options);
    },
    async testConnectivity(input: { engine: RuntimeEngine; profile?: ProfileDraft }): Promise<ConnectivityResult> {
      const engine = validateEngine(input?.engine);
      let execution;
      try { execution = store.resolveDraft(engine, input.profile); }
      catch { return { ok: false, engine, protocol: protocolFor(engine), status: "invalid-config", message: "运行配置无效，请检查服务 URL、模型和凭据。", durationMs: 0 }; }
      return testRuntimeConnectivity(execution, options);
    },
  };
}
