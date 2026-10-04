# 第三方开源库与许可清单

本项目在 Rhine-Music-Demo 和 RhineLabUI 的基础上开发 Windows 桌面移植版，并新增 Windows 播放体验及同步歌词显示。下表列出直接依赖和桌面运行组件；完整传递依赖版本见 [`package-lock.json`](package-lock.json)。对应许可证原文随仓库或构建资源保留。

## 代码来源

| 项目 | 本项目中的用途 | 许可与署名 |
| --- | --- | --- |
| [RonaldDeng/Rhine-Music-Demo](https://github.com/RonaldDeng/Rhine-Music-Demo) | Windows 移植的音乐库、播放和界面源项目 | MIT；特别鸣谢 RonaldDeng，保留上游版权与 NOTICE |
| [LBEILC/RhineLabUI](https://github.com/LBEILC/RhineLabUI) | 三维档案界面、渲染与动效基础 | MIT；保留 LBEILC 版权与 NOTICE |

## 运行时直接依赖

| 库 | 锁定版本 | 用途 | 许可文本 |
| --- | ---: | --- | --- |
| [Three.js](https://github.com/mrdoob/three.js) | 0.183.2 | WebGL 2 三维专辑架与场景 | MIT，见 [`public/licenses/three.txt`](public/licenses/three.txt) |
| [Rolling Number](https://github.com/kitlangton/rolling-number) | 0.4.1 | 滚动数字文本 | MIT，见 [`public/licenses/rolling-number.txt`](public/licenses/rolling-number.txt) |
| [music-metadata](https://github.com/Borewit/music-metadata) | 11.15.0 | 本地音频标签、时长及封面元数据读取 | MIT，见 [`public/licenses/music-metadata.txt`](public/licenses/music-metadata.txt) |
| [OpenCC-JS](https://github.com/nk2028/opencc-js) | 1.4.2 | 简繁中文转换 | MIT；字典数据另按 Apache-2.0，见 [`public/licenses/opencc-js.txt`](public/licenses/opencc-js.txt)、[`opencc-js-third-party.md`](public/licenses/opencc-js-third-party.md) 和 [`apache-2.0.txt`](public/licenses/apache-2.0.txt) |
| [Microsoft Edge WebView2 SDK](https://developer.microsoft.com/microsoft-edge/webview2/) | 1.0.4258.31 | Windows 桌面 WebView 宿主 | Microsoft 条款及其 NOTICE，见 [`sdk/lib/`](sdk/lib/) |

## 构建工具与字体

| 项目 | 锁定版本 | 用途 | 许可 |
| --- | ---: | --- | --- |
| [Vite](https://github.com/vitejs/vite) | 7.3.6 | 前端生产构建 | MIT |
| [TypeScript](https://github.com/microsoft/TypeScript) | 5.9.3 | 类型检查和 JavaScript 编译 | Apache-2.0 |
| [Prettier](https://github.com/prettier/prettier) | 3.9.6 | 源代码格式化 | MIT |
| [@types/three](https://github.com/DefinitelyTyped/DefinitelyTyped) | 0.183.1 | Three.js TypeScript 类型 | MIT |
| [Node.js](https://github.com/nodejs/node) | 构建机版本；随发行包记录 | 本地音乐服务运行时 | MIT；发行包包含 Node.js 许可文本 |
| [MiSans](https://hyperos.mi.com/font/en/download/) | 随项目提供的字体文件 | 界面字体 | 按字体目录内的 MiSans 协议使用；不是 MIT，见 [`public/fonts/`](public/fonts/) |

## 资源许可边界

代码使用 MIT 不表示项目中每个模型、图标、字体、封面或音频素材都采用 MIT。部分原作相关素材和原 PV 短音在上游 NOTICE 中被明确标注为不属于 MIT 授权范围。发布源码、安装包或改编素材前，应核对 [`NOTICE.md`](NOTICE.md) 并取得相应权利人的许可；来源署名本身不授予再分发权。
