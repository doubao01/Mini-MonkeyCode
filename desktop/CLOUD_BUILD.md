# Mini-MonkeyCode 云端桌面构建

仓库：<https://github.com/doubao01/Mini-MonkeyCode>  
源项目：<https://github.com/chaitin/MonkeyCode>  
桌面改造基线：`124929c2ce74ceda022df364d0e09a540f956191`

## 构建与下载

在 GitHub 的 Actions 中选择 **Mini MonkeyCode Windows Shell**，点击 **Run workflow**，选择 `ui/desktop-uplift`。
构建完成后下载 `Mini-MonkeyCode-windows-x64-<序号>` artifact。

该工作流使用 Windows 2022 的 MSVC 工具链、Node 24 和 Rust stable，验证前端改造、模型发现 Rust 测试及 Tauri 命令契约，再编译 GUI 模式的桌面程序。不会触发上游发布、上传 Release 或生成安装包。

产物包括：

- `MonkeyCode++.exe`：嵌入改造后前端的桌面程序。
- `browser-extension/`：源码构建的配套浏览器扩展。
- `SHA256SUMS.txt`：桌面程序 SHA256。
- `build-info.json`：源码提交、构建链接与应用标识。

## 运行范围

本轮按用户选择只编译桌面程序，不包含 `ohmyagent.exe`、WSL Linux 引擎或内置技能子模块。因此产物不是完整安装包；要运行本地任务仍需兼容的配套引擎，可将其放在桌面程序同目录中。需安装 Microsoft Edge WebView2 Runtime。

云端覆盖配置 `bundle.cloud-shell.conf.json` 保留显示名称 `MonkeyCode++`，使用独立应用标识 `io.github.doubao01.minimonkeycode`，不与上游应用标识共用默认配置目录。更新端点为空，不向上游更新服务请求或覆盖为官方客户端。

没有将本机客户端、用户配置、登录令牌或本地引擎上传到仓库。上游私有 `agent` 子模块的固定引用保留用于来源记录，当前工作流不初始化它。

## 验证边界

新工作流检查本次改造的 15 个前端测试文件、定向 ESLint、生产构建、命令／打包契约和模型发现 Rust 测试。它不等同于全项目检查或真实桌面视觉验收。完整引擎 E2E、WSL、签名及安装包发布不在本轮内。

原有上游工作流保留；本次推送到 `ui/desktop-uplift`，不触发上游 `main` 或版本 tag 发布。
