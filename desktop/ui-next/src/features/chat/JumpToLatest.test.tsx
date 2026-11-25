import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

afterEach(() => vi.unstubAllGlobals());

describe("回到最新按钮", () => {
  it("无溢出或处于底部时隐藏，离底超过像素误差时显示，手动到底后隐藏", async () => {
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
    log.scrollTop = 498;
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
});
