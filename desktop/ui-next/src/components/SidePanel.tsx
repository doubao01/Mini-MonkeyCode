// 辅助面板只管理宽度和标签；连接型内容由调用方保持挂载。
import { IconArrowLeft } from "@tabler/icons-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useI18n } from "@/lib/i18n";

const WIDTH_KEY = "mc.sidePanelWidth";
const MIN_WIDTH = 320;
const KEEP_MAIN = 360;
const COMPACT_WIDTH = 680;
function readWidth(): number {
  try {
    const value = Number(localStorage.getItem(WIDTH_KEY));
    if (Number.isFinite(value) && value >= MIN_WIDTH) return value;
  } catch { /* 存储不可读时使用默认宽度 */ }
  return 400;
}
export interface SidePanelTab {
  id: string;
  label: string;
  icon?: ReactNode;
  badge?: number;
  disabledReason?: string;
}
export function SidePanel({ tabs, active, onSelect, onClose, children }: {
  tabs: SidePanelTab[]; active: string; onSelect: (id: string) => void; onClose?: () => void; children: ReactNode;
}) {
  const { t } = useI18n();
  const paneRef = useRef<HTMLElement>(null);
  const cleanupDrag = useRef<() => void>(() => {});
  const [width, setWidth] = useState(readWidth);
  const [parentWidth, setParentWidth] = useState(0);
  useEffect(() => {
    const parent = paneRef.current?.parentElement;
    if (!parent) return;
    const update = () => { const value = parent.getBoundingClientRect().width; if (value > 0) setParentWidth(value); };
    update();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(parent);
    return () => { observer?.disconnect(); cleanupDrag.current(); };
  }, []);
  const compact = parentWidth > 0 && parentWidth < COMPACT_WIDTH;
  const maxWidth = parentWidth ? Math.max(MIN_WIDTH, parentWidth - KEEP_MAIN) : 1000;
  const actualWidth = compact ? parentWidth : Math.min(width, maxWidth);
  const commit = (value: number) => {
    setWidth(value);
    try { localStorage.setItem(WIDTH_KEY, String(Math.round(value))); } catch { /* 只丢持久化 */ }
  };
  const available = tabs.filter((tab) => !tab.disabledReason);
  return <aside ref={paneRef} aria-label={t("side.label")} style={{ width: actualWidth }} className="@container/panel relative flex min-w-0 shrink-0 flex-col border-s border-base-300 bg-base-100">
    {!compact && <div role="separator" tabIndex={0} aria-orientation="vertical" aria-label={t("side.resize")} aria-valuemin={MIN_WIDTH} aria-valuemax={maxWidth} aria-valuenow={actualWidth} className="absolute inset-y-0 -start-1 z-30 w-2 cursor-col-resize focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
      onKeyDown={(e) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
        e.preventDefault();
        const value = e.key === 'Home' ? MIN_WIDTH : e.key === 'End' ? maxWidth : actualWidth + (e.key === 'ArrowLeft' ? 24 : -24);
        commit(Math.max(MIN_WIDTH, Math.min(maxWidth, value)));
      }}
      onPointerDown={(e) => {
        cleanupDrag.current();
        const parent = paneRef.current?.parentElement?.getBoundingClientRect();
        if (!parent) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        let latest = actualWidth;
        const move = (event: PointerEvent) => { latest = Math.max(MIN_WIDTH, Math.min(maxWidth, parent.right - event.clientX)); setWidth(latest); };
        const cleanup = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); };
        const up = () => { cleanup(); commit(latest); };
        cleanupDrag.current = cleanup;
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up, { once: true });
        window.addEventListener('pointercancel', up, { once: true });
      }} />}
    <header className="flex h-10 shrink-0 items-center gap-1 border-b border-base-300 px-2">
      {compact && onClose && <button className="btn btn-ghost btn-sm btn-square" type="button" aria-label={t("side.backToChat")} onClick={onClose}><IconArrowLeft size={16} aria-hidden /></button>}
      <select className="select select-sm hidden min-w-0 flex-1 @max-[380px]/panel:block" aria-label={t("side.label")} value={active} onChange={(e) => onSelect(e.target.value)}>
        {tabs.map((tab) => <option key={tab.id} value={tab.id} disabled={!!tab.disabledReason}>{tab.label}{tab.badge ? ` (${tab.badge})` : ''}</option>)}
      </select>
      <div role="tablist" className="flex min-w-0 flex-1 items-center gap-1 @max-[380px]/panel:hidden" onKeyDown={(e) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
        e.preventDefault();
        const current = available.findIndex((tab) => tab.id === active);
        const next = e.key === 'Home' ? 0 : e.key === 'End' ? available.length - 1 : (current + (e.key === 'ArrowRight' ? 1 : -1) + available.length) % available.length;
        if (available[next]) { onSelect(available[next].id); e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')[next]?.focus(); }
      }}>
        {tabs.map((tab) => <button key={tab.id} type="button" role="tab" tabIndex={active === tab.id ? 0 : -1} aria-selected={active === tab.id} title={tab.disabledReason ?? tab.label} disabled={!!tab.disabledReason} className={`btn btn-xs shrink-0 gap-1.5 ${active === tab.id ? 'btn-active' : 'btn-ghost text-base-content/70'}`} onClick={() => onSelect(tab.id)}>{tab.icon}{tab.label}{!!tab.badge && <span className="badge badge-soft badge-primary badge-xs">{tab.badge}</span>}</button>)}
      </div>
    </header>
    {children}
  </aside>;
}
