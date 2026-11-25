import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  initializeStoredBackground,
  installBackground,
  resetBackgroundRuntimeForTest,
  setCustomBackgroundEnabledForTest,
} from "@/lib/background";
import { setLocale } from "@/lib/i18n";
import type { BackgroundAsset } from "@/lib/ipc/background";
import type { DesktopConfig } from "@/lib/ipc/config";
import { resetEscLayersForTest } from "@/lib/util/escLayer";
import { SettingsView, type SettingsViewHandle } from "./SettingsView";

/** Esc = 走 escLayer 的 window capture 单一监听(层栈按后进先出派发)。 */
const pressEsc = () =>
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  });

afterEach(() => {
  resetEscLayersForTest(); // 模块级层栈跨用例会串
  resetBackgroundRuntimeForTest();
  localStorage.clear();
  delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
  // UA 覆写(WSL 条件渲染用)按实例属性打的,删掉即回落 jsdom 原型 getter
  Reflect.deleteProperty(window.navigator, "userAgent");
  vi.unstubAllGlobals();
});

const baseConfig: DesktopConfig = {
  models: [
    { name: "主力", provider: "anthropic", base_url: "https://a", api_key: "k1", model: "claude", default: true },
    { name: "备用", provider: "openai", base_url: "https://b", api_key: "k2", model: "gpt", default: false },
  ],
  mcp_servers: { fetch: { url: "https://mcp" } },
  kernel_env: "",
  mc_base_url: "https://mc.example",
};

function stubShell(opts?: {
  config?: DesktopConfig;
  sound?: boolean;
  distros?: string[];
  save?: () => Promise<unknown>;
  /** 额外命令(账号分区的 baizhi/mc 系列等),优先于内置分支 */
  extra?: Record<string, () => unknown>;
}) {
  const calls: Array<{ cmd: string; args?: Record<string, unknown> }> = [];
  const listeners: Record<string, (e: { payload: unknown }) => void> = {};
  (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {
    core: {
      invoke: (cmd: string, args?: Record<string, unknown>) => {
        calls.push({ cmd, args });
        if (opts?.extra && cmd in opts.extra) return Promise.resolve(opts.extra[cmd]!());
        switch (cmd) {
          case "get_config":
            return Promise.resolve(structuredClone(opts?.config ?? baseConfig));
          case "sound_enabled":
            return Promise.resolve(opts?.sound ?? true);
          case "list_wsl_distros":
            return Promise.resolve(opts?.distros ?? []);
          case "host_info":
            return Promise.resolve({ version: "26080101", engine_version: "0.9.0" });
          case "save_config":
            return (opts?.save ?? (() => Promise.resolve(null)))();
          default:
            return Promise.resolve(null);
        }
      },
    },
    event: {
      listen: (name: string, cb: (e: { payload: unknown }) => void) => {
        listeners[name] = cb;
        return Promise.resolve(() => {});
      },
    },
  };
  return { calls, listeners };
}

const windowsUA = () =>
  Object.defineProperty(window.navigator, "userAgent", {
    value: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    configurable: true,
  });

const openModels = async () => {
  await userEvent.click(screen.getByRole("button", { name: "模型" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "主力" })).toBeDefined());
};

describe("设置视图:导航与载入", () => {
  it("非 Windows:导航为 通用/模型/MCP/关于,无「运行环境」;模型列表载入", async () => {
    stubShell();
    render(<SettingsView onClose={() => {}} />);
    for (const label of ["通用", "模型", "MCP", "关于"]) {
      expect(screen.getByRole("button", { name: label })).toBeDefined();
    }
    expect(screen.queryByRole("button", { name: "运行环境" })).toBeNull();
    await openModels();
    expect(screen.getByRole("button", { name: "备用" })).toBeDefined();
    expect(screen.getByText("默认")).toBeDefined(); // 主力行的默认徽标
  });

  it("关闭按钮回调 onClose", async () => {
    stubShell();
    const onClose = vi.fn();
    render(<SettingsView onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("浏览器模式:模型分区降级为只读提示,不渲染保存条", async () => {
    render(<SettingsView onClose={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "模型" }));
    expect(screen.getByRole("alert").textContent).toContain("浏览器模式下配置只读");
    expect(screen.queryByRole("button", { name: "保存" })).toBeNull();
  });
});

describe("Esc 分层与离开守卫", () => {
  it("开着主题下拉按 Esc:只关下拉,设置页不退(层栈后进先出,不再是注册时序说了算)", async () => {
    stubShell();
    const onClose = vi.fn();
    render(<SettingsView onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: "通用" }));
    await userEvent.click(screen.getByRole("button", { name: "外观主题" }));
    expect(screen.getByRole("listbox", { name: "外观主题" })).toBeDefined();

    pressEsc();
    expect(screen.queryByRole("listbox", { name: "外观主题" })).toBeNull();
    expect(onClose).not.toHaveBeenCalled(); // 此前视图层先注册,一按就把整页关了

    pressEsc(); // 下拉已收,这下才轮到视图层(表单干净 → 直接退出)
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("脏表单上 Esc/关闭:先问一句;「留在设置」不退,「放弃并离开」才退", async () => {
    stubShell();
    const onClose = vi.fn();
    render(<SettingsView onClose={onClose} />);
    await openModels();
    await userEvent.click(screen.getByRole("button", { name: "备用的更多操作" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "设为默认" }));

    await userEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(await screen.findByRole("dialog", { name: "有未保存的更改" })).toBeDefined();
    expect(onClose).not.toHaveBeenCalled();

    // 弹层里的 Esc = 取消离开:它自占一层,不会穿回视图层再把设置页关掉
    pressEsc();
    expect(screen.queryByRole("dialog", { name: "有未保存的更改" })).toBeNull();
    expect(onClose).not.toHaveBeenCalled();

    pressEsc(); // 焦点已不在输入框(上一步点了「关闭」),这下走视图层
    await userEvent.click(await screen.findByRole("button", { name: "留在设置" }));
    expect(onClose).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "关闭" }));
    await userEvent.click(await screen.findByRole("button", { name: "放弃并离开" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("表单干净时 Esc/关闭直接退出,不拿弹层烦人", async () => {
    stubShell();
    const onClose = vi.fn();
    render(<SettingsView onClose={onClose} />);
    await openModels();
    pressEsc();
    expect(screen.queryByRole("dialog", { name: "有未保存的更改" })).toBeNull();
    expect(screen.getByRole("dialog", { name: "设置" }).getAttribute("aria-modal")).toBe("true");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("外部跳转关闭也经过脏状态守卫，确认后才执行后续动作", async () => {
    stubShell();
    const ref = createRef<SettingsViewHandle>();
    const onClose = vi.fn();
    const afterApproved = vi.fn();
    render(<SettingsView ref={ref} onClose={onClose} />);
    await openModels();
    await userEvent.click(screen.getByRole("button", { name: "备用的更多操作" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "设为默认" }));

    await act(async () => ref.current?.requestClose(afterApproved));
    expect(await screen.findByRole("dialog", { name: "有未保存的更改" })).toBeDefined();
    expect(onClose).not.toHaveBeenCalled();
    expect(afterApproved).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "放弃并离开" }));
    expect(onClose).toHaveBeenCalledWith(false);
    expect(afterApproved).toHaveBeenCalledTimes(1);
  });

  it("从模态外发起跳转后选择留在设置，焦点回到设置内部", async () => {
    stubShell();
    const ref = createRef<SettingsViewHandle>();
    render(
      <>
        <SettingsView ref={ref} onClose={() => {}} />
        <button type="button">外部通知</button>
      </>,
    );
    await openModels();
    await userEvent.click(screen.getByRole("button", { name: "备用的更多操作" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "设为默认" }));
    await userEvent.click(screen.getByRole("button", { name: "外部通知" }));

    await act(async () => ref.current?.requestClose(() => {}));
    await userEvent.click(await screen.findByRole("button", { name: "留在设置" }));

    const dialog = screen.getByRole("dialog", { name: "设置" });
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "关闭" }));
  });

  it("radio 组中的未选项不会让 Tab 焦点越出设置模态", async () => {
    stubShell({ config: { ...baseConfig, mc_base_url: "" } });
    render(
      <>
        <SettingsView onClose={() => {}} />
        <button type="button">模态外按钮</button>
      </>,
    );
    await userEvent.click(screen.getByRole("button", { name: "通用" }));
    const dialog = screen.getByRole("dialog", { name: "设置" });

    for (let i = 0; i < 40; i += 1) {
      await userEvent.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
    expect(document.activeElement).not.toBe(screen.getByRole("button", { name: "模态外按钮" }));
  });
});

describe("脏状态机与保存条", () => {
  it("载入即收敛同名模型:重名不再把整份配置的保存永久拦死", async () => {
    // 历史版本/手工编辑落盘的同名存量(这里两条都叫「主力」)。载入不收敛的话
    // validateDraft 恒报 modelDup,save() 见错即 return —— 改 kernel_env、加
    // MCP、加模型……什么都存不下去,而重名的那条在引擎侧本来就是静默失效的
    const { calls } = stubShell({
      config: {
        ...baseConfig,
        models: [
          { name: "主力", provider: "anthropic", base_url: "https://a", api_key: "k1", model: "old", default: true },
          { name: "主力", provider: "anthropic", base_url: "https://a", api_key: "k1", model: "new" },
        ],
      },
    });
    render(<SettingsView onClose={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "MCP" }));
    await userEvent.click(await screen.findByRole("button", { name: "添加 MCP" }));
    await userEvent.type(screen.getByRole("textbox", { name: "名称" }), "files");
    await userEvent.type(screen.getByRole("textbox", { name: "URL" }), "https://x");
    await userEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(calls.some((c) => c.cmd === "save_config")).toBe(true));
    expect(screen.queryByText(/模型名称重复/)).toBeNull();
    const saved = calls.find((c) => c.cmd === "save_config")?.args?.config as DesktopConfig;
    // 收敛为一条:后者内容胜出(与引擎按名字建 Map 的物化行为一致)
    expect(saved.models.map((m) => [m.name, m.model])).toEqual([["主力", "new"]]);
    expect(saved.mcp_servers).toMatchObject({ files: { url: "https://x" } });
  });

});

describe("MCP 编辑(与模型同一份脏状态)", () => {
  it("添加 stdio 条目:命令/参数/环境变量序列化进 mcp_servers", async () => {
    const { calls } = stubShell();
    render(<SettingsView onClose={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "MCP" }));
    await waitFor(() => expect(screen.getByRole("button", { name: /fetch/ })).toBeDefined());
    await userEvent.click(screen.getByRole("button", { name: "添加 MCP" }));
    await userEvent.type(screen.getByRole("textbox", { name: "名称" }), "files");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "类型" }), "stdio");
    await userEvent.type(screen.getByRole("textbox", { name: "命令" }), "npx");
    await userEvent.type(screen.getByRole("textbox", { name: "参数(空格分隔)" }), "-y srv");
    await userEvent.type(screen.getByRole("textbox", { name: /环境变量/ }), "HOME=/h");
    await userEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(calls.some((c) => c.cmd === "save_config")).toBe(true));
    const servers = (calls.find((c) => c.cmd === "save_config")?.args?.config as DesktopConfig).mcp_servers;
    expect(servers).toEqual({
      fetch: { url: "https://mcp" },
      files: { command: "npx", args: ["-y", "srv"], env: { HOME: "/h" } },
    });
  });

  // 停用真值 = extra.disabled,壳按它过滤派生 mcp.json(config.rs 物化处):
  // 没有开关也没有徽标时,被早先版本停用过的 server 看着和正常条目一模一样,
  // 工具却永远不装载,只能手改 config.json
  it("停用:行上出「已停用」徽标,extra.disabled 进载荷", async () => {
    const { calls } = stubShell();
    render(<SettingsView onClose={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "MCP" }));
    await waitFor(() => expect(screen.getByRole("button", { name: /fetch/ })).toBeDefined());
    expect(screen.queryByText("已停用")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "停用" }));
    expect(screen.getByText("已停用")).toBeDefined();
    await userEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(calls.some((c) => c.cmd === "save_config")).toBe(true));
    expect((calls.find((c) => c.cmd === "save_config")?.args?.config as DesktopConfig).mcp_servers).toEqual({
      fetch: { disabled: true, url: "https://mcp", headers: undefined },
    });
  });

  it("既有停用条目:载入即外显,可就地启用(disabled 键随之消失)", async () => {
    const { calls } = stubShell({
      config: { ...baseConfig, mcp_servers: { fetch: { url: "https://mcp", disabled: true } } },
    });
    render(<SettingsView onClose={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "MCP" }));
    expect(await screen.findByText("已停用")).toBeDefined();

    await userEvent.click(screen.getByRole("button", { name: "启用" }));
    expect(screen.queryByText("已停用")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(calls.some((c) => c.cmd === "save_config")).toBe(true));
    expect((calls.find((c) => c.cmd === "save_config")?.args?.config as DesktopConfig).mcp_servers).toEqual({
      fetch: { url: "https://mcp", headers: undefined },
    });
  });
});

describe("界面缩放", () => {
  it("通用页四档点即生效:落 localStorage 并调 WebView setZoom,不进保存条", async () => {
    stubShell();
    const setZoom = vi.fn(() => Promise.resolve());
    (window as unknown as { __TAURI__: { webview?: unknown } }).__TAURI__.webview = {
      getCurrentWebview: () => ({ setZoom }),
    };
    render(<SettingsView onClose={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "通用" }));

    const scale110 = screen.getByRole("radio", { name: "110%" }) as HTMLInputElement;
    await userEvent.click(scale110);
    expect(scale110.checked).toBe(true);
    expect(setZoom).toHaveBeenCalledWith(1.1);
    expect(localStorage.getItem("mc.uiScale")).toBe("1.1");
    // 点即生效偏好,不弄脏表单
    expect(screen.queryByText(/有未保存的修改/)).toBeNull();
  });

  it("缩放档是原生 radio group,方向键可切换", async () => {
    stubShell();
    render(<SettingsView onClose={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "通用" }));
    const scale100 = screen.getByRole("radio", { name: "100%" }) as HTMLInputElement;
    // user-event 的 radio 方向键实现用 CSS.escape；jsdom 未提供该浏览器 API。
    vi.stubGlobal("CSS", { escape: (value: string) => value });
    scale100.focus();
    await userEvent.keyboard("{ArrowRight}");
    expect((screen.getByRole("radio", { name: "110%" }) as HTMLInputElement).checked).toBe(true);
  });
});

describe("提示音双向同步", () => {
  it("初值来自 sound_enabled;切换发 set_sound_enabled;壳广播回来盖一次", async () => {
    const { calls, listeners } = stubShell({ sound: false });
    render(<SettingsView onClose={() => {}} />);
    // 初始分区是「账号」,先切到通用
    await userEvent.click(screen.getByRole("button", { name: "通用" }));
    const toggle = () => screen.getByRole("checkbox", { name: "事件提示音" }) as HTMLInputElement;
    await waitFor(() => expect(toggle().checked).toBe(false));

    await userEvent.click(toggle());
    expect(toggle().checked).toBe(true); // 乐观置位
    expect(calls.some((c) => c.cmd === "set_sound_enabled" && c.args?.enabled === true)).toBe(true);

    // 托盘那头把它关了:sound-enabled 广播驱动设置页跟上
    act(() => listeners["sound-enabled"]?.({ payload: false }));
    expect(toggle().checked).toBe(false);
  });
});

describe("运行环境(仅 Windows 壳)", () => {
  it("Windows:导航含「运行环境」,WSL 发行版进下拉,选择后走保存条", async () => {
    windowsUA();
    const { calls } = stubShell({ distros: ["Ubuntu"] });
    render(<SettingsView onClose={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "运行环境" }));
    const select = await screen.findByRole("combobox", { name: "内核运行环境" });
    expect(screen.getByRole("option", { name: "本机(Windows)" })).toBeDefined();
    await waitFor(() => expect(screen.getByRole("option", { name: "WSL · Ubuntu" })).toBeDefined());

    await userEvent.selectOptions(select, "wsl:Ubuntu");
    await userEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(calls.some((c) => c.cmd === "save_config")).toBe(true));
    const payload = calls.find((c) => c.cmd === "save_config")?.args?.config as DesktopConfig;
    expect(payload.kernel_env).toBe("wsl:Ubuntu");
  });

  it("记忆的发行版已卸载:保留为「未检测到」选项,不静默改值", async () => {
    windowsUA();
    stubShell({ config: { ...baseConfig, kernel_env: "wsl:Gone" }, distros: ["Ubuntu"] });
    render(<SettingsView onClose={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "运行环境" }));
    const select = await screen.findByRole("combobox", { name: "内核运行环境" });
    await waitFor(() => expect((select as HTMLSelectElement).value).toBe("wsl:Gone"));
    expect(screen.getByRole("option", { name: /Gone.*未检测到/ })).toBeDefined();
    expect(screen.queryByRole("button", { name: "保存" })).toBeNull(); // 载入不置脏
  });

  it("记忆的发行版已卸载:页面上出告警(引擎起不来,不能只在收起的下拉里缀一句)", async () => {
    windowsUA();
    stubShell({ config: { ...baseConfig, kernel_env: "wsl:Gone" }, distros: ["Ubuntu"] });
    render(<SettingsView onClose={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "运行环境" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("未检测到发行版 Gone");
    expect(alert.textContent).toContain("引擎将无法启动");

    // 切回本机后告警消失
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "内核运行环境" }), "");
    expect(screen.queryByText(/未检测到发行版/)).toBeNull();
  });
});

describe("布局契约", () => {
  it("左侧导航 menu 解除 daisyUI 的 column wrap(LAYOUT §6.2 截断铁律)", () => {
    stubShell();
    render(<SettingsView onClose={() => {}} />);
    // .menu 与 .menu li 都默认 flex-flow: column wrap,不解除的话行宽跟内容
    // 走,行内 truncate 链永不触发
    const menu = screen.getByRole("navigation", { name: "设置" }).querySelector("ul.menu")!;
    expect(menu.className).toContain("flex-nowrap");
    expect(menu.className).toContain("[&_li]:flex-nowrap");
  });
});

describe("外观设置:自定义背景入口", () => {
  it("功能关闭时隐藏入口，连续点击主题标签五次后临时解锁", async () => {
    setCustomBackgroundEnabledForTest(false);
    stubShell();
    render(<SettingsView onClose={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "通用" }));
    const hiddenTrigger = document.querySelector<HTMLElement>("[data-background-unlock]")!;
    for (let i = 0; i < 4; i += 1) await userEvent.click(hiddenTrigger);
    expect(screen.queryByRole("button", { name: "选择图片" })).toBeNull();
    await userEvent.click(hiddenTrigger);
    expect(await screen.findByRole("button", { name: "选择图片" })).toBeDefined();
  });
});

describe("外观设置:自定义背景内部编辑器", () => {
  beforeEach(() => setCustomBackgroundEnabledForTest(true));

  const backgroundAsset: BackgroundAsset = {
    revision: "a".repeat(64),
    originalName: "wall.png",
    mime: "image/png",
    width: 1920,
    height: 1080,
    dataUrl: "data:image/png;base64,AA==",
  };
  const stagedBackgroundAsset = { ...backgroundAsset, stagedId: "stage-a" };

  const stubImageDecode = () =>
    vi.stubGlobal(
      "Image",
      class {
        src = "";
        decode = () => Promise.resolve();
      },
    );

  it("浏览器模式不展示桌面专属背景设置", async () => {
    render(<SettingsView onClose={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "通用" }));
    expect(screen.queryByRole("button", { name: "选择图片" })).toBeNull();
    const dialogBox = screen.getByRole("dialog", { name: "设置" }).querySelector(".modal-box") as HTMLElement;
    expect(dialogBox.className).toContain("bg-base-100");
    expect(dialogBox.className).not.toContain("mc-workbench-surface");
  });

  it("无图片时保留参数值但禁用调节控件", async () => {
    localStorage.setItem(
      "mc.backgroundPreferences",
      JSON.stringify({ version: 1, surfaceOpacity: 0.72, blurPx: 6, fit: "contain" }),
    );
    stubShell();
    render(<SettingsView onClose={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "通用" }));
    expect((screen.getByRole("slider", { name: "内容背景不透明度" }) as HTMLInputElement).value).toBe("72");
    expect((screen.getByRole("slider", { name: "内容背景不透明度" }) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole("slider", { name: "图片模糊" }) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole("radio", { name: "适应" }) as HTMLInputElement).disabled).toBe(true);
  });

  it("选择有效图片后显示预览与尺寸；调节即时生效、不进入引擎保存条", async () => {
    stubImageDecode();
    const { calls } = stubShell({
      extra: {
        "plugin:dialog|open": () => "/tmp/wall.png",
        background_import: () => stagedBackgroundAsset,
        background_confirm: () => null,
      },
    });
    render(<SettingsView onClose={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "通用" }));
    await userEvent.click(screen.getByRole("button", { name: "选择图片" }));
    expect((await screen.findByRole("img", { name: "自定义背景预览" })).getAttribute("src")).toBe(backgroundAsset.dataUrl);
    expect(screen.getByText("wall.png")).toBeDefined();
    expect(screen.getByText("1920 × 1080 px")).toBeDefined();

    fireEvent.change(screen.getByRole("slider", { name: "内容背景不透明度" }), { target: { value: "59" } });
    expect(document.documentElement.style.getPropertyValue("--mc-surface-opacity")).toBe("59%");
    expect(screen.getByRole("status").textContent).toContain("可读性");
    fireEvent.change(screen.getByRole("slider", { name: "图片模糊" }), { target: { value: "7" } });
    expect(document.documentElement.style.getPropertyValue("--mc-background-blur")).toBe("7px");
    await userEvent.click(screen.getByRole("radio", { name: "平铺" }));
    expect(document.documentElement.style.getPropertyValue("--mc-background-repeat")).toBe("repeat");
    expect(screen.queryByRole("button", { name: "保存" })).toBeNull();
    expect(calls.some((call) => call.cmd === "save_config")).toBe(false);
    const importCall = calls.find((call) => call.cmd === "background_import")!;
    const confirmCall = calls.find((call) => call.cmd === "background_confirm")!;
    expect(importCall.args?.ownerToken).toMatch(/^[0-9a-f]{64}$/);
    expect(confirmCall.args).toEqual({
      stagedId: importCall.args?.stagedId,
      ownerToken: importCall.args?.ownerToken,
    });
  });

  it("更换导入失败保留旧预览并显示 alert；清除失败同样保留", async () => {
    stubImageDecode();
    await installBackground(backgroundAsset);
    const { calls } = stubShell({
      extra: {
        "plugin:dialog|open": () => "/tmp/bad.png",
        background_import: () => {
          throw new Error("图片超过 20 MiB");
        },
        background_clear: () => {
          throw new Error("磁盘拒绝删除");
        },
        background_read: () => backgroundAsset,
      },
    });
    render(<SettingsView onClose={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "通用" }));
    await userEvent.click(screen.getByRole("button", { name: "更换图片" }));
    expect((await screen.findByRole("alert")).textContent).toContain("20 MiB");
    expect(screen.getByRole("img", { name: "自定义背景预览" }).getAttribute("src")).toBe(backgroundAsset.dataUrl);

    await userEvent.click(screen.getByRole("button", { name: "清除图片" }));
    expect((await screen.findByRole("alert")).textContent).toContain("磁盘拒绝删除");
    expect(screen.getByRole("img", { name: "自定义背景预览" }).getAttribute("src")).toBe(backgroundAsset.dataUrl);
    expect(calls.some((call) => call.cmd === "background_clear")).toBe(true);
  });

  it("导入已落盘但 IPC 响应丢失时仍用调用前 ID 与 owner token 重试 discard", async () => {
    let discardAttempts = 0;
    const { calls } = stubShell({
      extra: {
        "plugin:dialog|open": () => "/tmp/response-lost.png",
        background_import: () => {
          throw new Error("IPC response lost");
        },
        background_discard: () => {
          discardAttempts += 1;
          if (discardAttempts === 1) throw new Error("temporary discard failure");
          return null;
        },
      },
    });
    render(<SettingsView onClose={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "通用" }));
    await userEvent.click(screen.getByRole("button", { name: "选择图片" }));

    expect((await screen.findByRole("alert")).textContent).toContain("IPC response lost");
    const importCall = calls.find((call) => call.cmd === "background_import")!;
    const stagedId = String(importCall.args?.stagedId);
    const ownerToken = String(importCall.args?.ownerToken);
    expect(stagedId).toMatch(/^[A-Za-z0-9-]{1,160}$/);
    expect(ownerToken).toMatch(/^[0-9a-f]{64}$/);
    expect(importCall.args).toEqual({ path: "/tmp/response-lost.png", stagedId, ownerToken });
    const discards = calls.filter((call) => call.cmd === "background_discard");
    expect(discards).toHaveLength(2);
    expect(discards.every((call) => call.args?.stagedId === stagedId && call.args?.ownerToken === ownerToken)).toBe(true);
  });

  it("清除成功恢复无背景外观，偏好值仍保留并转为禁用", async () => {
    stubImageDecode();
    await installBackground(backgroundAsset);
    stubShell({ extra: { background_clear: () => null } });
    render(<SettingsView onClose={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "通用" }));
    await userEvent.click(screen.getByRole("button", { name: "清除图片" }));
    await waitFor(() => expect(screen.queryByRole("img", { name: "自定义背景预览" })).toBeNull());
    expect(document.documentElement.dataset.mcBackground).toBeUndefined();
    expect((screen.getByRole("slider", { name: "内容背景不透明度" }) as HTMLInputElement).disabled).toBe(true);
  });

  it("WebView 解码失败会丢弃 staged 导入，不确认磁盘事务且保留旧背景", async () => {
    stubImageDecode();
    await installBackground(backgroundAsset);
    let decodeCalls = 0;
    vi.stubGlobal(
      "Image",
      class {
        src = "";
        decode = () => decodeCalls++ === 0 ? Promise.reject(new Error("codec rejected")) : Promise.resolve();
      },
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { calls } = stubShell({
      extra: {
        "plugin:dialog|open": () => "/tmp/new.png",
        background_import: () => ({ ...stagedBackgroundAsset, stagedId: "decode-failed" }),
        background_discard: () => {
          throw new Error("discard unavailable");
        },
        background_read: () => backgroundAsset,
      },
    });
    render(<SettingsView onClose={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "通用" }));
    await userEvent.click(screen.getByRole("button", { name: "更换图片" }));

    expect((await screen.findByRole("alert")).textContent).toContain("codec rejected");
    expect(screen.getByRole("img", { name: "自定义背景预览" }).getAttribute("src")).toBe(backgroundAsset.dataUrl);
    expect(calls.filter((call) => call.cmd === "background_discard")).toHaveLength(2);
    expect(calls.some((call) => call.cmd === "background_confirm")).toBe(false);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("pending TTL"),
      expect.objectContaining({ stagedId: expect.stringMatching(/^[A-Za-z0-9-]{1,160}$/) }),
    );
  });

  it("跨组件重挂后旧 choose 不能覆盖后发 clear，且后端资产操作保持同序", async () => {
    stubImageDecode();
    await installBackground(backgroundAsset);
    let resolveImport!: (asset: typeof stagedBackgroundAsset) => void;
    const pendingImport = new Promise<typeof stagedBackgroundAsset>((resolve) => {
      resolveImport = resolve;
    });
    const { calls } = stubShell({
      extra: {
        "plugin:dialog|open": () => "/tmp/new.png",
        background_import: () => pendingImport,
        background_discard: () => null,
        background_clear: () => null,
      },
    });
    render(<SettingsView onClose={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "通用" }));
    await userEvent.click(screen.getByRole("button", { name: "更换图片" }));
    await waitFor(() => expect(calls.some((call) => call.cmd === "background_import")).toBe(true));

    await userEvent.click(screen.getByRole("button", { name: "模型" }));
    await userEvent.click(screen.getByRole("button", { name: "通用" }));
    await userEvent.click(screen.getByRole("button", { name: "清除图片" }));
    await act(async () => resolveImport(stagedBackgroundAsset));

    await waitFor(() => expect(screen.queryByRole("img", { name: "自定义背景预览" })).toBeNull());
    expect(calls.some((call) => call.cmd === "background_confirm")).toBe(false);
    const discardIndex = calls.findIndex((call) => call.cmd === "background_discard");
    const clearIndex = calls.findIndex((call) => call.cmd === "background_clear");
    expect(discardIndex).toBeGreaterThan(-1);
    expect(clearIndex).toBeGreaterThan(discardIndex);
  });

  it("旧 choose 已提交但后发 clear 失败时，从 Rust current 恢复而不保留旧 UI", async () => {
    stubImageDecode();
    await installBackground(backgroundAsset);
    const nextAsset = {
      ...backgroundAsset,
      revision: "b".repeat(64),
      originalName: "next.png",
      dataUrl: "data:image/png;base64,BB==",
    };
    let current: BackgroundAsset | null = backgroundAsset;
    let commitConfirm!: () => void;
    const { calls } = stubShell({
      extra: {
        "plugin:dialog|open": () => "/tmp/next.png",
        background_import: () => ({ ...nextAsset, stagedId: "stage-next" }),
        background_confirm: () => new Promise<void>((resolve) => {
          commitConfirm = () => {
            current = nextAsset;
            resolve();
          };
        }),
        background_clear: () => {
          throw new Error("clear response failed");
        },
        background_read: () => current,
      },
    });
    render(<SettingsView onClose={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "通用" }));
    await userEvent.click(screen.getByRole("button", { name: "更换图片" }));
    await waitFor(() => expect(calls.some((call) => call.cmd === "background_confirm")).toBe(true));

    await userEvent.click(screen.getByRole("button", { name: "模型" }));
    await userEvent.click(screen.getByRole("button", { name: "通用" }));
    await userEvent.click(screen.getByRole("button", { name: "清除图片" }));
    expect(calls.some((call) => call.cmd === "background_clear")).toBe(false);
    await act(async () => commitConfirm());

    expect((await screen.findByRole("alert")).textContent).toContain("clear response failed");
    expect(screen.getByRole("img", { name: "自定义背景预览" }).getAttribute("src")).toBe(nextAsset.dataUrl);
    expect(screen.getByText("next.png")).toBeDefined();
    const confirmIndex = calls.findIndex((call) => call.cmd === "background_confirm");
    const clearIndex = calls.findIndex((call) => call.cmd === "background_clear");
    const readIndex = calls.findIndex((call) => call.cmd === "background_read");
    expect(clearIndex).toBeGreaterThan(confirmIndex);
    expect(readIndex).toBeGreaterThan(clearIndex);
  });

  it("英文界面用 i18n 前缀呈现结构化启动错误，不泄露硬编码中文 UI 文案", async () => {
    localStorage.setItem("mc.backgroundAssetPresent", "1");
    (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {
      core: { invoke: () => Promise.reject(new Error("codec E42")) },
    };
    await initializeStoredBackground();
    stubShell();
    setLocale("en");
    const view = render(<SettingsView onClose={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "General" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Saved background unavailable: codec E42");
    expect(alert.textContent).not.toContain("已保存的背景不可用");
    view.unmount();
    setLocale("zh-CN");
  });
});
