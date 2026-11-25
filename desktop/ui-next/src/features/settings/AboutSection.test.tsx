import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { resetUpdateForTest, checkUpdateNow } from "@/features/update/useUpdate";
import { AboutSection } from "./AboutSection";

afterEach(() => {
  // 共享更新态是模块级 store,跨用例需复位
  resetUpdateForTest();
  delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
});

function stubShell({ exportLog }: { exportLog?: () => unknown } = {}) {
  const calls: string[] = [];
  (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {
    core: {
      invoke: (cmd: string) => {
        calls.push(cmd);
        if (cmd === "host_info") return Promise.resolve({ version: "26.11.25.01", engine_version: "0.9" });
        if (cmd === "update_check") return Promise.resolve({ available: true, current: "1.0", latest: "1.1" });
        if (cmd === "update_install") return new Promise(() => {}); // 成功:壳自行重启,不返回
        if (cmd === "export_engine_log" && exportLog) {
          try {
            return Promise.resolve(exportLog());
          } catch (e) {
            return Promise.reject(e);
          }
        }
        return Promise.resolve(null);
      },
    },
    event: { listen: () => Promise.resolve(() => {}) },
  };
  return { calls };
}

/** 隐藏排障入口的解锁手势:连点版本号 5 次。 */
async function unlock() {
  const version = await screen.findByRole("button", { name: /应用 26\.11\.25\.01/ });
  for (let i = 0; i < 5; i++) await userEvent.click(version);
}

describe("关于页不检查更新", () => {
  it("展示当日应用版本，不渲染检查或安装更新，不调用更新接口", async () => {
    const { calls } = stubShell();
    render(<AboutSection />);
    await screen.findByRole("button", { name: /应用 26\.11\.25\.01/ });
    expect(screen.queryByRole("button", { name: /检查更新|下载更新|更新中/ })).toBeNull();
    expect(calls).not.toContain("update_check");
    expect(calls).not.toContain("update_install");
  });

  it("共享更新状态已发现新版时仍不提供安装入口", async () => {
    const { calls } = stubShell();
    await checkUpdateNow();
    render(<AboutSection />);
    await screen.findByText(/应用 26\.11\.25\.01/);
    expect(screen.queryByRole("button", { name: /检查更新|下载更新/ })).toBeNull();
    expect(calls.filter((cmd) => cmd === "update_check")).toHaveLength(1);
    expect(calls).not.toContain("update_install");
  });
});
describe("隐藏排障入口(连点版本号解锁)", () => {
  // 「导出日志」= 一步拿到可直接附进工单的引擎日志副本(走另存对话框),
  // 与「打开存储目录 → 自己进 ohmyagent/logs/ 找文件」不是一回事;撤掉后
  // exportEngineLog 在整个 ui-next 里零调用者。按同一把解锁钥匙恢复
  it("解锁后可导出引擎日志:走 export_engine_log,成功给回执", async () => {
    const { calls } = stubShell({ exportLog: () => "/tmp/ohmyagent.log" });
    render(<AboutSection />);
    await unlock();
    await userEvent.click(screen.getByRole("button", { name: "导出日志" }));
    await waitFor(() => expect(calls).toContain("export_engine_log"));
    expect((await screen.findByRole("status")).textContent).toContain("日志已导出");
  });

  it("另存对话框被取消(壳回 null):不谎报成功;失败则外显壳的中文 Err", async () => {
    const failing = { on: false };
    stubShell({
      exportLog: () => {
        if (failing.on) throw new Error("引擎日志不存在");
        return null;
      },
    });
    render(<AboutSection />);
    await unlock();
    await userEvent.click(screen.getByRole("button", { name: "导出日志" }));
    expect(screen.queryByText("日志已导出")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();

    failing.on = true;
    await userEvent.click(screen.getByRole("button", { name: "导出日志" }));
    expect((await screen.findByRole("alert")).textContent).toContain("引擎日志不存在");
  });

  // 不解锁时一个排障入口都不占位;「打开扩展目录」是真撤了(常驻入口在
  // 设置·浏览器分区),解锁也不会出现
  it("常态没有更新动作:三个排障入口都不出现,打开扩展目录更是已撤", async () => {
    stubShell();
    render(<AboutSection />);
    await screen.findByText(/应用 26\.11\.25\.01/);
    expect(screen.queryByRole("button", { name: "重启引擎" })).toBeNull();
    expect(screen.queryByRole("button", { name: "导出日志" })).toBeNull();
    expect(screen.queryByRole("button", { name: "打开扩展目录" })).toBeNull();
    expect(screen.queryByRole("button", { name: "打开程序目录" })).toBeNull();
    expect(screen.queryByRole("button", { name: "打开存储目录" })).toBeNull();
  });

  it("连点版本号 5 次:两个入口现身,分别走 open_app_dir / open_log_dir", async () => {
    const { calls } = stubShell();
    render(<AboutSection />);
    const version = await screen.findByRole("button", { name: /应用 26\.11\.25\.01/ });
    for (let i = 0; i < 4; i++) await userEvent.click(version);
    expect(screen.queryByRole("button", { name: "打开程序目录" })).toBeNull(); // 差一次不解锁
    await userEvent.click(version);

    await userEvent.click(screen.getByRole("button", { name: "打开程序目录" }));
    await userEvent.click(screen.getByRole("button", { name: "打开存储目录" }));
    await waitFor(() => expect(calls).toContain("open_app_dir"));
    expect(calls).toContain("open_log_dir");
  });
});
