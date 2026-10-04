# Rhine Music for Windows 0.6.0-dev.56

此版本是 Rhine-Music-Demo 的 Windows 桌面移植版。Windows 版开发者为 [Bong712](https://github.com/Bong712)，特别鸣谢 [RonaldDeng](https://github.com/RonaldDeng) 提供上游音乐项目。

## 本次更新

- 设置页改为显示实际图形路径 **WebView2 / WebGL 2（ANGLE）**，并加入 Bong712 开发者和 RonaldDeng 特别鸣谢信息。
- 移除面向用户的内部帧率验收文案。
- 许可证加入 Windows 移植版版权署名，并继续保留 RhineLabUI 和 Rhine-Music-Demo 的原始署名。
- 重新打包为新的唯一开发版本；已有 EXE 保留不变。

## Windows 版功能

- Windows x64 独立桌面程序，音频留在用户本机，不上传歌曲。
- 以规范化后的专辑名归并同名专辑，保留实际曲目路径和稳定的多碟排序。
- 本机播放列表和可编辑队列。
- 读取同目录同基名 LRC 歌词，播放时同步显示，支持时间偏移、多时间戳行和歌词点击定位。
- 3D 专辑架采用 Three.js、WebGL 2、实例化绘制和封面纹理图集。
- Windows 图形宿主使用 WebView2 / Chromium / ANGLE；硬件设备选择由 WebView2、Windows 和显卡驱动共同决定。

## 下载与许可

安装包需要 Windows 10/11 与 Microsoft Edge WebView2 Evergreen Runtime。歌曲文件、私人曲库数据和在线介绍缓存不包含在发行包中。

代码来源、第三方开源库、字体、模型与音频素材的许可边界见 [README.md](README.md)、[LICENSE](LICENSE)、[NOTICE.md](NOTICE.md) 和 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)。特别注意：部分原作相关模型、图标与短音频不属于 MIT 授权范围，来源标注也不是再分发许可。
