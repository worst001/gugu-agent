import type { GatewayConfig } from './types.js'

type SitePageOptions = Pick<GatewayConfig, 'downloadUrl' | 'downloadVersion' | 'downloadSha256'>

export function createHomePageHtml(config: SitePageOptions): string {
  const downloadHref = config.downloadUrl || '/download'

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Gugu Agent</title>
  <meta name="description" content="Gugu Agent 桌面端，集成托管模型、文件解析、技能和 CE 工作流。">
  ${siteStyles()}
</head>
<body>
  <main class="shell">
    <nav class="nav">
      <a class="brand" href="/"><span class="brand-mark">G</span><span>Gugu Agent</span></a>
      <div class="nav-links">
        <a href="/download">下载</a>
        <a href="/buy">购买</a>
      </div>
    </nav>

    <section class="hero">
      <div class="hero-copy">
        <p class="eyebrow">AI 开发桌面端</p>
        <h1>把模型、文件解析和工程工作流放进一个干净的工具里。</h1>
        <p class="lead">Gugu Agent 面向日常开发、调试、文件理解和 CE 工作流。新用户可先试用，之后通过月付套餐继续使用托管额度。</p>
        <div class="cta-row">
          <a class="button primary" href="${escapeHtml(downloadHref)}">下载应用</a>
          <a class="button secondary" href="/buy">查看套餐</a>
        </div>
      </div>
      <aside class="product-panel" aria-label="Gugu Agent 能力概览">
        <div class="panel-top">
          <span>Gugu Managed</span>
          <strong>${escapeHtml(config.downloadVersion || '最新版本')}</strong>
        </div>
        <div class="cap-grid">
          <div><b>DeepSeek V4</b><span>托管模型线路</span></div>
          <div><b>GLM</b><span>文件解析与多模态</span></div>
          <div><b>CE</b><span>计划、实现、评审工作流</span></div>
          <div><b>桌面端</b><span>订阅、激活、技能管理</span></div>
        </div>
      </aside>
    </section>

    <section class="band">
      <article>
        <h2>先试用，再订阅</h2>
        <p>新设备自动获得 7 天试用。用完或到期后，桌面端会引导到订阅页购买并输入激活码。</p>
      </article>
      <article>
        <h2>人工发码，后续接支付</h2>
        <p>当前版本生成订单号后人工确认收款。备案和 HTTPS 准备好后，订单号会复用为微信、支付宝支付单。</p>
      </article>
      <article>
        <h2>下载入口独立</h2>
        <p>安装包可以先放在对象存储、Nginx 静态目录或 GitHub Release，官网只负责稳定引导。</p>
      </article>
    </section>
  </main>
</body>
</html>`
}

export function createDownloadPageHtml(config: SitePageOptions): string {
  const hasDownload = Boolean(config.downloadUrl)

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>下载 Gugu Agent</title>
  <meta name="description" content="下载 Gugu Agent 桌面端安装包。">
  ${siteStyles()}
</head>
<body>
  <main class="shell">
    <nav class="nav">
      <a class="brand" href="/"><span class="brand-mark">G</span><span>Gugu Agent</span></a>
      <div class="nav-links">
        <a href="/buy">购买</a>
      </div>
    </nav>

    <section class="hero download-hero">
      <div class="hero-copy">
        <p class="eyebrow">桌面端下载</p>
        <h1>安装 Gugu Agent，开始使用托管模型和文件解析。</h1>
        <p class="lead">Windows 安装包会从独立下载链接分发。安装后打开应用，新设备会自动进入试用。</p>
        <div class="cta-row">
          ${hasDownload
            ? `<a class="button primary" href="${escapeHtml(config.downloadUrl!)}">下载安装包</a>`
            : '<span class="button disabled">安装包准备中</span>'}
          <a class="button secondary" href="/buy">购买 / 续费</a>
        </div>
      </div>
      <aside class="product-panel">
        <div class="download-meta">
          <dl>
            <div><dt>版本</dt><dd>${escapeHtml(config.downloadVersion || '待配置')}</dd></div>
            <div><dt>平台</dt><dd>Windows</dd></div>
            <div><dt>校验</dt><dd>${escapeHtml(config.downloadSha256 || '暂未配置')}</dd></div>
          </dl>
        </div>
      </aside>
    </section>

    <section class="band">
      <article>
        <h2>安装后试用</h2>
        <p>首次启动后选择 Gugu Managed，新设备会自动注册试用权益。</p>
      </article>
      <article>
        <h2>用完后续费</h2>
        <p>桌面端“设置 → 订阅”会显示套餐状态和剩余百分比，并提供购买入口。</p>
      </article>
      <article>
        <h2>激活码升级</h2>
        <p>人工确认订单后，把激活码填入订阅页即可升级为对应月付套餐。</p>
      </article>
    </section>
  </main>
</body>
</html>`
}

function siteStyles(): string {
  return `<style>
    :root {
      color-scheme: light;
      --bg: #f7f1e6;
      --surface: #fffaf2;
      --surface-strong: #ffffff;
      --ink: #241a12;
      --muted: #735f50;
      --line: #e5cdb5;
      --brand: #9b5a32;
      --brand-dark: #75401f;
      --green: #2f7d69;
      --blue: #315f91;
      --shadow: 0 24px 70px rgba(88, 54, 28, 0.14);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      background:
        linear-gradient(180deg, rgba(255, 247, 234, 0.92), rgba(247, 241, 230, 0.96)),
        radial-gradient(circle at 16% 4%, rgba(47, 125, 105, 0.15), transparent 30rem);
      color: var(--ink);
      font-family: "PingFang SC", "Microsoft YaHei", "Noto Sans SC", system-ui, sans-serif;
      line-height: 1.6;
    }
    a { color: inherit; text-decoration: none; }
    .shell { width: min(1120px, calc(100% - 32px)); margin: 0 auto; padding: 28px 0 48px; }
    .nav { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 46px; }
    .brand, .nav-links, .cta-row { display: flex; align-items: center; gap: 12px; }
    .brand { font-weight: 850; }
    .brand-mark {
      display: grid;
      width: 34px;
      height: 34px;
      place-items: center;
      border: 1px solid rgba(155, 90, 50, 0.34);
      border-radius: 10px;
      background: var(--surface-strong);
      color: var(--brand);
      box-shadow: 0 8px 22px rgba(88, 54, 28, 0.1);
      font-weight: 900;
    }
    .nav-links a { color: var(--muted); font-size: 14px; font-weight: 700; }
    .hero {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(320px, 420px);
      gap: 52px;
      align-items: center;
      min-height: 520px;
    }
    .download-hero { min-height: 460px; }
    .eyebrow {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      margin: 0 0 18px;
      color: var(--brand-dark);
      font-size: 14px;
      font-weight: 800;
    }
    .eyebrow::before {
      content: "";
      width: 8px;
      height: 8px;
      border-radius: 999px;
      background: var(--green);
    }
    h1, h2, p { margin: 0; }
    h1 { max-width: 780px; font-size: clamp(42px, 7vw, 72px); line-height: 1.02; letter-spacing: 0; }
    .lead { max-width: 660px; margin-top: 22px; color: var(--muted); font-size: 19px; }
    .cta-row { flex-wrap: wrap; margin-top: 30px; }
    .button {
      display: inline-flex;
      min-height: 46px;
      align-items: center;
      justify-content: center;
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 0 22px;
      font-weight: 850;
    }
    .button.primary { border-color: var(--brand); background: var(--brand); color: #fffaf2; }
    .button.secondary { background: rgba(255, 250, 242, 0.72); color: var(--brand-dark); }
    .button.disabled { color: var(--muted); background: #f2e5d4; cursor: not-allowed; }
    .product-panel {
      position: relative;
      overflow: hidden;
      border: 1px solid var(--line);
      border-radius: 28px;
      background: var(--surface-strong);
      box-shadow: var(--shadow);
    }
    .product-panel::before {
      content: "";
      position: absolute;
      inset: 0 0 auto;
      height: 8px;
      background: linear-gradient(90deg, var(--brand), var(--green), var(--blue));
    }
    .panel-top {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      padding: 34px 34px 18px;
      color: var(--muted);
      font-size: 14px;
    }
    .panel-top strong { color: var(--ink); }
    .cap-grid { display: grid; gap: 12px; padding: 0 34px 34px; }
    .cap-grid div {
      display: flex;
      justify-content: space-between;
      gap: 18px;
      border-top: 1px solid #f0deca;
      padding-top: 13px;
    }
    .cap-grid b { white-space: nowrap; }
    .cap-grid span { color: var(--muted); text-align: right; }
    .download-meta { padding: 34px; }
    dl, dt, dd { margin: 0; }
    .download-meta div {
      display: flex;
      justify-content: space-between;
      gap: 18px;
      border-top: 1px solid #f0deca;
      padding: 14px 0;
    }
    .download-meta div:first-child { border-top: 0; }
    dt { color: var(--muted); }
    dd { max-width: 260px; overflow-wrap: anywhere; font-weight: 800; text-align: right; }
    .band {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 16px;
      margin-top: 28px;
      border-top: 1px solid var(--line);
      padding-top: 24px;
    }
    .band article { padding-right: 18px; }
    .band h2 { margin-bottom: 8px; font-size: 19px; }
    .band p { color: var(--muted); }
    @media (max-width: 860px) {
      .shell { width: min(100% - 24px, 640px); padding-top: 20px; }
      .hero, .band { grid-template-columns: 1fr; min-height: auto; }
      h1 { font-size: clamp(38px, 12vw, 56px); }
      .product-panel { margin-top: 8px; }
      .panel-top, .cap-grid, .download-meta { padding-left: 22px; padding-right: 22px; }
    }
  </style>`
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  }[char] ?? char))
}
