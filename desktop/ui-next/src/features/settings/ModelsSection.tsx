import { IconDotsVertical, IconRobot } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";

import { useI18n } from "@/lib/i18n";
import { baizhiStatus, baizhiSync, mcModelsSync, mcStatus, type BaizhiSyncResult, type McModelsSyncResult } from "@/lib/ipc/account";
import type { HostModel } from "@/lib/ipc/config";
import { modelDisplay, modelSourceRank, SOURCE_BAIZHI, SOURCE_MONKEYCODE } from "@/lib/models/modelMenu";
import { useDismiss } from "@/lib/util/useDismiss";
import { useMcTransport } from "@/lib/mcTransport";
import { ModelConfigDialog } from "./models/ModelConfigDialog";
import { removeModel } from "./models/modelEditor";
import type { SettingsDraft } from "./settingsForm";

function ModelCard({ model, isDefault, onEdit, onDefault, onDelete }: {
  model: HostModel; isDefault: boolean; onEdit: () => void; onDefault: () => void; onDelete: () => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = () => { setOpen(false); trigger.current?.focus(); };
  useDismiss(open, menu, close);
  const name = modelDisplay(model).label || t("settings.models.unnamed");
  const format = model.provider === "openai" ? "OpenAI Chat" : model.provider === "openai_responses" ? "OpenAI Responses" : model.provider === "anthropic" ? "Anthropic Messages" : model.provider;
  const owner = model.owner === "private" ? t("settings.models.personal") : model.owner === "team" ? t("settings.models.team") : model.owner === "public" ? t("settings.models.public") : model.source === SOURCE_BAIZHI ? t("model.source.baizhi") : model.source === SOURCE_MONKEYCODE ? t("model.source.member") : model.source || t("settings.models.local");
  const action = (fn: () => void) => { close(); fn(); };
  return <li className="card card-border min-w-0 flex-row items-center gap-3 bg-base-100 px-3 py-3">
    <span className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-full bg-base-200 sm:flex"><IconRobot size={16} aria-hidden /></span>
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
      <button type="button" className="min-w-0 max-w-full truncate text-start text-sm font-medium underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" title={name} onClick={onEdit}>{name}</button>
      <span className="badge badge-ghost badge-sm">{format}</span><span className="badge badge-ghost badge-sm">{owner}</span>
      {isDefault && <span className="badge badge-primary badge-soft badge-sm">{t("settings.models.default")}</span>}
      {model.locked && <span className="badge badge-warning badge-soft badge-sm">{t("settings.models.lockedBadge")}</span>}
    </div>
    <div ref={menu} className={`dropdown dropdown-end shrink-0 ${open ? "dropdown-open" : ""}`}>
      <button ref={trigger} type="button" className="btn btn-ghost btn-sm btn-square" aria-label={t("settings.models.more", { name })} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}><IconDotsVertical size={16} aria-hidden /></button>
      {open && <ul role="menu" className="dropdown-content menu z-10 w-40 rounded-box bg-base-100 p-1 shadow-sm" onKeyDown={(e) => {
        const buttons = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('button')];
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
          e.preventDefault();
          const next = e.key === "Home" ? 0 : e.key === "End" ? buttons.length - 1 : (index + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
          buttons[next]?.focus();
        }
      }}>
        <li role="none"><button role="menuitem" type="button" onClick={() => action(onEdit)}>{t(model.source === SOURCE_MONKEYCODE || model.locked ? "settings.models.view" : "settings.models.edit")}</button></li>
        {!model.locked && !isDefault && <li role="none"><button role="menuitem" type="button" onClick={() => action(onDefault)}>{t("settings.models.setDefault")}</button></li>}
        {!model.source && <li role="none"><button role="menuitem" type="button" className="text-error" onClick={() => action(onDelete)}>{t("settings.models.delete")}</button></li>}
      </ul>}
    </div>
  </li>;
}

export function ModelsSection({ draft, onDraft, onSave, onModalChange, changes = [], blocked = false, onSync }: {
  draft: SettingsDraft;
  onDraft: (up: (d: SettingsDraft) => SettingsDraft) => void;
  onSave: (original: HostModel | null, model: HostModel, onPersisted: (saved: HostModel) => void) => Promise<string | null>;
  onModalChange: (open: boolean) => void;
  changes?: string[];
  blocked?: boolean;
  onSync: (result: BaizhiSyncResult | McModelsSyncResult) => void;
}) {
  const { t } = useI18n();
  const [editing, setEditing] = useState<{ original: HostModel | null } | null>(null);
  const [deleting, setDeleting] = useState<HostModel | null>(null);
  const [message, setMessage] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [connected, setConnected] = useState({ baizhi: false, mc: false });
  const transport = useMcTransport();
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    let alive = true;
    void Promise.all([baizhiStatus().catch(() => null), mcStatus().catch(() => null)]).then(([bz, mc]) => {
      if (alive) setConnected({ baizhi: !!bz?.logged_in, mc: !!mc?.logged_in });
    });
    return () => { alive = false; };
  }, [transport.generation]);
  useEffect(() => { onModalChange(!!editing); return () => onModalChange(false); }, [editing, onModalChange]);
  const sync = async () => {
    setSyncing(true); setMessage("");
    const generation = transport.generation;
    try {
      let count = 0;
      if (connected.baizhi) {
        const result = await baizhiSync(draft.models.filter((m) => m.source === SOURCE_BAIZHI).map((m) => m.api_key).filter(Boolean));
        if (!alive.current || !transport.isCurrent(generation)) return;
        if (result.models.length || Object.keys(result.mcp_servers).length) { onSync(result); count += result.models.length + Object.keys(result.mcp_servers).length; }
      }
      if (connected.mc) { const result = await mcModelsSync(generation); if (!alive.current || !transport.isCurrent(generation)) return; if (result.models.length) { onSync(result); count += result.models.length; } }
      if (alive.current) setMessage(t(count ? "settings.models.syncPending" : "settings.models.syncEmpty"));
    } catch (e) { if (alive.current && transport.isCurrent(generation)) setMessage(e instanceof Error ? e.message : String(e)); }
    finally { if (alive.current) setSyncing(false); }
  };
  const rows = draft.models.map((model, index) => ({ model, index })).sort((a, b) => modelSourceRank(a.model.source) - modelSourceRank(b.model.source));
  return <section aria-label={t("settings.models.title")} className="flex h-full min-h-0 flex-col gap-4">
    <header className="flex shrink-0 items-start justify-between gap-4">
      <div className="min-w-0"><h2 className="flex items-center gap-2 text-lg font-semibold"><IconRobot size={22} aria-hidden />{t("settings.models.title")}</h2><p className="mt-2 text-sm text-base-content/70">{t("settings.models.subtitle")}</p></div>
      <button type="button" className="btn btn-outline btn-sm shrink-0" onClick={() => { setMessage(""); setEditing({ original: null }); }}>{t("settings.models.bind")}</button>
    </header>
    <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden [scrollbar-gutter:stable] overscroll-contain pb-32">
      <ul className="flex flex-col gap-4">
        {rows.map(({ model, index }) => <ModelCard key={`${model.source ?? ''}:${model.name}`} model={model} isDefault={index === draft.defaultIdx} onEdit={() => setEditing({ original: { ...model } })} onDefault={() => onDraft((d) => ({ ...d, defaultIdx: d.models.findIndex((m) => m.name === model.name && m.source === model.source) }))} onDelete={() => setDeleting(model)} />)}
      </ul>
      {!rows.length && <div className="rounded-lg border border-dashed border-base-300 px-4 py-10 text-center text-sm text-base-content/70">{t("settings.models.empty")}</div>}
      {deleting && <div className="mt-4 rounded-lg border border-warning p-4" role="alert">
        <p className="text-sm">{t("settings.models.deleteAsk", { name: modelDisplay(deleting).label })}</p>
        {draft.models[draft.defaultIdx]?.name === deleting.name && <p className="mt-2 text-xs">{t("settings.models.deleteDefault")}</p>}
        <div className="mt-3 flex gap-2"><button className="btn btn-outline btn-sm" onClick={() => setDeleting(null)}>{t("settings.models.cancel")}</button><button className="btn btn-error btn-sm" onClick={() => { onDraft((d) => removeModel(d, deleting.name)); setDeleting(null); }}>{t("settings.models.delete")}</button></div>
      </div>}
      {(connected.baizhi || connected.mc) && <button type="button" disabled={syncing} className="btn btn-ghost btn-sm mt-4" onClick={() => void sync()}>{syncing && <span className="loading loading-spinner loading-xs" aria-hidden />}{t("settings.models.sync")}</button>}
      {message && <p role="status" className="mt-3 text-xs text-base-content/70">{message}</p>}
    </div>
    {editing && <ModelConfigDialog original={editing.original} readonly={editing.original?.source === SOURCE_MONKEYCODE || !!editing.original?.locked} changes={changes} blocked={blocked} onClose={() => setEditing(null)} onSave={async (model) => {
      const error = await onSave(editing.original, model, (saved) => {
        // 写盘后恢复失败会保留弹窗；定位基线必须同步到落盘版本，才能继续编辑/重试。
        setEditing({ original: { ...saved } });
      });
      if (!error) setMessage(t("settings.models.saved"));
      return error;
    }} />}
  </section>;
}
