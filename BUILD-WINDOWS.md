# Windows 桌面构建

`scripts/build-windows.ps1` 会构建 WebView2 前端、本地音乐服务和 x64 WinForms 启动器，并将完整程序资源嵌入单文件 `.exe`。

## 环境

- Windows 10/11、Node.js 22.12+、npm 和 .NET Framework 4.6.2+ x64 编译器。
- 已安装 Microsoft Edge WebView2 Evergreen Runtime。
- WebView2 SDK 的 `Microsoft.Web.WebView2.Core.dll`、`Microsoft.Web.WebView2.WinForms.dll`、x64 `WebView2Loader.dll`，以及相应许可文件。
- `npm ci` 已完成；不要把真实音乐目录作为构建输入。

当前开发机已经有上版 WebView2 运行文件时，可直接运行：

```powershell
npm ci
npm run check:music
node scripts/version.mjs --dry-run
./scripts/build-windows.ps1
```

也可以显式指定 Node 和 WebView2 SDK 目录：

```powershell
./scripts/build-windows.ps1 `
  -NodePath 'C:\Program Files\nodejs\node.exe' `
  -WebView2Dir 'C:\path\to\webview2-runtime-files'
```

如果没有项目默认查找的旧版运行模板，可通过 `-RuntimeTemplateDir` 指定含 Node/WebView2 许可文件的目录。每次实际出包会在构建锁内扫描现有工件并自动保留一个未使用的 `0.6.0-dev.N`，然后同步版本状态、npm package/lock、UI 常量、PE 版本、Windows 程序集清单、解压目录和 PWA 离线缓存键。EXE、同版本说明、发布清单和 SHA-256 写入工作区根目录 `outputs/`；已有版本文件一律拒绝覆盖，因此 0.5.0 和以前的开发包都会保留。出包失败会保留已预留的序号，后续构建继续递增，不会复用失败版本。`--dry-run` 预览下一个候选版本；`--sync` 只修复当前版本元数据。

## 程序行为

- 单文件 x64 WinForms EXE 内嵌 `dist`、Node.js、WebView2 SDK DLL 和服务包。首次运行将资源解压至 `%LOCALAPPDATA%\Rhine Music\app-v<version>`。
- 音乐库数据写入 `%LOCALAPPDATA%\Rhine Music\music-data-v3`，与程序版本分开保存。
- 本地服务仅监听 `127.0.0.1`。播放器使用系统安装的 WebView2 Evergreen Runtime，硬件加速由 WebView2/ANGLE、Windows 图形栈和显卡驱动选择；Three.js 请求 WebGL 2 和 `high-performance` GPU。
- 启动器启用 Per-Monitor V2 DPI。F11 切换边框窗口与当前显示器的无边框全屏。

## 4K 性能验收

前端显示的 rAF 诊断值不作为验收结果。性能报告必须记录 3840×2160 的实际 canvas 缓冲区，并用 PresentMon 的显示帧/显示间隔数据检查冷切换、热切换、快速切换、专辑详情、主题切换和大曲库。目标显示帧率至少 60 FPS，且测试期间不降低原始画质、不把低分辨率画面放大到 4K，也不使用帧率上限伪造结果。只有保存的 `performance-acceptance.json` 报告通过这些条件后，才允许运行 `node scripts/version.mjs --finalize` 生成正式 0.6.0 版本。
