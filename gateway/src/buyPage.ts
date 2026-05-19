import { formatAmountCny, GATEWAY_PACKAGES, PURCHASE_PACKAGES } from './packages.js'

export function createBuyPageHtml(): string {
  const publicPackages = PURCHASE_PACKAGES.map((pkg) => ({
    id: pkg.id,
    name: pkg.name,
    description: pkg.description,
    amountCents: pkg.amountCents,
  }))
  const packageOptions = PURCHASE_PACKAGES.map((pkg) => `
    <article class="plan" data-package-id="${escapeHtml(pkg.id)}">
      <div class="plan-copy">
        <p class="kind">月付套餐</p>
        <h3>${escapeHtml(pkg.name)}</h3>
        <p>${escapeHtml(pkg.description)}</p>
      </div>
      <div class="price">
        <strong>${escapeHtml(formatAmountCny(pkg.amountCents))}</strong>
      </div>
      <button type="button" data-buy="${escapeHtml(pkg.id)}">选择套餐</button>
    </article>
  `).join('')

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Gugu Agent 购买 / 续费</title>
  <meta name="description" content="购买或续费 Gugu Agent 托管额度，第一版采用人工确认收款后发码。">
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
      --shadow: 0 24px 70px rgba(88, 54, 28, 0.14);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      background:
        radial-gradient(circle at 14% 0%, rgba(49, 95, 145, 0.12), transparent 31rem),
        linear-gradient(180deg, #fff7ea 0%, var(--bg) 58%, #f3eadc 100%);
      color: var(--ink);
      font-family: "PingFang SC", "Microsoft YaHei", "Noto Sans SC", system-ui, sans-serif;
      line-height: 1.6;
    }
    .shell { width: min(1120px, calc(100% - 32px)); margin: 0 auto; padding: 28px 0 42px; }
    .nav { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 42px; }
    .brand { display: inline-flex; align-items: center; gap: 10px; font-weight: 850; }
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
    .nav-note { color: var(--muted); font-size: 14px; }
    .hero {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(320px, 420px);
      gap: 52px;
      align-items: center;
      margin-bottom: 36px;
    }
    .eyebrow {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 18px;
      color: var(--brand-dark);
      font-size: 14px;
      font-weight: 750;
    }
    .eyebrow::before {
      content: "";
      width: 8px;
      height: 8px;
      border-radius: 999px;
      background: var(--green);
    }
    h1, h2, h3, p { margin: 0; }
    h1 { max-width: 760px; font-size: clamp(42px, 8vw, 76px); line-height: 0.98; letter-spacing: 0; }
    .lead { max-width: 650px; margin-top: 24px; color: var(--muted); font-size: 19px; }
    .summary {
      position: relative;
      overflow: hidden;
      border: 1px solid var(--line);
      border-radius: 28px;
      background: var(--surface-strong);
      box-shadow: var(--shadow);
    }
    .summary::before {
      content: "";
      position: absolute;
      inset: 0 0 auto;
      height: 8px;
      background: linear-gradient(90deg, var(--brand), var(--green), var(--blue));
    }
    .summary-inner { padding: 34px; }
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
    .row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 13px 0;
      border-top: 1px solid #f0deca;
      color: var(--muted);
      font-size: 14px;
    }
    .row strong { color: var(--ink); }
    .pill {
      display: inline-flex;
      border-radius: 999px;
      padding: 5px 10px;
      background: rgba(47, 125, 105, 0.11);
      color: var(--green);
      font-size: 12px;
      font-weight: 850;
      white-space: nowrap;
    }
    .section {
      border: 1px solid var(--line);
      border-radius: 24px;
      background: rgba(255, 250, 242, 0.76);
      padding: 26px;
      backdrop-filter: blur(12px);
      margin-top: 18px;
    }
    .section h2 { margin-bottom: 18px; font-size: 24px; line-height: 1.2; }
    .plans { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
    .plan {
      display: grid;
      grid-template-rows: 96px auto auto;
      gap: 18px;
      border: 1px solid #ead5bf;
      border-radius: 18px;
      background: var(--surface-strong);
      padding: 18px;
      transition: border-color 0.16s ease, box-shadow 0.16s ease, transform 0.16s ease;
    }
    .plan:hover {
      border-color: rgba(155, 90, 50, 0.42);
      transform: translateY(-1px);
    }
    .plan.selected {
      border-color: rgba(47, 125, 105, 0.66);
      box-shadow: 0 0 0 3px rgba(47, 125, 105, 0.12);
    }
    .plan-copy {
      min-width: 0;
    }
    .plan h3 { font-size: 20px; }
    .plan p { color: var(--muted); font-size: 15px; }
    .kind { color: var(--brand-dark); font-size: 13px; font-weight: 800; }
    .price strong { display: block; font-size: 30px; line-height: 1; }
    button {
      min-height: 44px;
      border: 1px solid var(--brand);
      border-radius: 999px;
      background: var(--brand);
      color: #fffaf2;
      padding: 0 18px;
      font: inherit;
      font-weight: 800;
      cursor: pointer;
    }
    button.secondary {
      background: rgba(255, 250, 242, 0.72);
      color: var(--brand-dark);
      border-color: var(--line);
    }
    .steps { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; }
    .step {
      border: 1px solid #ead5bf;
      border-radius: 18px;
      background: var(--surface-strong);
      padding: 18px;
    }
    .step b {
      display: grid;
      width: 30px;
      height: 30px;
      margin-bottom: 12px;
      place-items: center;
      border-radius: 10px;
      background: rgba(49, 95, 145, 0.12);
      color: var(--blue);
    }
    .order-box {
      display: grid;
      gap: 12px;
      border: 1px solid rgba(47, 125, 105, 0.28);
      border-radius: 18px;
      background: #f7fff9;
      padding: 18px;
      margin-top: 16px;
    }
    .order-box input {
      width: 100%;
      height: 44px;
      border: 1px solid var(--line);
      border-radius: 12px;
      background: #fffdf8;
      padding: 0 12px;
      font: inherit;
    }
    .order-result {
      display: none;
      border: 1px dashed rgba(47, 125, 105, 0.45);
      border-radius: 14px;
      padding: 14px;
      background: #ffffff;
    }
    .order-result.show { display: block; }
    .error { color: #a33f32; font-weight: 700; min-height: 22px; }
    footer { margin-top: 28px; color: var(--muted); font-size: 13px; text-align: center; }
    @media (max-width: 860px) {
      .shell { width: min(100% - 24px, 640px); padding-top: 20px; }
      .nav-note { display: none; }
      .hero, .plans, .steps { grid-template-columns: 1fr; }
      h1 { font-size: clamp(40px, 13vw, 58px); }
      .summary-inner, .section { padding: 22px; }
      .plan { grid-template-rows: auto auto auto; }
    }
  </style>
</head>
<body>
  <main class="shell">
    <nav class="nav">
      <div class="brand"><span class="brand-mark">G</span><span>Gugu Agent</span></div>
      <span class="nav-note">托管额度 · 人工确认收款后发码</span>
    </nav>

    <section class="hero">
      <div>
        <p class="eyebrow">购买 / 续费入口</p>
        <h1>继续使用 Gugu 托管额度</h1>
        <p class="lead">当前版本先采用人工收款和发码。选择套餐生成订单号，付款后把订单号发给客服；确认后会签发激活码，你回到桌面端“设置 → 订阅”输入即可升级。</p>
      </div>
      <aside class="summary">
        <div class="summary-inner">
          <p class="kind">激活码示意</p>
          <div class="code">GUGU-••••••••</div>
          <div class="row"><span>开通方式</span><strong>人工核验后发码</strong></div>
          <div class="row"><span>试用权益</span><span class="pill">${GATEWAY_PACKAGES.trial.durationDays} 天试用</span></div>
          <div class="row"><span>桌面端路径</span><strong>设置 → 订阅</strong></div>
        </div>
      </aside>
    </section>

    <section class="section" id="plans">
      <h2>选择套餐</h2>
      <div class="plans">${packageOptions}</div>
      <div class="order-box">
        <div>
          <h3 id="selectedTitle">选择一个套餐后提交订单</h3>
          <p id="selectedDesc">付款前请先生成订单号，方便人工核对。</p>
        </div>
        <input id="contact" placeholder="联系方式或备注，例如微信、手机号、邮箱">
        <button id="createOrder" type="button" disabled>提交订单</button>
        <div id="orderError" class="error"></div>
        <div id="orderResult" class="order-result"></div>
      </div>
    </section>

    <section class="section">
      <h2>激活步骤</h2>
      <div class="steps">
        <article class="step"><b>1</b><h3>选择套餐</h3><p>轻量版适合偶尔使用，Pro 适合日常开发，Max 适合高频和复杂项目。</p></article>
        <article class="step"><b>2</b><h3>生成订单</h3><p>留下联系方式或备注，页面会生成唯一订单号。</p></article>
        <article class="step"><b>3</b><h3>付款并联系</h3><p>付款后发送订单号，管理员确认收款后签发激活码。</p></article>
        <article class="step"><b>4</b><h3>桌面端激活</h3><p>打开 Gugu Agent，进入“设置 → 订阅”，粘贴激活码完成升级。</p></article>
      </div>
    </section>

    <footer>自动支付会在备案、HTTPS 域名和公司商户账号准备好后接入；本期不承诺自动到账。</footer>
  </main>

  <script>
    const packages = ${JSON.stringify(publicPackages).replace(/</g, '\\u003c')}
    let selected = null
    const selectedTitle = document.getElementById('selectedTitle')
    const selectedDesc = document.getElementById('selectedDesc')
    const createOrder = document.getElementById('createOrder')
    const contact = document.getElementById('contact')
    const orderError = document.getElementById('orderError')
    const orderResult = document.getElementById('orderResult')

    document.querySelectorAll('[data-buy]').forEach((button) => {
      button.addEventListener('click', () => {
        selected = packages.find((item) => item.id === button.dataset.buy)
        if (!selected) return
        selectedTitle.textContent = selected.name + ' · ' + formatCny(selected.amountCents)
        selectedDesc.textContent = selected.description
        createOrder.disabled = false
        orderResult.classList.remove('show')
        orderError.textContent = ''
        document.querySelectorAll('.plan').forEach((item) => item.classList.toggle('selected', item.dataset.packageId === selected.id))
      })
    })

    createOrder.addEventListener('click', async () => {
      if (!selected) return
      createOrder.disabled = true
      orderError.textContent = ''
      try {
        const response = await fetch('/v1/orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ packageId: selected.id, contact: contact.value.trim() }),
        })
        const body = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(body?.error?.message || '订单创建失败')
        renderOrder(body.order)
      } catch (error) {
        orderError.textContent = error.message || String(error)
      } finally {
        createOrder.disabled = false
      }
    })

    function renderOrder(order) {
      orderResult.classList.add('show')
      orderResult.innerHTML = [
        '<strong>订单号：' + escapeHtml(order.orderId) + '</strong>',
        '<p>套餐：' + escapeHtml(order.packageName) + '，金额：' + formatCny(order.amountCents) + '。</p>',
        '<p>请付款后把订单号和联系方式发送给客服。管理员确认收款后，会发你一个 GUGU 激活码。</p>',
        '<button class="secondary" type="button" onclick="navigator.clipboard && navigator.clipboard.writeText(\\'' + escapeAttr(order.orderId) + '\\')">复制订单号</button>',
      ].join('')
    }

    function formatCny(cents) {
      return '¥' + (Number(cents || 0) / 100).toFixed(Number(cents || 0) % 100 === 0 ? 0 : 2)
    }
    function escapeHtml(value) {
      return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]))
    }
    function escapeAttr(value) { return escapeHtml(value) }
  </script>
</body>
</html>`
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
