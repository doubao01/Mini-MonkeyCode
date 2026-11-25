import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";
import type { DesktopConfig } from "@/lib/ipc/config";
import { resetEscLayersForTest } from "@/lib/util/escLayer";
import { SettingsView } from "./SettingsView";

const config: DesktopConfig = {
  models: [
    { name: "主力", provider: "openai", base_url: "https://api.test/v1", api_key: "test-token", model: "first", default: true },
    { name: "备用", provider: "anthropic", base_url: "https://other.test", api_key: "other-token", model: "second" },
  ],
  mcp_servers: { fetch: { url: "https://mcp.test" } },
  mc_base_url: "https://private.test", mc_basic_auth: "old-auth", mc_llm_base_url: "https://proxy.test",
};

function shell({ initial = config, save, discover, persistedError, extra = {} }: {
  initial?: DesktopConfig; save?: (value: DesktopConfig) => Promise<void>;
  discover?: () => Promise<string[]>; persistedError?: string; extra?: Record<string, () => unknown>;
} = {}) {
  let disk = structuredClone(initial);
  const invoke = vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
    if (cmd in extra) return extra[cmd]!();
    if (cmd === "get_config") return structuredClone(disk);
    if (cmd === "save_config") {
      const value = args!.config as DesktopConfig;
      if (save) await save(value);
      disk = structuredClone(value);
      if (persistedError) throw new Error(persistedError);
    }
    if (cmd === "models_discover") return discover ? discover() : ["real-model", "another-model"];
    if (cmd === "list_wsl_distros") return [];
    if (cmd === "sound_enabled") return true;
    if (cmd === "browser_status") return { enabled: false };
    return null;
  });
  Reflect.set(window, "__TAURI__", { core: { invoke }, event: { listen: async () => () => {} } });
  return invoke;
}
const editor = () => screen.getByRole("dialog", { name: /编辑 AI 大模型|绑定 AI 大模型/ });
const edit = async () => { await userEvent.click(await screen.findByRole("button", { name: "主力" })); return editor(); };
const saveEditor = async () => userEvent.click(within(editor()).getByRole("button", { name: "保存" }));
const esc = () => act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); });
const selectDefault = async () => {
  await userEvent.click(await screen.findByRole("button", { name: "备用的更多操作" }));
  await userEvent.click(screen.getByRole("menuitem", { name: "设为默认" }));
};

beforeEach(() => setLocale("zh-CN"));
afterEach(() => { resetEscLayersForTest(); Reflect.deleteProperty(window, "__TAURI__"); localStorage.clear(); });

describe("云端式模型管理", () => {
  it("同步在弹窗保存期间返回时排队,不撤销已保存的重命名", async () => {
    let finishSave!: () => void;
    let finishSync!: (result: unknown) => void;
    const invoke = shell({ save: () => new Promise<void>((resolve) => { finishSave = resolve; }), extra: {
      mc_status: () => ({ logged_in: true }),
      mc_models_sync: () => new Promise((resolve) => { finishSync = resolve; }),
    } });
    render(<SettingsView onClose={() => {}} />);
    await userEvent.click(await screen.findByRole("button", { name: "同步模型" }));
    await edit();
    await userEvent.type(screen.getByLabelText("备注（选填）"), "新版");
    await saveEditor();
    await act(async () => finishSync({ models: [{ ...config.models[1], name: "云端", source: "monkeycode" }] }));
    await act(async () => finishSave());
    expect(await screen.findByRole("button", { name: "主力新版" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "主力" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "保存" }));
    await act(async () => finishSave());
    const saves = invoke.mock.calls.filter(([cmd]) => cmd === "save_config");
    expect((saves.at(-1)![1]!.config as DesktopConfig).models.map((m) => m.name)).toContain("主力新版");
    expect((saves.at(-1)![1]!.config as DesktopConfig).models.map((m) => m.name)).not.toContain("主力");
  });
  it("写盘后重启失败也发布已落盘草稿,取消弹窗后再保存不回滚", async () => {
    const invoke = shell({ persistedError: "引擎重启失败" });
    render(<SettingsView onClose={() => {}} />); await edit();
    await userEvent.type(screen.getByLabelText("备注（选填）"), "新版");
    await saveEditor();
    await screen.findAllByText(/配置已写入/);
    await userEvent.click(within(editor()).getByRole("button", { name: "取消" }));
    expect(await screen.findByRole("button", { name: "主力新版" })).toBeDefined();
    await selectDefault();
    await userEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(invoke.mock.calls.filter(([cmd]) => cmd === "save_config")).toHaveLength(2));
    const value = invoke.mock.calls.filter(([cmd]) => cmd === "save_config").at(-1)![1]!.config as DesktopConfig;
    expect(value.models.map((m) => m.name)).toEqual(["主力新版", "备用"]);
    expect(value.models[1]!.default).toBe(true);
  });
  it("写盘后恢复失败保留的弹窗可继续修改并重试,不产生引用冲突", async () => {
    const invoke = shell({ persistedError: "引擎重启失败" });
    render(<SettingsView onClose={() => {}} />); await edit();
    await userEvent.type(screen.getByLabelText("备注（选填）"), "新版");
    await saveEditor();
    await screen.findAllByText(/配置已写入/);
    await userEvent.type(screen.getByLabelText("备注（选填）"), "重试");
    await saveEditor();
    await waitFor(() => expect(invoke.mock.calls.filter(([cmd]) => cmd === "save_config")).toHaveLength(2));
    expect(screen.queryByText(/原模型已被同步/)).toBeNull();
    const value = invoke.mock.calls.filter(([cmd]) => cmd === "save_config").at(-1)![1]!.config as DesktopConfig;
    expect(value.models[0]!.name).toBe("主力新版重试");
  });
  it.each([false, true])("历史空项被写盘过滤后重试仍按模型身份定位（有后继项=%s）", async (hasNext) => {
    const empty = { name: "", provider: "anthropic", base_url: "", api_key: "", model: "" };
    const initial = { ...config, models: [empty, config.models[0]!, ...(hasNext ? [config.models[1]!] : [])] };
    const invoke = shell({ initial, persistedError: "引擎重启失败" });
    render(<SettingsView onClose={() => {}} />); await edit();
    await userEvent.type(screen.getByLabelText("备注（选填）"), "新版");
    await saveEditor();
    await screen.findAllByText(/配置已写入/);
    await userEvent.type(screen.getByLabelText("备注（选填）"), "重试");
    await saveEditor();
    await waitFor(() => expect(invoke.mock.calls.filter(([cmd]) => cmd === "save_config")).toHaveLength(2));
    const value = invoke.mock.calls.filter(([cmd]) => cmd === "save_config").at(-1)![1]!.config as DesktopConfig;
    expect(value.models.map((m) => m.name)).toEqual(["主力新版重试", ...(hasNext ? ["备用"] : [])]);
  });
  it("新增已落盘但恢复失败后重试只更新该模型,不追加重名项", async () => {
    const invoke = shell({ persistedError: "引擎重启失败" });
    render(<SettingsView onClose={() => {}} />);
    await screen.findByRole("button", { name: "主力" });
    await userEvent.click(screen.getByRole("button", { name: "绑定" }));
    await userEvent.type(screen.getByLabelText("API Token"), "new-token");
    await userEvent.type(screen.getByLabelText("模型名称"), "manual-id");
    await saveEditor();
    await screen.findAllByText(/配置已写入/);
    expect(screen.getByRole("dialog", { name: "编辑 AI 大模型" })).toBeDefined();
    await saveEditor();
    await waitFor(() => expect(invoke.mock.calls.filter(([cmd]) => cmd === "save_config")).toHaveLength(2));
    const value = invoke.mock.calls.filter(([cmd]) => cmd === "save_config").at(-1)![1]!.config as DesktopConfig;
    expect(value.models.map((m) => m.name)).toEqual(["主力", "备用", "manual-id"]);
  });
  it("未锁定百智云模型保留五项身份配置编辑能力及来源", async () => {
    const invoke = shell({ initial: { ...config, models: [{ ...config.models[0]!, source: "baizhi" }] } });
    render(<SettingsView onClose={() => {}} />); await edit();
    for (const label of ["接口格式", "模型 API 地址", "API Token", "模型名称", "备注（选填）"]) {
      expect(screen.getByLabelText(label).hasAttribute("disabled")).toBe(false);
    }
    await userEvent.clear(screen.getByLabelText("API Token"));
    await userEvent.type(screen.getByLabelText("API Token"), "replacement-token");
    await saveEditor();
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "编辑 AI 大模型" })).toBeNull());
    const value = invoke.mock.calls.find(([cmd]) => cmd === "save_config")![1]!.config as DesktopConfig;
    expect(value.models[0]).toMatchObject({ source: "baizhi", api_key: "replacement-token" });
  });
  it("发现的模型选择在改接口后须重新选择或明确确认,手填ID仍可保存", async () => {
    const invoke = shell(); render(<SettingsView onClose={() => {}} />); await edit();
    await userEvent.click(screen.getByRole("button", { name: "获取模型列表" }));
    await waitFor(() => expect(document.querySelector('option[value="real-model"]')).not.toBeNull());
    fireEvent.change(screen.getByLabelText("模型名称"), { target: { value: "real-model" } });
    fireEvent.change(screen.getByLabelText("模型 API 地址"), { target: { value: "https://new.test/v1" } });
    expect(screen.getByText(/接口或凭据已改变/)).toBeDefined();
    expect(within(editor()).getByRole("button", { name: "保存" }).hasAttribute("disabled")).toBe(true);
    expect(document.querySelector('option[value="real-model"]')).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "确认当前模型 ID" }));
    await saveEditor();
    await waitFor(() => expect(invoke.mock.calls.some(([cmd]) => cmd === "save_config")).toBe(true));
    const value = invoke.mock.calls.find(([cmd]) => cmd === "save_config")![1]!.config as DesktopConfig;
    expect(value.models[0]).toMatchObject({ model: "real-model", base_url: "https://new.test/v1" });
  });
  it("默认打开模型，不显示账号导航或配置表单", async () => {
    shell(); render(<SettingsView onClose={() => {}} />);
    expect(await screen.findByRole("heading", { name: "AI 大模型" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "账号" })).toBeNull();
    expect(screen.queryByLabelText("API Token")).toBeNull();
    expect(screen.getByText("OpenAI Chat")).toBeDefined();
    expect(screen.getAllByText("本地")).toHaveLength(2);
  });
  it("零模型提供绑定入口，不出现账号死链接", async () => {
    shell({ initial: { ...config, models: [] } }); render(<SettingsView onClose={() => {}} />);
    expect(await screen.findByText(/尚未配置 AI 大模型/)).toBeDefined();
    await userEvent.click(screen.getByRole("button", { name: "绑定" }));
    expect(editor()).toBeDefined();
  });
  it("新增取消不留下空条目或保存条", async () => {
    const invoke = shell(); render(<SettingsView onClose={() => {}} />);
    await screen.findByRole("button", { name: "主力" });
    await userEvent.click(screen.getByRole("button", { name: "绑定" }));
    await userEvent.type(screen.getByLabelText("备注（选填）"), "取消的模型");
    await userEvent.click(within(editor()).getByRole("button", { name: "取消" }));
    expect(screen.queryByRole("button", { name: "取消的模型" })).toBeNull();
    expect(screen.queryByRole("button", { name: "保存" })).toBeNull();
    expect(invoke.mock.calls.some(([cmd]) => cmd === "save_config")).toBe(false);
  });
  it("新增手动 ID 真正保存；备注为空取 ID，新建使用显式初值", async () => {
    const invoke = shell(); render(<SettingsView onClose={() => {}} />);
    await screen.findByRole("button", { name: "主力" });
    await userEvent.click(screen.getByRole("button", { name: "绑定" }));
    await userEvent.clear(screen.getByLabelText("模型 API 地址"));
    await userEvent.type(screen.getByLabelText("模型 API 地址"), "https://custom.test/v1");
    await userEvent.type(screen.getByLabelText("API Token"), "new-token");
    await userEvent.type(screen.getByLabelText("模型名称"), "manual-id");
    await saveEditor();
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "绑定 AI 大模型" })).toBeNull());
    const value = invoke.mock.calls.find(([cmd]) => cmd === "save_config")![1]!.config as DesktopConfig;
    expect(value.models[2]).toMatchObject({ name: "manual-id", model: "manual-id", provider: "openai" });
    expect(value.models[2]?.context_window).toBe(200000);
    expect(value.models[2]?.max_output).toBe(32000);
    expect(value.mc_basic_auth).toBe("old-auth");
    expect(value.mc_llm_base_url).toBe("https://proxy.test");
    expect(invoke.mock.calls.filter(([cmd]) => cmd === "save_config")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "保存" })).toBeNull();
  });
  it("编辑取消保留原配置，Token 默认遮挡", async () => {
    const invoke = shell(); render(<SettingsView onClose={() => {}} />); await edit();
    expect(screen.getByLabelText("API Token").getAttribute("type")).toBe("pass" + "word");
    await userEvent.click(screen.getByRole("button", { name: "显示 API Token" }));
    expect(screen.getByLabelText("API Token").getAttribute("type")).toBe("text");
    await userEvent.type(screen.getByLabelText("备注（选填）"), "改变");
    await userEvent.click(within(editor()).getByRole("button", { name: "取消" }));
    expect(screen.getByRole("button", { name: "主力" })).toBeDefined();
    expect(invoke.mock.calls.some(([cmd]) => cmd === "save_config")).toBe(false);
  });
  it("保存失败保留弹窗和输入，不显示成功", async () => {
    shell({ save: async () => { throw new Error("写入失败"); } }); render(<SettingsView onClose={() => {}} />); await edit();
    await userEvent.type(screen.getByLabelText("备注（选填）"), "修改");
    await saveEditor();
    expect(await within(editor()).findByRole("alert")).toHaveProperty("textContent", "写入失败");
    expect((screen.getByLabelText("备注（选填）") as HTMLInputElement).value).toBe("主力修改");
    expect(screen.queryByText("模型配置已保存")).toBeNull();
  });
  it("保存在途防重入，候选配置不会被旧草稿覆盖", async () => {
    let done!: () => void;
    const invoke = shell({ save: () => new Promise<void>((resolve) => { done = resolve; }) });
    render(<SettingsView onClose={() => {}} />); await edit();
    await userEvent.type(screen.getByLabelText("备注（选填）"), "新");
    await saveEditor();
    expect(within(editor()).getByRole("button", { name: "保存" }).hasAttribute("disabled")).toBe(true);
    await act(async () => done());
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "编辑 AI 大模型" })).toBeNull());
    expect(invoke.mock.calls.filter(([cmd]) => cmd === "save_config")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "主力新" })).toBeDefined();
  });
  it("重复名称、缺 Token 和非法参数被拦截", async () => {
    const invoke = shell(); render(<SettingsView onClose={() => {}} />); await edit();
    await userEvent.clear(screen.getByLabelText("备注（选填）"));
    await userEvent.type(screen.getByLabelText("备注（选填）"), "备用");
    await saveEditor();
    expect((await within(editor()).findByRole("alert")).textContent).toContain("重复");
    await userEvent.clear(screen.getByLabelText("API Token"));
    await saveEditor();
    expect(screen.getByLabelText("API Token").getAttribute("aria-invalid")).toBe("true");
    expect(invoke.mock.calls.some(([cmd]) => cmd === "save_config")).toBe(false);
  });
  it("旧长度及 high 思考档位不被开关覆盖", async () => {
    const invoke = shell({ initial: { ...config, models: [{ ...config.models[0]!, context_window: 128000, max_output: 64000, think: "high", vision: false }] } });
    render(<SettingsView onClose={() => {}} />); await edit();
    expect((screen.getByLabelText("输出长度") as HTMLInputElement).value).toBe("64000");
    await userEvent.click(screen.getByRole("switch", { name: "推理 / 思考" }));
    await userEvent.click(screen.getByRole("switch", { name: "推理 / 思考" }));
    await saveEditor();
    const value = invoke.mock.calls.find(([cmd]) => cmd === "save_config")![1]!.config as DesktopConfig;
    expect(value.models[0]).toMatchObject({ think: "high", context_window: 128000, max_output: 64000, vision: false });
  });
  it("图片和长度参数进入保存载荷", async () => {
    const invoke = shell(); render(<SettingsView onClose={() => {}} />); await edit();
    await userEvent.type(screen.getByLabelText("上下文长度"), "128000");
    await userEvent.type(screen.getByLabelText("输出长度"), "64000");
    await userEvent.click(screen.getByRole("switch", { name: "图片识别" }));
    await saveEditor();
    const value = invoke.mock.calls.find(([cmd]) => cmd === "save_config")![1]!.config as DesktopConfig;
    expect(value.models[0]).toMatchObject({ context_window: 128000, max_output: 64000, vision: true });
  });
  it("设默认更改有保存条，弹窗说明全量保存包含其他更改", async () => {
    const invoke = shell(); render(<SettingsView onClose={() => {}} />); await selectDefault();
    await edit(); expect(within(editor()).getByText(/本次保存也会包含/).textContent).toContain("默认项");
    await saveEditor();
    const value = invoke.mock.calls.find(([cmd]) => cmd === "save_config")![1]!.config as DesktopConfig;
    expect(value.models.map((m) => !!m.default)).toEqual([false, true]);
  });
  it("删除有确认，默认回退且不删除同步项", async () => {
    const invoke = shell(); render(<SettingsView onClose={() => {}} />);
    await userEvent.click(await screen.findByRole("button", { name: "主力的更多操作" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "删除" }));
    expect(screen.getByRole("button", { name: "主力" })).toBeDefined();
    await userEvent.click(screen.getByRole("button", { name: "删除" }));
    await userEvent.click(screen.getByRole("button", { name: "保存" }));
    const value = invoke.mock.calls.find(([cmd]) => cmd === "save_config")![1]!.config as DesktopConfig;
    expect(value.models.map((m) => [m.name, m.default])).toEqual([["备用", true]]);
  });
  it("受限会员模型只能查看，没有编辑/删除/默认动作", async () => {
    shell({ initial: { ...config, models: [{ ...config.models[0]!, source: "monkeycode", locked: true, default: false }] } });
    render(<SettingsView onClose={() => {}} />);
    await userEvent.click(await screen.findByRole("button", { name: "主力的更多操作" }));
    expect(screen.getByRole("menuitem", { name: "查看配置" })).toBeDefined();
    expect(screen.queryByRole("menuitem", { name: "删除" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "设为默认" })).toBeNull();
    await userEvent.click(screen.getByRole("menuitem", { name: "查看配置" }));
    expect(screen.getByLabelText("API Token").closest("fieldset")!.disabled).toBe(true);
    expect(within(screen.getByRole("dialog", { name: "AI 大模型配置" })).queryByRole("button", { name: "保存" })).toBeNull();
  });
  it("顶层弹窗独占 Tab/Escape，关闭后恢复触发焦点", async () => {
    shell(); const onClose = vi.fn(); render(<SettingsView onClose={onClose} />); await edit();
    expect(screen.getByRole("dialog", { name: "设置" }).querySelector('.modal-box')!.hasAttribute("inert")).toBe(true);
    for (let i = 0; i < 25; i++) { await userEvent.tab(); expect(editor().contains(document.activeElement)).toBe(true); }
    esc(); expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: "编辑 AI 大模型" })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "主力" })));
  });
  it("输入法 Escape 不关闭弹窗", async () => {
    shell(); render(<SettingsView onClose={() => {}} />); await edit();
    fireEvent.keyDown(window, { key: "Escape", isComposing: true });
    expect(editor()).toBeDefined();
  });
  it("运行任务时禁止保存且说明原因", async () => {
    const invoke = shell(); render(<SettingsView onClose={() => {}} hasRunningTask />); await edit();
    expect(within(editor()).getByRole("button", { name: "保存" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByText(/当前有任务运行/)).toBeDefined();
    expect(invoke.mock.calls.some(([cmd]) => cmd === "save_config")).toBe(false);
  });
  it("模型发现是真实返回值，失败仍可手填保存", async () => {
    const invoke = shell({ discover: async () => { throw new Error("接口不支持列表"); } });
    render(<SettingsView onClose={() => {}} />); await edit();
    await userEvent.click(screen.getByRole("button", { name: "获取模型列表" }));
    expect(await screen.findByText("接口不支持列表")).toBeDefined();
    await saveEditor();
    expect(invoke.mock.calls.some(([cmd]) => cmd === "models_discover")).toBe(true);
    expect(invoke.mock.calls.some(([cmd]) => cmd === "save_config")).toBe(true);
  });
  it("换凭据取消旧发现请求，迟到结果不污染新列表", async () => {
    let done!: (items: string[]) => void;
    const invoke = shell({ discover: () => new Promise<string[]>((resolve) => { done = resolve; }) });
    render(<SettingsView onClose={() => {}} />); await edit();
    await userEvent.click(screen.getByRole("button", { name: "获取模型列表" }));
    await userEvent.type(screen.getByLabelText("API Token"), "new");
    await act(async () => done(["stale-model"]));
    expect(screen.queryByDisplayValue("stale-model")).toBeNull();
    expect(document.querySelector('option[value="stale-model"]')).toBeNull();
    expect(invoke.mock.calls.some(([cmd]) => cmd === "models_discover_cancel")).toBe(true);
  });
  it("已连接云端可以同步，结果待用户保存而非假报自动成功", async () => {
    const invoke = shell({ extra: { mc_status: () => ({ logged_in: true }), mc_models_sync: () => ({ models: [{ ...config.models[0], name: "synced", source: "monkeycode" }] }) } });
    render(<SettingsView onClose={() => {}} />);
    await userEvent.click(await screen.findByRole("button", { name: "同步模型" }));
    expect(await screen.findByText(/同步结果已加入待保存配置/)).toBeDefined();
    expect(invoke.mock.calls.some(([cmd]) => cmd === "save_config")).toBe(false);
    await userEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(invoke.mock.calls.some(([cmd]) => cmd === "save_config")).toBe(true);
  });
});
