# 素打 · Qrint Studio

**Web 端（在线使用）**：<https://yiran168.github.io/suda-win-web/> —— 无需安装，浏览器直接打印；仅支持 **Chrome / Edge**（Firefox / Safari 不支持 Web Serial）

**简体中文** | [English](README_EN.md)

错题小印系列 58mm 蓝牙热敏打印机的**桌面客户端 + 网页版**，同时兼容 ESC/POS 通用协议的公模热敏打印机。

用 React + TypeScript 从零编写，Electron 打包为 Windows 安装程序。

## 下载

不想自己构建？直接在 [Releases](../../releases/latest) 下载：

- **SuDa-Setup-v1.0.0.exe** —— Windows 安装程序（推荐）
- **SuDa-Portable-v1.0.0.zip** —— 便携版，解压即用，不写注册表

## 使用

**桌面端**：安装后打开素打 → 先在 Windows 蓝牙设置里配对打印机（配对后会生成"传出方向"的 COM 口）→ 首页点「连接」选对应 COM 口 → 开始创作。

**网页版**（无需安装，浏览器直接打印）：

1. 克隆仓库后 `npm install && npm run dev`（或部署到任意 HTTPS 静态托管，如 GitHub Pages）
2. 用 **Chrome / Edge** 打开 `http://localhost:7100`（Web Serial API 仅在 localhost 或 HTTPS 环境可用；Firefox / Safari 不支持）
3. 同样先在 Windows 蓝牙设置里完成打印机配对
4. 首页点「连接」→ 在浏览器弹出的串口选择器中点中打印机对应的端口 → 授权
5. 连接成功后功能与桌面端完全一致（同一套代码内核）；授权过的端口下次打开可直接重连

## 这是什么

错题小印（Qring / BeePrt BY 系列）是一款 58mm 蓝牙热敏打印机，多用于错题、便签、标签打印。官方 App 服务器已经扑街，上游开源了手机端，而桌面上一直没有好用的客户端 —— 于是有了素打。

它通过经典蓝牙（SPP 虚拟串口）直连打印机，把文字、图片、条码、文档排版成 384 点宽的光栅位图直接下发打印。支持可视化画布编辑、打印预览、模板复用、文档直印和打印历史。

打印数据面只用到标准 ESC/POS 指令（`GS v 0` 光栅位图 + `ESC J` 走纸），因此**任何走串口的公模 ESC/POS 58mm 热敏打印机也能直接打印**；Qring 私有指令只用于电量 / 缺纸 / 过热等状态监测，在公模机上查询无响应时自动降级为盲打，不影响出纸。

## 致谢

**本项目基于 [Thisko/QrintPrint](https://github.com/Thisko/QrintPrint) 移植重写。** QrintPrint 是错题小印的开源客户端，作者 [@Thisko](https://github.com/Thisko) 用 ArkTS 从零编写了原生 HarmonyOS 版本，并通过对官方 App（com.zxxk.xiaoyin）的分析整理出了完整的 Qring 私有协议。没有这份开源实现，就没有素打 —— 特此致谢，也欢迎大家去给上游项目点 Star ⭐

开发过程中还参考了这些社区实现，一并感谢：

- [ZhaYi-Miao/QrintPrint-Web-Console](https://github.com/ZhaYi-Miao/QrintPrint-Web-Console) — 网页控制台与 BLE 通道探索
- [Thisko/QringPrint-Web](https://github.com/Thisko/QringPrint-Web) — Web 端实现
- [snowboys/QrintPrint-Windows](https://github.com/snowboys/QrintPrint-Windows) — Windows 端 USB 方案参考
- [tanadiejiang/pocket_print](https://github.com/tanadiejiang/pocket_print) — 口袋打印机相关实现

## 功能

**画布编辑**

- 九类元素：文字 / 图片 / 二维码（16 种内容预设）/ 条码（19 种码制）/ 形状（24 种）/ 表格 / 日期时间 / 流水号 / 手绘
- 旋转、多选整体对齐与整体无极旋转、磁吸参考线、八向缩放手柄，选框随内容实时变化
- 任意元素可**反色**（黑底白字）；文字支持 5 种打印增强算法（补偿部分机型浓度指令不生效）
- **所见即所得**：画布直接渲染 1:1 打印点阵（203dpi 纯黑白位图），屏幕上看到的就是打印出来的

**文档直印**

- PDF / Word / PPT / Excel / TXT 导入 → 逐页勾选、编辑、分批打印
- Word 走**自研解析排版引擎**（不依赖 Office 等外部软件）：保留分栏、嵌套表格、文本框、常用公式（分数/上下标/根式/求和/矩阵）、真实字号与列表编号
- 导入后仍可改纸型/纸宽/标签尺寸/窄纸装入位置/走纸距离，内容按新纸张自动重新排版分页

**模板与纸张**

- 内置 494 套行业模板（12 大类），套用前确认纸宽并等比缩放，模板内容全部可再编辑
- 标签纸 / 连续纸 / 便签纸，画布随纸张等比缩放；窄纸（<55mm）可设装入位置

**可靠性**

- 打印前体检：缺纸 / 开盖 / 低电压 / 过热实时拦截，主页与打印途中双重过热提示
- 逐份 ACK 确认、多份打印节奏闸、取消中断与**断点续打**（页级 + 份级 + 过热行级自动续打）
- 断连自动重连上次设备；全链路运行日志（连接/协议收发/渲染/打印），一键导出 .log 供排障

## 技术实现

几个值得一提的地方：

**Qring 私有协议（非标准 ESC/POS）**

不依赖官方 SDK。打印机的状态查询、电量等走自己的 `10 FF` 系列命令，只有走纸（`ESC J`）和光栅位图（`GS v 0`）两条沿用 ESC/POS。协议源自上游对官方 App 的分析整理：

- 状态字节单字节承载五个位：打印中 / 开盖 / 缺纸 / 低电压 / 过热
- 光栅编码：每行 48 字节（384 点 / 8），MSB first，置 1 = 黑
- 打印期间暂停状态轮询，避免查询字节混入打印数据流
- 数据面是纯 ESC/POS：**公模 58mm 串口热敏打印机零适配可用**，私有的状态 / 体检能力在公模机上自动跳过

核心文件：`src/protocol/qring.ts`

**1:1 点阵画布**

画布不走普通 DOM 缩放，而是直接把每个元素渲染为 203dpi 的打印点阵再贴回屏幕 —— 热敏打印机只能打纯黑白，画布上就不出现彩色；锯齿、抖动、反色效果和出纸完全一致。编辑态的清晰度 = 打印态的清晰度。

核心文件：`src/render/`（光栅化、抖动二值化、文字增强）

**docx 自研解析排版引擎**

mammoth 之类的库会把嵌套表格拍平、丢掉分栏/文本框/公式，索性自己写：

- 解析层：命名空间 URI 匹配、`w:cols` 分节分栏、styles/numbering 解析、表格按 `tblGrid` 递归、文本框从 `w:txbxContent` 就近提升、OMML 公式子集
- 排版层：AST → 分栏栏带流式排版 → 逐页点阵绘制
- 公式排版器覆盖分数、上下标、根式、求和、矩阵，能应付中小学错题场景

核心文件：`src/docs/docxParser.ts` → `src/docs/flowTypeset.ts` → `src/docs/mathLayout.ts`

**过热行级断点续打**

热敏头过热是这批机器的常态。打印途中收到过热故障帧（或 ACK 超时且状态位过热）时不判失败：按发送速率与传输耗时**估算断点行**，回退 128 行作为重叠区，轮询散热完成后从断点行接着打 —— 只打了一半的文字/图片也能无走纸续上，而不是整份重打。页级/份级断点同理，取消后可从断点继续。

核心文件：`src/print/printJob.ts`

**双通道传输，同一套接口**

- 桌面端（Electron）：`serialport` 走 SPP 虚拟串口（如 COM7）
- 网页版（Chrome / Edge）：Web Serial API 直连同一虚拟串口，无需安装

两条通道实现同一个 `Transport` 接口（write/close/onDrop），上层协议、打印管线、自动重连完全不感知差异。BLE 透传模组缓冲太小、实测无法承载点阵数据（上游各平台实现也全部只走 SPP），故只保留串口类通道。

核心文件：`src/transport/`

## 项目结构

```
src/
  model/       文档模型、纸张、预设（元素/模板/便签底纹）
  editor/      画布、会话（选择/变换/撤销）、属性面板
  render/      光栅化、抖动二值化、文字增强
  docs/        文档导入：docx 自研解析（docxParser）→ AST 排版（flowTypeset）→ 公式（mathLayout）
  protocol/    Qring 私有协议 + ESC/POS（状态/ACK/光栅下发）
  transport/   连接管理（SPP / Web Serial，自动重连）
  print/       打印任务管线（体检/逐份/取消/断点续打/过热续打）
  pages/       首页 / 编辑器 / 模板 / 设置 / 日志 / 历史 / 使用方法
electron/      桌面壳（主进程、串口 IPC、app:// 协议）
public/templates/  内置模板图片资源
installer/     NSIS 安装程序脚本
```

## 构建

**环境要求**：Node.js 18+；桌面端打包需 Windows；设备为错题小印系列 58mm 蓝牙热敏打印机。

```bash
npm install                     # 安装依赖
npm run dev                     # 网页预览（默认 http://localhost:7100）
npm run electron                # 构建并启动桌面客户端
node scripts/build-portable.mjs # 组装便携版（release/qrint-portable + zip）
```

Windows 安装程序：在 `installer/` 下用 NSIS 构建（`makensis` 处理 `qrint.nsi`，产物在 `release/`）。

## 常见问题

**支持哪些打印机？** 错题小印 / Qring / BeePrt BY 系全功能（状态监测、体检拦截、过热续打）；公模 ESC/POS 58mm 串口热敏打印机可正常打印，体检与状态显示自动跳过。

**连不上打印机？** 先在 Windows 蓝牙设置里完成配对，再选「SPP 串口」通道和对应 COM 口；网页版需用 Chrome / Edge 打开。设备名一般带 Qring 前缀。

**打印出来模糊 / 偏淡？** 这批机器浓度指令不生效，给文字元素开一种打印增强算法（5 种按清晰度排列），或调图片阈值。

**为什么不做 BLE？** 机器是 SPP+BLE 双模，但 BLE 透传模组缓冲太小，实测点阵数据发到一半就被设备断开（上游安卓/鸿蒙/Windows 实现同样只走 SPP），故删除 BLE 只保留串口类通道。

**打印中途过热停了？** 不用管 —— 散热后自动从断点行续打；日志页能看到每一次续打记录。

## 免责声明

素打是第三方客户端，与错题小印官方无关。打印机通信协议来自上游开源项目对官方 App 的分析整理，**仅供学习参考，严禁商用**；如认为此实现侵害了你的权益，请联系作者下架。

## 开源协议

MIT License

---

Made with ❤️ by **yiran168 & Kimi K3** —— 本项目由 yiran168 与 Kimi K3 共同开发。
