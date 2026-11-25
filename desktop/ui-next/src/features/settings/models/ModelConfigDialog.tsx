import { IconChevronDown, IconEye, IconEyeOff, IconHelpCircle, IconX } from "@tabler/icons-react";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { useI18n } from "@/lib/i18n";
import type { HostModel } from "@/lib/ipc/config";
import { openExternal } from "@/lib/ipc/host";
import { inDesktopShell } from "@/lib/ipc/ipc";
import { cancelModelDiscovery, discoverModels } from "@/lib/ipc/modelDiscovery";
import { useDismiss } from "@/lib/util/useDismiss";
import { useEscLayer } from "@/lib/util/escLayer";
import { requestPreview } from "./modelEditor";

/** 模型 ID 选择器：原生 datalist 的弹层只做前缀匹配，空列表或输入已等
 * 于某项时只剩当前值一项，也没有加载/失败态。这里自绘列表，展开即列出
 * 全部已获取的 ID，并支持筛选与键盘选择。 */
function ModelCombo({ id, value, items, disabled, canFetch, loading, message, invalid, expandKey, onOpen, onChange }: {
  id: string;
  value: string;
  items: string[];
  disabled: boolean;
  canFetch: boolean;
  loading: boolean;
  message: string;
  invalid: boolean;
  /** 递增即展开（获取列表成功时调用方推进，不必手点三角）。 */
  expandKey: number;
  onOpen: () => void;
  onChange: (value: string) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  // null = 未在输入筛选，展开时列出全部候选；否则只列匹配项。
  const [filter, setFilter] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const requested = useRef(false);
  const close = useCallback(() => { setOpen(false); setActive(-1); setFilter(null); }, []);
  useDismiss(open, box, close);
  // 首次展开且还没拿到列表时触发一次发现，不让用户先猜按钮在哪。
  useEffect(() => {
    if (!open || requested.current || loading || items.length || disabled || !canFetch) return;
    requested.current = true;
    onOpen();
  }, [canFetch, disabled, items.length, loading, onOpen, open]);
  const visible = filter ? items.filter((item) => item.toLowerCase().includes(filter.trim().toLowerCase())) : items;
  // 获取列表成功后自动展开（父层递增 expandKey）。渲染期间根据新 prop
  // 调整自身状态，避免在 effect 里同步 setState 引起级联渲染。
  const [seenKey, setSeenKey] = useState(expandKey);
  if (expandKey !== seenKey) {
    setSeenKey(expandKey);
    if (items.length && !disabled) {
      setOpen(true);
      setFilter(null);
      setActive(Math.max(0, items.indexOf(value)));
    }
  }
  // 筛选会把 active 甩出界；渲染前收回列表内，避免高亮与回车指向脱节。
  const cursor = active >= 0 && active < visible.length ? active : visible.length ? 0 : -1;
  const listId = `${id}-list`;
  const expand = () => {
    if (disabled) return;
    setOpen(true);
    // 已选值不能当筛选词，否则打开只剩当前这一项——用户反馈的核心症状。
    setActive(Math.max(0, items.indexOf(value)));
  };
  const pick = (item: string) => {
    onChange(item);
    close();
  };
  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) { expand(); return; }
      if (!visible.length) return;
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((current) => (current + step + visible.length) % visible.length);
      return;
    }
    if (e.key === "Enter" && open) {
      // 列表里的回车是选项，不能顺手提交整个表单；空列表时放行默认提交。
      const item = visible[cursor];
      if (!item) return;
      e.preventDefault();
      pick(item);
      return;
    }
    if (e.key === "Escape" && open) {
      e.stopPropagation();
      close();
      return;
    }
    if (e.key === "Tab") close();
  };
  const status = loading
    ? t("settings.models.loading")
    : message
      ? ""
      : items.length
        ? ""
        : t("settings.models.listEmpty");
  return (
    <div ref={box} className="relative">
      <div className="flex gap-1">
        <input
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? `${id}-error` : undefined}
          aria-activedescendant={open && cursor >= 0 ? `${id}-opt-${cursor}` : undefined}
          className="input input-sm min-w-0 flex-1 font-mono"
          value={value}
          disabled={disabled}
          onChange={(e) => { onChange(e.target.value); setFilter(e.target.value); setOpen(true); setActive(0); }}
          onClick={expand}
          onKeyDown={onKeyDown}
        />
        <button type="button" className="btn btn-ghost btn-sm btn-square" disabled={disabled} aria-label={t(open ? "settings.models.collapseList" : "settings.models.expandList")} aria-expanded={open} aria-controls={listId} onClick={() => (open ? close() : expand())}>
          <IconChevronDown size={16} aria-hidden className={`transition-transform duration-150 ${open ? "rotate-180" : ""}`} />
        </button>
      </div>
      {open && (
        <div className="absolute inset-x-0 z-50 mt-1 overflow-hidden rounded-box border border-base-300 bg-base-100 shadow-lg">
          <ul id={listId} role="listbox" aria-label={t("settings.models.idList")} className="max-h-56 overflow-y-auto overflow-x-hidden p-1">
            {visible.map((item, index) => (
              <li key={item} id={`${id}-opt-${index}`} role="option" aria-selected={item === value} className={`cursor-pointer truncate rounded-md px-2 py-1.5 font-mono text-xs ${index === cursor ? "menu-active" : ""}`} onMouseEnter={() => setActive(index)} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(item)}>{item}</li>
            ))}
            {!loading && items.length > 0 && !visible.length && <li role="presentation" className="px-2 py-1.5 text-xs text-base-content/70">{t("settings.models.listNoMatch")}</li>}
          </ul>
          {status && <p role="status" className="border-t border-base-300 px-2 py-1.5 text-xs leading-relaxed text-base-content/70">{status}</p>}
        </div>
      )}
    </div>
  );
}

export function ModelConfigDialog({ original, readonly, changes, blocked, onClose, onSave }: {
  original: HostModel | null;
  readonly: boolean;
  changes: string[];
  blocked: boolean;
  onClose: () => void;
  onSave: (model: HostModel) => Promise<string | null>;
}) {
  const { t } = useI18n();
  const id = useId();
  const [model, setModel] = useState<HostModel>(() => original ? { ...original } : {
    name: "", provider: "openai", base_url: "https://model-square.app.baizhi.cloud/v1", api_key: "", model: "",
  });
  const [context, setContext] = useState(String(original ? original.context_window ?? "" : 200000));
  const [output, setOutput] = useState(String(original ? original.max_output ?? "" : 32000));
  const [showToken, setShowToken] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [items, setItems] = useState<string[]>([]);
  const [expandKey, setExpandKey] = useState(0);
  const [loading, setLoading] = useState(false);
  const [discoveryMessage, setDiscoveryMessage] = useState("");
  const [needsConfirmation, setNeedsConfirmation] = useState(false);
  const request = useRef<string | null>(null);
  const lastThink = useRef(original?.think === "off" ? undefined : original?.think);
  const root = useRef<HTMLFormElement>(null);
  const closeRef = useRef(onClose);
  const savingRef = useRef(false);
  useLayoutEffect(() => { closeRef.current = onClose; }, [onClose]);

  const cancelRequest = useCallback(() => {
    if (request.current) cancelModelDiscovery(request.current);
    request.current = null;
  }, []);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    root.current?.querySelector<HTMLElement>("select, button")?.focus();
    return () => {
      cancelRequest();
      window.requestAnimationFrame(() => { if (previous?.isConnected) previous.focus(); });
    };
  }, [cancelRequest]);
  useEscLayer(true, useCallback(() => {
    if (!savingRef.current) closeRef.current();
    return true;
  }, []));

  const patch = (values: Partial<HostModel>) => {
    if ("model" in values) setNeedsConfirmation(false);
    if ("provider" in values || "base_url" in values || "api_key" in values) {
      if (items.includes(model.model)) setNeedsConfirmation(true);
      cancelRequest();
      setItems([]);
      setLoading(false);
      setDiscoveryMessage("");
    }
    setModel((m) => ({ ...m, ...values }));
    setErrors({});
    setError("");
  };
  const fetchList = async () => {
    if (!inDesktopShell()) { setDiscoveryMessage(t("settings.models.discoveryBrowser")); return; }
    cancelRequest();
    const requestId = crypto.randomUUID();
    request.current = requestId;
    setLoading(true);
    setDiscoveryMessage("");
    try {
      const result = await discoverModels(requestId, model.provider, model.base_url.trim(), model.api_key);
      if (request.current !== requestId) return;
      setItems(result);
      setDiscoveryMessage(t(result.length ? "settings.models.discoveryReady" : "settings.models.discoveryEmpty", { n: result.length }));
      if (result.length) setExpandKey((key) => key + 1);
    } catch (e) {
      if (request.current === requestId) setDiscoveryMessage(e instanceof Error ? e.message : String(e));
    } finally {
      if (request.current === requestId) { request.current = null; setLoading(false); }
    }
  };
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (readonly || savingRef.current || blocked || needsConfirmation) return;
    const invalid: Record<string, string> = {};
    if (!model.model.trim() && (!original?.source || model.model !== original.model)) invalid.model = t("settings.models.required");
    if (!model.source && !model.api_key.trim()) invalid.api_key = t("settings.models.required");
    if ((!original?.source || model.base_url !== original.base_url) && !requestPreview(model.base_url, model.provider)) invalid.base_url = t("settings.models.badUrl");
    for (const [key, value] of [["context", context], ["output", output]]) {
      if (value && (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < 1)) invalid[key!] = t("settings.models.badNumber");
    }
    setErrors(invalid);
    if (Object.keys(invalid).length) return;
    setSaving(true);
    savingRef.current = true;
    setError("");
    try {
      const result = await onSave({ ...model, name: original && model.name === original.name ? original.name : model.name.trim() || model.model.trim(),
        model: original && model.model === original.model ? original.model : model.model.trim(),
        base_url: original && model.base_url === original.base_url ? original.base_url : model.base_url.trim(), context_window: context ? Number(context) : undefined, max_output: output ? Number(output) : undefined });
      if (result) setError(result);
      else closeRef.current();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { savingRef.current = false; setSaving(false); }
  };
  const field = (key: string, label: string, content: ReactNode, hint?: ReactNode) => (
    <div className="flex flex-col gap-2">
      <label htmlFor={`${id}-${key}`} className="text-sm font-medium">{label}</label>
      {content}
      {hint && <div id={`${id}-${key}-hint`} className="text-xs leading-relaxed text-base-content/70">{hint}</div>}
      {errors[key] && <p id={`${id}-${key}-error`} role="alert" className="text-xs text-error">{errors[key]}</p>}
    </div>
  );
  const attrs = (key: string) => ({ id: `${id}-${key}`, "aria-invalid": !!errors[key], "aria-describedby": errors[key] ? `${id}-${key}-error` : undefined });
  const preview = requestPreview(model.base_url, model.provider);

  return createPortal(
    <div className="modal modal-open" role="dialog" aria-modal="true" aria-labelledby={`${id}-title`}>
      <form ref={root} onSubmit={(e) => void save(e)} className="modal-box flex max-h-[85vh] max-w-xl flex-col gap-5 overflow-hidden p-6" onKeyDown={(e) => {
        if (e.key !== "Tab") return;
        const nodes = [...root.current!.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href]')];
        const first = nodes[0], last = nodes.at(-1);
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }}>
        <header className="flex shrink-0 items-center justify-between gap-3">
          <h2 id={`${id}-title`} className="text-lg font-semibold">{t(readonly ? "settings.models.viewTitle" : original ? "settings.models.editTitle" : "settings.models.bindTitle")}</h2>
          <button type="button" className="btn btn-ghost btn-sm btn-square" disabled={saving} onClick={onClose} aria-label={t("settings.models.close")}><IconX size={18} aria-hidden /></button>
        </header>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overflow-x-hidden [scrollbar-gutter:stable] overscroll-contain pr-1">
          {readonly && <p className="text-xs text-base-content/70">{t("settings.models.readonly")}</p>}
          <fieldset disabled={readonly || saving} className="flex min-w-0 flex-col gap-4">
            {field("provider", t("settings.models.format"), <select id={`${id}-provider`} className="select select-sm w-full" value={model.provider} onChange={(e) => patch({ provider: e.target.value })}>
              <option value="openai">OpenAI Chat</option><option value="openai_responses">OpenAI Responses</option><option value="anthropic">Anthropic Messages</option>
              {!['openai', 'openai_responses', 'anthropic'].includes(model.provider) && <option value={model.provider}>{model.provider}</option>}
            </select>)}
            {field("base_url", t("settings.models.address"), <input {...attrs("base_url")} className="input input-sm w-full font-mono" placeholder="https://api.example.com/v1" value={model.base_url} onChange={(e) => patch({ base_url: e.target.value })} />, preview && <span className="break-all font-mono">{preview}</span>)}
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2"><label htmlFor={`${id}-api_key`} className="text-sm font-medium">{t("settings.models.token")}</label>
                <button type="button" className="btn btn-link btn-xs h-auto p-0" title={t("settings.models.tokenHelpHint")} onClick={() => void openExternal("https://monkeycode.docs.baizhi.cloud/")}><IconHelpCircle size={14} aria-hidden />{t("settings.models.tokenHelp")}</button>
              </div>
              <div className="flex gap-1"><input {...attrs("api_key")} autoComplete="off" type={showToken ? "text" : "pass" + "word"} className="input input-sm min-w-0 flex-1 font-mono" value={model.api_key} onChange={(e) => patch({ api_key: e.target.value })} />
                <button type="button" className="btn btn-ghost btn-sm btn-square" onClick={() => setShowToken(!showToken)} aria-label={t(showToken ? "settings.models.hideToken" : "settings.models.showToken")}>{showToken ? <IconEyeOff size={16} aria-hidden /> : <IconEye size={16} aria-hidden />}</button></div>
              {errors.api_key && <p id={`${id}-api_key-error`} role="alert" className="text-xs text-error">{errors.api_key}</p>}
            </div>
            {field("model", t("settings.models.modelName"), <>
                <ModelCombo id={`${id}-model`} value={model.model} items={items} disabled={readonly || saving} canFetch={!!model.base_url.trim() && !!model.api_key.trim()} loading={loading} message={discoveryMessage} invalid={!!errors.model} expandKey={expandKey} onOpen={() => void fetchList()} onChange={(v) => patch({ model: v })} />
              {errors.model && <p id={`${id}-model-error`} role="alert" className="text-xs text-error">{errors.model}</p>}
              {!readonly && <button type="button" disabled={loading || !model.base_url.trim() || !model.api_key.trim()} className="btn btn-outline btn-sm w-fit" onClick={() => void fetchList()}>{loading && <span className="loading loading-spinner loading-xs" aria-hidden />}{t("settings.models.discover")}</button>}
              {needsConfirmation && <div role="status" className="text-xs text-warning"><p>{t("settings.models.reconfirm")}</p><button type="button" className="btn btn-ghost btn-xs" onClick={() => setNeedsConfirmation(false)}>{t("settings.models.confirmId")}</button></div>}
              {discoveryMessage && <p role="status" className="text-xs leading-relaxed text-base-content/70">{discoveryMessage}</p>}
            </>, !readonly && t("settings.models.discoveryHint"))}
            {field("name", t("settings.models.displayName"), <input id={`${id}-name`} className="input input-sm w-full" value={model.name} onChange={(e) => patch({ name: e.target.value })} />, t("settings.models.nameHint"))}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {field("context", t("settings.models.contextLength"), <input {...attrs("context")} type="number" min={1} step={1} className="input input-sm w-full" placeholder={t("settings.models.inherit")} value={context} onChange={(e) => setContext(e.target.value)} />)}
              {field("output", t("settings.models.outputLength"), <input {...attrs("output")} type="number" min={1} step={1} className="input input-sm w-full" placeholder={t("settings.models.inherit")} value={output} onChange={(e) => setOutput(e.target.value)} />)}
            </div>
            {field("reasoning", t("settings.models.reasoning"), <>
              <label className="flex items-center justify-between rounded-lg border border-base-300 px-3 py-2"><span className="text-sm">{t(model.think === "off" ? "settings.models.disabled" : "settings.models.enabled")}</span><input id={`${id}-reasoning`} aria-label={t("settings.models.reasoning")} type="checkbox" role="switch" className="toggle toggle-sm" checked={model.think !== 'off'} onChange={(e) => {
                if (e.target.checked) patch({ think: lastThink.current });
                else { lastThink.current = model.think; patch({ think: "off" }); }
              }} /></label>
              {model.think !== 'off' && <select aria-label={t("settings.models.think")} className="select select-sm w-full" value={model.think ?? ''} onChange={(e) => { lastThink.current = e.target.value || undefined; patch({ think: lastThink.current }); }}>
                <option value="">{t("settings.models.think.default")}</option><option value="low">{t("settings.models.think.low")}</option><option value="medium">{t("settings.models.think.medium")}</option><option value="high">{t("settings.models.think.high")}</option>
              </select>}
            </>)}
            {field("vision", t("settings.models.imageRecognition"), <label className="flex items-center justify-between rounded-lg border border-base-300 px-3 py-2"><span className="text-sm">{t(model.vision ? "settings.models.vision.on" : "settings.models.imageOff")}</span><input id={`${id}-vision`} aria-label={t("settings.models.imageRecognition")} role="switch" type="checkbox" className="toggle toggle-sm" checked={!!model.vision} onChange={(e) => patch({ vision: e.target.checked || undefined })} /></label>, t("settings.models.imageHint"))}
          </fieldset>
          {!readonly && <p className="text-xs leading-relaxed text-base-content/70">{t("settings.models.saveHint")}</p>}
          {!!changes.length && !readonly && <p className="rounded-lg border border-warning p-3 text-xs leading-relaxed">{t("settings.models.otherChanges", { changes: changes.join('、') })}</p>}
          {blocked && !readonly && <p role="status" className="text-xs text-warning">{t("settings.models.runningHint")}</p>}
          {error && <p role="alert" className="text-sm text-error">{error}</p>}
        </div>
        <footer className="flex shrink-0 justify-end gap-2">
          <button type="button" className="btn btn-outline btn-sm" disabled={saving} onClick={onClose}>{t(readonly ? "settings.models.close" : "settings.models.cancel")}</button>
          {!readonly && <button type="submit" className="btn btn-primary btn-sm" disabled={saving || blocked || needsConfirmation}>{saving && <span className="loading loading-spinner loading-xs" aria-hidden />}{t("settings.models.save")}</button>}
        </footer>
      </form>
      <div className="modal-backdrop" aria-hidden onClick={() => { if (!saving) onClose(); }} />
    </div>, document.body,
  );
}
