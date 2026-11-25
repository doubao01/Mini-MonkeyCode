// 关于:宿主/内核版本对照。版本按 YYMMDDNN 展示构建日期，不在本页检查或安装更新。
// 排障入口常态隐藏，连点版本号 5 次解锁，只在本次挂载内有效。
// 导出日志走另存对话框，与打开存储目录分别保留；取消不提示成功。
import { useEffect, useState } from "react";

import { useI18n } from "@/lib/i18n";
import { exportEngineLog } from "@/lib/ipc/config";
import { hostInfo, openAppDir, openLogDir, type HostInfo } from "@/lib/ipc/host";

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const UNLOCK_TAPS = 5;

export function AboutSection() {
  const { t } = useI18n();
  const [info, setInfo] = useState<HostInfo | null>(null);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const [taps, setTaps] = useState(0);
  const unlocked = taps >= UNLOCK_TAPS;

  useEffect(() => {
    let alive = true;
    void hostInfo().then((v) => { if (alive) setInfo(v); });
    return () => { alive = false; };
  }, []);

  /** 动作先单独求值；ok?.(await fn()) 会在未传回执时连动作一起短路。 */
  const runDiag = async <T,>(fn: () => Promise<T>, ok?: (v: T) => string | null) => {
    setMsg(null);
    try {
      const done = await fn();
      const text = ok?.(done);
      if (text) setMsg({ text });
    } catch (e) {
      setMsg({ text: errMsg(e), error: true });
    }
  };

  return (
    <section aria-label={t("settings.nav.about")} className="flex flex-col gap-3">
      <div className="flex items-center gap-4 rounded-box border border-base-300 p-4">
        <img src="/logo.png" alt="" aria-hidden className="h-12 w-12 rounded-2xl shadow-sm" />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-sm font-bold">{t("app.name")}</span>
          <button type="button" className="cursor-default truncate text-start font-mono text-xs text-base-content/60" onClick={() => setTaps((n) => n + 1)}>
            {t("settings.about.version", {
              version: info?.version ?? "—",
              engine: info?.engine_version ?? t("settings.about.engineNotReady"),
            })}
          </button>
        </div>
      </div>
      {msg && <div role={msg.error ? "alert" : "status"} className={`alert ${msg.error ? "alert-error" : "alert-success"} alert-soft py-1.5 text-xs`}><span>{msg.text}</span></div>}
      {unlocked && <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn btn-sm" onClick={() => void runDiag(openAppDir)}>{t("settings.about.openAppDir")}</button>
        <button type="button" className="btn btn-sm" onClick={() => void runDiag(openLogDir)}>{t("settings.about.openDataDir")}</button>
        <button type="button" className="btn btn-sm" title={t("settings.about.exportLogHint")} onClick={() => void runDiag(exportEngineLog, (dest) => dest ? t("settings.about.exportDone") : null)}>{t("settings.about.exportLog")}</button>
      </div>}
    </section>
  );
}
