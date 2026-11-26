import { IconArrowDown } from "@tabler/icons-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

import { useI18n } from "@/lib/i18n";

/** 贴底容差(px):Chromium 的 scrollHeight/clientHeight 是取整值而 scrollTop
 *  可带小数,真正滚到底时「离底距离」仍可能差 1~2px。容差吸收这点取整误差,
 *  否则贴底了按钮还亮着。 */
const BOTTOM_TOLERANCE_PX = 4;
/** 兜底复查间隔(ms):几何变了却既没滚动也没尺寸变化时靠它收敛。 */
const POLL_MS = 120;

export function JumpToLatest({ scrollRef, sessionId, enabled, onClick }: {
  scrollRef: RefObject<HTMLDivElement | null>;
  sessionId: string;
  enabled: boolean;
  onClick: () => void;
}) {
  const { t } = useI18n();
  const [visible, setVisible] = useState(false);
  // 显隐的权威副本:measure 会被 scroll/RO/定时器多条路径调到,用它挡住
  // 同值的重复 setState,免得空转重渲。
  const visibleRef = useRef(false);

  /** 离底距离(px):0 = 贴底;内容不足一屏恒为 0(没有可滚的历史)。 */
  const distance = useCallback((log: HTMLElement) => {
    const max = log.scrollHeight - log.clientHeight;
    return max <= 0 ? 0 : max - log.scrollTop;
  }, []);

  const measure = useCallback(() => {
    const log = scrollRef.current;
    if (!log) return;
    const next = distance(log) > BOTTOM_TOLERANCE_PX;
    if (visibleRef.current === next) return;
    visibleRef.current = next;
    setVisible(next);
  }, [distance, scrollRef]);

  // 几何变化的来源要逐个盯住,少一条就会留下「已经贴底但按钮还亮着」的
  // 陈旧状态(用户报障:滚动条已在最底部,回到最新的图标还在)。
  // - scroll:用户滚动与程序贴底都走这里;
  // - 视口/内容轨尺寸:composer 面板、图片解码、工具卡展开;
  // - 虚拟行容器:上下 spacer 一增一减时列高可以不变,只盯列会漏。
  useLayoutEffect(() => {
    if (!enabled) {
      if (visibleRef.current) {
        visibleRef.current = false;
        setVisible(false);
      }
      return;
    }
    const log = scrollRef.current;
    if (!log) return;

    const onScroll = () => measure();
    log.addEventListener("scroll", onScroll, { passive: true });

    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    observer?.observe(log);
    const track = log.firstElementChild;
    if (track) observer?.observe(track);
    const items = log.querySelector("[data-chat-items]");
    if (items) observer?.observe(items);

    measure();
    return () => {
      cancelAnimationFrame(frame);
      log.removeEventListener("scroll", onScroll);
      observer?.disconnect();
    };
  }, [enabled, measure, scrollRef, sessionId]);

  // React 提交 DOM 后再量一次:行高、spacer、面板高度的变化可能既不发
  // scroll 也不改视口尺寸,只留着一份亮着的陈旧状态。
  useLayoutEffect(() => {
    if (!visible) return;
    measure();
  });

  // 兜底复查:几何变了却没有任何事件(虚拟窗口滑动、浏览器 clamp)时,
  // 靠它把显隐收敛到真实位置。
  useEffect(() => {
    if (!enabled) return;
    const timer = window.setInterval(measure, POLL_MS);
    return () => window.clearInterval(timer);
  }, [enabled, measure]);

  if (!enabled || !visible) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-3 z-20 flex justify-center px-3">
      <button
        type="button"
        className="btn btn-sm pointer-events-auto gap-1.5 rounded-full border-base-300 bg-base-100 text-base-content shadow-md"
        onClick={() => {
          onClick();
          // 父层写 scrollTop 后立刻量一次;若父层的贴底延到下一帧,
          // 下一帧的 scroll 事件与轮询还会各量一次,收敛到贴底即隐藏。
          measure();
        }}
      >
        <IconArrowDown size={16} stroke={1.75} aria-hidden />
        {t("chat.jumpToLatest")}
      </button>
    </div>
  );
}
