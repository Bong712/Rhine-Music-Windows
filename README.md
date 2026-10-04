# Rhine Music · Windows

这是 [RonaldDeng/Rhine-Music-Demo](https://github.com/RonaldDeng/Rhine-Music-Demo) 的 Windows 桌面移植版。项目在三维音乐档案界面和本机播放基础上，添加了同步歌词显示，并扩展了 Windows 曲库、歌单和播放队列管理。

**当前版本：0.6.0-dev.57** · **维护者：** [Bong712](https://github.com/Bong712)

## 下载与运行

打开 [Releases](https://github.com/Bong712/Rhine-Music-Windows/releases)，下载对应版本的 Windows x64 `.exe`。需要 Windows 10/11 和 Microsoft Edge WebView2 Evergreen Runtime。程序首次启动时会解压运行资源到 `%LOCALAPPDATA%\Rhine Music\app-v<version>`。

在“音乐库”中添加本机音乐文件夹并扫描。播放器读取原位置的音频，不上传或复制歌曲。曲库索引、歌单、封面缓存和设置存放在 `%LOCALAPPDATA%\Rhine Music\music-data-v3`。还没有曲库时，可以直接进入演示封面。

## 功能与 Windows 版改进

- 将 macOS／浏览器原型移植为 Windows x64 桌面程序，使用 WinForms 启动器、内置本机音乐服务和 WebView2 窗口。
- 将专辑标题经去首尾空白、Unicode NFC 规范化和忽略大小写后作为归档身份。同名专辑可以跨歌手标签、唱片编号和音乐根目录归并；曲目仍从各自原路径读取，多碟顺序保持稳定。
- 添加本机歌单管理、可编辑播放队列、上一首／下一首，以及与音频文件同名的 LRC 歌词、播放同步、偏移解析和歌词点击定位。
- 优化三维专辑架的封面传输：使用普通 2D 纹理图集和每张专辑独立的 UV 区域，专辑架采用实例化绘制；更新封面只上传变化的图块。冷切换时的选中封面和离场封面改用 CanvasTexture 路径，避免 GPU 纹理读回后再复制。
- 设置页提供专辑与画面偏好、音量和动效选项。支持 F11 无边框全屏及 Per-Monitor V2 DPI。
- 图形路径为 **WebView2 → Chromium/ANGLE → WebGL 2 → Three.js**，并请求高性能 GPU。实际 GPU 选择和呈现能力取决于 Windows、WebView2 与显卡驱动。

## 发行说明

当前发行使用 `0.6.0-dev.57` 版本号。应用界面显示实际的 WebView2 / WebGL 2 图形路径及 Bong712 维护者信息。帧率由具体设备的显示器、显卡和驱动决定；项目不以开发原型数据代替最终用户设备上的性能承诺。

详细改动见 [发行说明](RELEASE_NOTES_0.6.0-dev.57.md) 和 [CHANGELOG.md](CHANGELOG.md)。

## 开发与构建

需要 Windows 10/11、Node.js 22.12+、npm、.NET Framework 4.6.2+ x64 编译工具和 WebView2 Evergreen Runtime。仓库包含构建所需的 WebView2 SDK 程序集及对应许可文件。

```powershell
npm ci
$releaseDir = Join-Path (Get-Location) 'outputs'
./scripts/build-windows.ps1 -WebView2Dir (Join-Path (Get-Location) 'sdk/lib') -OutputDirectory $releaseDir
```

构建脚本会分配新的 `0.6.0-dev.N` 版本，保留已有发行文件，并将 EXE 与版本清单输出到 `outputs/`。前端开发模式可用 `npm run dev`；独立音乐服务可用 `npm run music`。音乐服务只绑定本机 `127.0.0.1`。

## 来源、署名与许可

Windows 版开发者：[Bong712](https://github.com/Bong712)；特别鸣谢：[RonaldDeng](https://github.com/RonaldDeng)，感谢其 Rhine-Music-Demo 项目。原版界面基础来自 [LBEILC/RhineLabUI](https://github.com/LBEILC/RhineLabUI)。本项目保留各自作者署名与 MIT 许可。直接依赖包括 Three.js、Rolling Number、music-metadata、OpenCC-JS，另使用 WebView2 SDK 与 MiSans 字体，版本和许可见 [第三方开源库与许可清单](THIRD-PARTY-NOTICES.md)、[NOTICE.md](NOTICE.md) 及 `public/licenses/`、`sdk/lib/`。

代码许可不自动覆盖原作模型、图标、音频采样、字体或其他非代码素材。上游说明明确指出，部分原作相关素材不属于 MIT 授权范围，来源标注也不构成再分发许可。完整资源来源和适用边界见 [NOTICE.md](NOTICE.md)。

## English

Rhine Music for Windows is a Windows desktop port of [RonaldDeng/Rhine-Music-Demo](https://github.com/RonaldDeng/Rhine-Music-Demo), with synchronized LRC lyric display added alongside playlist and playback-queue management. It is developed by [Bong712](https://github.com/Bong712), with special thanks to RonaldDeng. The 3D archive UI builds on [LBEILC/RhineLabUI](https://github.com/LBEILC/RhineLabUI). See the notices for third-party licenses and asset attribution.
