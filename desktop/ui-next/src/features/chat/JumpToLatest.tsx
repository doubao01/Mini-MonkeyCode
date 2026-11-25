import { IconArrowDown } from "@tabler/icons-react";
import { useLayoutEffect, useState, type RefObject } from "react";

import { useI18n } from "@/lib/i18n";

export function JumpToLatest({ scrollRef, sessionId, enabled, onClick }: {
  scrollRef: RefObject<HTMLDivElement | null>;
  sessionId: string;
  enabled: boolean;
  onClick: () => void;
}) {
  const { t } = useI18n();
  const [visible, setVisible] = useState(false);

  useLayoutEffect(() => {
    const log = enabled ? scrollRef.current : null;
    if (!log) return;
    // 显隐依据实际几何，而不是贴底跟随旗标；后者在用户开始拖动时就会解除。
    const measure = () => setVisible(log.scrollHeight - log.scrollTop - log.clientHeight > 1);
    let frame = 0;
    const scheduleMeasure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    log.addEventListener("scroll", measure, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(scheduleMeasure);
    observer?.observe(log);
    if (log.firstElementChild) observer?.observe(log.firstElementChild);
    scheduleMeasure();
    return () => {
      cancelAnimationFrame(frame);
      log.removeEventListener("scroll", measure);
      observer?.disconnect();
    };
  }, [enabled, scrollRef, sessionId]);

  if (!enabled || !visible) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-3 z-20 flex justify-center px-3">
      <button
        type="button"
        className="btn btn-sm pointer-events-auto gap-1.5 rounded-full border-base-300 bg-base-100 text-base-content shadow-md"
        onClick={() => {
          onClick();
          const log = scrollRef.current;
          if (log) setVisible(log.scrollHeight - log.scrollTop - log.clientHeight > 1);
        }}
      >
        <IconArrowDown size={16} stroke={1.75} aria-hidden />
        {t("chat.jumpToLatest")}
      </button>
    </div>
  );
}
