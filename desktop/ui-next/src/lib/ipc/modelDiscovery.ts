import { invoke } from "./ipc";

export function discoverModels(requestId: string, provider: string, baseUrl: string, apiKey: string): Promise<string[]> {
  return invoke<string[]>("models_discover", { requestId, provider, baseUrl, apiKey });
}

export function cancelModelDiscovery(requestId: string): void {
  void invoke("models_discover_cancel", { requestId }).catch(() => {});
}
