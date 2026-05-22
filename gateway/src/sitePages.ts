import type { GatewayConfig } from './types.js'

type SitePageOptions = Pick<
  GatewayConfig,
  | 'downloadUrl'
  | 'downloadWindowsUrl'
  | 'downloadMacosUrl'
  | 'downloadVersion'
  | 'downloadSha256'
  | 'downloadWindowsSha256'
  | 'downloadMacosSha256'
  | 'icpRecord'
  | 'icpUrl'
>

type DownloadOption = {
  title: string
  platform: string
  badge: string
  fileType: string
  description: string
  href: string
  version: string
  checksum: string | null
  cta: string
}

export function createHomePageHtml(config: SitePageOptions): string {
  const downloadHref = '/download'

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
        <h2>在线支付发码</h2>
        <p>微信支付已接入，支付完成后会自动生成激活码。支付宝入口也已经预留，完成审核后即可启用。</p>
      </article>
      <article>
        <h2>下载入口独立</h2>
        <p>安装包通过官方 HTTPS 下载源分发，官网负责稳定引导、版本信息和校验说明。</p>
      </article>
    </section>
    ${siteFooterHtml(config)}
  </main>
</body>
</html>`
}

export function createDownloadPageHtml(config: SitePageOptions): string {
  const windowsUrl = config.downloadWindowsUrl || config.downloadUrl
  const macosUrl = config.downloadMacosUrl
  const hasDownload = Boolean(windowsUrl || macosUrl)
  const version = config.downloadVersion || '最新版本'
  const windowsSha256 = config.downloadWindowsSha256 || config.downloadSha256
  const macosSha256 = config.downloadMacosSha256
  const platforms = [
    windowsUrl ? 'Windows' : null,
    macosUrl ? 'macOS' : null,
  ].filter(Boolean).join(' / ') || '准备中'
  const primaryDownload = windowsUrl || macosUrl

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
      <div class="hero-copy download-copy">
        <p class="eyebrow">官方客户端下载</p>
        <h1>下载 Gugu Agent 桌面端</h1>
        <p class="lead">选择适合你设备的安装包。安装后打开应用，新设备会自动进入试用，也可以在设置里粘贴激活码恢复订阅。</p>
        <div class="cta-row">
          ${primaryDownload
            ? `<a class="button primary" href="${escapeHtml(primaryDownload)}" target="_blank" rel="noreferrer">立即下载</a>`
            : '<span class="button disabled">安装包准备中</span>'}
          <a class="button secondary" href="/buy">查看套餐</a>
        </div>
      </div>
      <aside class="product-panel download-panel" aria-label="下载信息">
        <div class="panel-top">
          <span>当前版本</span>
          <strong>${escapeHtml(version)}</strong>
        </div>
        <div class="download-meta compact">
          <dl>
            <div><dt>分发源</dt><dd>官方 HTTPS 下载源</dd></div>
            <div><dt>支持平台</dt><dd>${escapeHtml(platforms)}</dd></div>
            <div><dt>校验方式</dt><dd>SHA256</dd></div>
          </dl>
        </div>
      </aside>
    </section>

    ${hasDownload
      ? `<section class="download-list" aria-label="安装包下载列表">
      ${windowsUrl ? downloadOptionHtml({
        title: 'Windows MSI',
        platform: 'Windows',
        badge: 'Win',
        fileType: 'MSI 安装包',
        description: '适合 Windows 10 / 11 x64 桌面环境。',
        href: windowsUrl,
        version,
        checksum: windowsSha256,
        cta: '下载 Windows MSI',
      }) : ''}
      ${macosUrl ? downloadOptionHtml({
        title: 'macOS DMG',
        platform: 'macOS',
        badge: 'Mac',
        fileType: 'DMG 安装包',
        description: '适合 Apple Silicon Mac。首次打开如遇系统提示，请按安装说明处理。',
        href: macosUrl,
        version,
        checksum: macosSha256,
        cta: '下载 macOS DMG',
      }) : ''}
    </section>`
      : ''}

    <section class="security-note" aria-label="安装安全说明">
      <div>
        <p class="note-label">安装安全说明</p>
        <h2>关于浏览器风险提示</h2>
        <p>Windows 安装包正在补充代码签名和下载信誉。少数浏览器可能提示“危险下载内容”，这通常来自未签名安装包的信誉判断。</p>
      </div>
      <ul>
        <li>只从本页面或官方发布页下载，不使用第三方转发链接。</li>
        <li>下载后可核对页面上的 SHA256 校验值，确认文件完整。</li>
        <li>后续接入代码签名证书后，会逐步降低误报。</li>
      </ul>
    </section>

    <section class="band workflow-band" aria-label="安装流程">
      <article>
        <span>01</span>
        <h2>下载</h2>
        <p>选择 Windows 或 macOS 安装包，保存到本机后再运行。</p>
      </article>
      <article>
        <span>02</span>
        <h2>安装 / 首次打开</h2>
        <p>按系统提示完成安装。首次启动后，新设备会自动进入试用。</p>
      </article>
      <article>
        <span>03</span>
        <h2>激活 / 订阅</h2>
        <p>在桌面端“设置 → 订阅”粘贴激活码，即可恢复对应套餐。</p>
      </article>
    </section>
    ${siteFooterHtml(config)}
  </main>
</body>
</html>`
}

function siteFooterHtml(config: Pick<SitePageOptions, 'icpRecord' | 'icpUrl'>): string {
  if (!config.icpRecord) return ''
  const href = escapeHtml(config.icpUrl || 'https://beian.miit.gov.cn/')
  return `<footer class="site-footer">
      <a href="${href}" target="_blank" rel="noreferrer">${escapeHtml(config.icpRecord)}</a>
    </footer>`
}

function downloadOptionHtml(option: DownloadOption): string {
  return `<article class="download-card">
        <div class="download-card-head">
          <span class="platform-mark">${escapeHtml(option.badge)}</span>
          <div>
            <p class="card-kicker">${escapeHtml(option.platform)}</p>
            <h2>${escapeHtml(option.title)}</h2>
          </div>
        </div>
        <p>${escapeHtml(option.description)}</p>
        <dl class="card-meta">
          <div><dt>版本</dt><dd>${escapeHtml(option.version)}</dd></div>
          <div><dt>类型</dt><dd>${escapeHtml(option.fileType)}</dd></div>
          <div><dt>${escapeHtml(option.platform)} SHA256</dt><dd><code>${escapeHtml(option.checksum || '见发布页附件')}</code></dd></div>
        </dl>
        <a class="button primary download-button" href="${escapeHtml(option.href)}" target="_blank" rel="noreferrer">${escapeHtml(option.cta)}</a>
      </article>`
}

function siteStyles(): string {
  return `<style>
    :root {
      color-scheme: light;
      --bg: #f4f6f4;
      --surface: #ffffff;
      --surface-soft: #f8faf8;
      --ink: #241a12;
      --muted: #685f57;
      --line: #dfe6e1;
      --brand: #9b5a32;
      --brand-dark: #75401f;
      --green: #2f7d69;
      --blue: #315f91;
      --amber: #b9783b;
      --shadow: 0 18px 48px rgba(34, 28, 23, 0.08);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      background: linear-gradient(180deg, #fbfcfb 0%, var(--bg) 100%);
      color: var(--ink);
      font-family: "PingFang SC", "Microsoft YaHei", "Noto Sans SC", system-ui, sans-serif;
      line-height: 1.6;
    }
    a { color: inherit; text-decoration: none; }
    .shell { width: min(1120px, calc(100% - 32px)); margin: 0 auto; padding: 28px 0 48px; }
    .nav { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 44px; }
    .brand, .nav-links, .cta-row { display: flex; align-items: center; gap: 12px; }
    .brand { font-weight: 850; }
    .brand-mark {
      display: grid;
      width: 34px;
      height: 34px;
      place-items: center;
      border: 1px solid rgba(155, 90, 50, 0.26);
      border-radius: 8px;
      background: var(--surface);
      color: var(--brand);
      box-shadow: 0 8px 20px rgba(34, 28, 23, 0.08);
      font-weight: 900;
    }
    .nav-links a { color: var(--muted); font-size: 14px; font-weight: 750; }
    .hero {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(320px, 420px);
      gap: 52px;
      align-items: center;
      min-height: 520px;
    }
    .download-hero {
      min-height: 350px;
      align-items: stretch;
    }
    .download-copy {
      display: grid;
      align-content: center;
      padding-bottom: 20px;
    }
    .eyebrow {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      margin: 0 0 18px;
      color: var(--green);
      font-size: 14px;
      font-weight: 850;
    }
    .eyebrow::before {
      content: "";
      width: 8px;
      height: 8px;
      border-radius: 999px;
      background: currentColor;
    }
    h1, h2, p { margin: 0; }
    h1 { max-width: 780px; font-size: 68px; line-height: 1.02; letter-spacing: 0; }
    .download-hero h1 { max-width: 640px; font-size: 56px; }
    .lead { max-width: 660px; margin-top: 22px; color: var(--muted); font-size: 19px; }
    .download-hero .lead { max-width: 600px; font-size: 18px; }
    .cta-row { flex-wrap: wrap; margin-top: 30px; }
    .button {
      display: inline-flex;
      min-height: 46px;
      align-items: center;
      justify-content: center;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 0 22px;
      font-weight: 850;
      transition: transform 160ms ease, border-color 160ms ease, background 160ms ease;
    }
    .button:hover { transform: translateY(-1px); }
    .button:focus-visible { outline: 3px solid rgba(47, 125, 105, 0.22); outline-offset: 2px; }
    .button.primary { border-color: var(--brand); background: var(--brand); color: #fff; }
    .button.secondary { background: var(--surface); color: var(--brand-dark); }
    .button.disabled { color: var(--muted); background: #f1eee8; cursor: not-allowed; }
    .product-panel {
      position: relative;
      overflow: hidden;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--surface);
      box-shadow: var(--shadow);
    }
    .product-panel::before {
      content: "";
      position: absolute;
      inset: 0 0 auto;
      height: 6px;
      background: linear-gradient(90deg, var(--brand), var(--green), var(--blue));
    }
    .panel-top {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      padding: 30px 30px 16px;
      color: var(--muted);
      font-size: 14px;
    }
    .panel-top strong { color: var(--ink); }
    .cap-grid { display: grid; gap: 12px; padding: 0 30px 30px; }
    .cap-grid div {
      display: flex;
      justify-content: space-between;
      gap: 18px;
      border-top: 1px solid #edf1ee;
      padding-top: 13px;
    }
    .cap-grid b { white-space: nowrap; }
    .cap-grid span { color: var(--muted); text-align: right; }
    .download-panel { align-self: center; }
    .download-meta { padding: 30px; }
    .download-meta.compact { padding-top: 0; }
    dl, dt, dd { margin: 0; }
    .download-meta div {
      display: flex;
      justify-content: space-between;
      gap: 18px;
      border-top: 1px solid #edf1ee;
      padding: 14px 0;
    }
    .download-meta div:first-child { border-top: 0; }
    dt { color: var(--muted); }
    dd { max-width: 260px; overflow-wrap: anywhere; font-weight: 800; text-align: right; }
    .download-list {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 16px;
      margin-top: 24px;
    }
    .download-card {
      display: grid;
      grid-template-rows: auto auto 1fr auto;
      gap: 18px;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 22px;
      background: var(--surface);
      box-shadow: 0 12px 30px rgba(34, 28, 23, 0.06);
    }
    .download-card-head {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .platform-mark {
      display: grid;
      width: 44px;
      height: 44px;
      place-items: center;
      border-radius: 8px;
      background: rgba(47, 125, 105, 0.1);
      color: var(--green);
      font-size: 13px;
      font-weight: 900;
    }
    .card-kicker {
      color: var(--muted);
      font-size: 13px;
      font-weight: 850;
    }
    .download-card h2 { font-size: 24px; line-height: 1.2; }
    .download-card > p {
      min-height: 52px;
      color: var(--muted);
    }
    .card-meta {
      display: grid;
      gap: 8px;
      align-content: start;
      padding-top: 4px;
    }
    .card-meta div {
      display: grid;
      grid-template-columns: 108px minmax(0, 1fr);
      gap: 12px;
      align-items: start;
    }
    .card-meta dd {
      max-width: none;
      text-align: left;
      font-weight: 760;
      min-width: 0;
    }
    .card-meta code {
      display: block;
      color: var(--ink);
      font-family: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace;
      font-size: 12px;
      line-height: 1.45;
      overflow-wrap: anywhere;
    }
    .download-button { width: 100%; }
    .security-note {
      display: grid;
      grid-template-columns: minmax(240px, 0.7fr) minmax(0, 1.3fr);
      gap: 22px;
      margin-top: 16px;
      border: 1px solid #dfe6e1;
      border-radius: 8px;
      padding: 22px;
      background: var(--surface-soft);
    }
    .note-label {
      margin-bottom: 6px;
      color: var(--amber);
      font-size: 13px;
      font-weight: 850;
    }
    .security-note h2 { margin-bottom: 6px; font-size: 20px; }
    .security-note p, .security-note li { color: var(--muted); }
    .security-note ul { margin: 0; padding-left: 20px; }
    .security-note li + li { margin-top: 6px; }
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
    .workflow-band article {
      display: grid;
      gap: 6px;
      align-content: start;
    }
    .workflow-band span {
      color: var(--green);
      font-size: 13px;
      font-weight: 900;
    }
    .site-footer {
      margin-top: 30px;
      border-top: 1px solid var(--line);
      padding-top: 18px;
      color: var(--muted);
      font-size: 13px;
      text-align: center;
    }
    .site-footer a { color: inherit; }
    @media (max-width: 860px) {
      .shell { width: min(100% - 24px, 640px); padding-top: 20px; }
      .hero, .band, .download-list, .security-note { grid-template-columns: 1fr; min-height: auto; }
      .nav { margin-bottom: 32px; }
      h1 { font-size: 42px; }
      .download-hero h1 { font-size: 40px; }
      .product-panel { margin-top: 8px; }
      .panel-top, .cap-grid, .download-meta { padding-left: 22px; padding-right: 22px; }
      .download-card { grid-template-rows: auto; }
      .download-card > p { min-height: 0; }
      .card-meta div { grid-template-columns: 104px minmax(0, 1fr); }
      .security-note { padding: 18px; }
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
