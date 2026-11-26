import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { JumpToLatest } from "./JumpToLatest";

function Harness({ enabled = true }: { enabled?: boolean }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  return (
    <div>
      <div ref={scrollRef} data-testid="log"><div data-testid="track" /></div>
      <JumpToLatest scrollRef={scrollRef} sessionId="test" enabled={enabled} onClick={() => {}} />
    </div>
  );
}

/** 给容器装上可控的滚动几何。 */
function stubGeometry(log: HTMLElement, initial: { scrollHeight: number; clientHeight: number }) {
  let height = initial.scrollHeight;
  let top = 0;
  Object.defineProperties(log, {
    scrollHeight: { configurable: true, get: () => height },
    clientHeight: { configurable: true, get: () => initial.clientHeight },
    scrollTop: {
      configurable: true,
      get: () => top,
      set: (value: number) => { top = Math.max(0, Math.min(value, height - initial.clientHeight)); },
    },
  });
  return {
    setHeight: (value: number) => { height = value; },
    setTop: (value: number) => { top = value; },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("回到最新按钮", () => {
  it("无溢出或处于底部时隐藏，离底超过容差时显示，手动到底后隐藏", async () => {
    render(<Harness />);
    const log = screen.getByTestId("log");
    let height = 400;
    Object.defineProperties(log, {
      scrollHeight: { configurable: true, get: () => height },
      clientHeight: { configurable: true, value: 500 },
    });
    fireEvent.scroll(log);
    expect(screen.queryByRole("button", { name: "回到最新" })).toBeNull();
    height = 1000;
    log.scrollTop = 499.5;
    fireEvent.scroll(log);
    expect(screen.queryByRole("button", { name: "回到最新" })).toBeNull();
    log.scrollTop = 490;
    fireEvent.scroll(log);
    expect(screen.getByRole("button", { name: "回到最新" })).toBeTruthy();
    log.scrollTop = 500;
    fireEvent.scroll(log);
    expect(screen.queryByRole("button", { name: "回到最新" })).toBeNull();
  });

  it("内容或视口尺寸改变时重新判断，空态隐藏并清理监听", async () => {
    let resize = () => {};
    const observe = vi.fn();
    const disconnect = vi.fn();
    vi.stubGlobal("ResizeObserver", class {
      constructor(callback: () => void) { resize = callback; }
      observe = observe;
      disconnect = disconnect;
    });
    const { rerender } = render(<Harness />);
    const log = screen.getByTestId("log");
    let height = 500;
    Object.defineProperties(log, {
      scrollHeight: { configurable: true, get: () => height },
      clientHeight: { configurable: true, value: 500 },
    });
    expect(observe).toHaveBeenCalledWith(log);
    expect(observe).toHaveBeenCalledWith(screen.getByTestId("track"));
    height = 1200;
    resize();
    await screen.findByRole("button", { name: "回到最新" });
    height = 500;
    resize();
    await waitFor(() => expect(screen.queryByRole("button", { name: "回到最新" })).toBeNull());
    height = 1200;
    resize();
    await screen.findByRole("button", { name: "回到最新" });
    rerender(<Harness enabled={false} />);
    expect(screen.queryByRole("button", { name: "回到最新" })).toBeNull();
    expect(disconnect).toHaveBeenCalled();
  });

  // 报障:滚动条已在最底部,回到最新的图标还在。
  // 贴底后 Chromium 的取整误差会留下 1~2px 残差,门槛太紧就会误判离底。
  it("贴底时按容差判定,不因取整误差亮着", async () => {
    render(<Harness />);
    const log = screen.getByTestId("log");
    const geo = stubGeometry(log, { scrollHeight: 1000, clientHeight: 500 });
    geo.setTop(500);          // 正好贴底
    fireEvent.scroll(log);
    expect(screen.queryByRole("button", { name: "回到最新" })).toBeNull();
    geo.setTop(497.5);        // 取整误差量级的残差
    fireEvent.scroll(log);
    expect(screen.queryByRole("button", { name: "回到最新" })).toBeNull();
    geo.setTop(480);          // 真正离底
    fireEvent.scroll(log);
    expect(screen.getByRole("button", { name: "回到最新" })).toBeTruthy();
    geo.setTop(500);
    fireEvent.scroll(log);
    expect(screen.queryByRole("button", { name: "回到最新" })).toBeNull();
  });

  // 报障同款:几何变了却既没滚动也没尺寸变化(虚拟窗口滑动、浏览器 clamp),
  // 按钮会卡在亮着的陈旧状态。
  it("无事件的几何变化后靠复查收敛到贴底并隐藏", async () => {
    vi.useFakeTimers();
    try {
      render(<Harness />);
      const log = screen.getByTestId("log");
      const geo = stubGeometry(log, { scrollHeight: 1000, clientHeight: 500 });
      geo.setTop(100);
      fireEvent.scroll(log);
      expect(screen.getByRole("button", { name: "回到最新" })).toBeTruthy();

      // 只改几何,不发 scroll、不触发 RO
      geo.setTop(500);
      await act(async () => { await vi.advanceTimersByTimeAsync(200); });
      expect(screen.queryByRole("button", { name: "回到最新" })).toBeNull();

      // 再离底,同样没有事件
      geo.setTop(200);
      await act(async () => { await vi.advanceTimersByTimeAsync(200); });
      expect(screen.getByRole("button", { name: "回到最新" })).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("点击后立即隐藏,父层未贴底时由后续测量恢复显示", async () => {
    const clicked = vi.fn();
    function ClickHarness() {
      const scrollRef = useRef<HTMLDivElement>(null);
      return (
        <div>
          <div ref={scrollRef} data-testid="log"><div /></div>
          <JumpToLatest scrollRef={scrollRef} sessionId="test" enabled onClick={clicked} />
        </div>
      );
    }
    render(<ClickHarness />);
    const log = screen.getByTestId("log");
    const geo = stubGeometry(log, { scrollHeight: 1000, clientHeight: 500 });
    geo.setTop(100);
    fireEvent.scroll(log);
    const button = await screen.findByRole("button", { name: "回到最新" });
    fireEvent.click(button);
    expect(clicked).toHaveBeenCalled();
    // 父层把 scrollTop 写到贴底
    geo.setTop(500);
    fireEvent.scroll(log);
    expect(screen.queryByRole("button", { name: "回到最新" })).toBeNull();
  });
});
