import { describe, expect, it } from "vitest";
import { draftFromConfig } from "../settingsForm";
import { applyModelEdit, removeModel, requestPreview } from "./modelEditor";

const first = { name: "first", provider: "openai", base_url: "https://host/v1", api_key: "key", model: "id", default: true };
const second = { ...first, name: "second", default: false };
const draft = () => draftFromConfig({ models: [first, second], mcp_servers: {} });

describe("模型编辑定位", () => {
  it("列表重排后仍按原始键写入，不按旧索引", () => {
    const d = draft();
    d.models.reverse();
    const original = { ...d.models[1]! };
    const next = applyModelEdit(d, original, { ...original, model: "new" });
    expect(next?.models.map((m) => m.model)).toEqual(["id", "new"]);
  });
  it("原条目被移除或改动时拒绝覆盖", () => {
    const d = draft();
    const original = { ...d.models[0]! };
    d.models[0] = { ...original, api_key: "changed" };
    expect(applyModelEdit(d, original, { ...original, name: "rename" })).toBeNull();
    d.models.shift();
    expect(applyModelEdit(d, original, original)).toBeNull();
  });
  it("删除默认模型优先选未受限项", () => {
    const d = draft();
    d.models.push({ ...second, name: "available" });
    d.models[1] = { ...second, locked: true };
    expect(removeModel(d, "first").defaultIdx).toBe(1);
  });
  it("同步模型不能从本地删除", () => {
    const d = draft();
    d.models[0] = { ...d.models[0]!, source: "baizhi" };
    expect(removeModel(d, "first")).toBe(d);
  });
});

describe("请求地址提示", () => {
  it("完整接口不重复追加路径", () => {
    expect(requestPreview("https://host/v1/chat/completions", "openai")).toBe("https://host/v1/chat/completions");
    expect(requestPreview("https://host/v1", "openai_responses")).toBe("https://host/v1/responses");
  });
  it("提示中不显示带鉴权参数的地址", () => {
    expect(requestPreview("https://host/v1?token=secret", "openai")).toBe("");
    expect(requestPreview("file:///tmp", "openai")).toBe("");
  });
});
