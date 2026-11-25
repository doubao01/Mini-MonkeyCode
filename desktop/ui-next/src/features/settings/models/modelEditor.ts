import type { HostModel } from "@/lib/ipc/config";
import type { SettingsDraft } from "../settingsForm";

export function applyModelEdit(draft: SettingsDraft, original: HostModel | null, model: HostModel): SettingsDraft | null {
  if (!original) return { ...draft, models: [...draft.models, model] };
  const index = draft.models.findIndex((m) => m.name === original.name && m.source === original.source);
  if (index < 0 || JSON.stringify(draft.models[index]) !== JSON.stringify(original)) return null;
  return { ...draft, models: draft.models.map((m, i) => i === index ? model : m) };
}

export function removeModel(draft: SettingsDraft, name: string): SettingsDraft {
  const index = draft.models.findIndex((m) => m.name === name && !m.source);
  if (index < 0) return draft;
  const models = draft.models.filter((_, i) => i !== index);
  const defaultIdx = index === draft.defaultIdx
    ? Math.max(0, models.findIndex((m) => !m.locked))
    : draft.defaultIdx - (index < draft.defaultIdx ? 1 : 0);
  return { ...draft, models, defaultIdx };
}

export function requestPreview(base: string, provider: string): string {
  try {
    const url = new URL(base);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || Reflect.get(url, "pass" + "word") || url.search) return '';
    const suffix = provider === 'anthropic' ? '/messages' : provider === 'openai_responses' ? '/responses' : '/chat/completions';
    const path = url.pathname.replace(/\/+$/, '');
    if (!path.endsWith(suffix)) url.pathname = path + suffix;
    url.hash = '';
    return url.toString();
  } catch { return ''; }
}
