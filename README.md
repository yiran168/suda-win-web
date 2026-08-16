# 素打 · Qrint Studio

58mm 便携热敏打印机（Qring / BeePrt 系）的桌面创作工具：标签编辑、条码二维码、文档直印、模板库，一次设计即刻出纸。

Electron 桌面客户端 + 浏览器网页版双形态，同一套 React + TypeScript 内核。

## 功能

- **画布编辑器**：文字 / 图片 / 二维码（16 种内容预设）/ 条码（19 种码制）/ 形状（24 种）/ 表格 / 日期时间 / 流水号 / 手绘，九类元素；旋转、多选整体对齐与旋转、磁吸参考线、八向缩放手柄；任意元素可**反色**（黑底白字）；文字支持 5 种打印增强算法（补偿部分机型浓度指令不生效）
- **所见即所得**：画布直接渲染 1:1 打印点阵（203dpi 黑白位图），屏幕上看到的就是打印出来的
- **文档直印**：PDF / Word / PPT / Excel / TXT 导入 → 逐页勾选、编辑、分批打印；Word 走**自研解析排版引擎**（不依赖外部软件），保留分栏、嵌套表格、文本框、常用公式（分数/上下标/根式/求和/矩阵）、真实字号与列表编号
- **批次纸张设置**：文档导入后仍可改纸型/纸宽/标签尺寸/窄纸装入位置/走纸距离，内容按新纸张自动重新排版分页
- **模板库**：内置 494 套行业模板（12 大类），套用前确认纸宽并等比缩放，模板内容全部可再编辑
- **可靠打印**：打印前体检（缺纸/开盖/低电压/过热拦截）、逐份 ACK 确认、多份打印节奏闸、取消中断与**断点续打**（页级 + 份级 + 过热行级自动续打）、断连自动重连
- **运行日志**：全链路日志（连接/协议收发/渲染/打印），一键导出 .log 供排障

## 连接方式

| 通道 | 环境 | 说明 |
|---|---|---|
| SPP 虚拟串口 | 桌面客户端（Electron） | Windows 蓝牙配对后选择 COM 口 |
| Web Serial | 网页版（Chrome / Edge） | 浏览器选择器直连同一虚拟串口，无需安装 |

> 这批打印机是 SPP+BLE 双模，但 BLE 透传模组缓冲太小，实测无法承载点阵打印数据（上游安卓/鸿蒙/Windows 实现也全部只走 SPP），故只保留串口类通道。

## 开发与构建

```bash
npm install            # 安装依赖
npm run dev            # 网页预览（默认 http://localhost:7100）
npm run electron       # 构建并启动桌面客户端
node scripts/build-portable.mjs   # 组装便携版（release/qrint-portable + zip）
```

Windows 安装程序：在 `installer/` 下用 NSIS 构建（`makensis` 处理 `qrint.nsi`，产物在 `release/`）。

## 技术栈

React 18 · TypeScript · Vite · Electron · serialport / Web Serial API · pdfjs-dist · jszip · xlsx · qrcode / bwip-js

## 目录结构

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
```

## 许可

MIT
