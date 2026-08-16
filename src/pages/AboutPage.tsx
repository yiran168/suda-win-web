/** 关于素打：设置页点击进入，主题跟随。 */
export function AboutPage() {
  return (
    <div className="page article-page">
      <article className="article card">
        <h1>素打</h1>
        <p className="article-lede">
          本地优先的便携式热敏打印创作工具：面向连续纸与标签纸，把文字、图片、二维码、
          一维条码、形状、表格、日期时间、流水号与手绘签名统一放进可编辑画布，
          从毫米级纸张设置、203 dpi 同源预览到蓝牙发送打印，编辑与输出共用同一套坐标与点阵流程。
        </p>

        <h2>开源致谢</h2>
        <p>
          特别感谢 GitHub 开发者 <b>Thisko</b> 开源的
          <b> QrintPrint</b>（HarmonyOS 版），其公开整理的 Qring / BeePrt BY 系列打印机经典蓝牙
          SPP 通信方式、私有状态命令与点阵打印流程，是本应用协议层的依据：
          <code>10 FF</code> 状态命令、384 点光栅、1024 字节分包、<code>ESC J</code> 走纸与
          <code>GS v 0</code> 光栅输出行为均与上游保持一致。
        </p>
        <p>
          同时参考了 <b>ZhaYi-Miao</b> 的 QrintPrint-Windows / Web-Console 与
          <b> snowboys</b> 的 QrintPrint-Windows（Python 版）在桌面串口连接、
          协议封装与远程打印上的实现思路。谨向所有开源贡献者致谢。
        </p>

        <h2>通信与隐私</h2>
        <p>
          应用不申请网络权限：模板、历史、设置与日志全部保存在本机。
          打印通道为经典蓝牙 SPP（在 Windows 蓝牙设置中配对打印机后，以虚拟串口方式连接），
          数据只在你的电脑与打印机之间传输。
        </p>

        <h2>硬件档案</h2>
        <p>
          默认 203 dpi、384 点打印头。实际纸宽可在 10.0–57.0 mm 间按 0.1 mm 无极设置，
          并选择靠左/靠右装纸。使用其他型号前，请先打印校准样张；
          未经验证的协议实现请勿用于关键业务。
        </p>

        <h2>许可证与品牌</h2>
        <p>
          遵循上游 <b>MIT License</b>。Qring / BeePrt、汉印 / 汉码、微打等名称归各自权利人所有；
          本应用是独立第三方工具，与这些品牌无隶属关系。
        </p>

        <footer className="article-footer">素打桌面端 v1.0.0 · 网页版与客户端共用同一内核</footer>
      </article>
    </div>
  );
}
