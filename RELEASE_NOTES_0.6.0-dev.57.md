# Rhine Music for Windows 0.6.0-dev.57

此版本是 [RonaldDeng/Rhine-Music-Demo](https://github.com/RonaldDeng/Rhine-Music-Demo) 的 Windows 桌面移植版。Windows 版开发者为 [Bong712](https://github.com/Bong712)，特别鸣谢 RonaldDeng。

## 本次更新

- Windows 文件属性中的 CompanyName 留空，避免把个人开发者信息显示为公司名称。
- 应用内仍显示“Windows 版开发者：Bong712”，文件版权字段保留 Bong712。
- 继续使用 WebView2 / WebGL 2（ANGLE）图形路径；应用设置页不显示内部帧率验收文案。
- 以新的唯一版本号打包，旧版 EXE 均保留。

## 项目功能

- Windows x64 桌面播放器，基于 Rhine-Music-Demo 移植并新增同步歌词显示。
- 以规范化专辑名归并同名专辑，支持本机歌单、播放队列和 LRC 歌词定位。
- 使用 Three.js、WebGL 2、实例化绘制和封面纹理图集显示三维专辑架。
- 本机音乐文件留在原路径；歌曲、私人曲库和介绍缓存不包含在发行包中。

代码来源、开源库与素材许可说明见 [README.md](README.md)、[NOTICE.md](NOTICE.md) 和 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)。
