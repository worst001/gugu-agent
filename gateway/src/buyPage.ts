export function createBuyPageHtml(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Gugu Agent 购买与续费</title>
  <meta name="description" content="购买或续费 Gugu Agent 托管额度，付款后领取激活码。">
  <style>
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
      --shadow: 0 24px 70px rgba(88, 54, 28, 0.16);
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      min-height: 100vh;
      background:
        radial-gradient(circle at 10% 0%, rgba(49, 95, 145, 0.12), transparent 31rem),
        linear-gradient(180deg, #fff7ea 0%, var(--bg) 58%, #f3eadc 100%);
      color: var(--ink);
      font-family: "PingFang SC", "Microsoft YaHei", "Noto Sans SC", system-ui, sans-serif;
      line-height: 1.6;
    }

    a {
      color: inherit;
      text-decoration: none;
    }

    .shell {
      width: min(1120px, calc(100% - 32px));
      margin: 0 auto;
      padding: 28px 0 42px;
    }

    .nav {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 48px;
    }

    .brand {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      font-weight: 800;
      letter-spacing: 0;
    }

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

    .nav-note {
      color: var(--muted);
      font-size: 14px;
    }

    .hero {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(320px, 420px);
      gap: 52px;
      align-items: center;
      min-height: 480px;
    }

    .eyebrow {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 18px;
      color: var(--brand-dark);
      font-size: 14px;
      font-weight: 700;
    }

    .eyebrow::before {
      content: "";
      width: 8px;
      height: 8px;
      border-radius: 999px;
      background: var(--green);
    }

    h1,
    h2,
    h3,
    p {
      margin: 0;
    }

    h1 {
      max-width: 760px;
      font-size: clamp(42px, 8vw, 76px);
      line-height: 0.98;
      letter-spacing: 0;
    }

    .lead {
      max-width: 620px;
      margin-top: 24px;
      color: var(--muted);
      font-size: 19px;
    }

    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      margin-top: 34px;
    }

    .button {
      display: inline-flex;
      min-height: 46px;
      align-items: center;
      justify-content: center;
      border-radius: 999px;
      padding: 0 20px;
      border: 1px solid transparent;
      font-weight: 750;
      transition: transform 160ms ease, box-shadow 160ms ease, border-color 160ms ease;
    }

    .button:focus-visible {
      outline: 3px solid rgba(49, 95, 145, 0.28);
      outline-offset: 3px;
    }

    .button:hover {
      transform: translateY(-1px);
    }

    .button.primary {
      background: var(--brand);
      color: #fffaf2;
      box-shadow: 0 16px 34px rgba(155, 90, 50, 0.24);
    }

    .button.secondary {
      border-color: var(--line);
      background: rgba(255, 250, 242, 0.72);
      color: var(--brand-dark);
    }

    .activation-card {
      position: relative;
      overflow: hidden;
      border: 1px solid var(--line);
      border-radius: 28px;
      background: var(--surface-strong);
      box-shadow: var(--shadow);
      animation: lift 520ms ease both;
    }

    .activation-card::before {
      content: "";
      position: absolute;
      inset: 0 0 auto;
      height: 8px;
      background: linear-gradient(90deg, var(--brand), var(--green), var(--blue));
    }

    .card-inner {
      padding: 34px;
    }

    .card-label {
      color: var(--muted);
      font-size: 13px;
      font-weight: 700;
    }

    .code {
      margin: 18px 0 22px;
      padding: 18px;
      border: 1px dashed rgba(155, 90, 50, 0.45);
      border-radius: 18px;
      background: #fff8ee;
      font-size: 22px;
      font-weight: 900;
      letter-spacing: 0;
    }

    .status-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 14px 0;
      border-top: 1px solid #f0deca;
      color: var(--muted);
      font-size: 14px;
    }

    .status-row strong {
      color: var(--ink);
    }

    .pill {
      display: inline-flex;
      align-items: center;
      border-radius: 999px;
      padding: 5px 10px;
      background: rgba(47, 125, 105, 0.11);
      color: var(--green);
      font-size: 12px;
      font-weight: 800;
      white-space: nowrap;
    }

    .sections {
      display: grid;
      gap: 22px;
      margin-top: 46px;
    }

    .section {
      border: 1px solid var(--line);
      border-radius: 24px;
      background: rgba(255, 250, 242, 0.72);
      padding: 26px;
      backdrop-filter: blur(12px);
    }

    .section h2 {
      margin-bottom: 18px;
      font-size: 24px;
      line-height: 1.2;
    }

    .plans,
    .steps {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 14px;
    }

    .plan,
    .step {
      border: 1px solid #ead5bf;
      border-radius: 18px;
      background: var(--surface-strong);
      padding: 18px;
    }

    .plan h3,
    .step h3 {
      margin-bottom: 8px;
      font-size: 18px;
    }

    .plan p,
    .step p,
    .note {
      color: var(--muted);
      font-size: 15px;
    }

    .step-number {
      display: inline-grid;
      width: 30px;
      height: 30px;
      margin-bottom: 12px;
      place-items: center;
      border-radius: 10px;
      background: rgba(49, 95, 145, 0.12);
      color: var(--blue);
      font-weight: 900;
    }

    .contact {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 18px;
      border-color: rgba(47, 125, 105, 0.28);
      background: #f7fff9;
    }

    .contact p {
      max-width: 760px;
      color: #426857;
    }

    footer {
      margin-top: 28px;
      color: var(--muted);
      font-size: 13px;
      text-align: center;
    }

    @keyframes lift {
      from {
        opacity: 0;
        transform: translateY(12px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    @media (max-width: 820px) {
      .shell {
        width: min(100% - 24px, 640px);
        padding-top: 20px;
      }

      .nav {
        margin-bottom: 28px;
      }

      .nav-note {
        display: none;
      }

      .hero {
        grid-template-columns: 1fr;
        gap: 30px;
        min-height: 0;
      }

      h1 {
        font-size: clamp(40px, 13vw, 58px);
      }

      .lead {
        font-size: 17px;
      }

      .card-inner,
      .section {
        padding: 22px;
      }

      .plans,
      .steps {
        grid-template-columns: 1fr;
      }

      .contact {
        align-items: stretch;
        flex-direction: column;
      }
    }
  </style>
</head>
<body>
  <main class="shell">
    <nav class="nav" aria-label="页面导航">
      <a class="brand" href="#top" aria-label="Gugu Agent">
        <span class="brand-mark">G</span>
        <span>Gugu Agent</span>
      </a>
      <span class="nav-note">人工开通 · 激活码升级</span>
    </nav>

    <section id="top" class="hero">
      <div>
        <p class="eyebrow">购买 / 续费入口</p>
        <h1>继续使用 Gugu 托管额度</h1>
        <p class="lead">第一版采用人工发码。确认套餐并完成付款后，Gugu 团队会为你签发激活码，你回到桌面端输入即可完成升级。</p>
        <div class="actions">
          <a class="button primary" href="#contact">联系开通</a>
          <a class="button secondary" href="#activation">查看激活步骤</a>
        </div>
      </div>

      <aside class="activation-card" aria-label="激活码示意">
        <div class="card-inner">
          <p class="card-label">激活码示意</p>
          <div class="code">GUGU-••••-••••</div>
          <div class="status-row">
            <span>开通方式</span>
            <strong>人工核验后发码</strong>
          </div>
          <div class="status-row">
            <span>可用套餐</span>
            <span class="pill">Pro / Team</span>
          </div>
          <div class="status-row">
            <span>桌面端路径</span>
            <strong>设置 → 订阅</strong>
          </div>
        </div>
      </aside>
    </section>

    <div class="sections">
      <section id="plans" class="section">
        <h2>选择套餐</h2>
        <div class="plans">
          <article class="plan">
            <h3>Pro</h3>
            <p>适合个人开发者和高频使用者。用于托管模型调用、附件解析等消耗额度的能力。</p>
          </article>
          <article class="plan">
            <h3>Team</h3>
            <p>适合小团队或多设备使用。可按额度、有效期和可激活次数签发激活码。</p>
          </article>
        </div>
        <p class="note" style="margin-top: 14px;">实际价格、额度和有效期以当前沟通渠道确认为准；本页面不会自动扣费。</p>
      </section>

      <section id="activation" class="section">
        <h2>三步完成开通</h2>
        <div class="steps">
          <article class="step">
            <span class="step-number">1</span>
            <h3>确认套餐</h3>
            <p>联系 Gugu 团队，说明你要购买或续费的套餐、额度和有效期。</p>
          </article>
          <article class="step">
            <span class="step-number">2</span>
            <h3>完成付款</h3>
            <p>付款后发送付款凭证、联系信息和需要绑定的使用场景，等待人工核验。</p>
          </article>
          <article class="step">
            <span class="step-number">3</span>
            <h3>领取激活码</h3>
            <p>核验通过后，你会收到一串 GUGU 开头的激活码。</p>
          </article>
          <article class="step">
            <span class="step-number">4</span>
            <h3>回到桌面端激活</h3>
            <p>打开 Gugu Agent 桌面端，在“设置 → 订阅”里粘贴激活码并点击激活。</p>
          </article>
        </div>
      </section>

      <section id="contact" class="section contact">
        <div>
          <h2>联系开通</h2>
          <p>请通过你获取安装包或服务的原沟通渠道联系 Gugu 团队。付款与发码目前由人工处理，通常会在确认后签发激活码。</p>
        </div>
        <a class="button primary" href="#activation">我知道流程了</a>
      </section>
    </div>

    <footer>Gugu Agent 托管额度服务 · 当前为人工开通阶段</footer>
  </main>
</body>
</html>`
}
