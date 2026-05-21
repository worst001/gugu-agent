import {
  formatAmountCny,
  getGatewayPackage,
  isPurchasablePackageId,
  PURCHASE_PACKAGES,
} from './packages.js'
import type { GatewayPackage } from './types.js'

type BuyPageOptions = {
  wechatPayEnabled?: boolean
  alipayPayEnabled?: boolean
  icpRecord?: string | null
  icpUrl?: string | null
}

type CheckoutPageOptions = BuyPageOptions & {
  packageId?: string | null
}

export function createBuyPageHtml(options: BuyPageOptions = {}): string {
  const planCards = PURCHASE_PACKAGES.map((pkg) => `
    <article class="plan-card">
      <div>
        <p class="plan-kind">月付套餐</p>
        <h2>${escapeHtml(pkg.name)}</h2>
        <p>${escapeHtml(pkg.description)}</p>
      </div>
      <div class="plan-meta">
        <strong>${escapeHtml(formatAmountCny(pkg.amountCents))}</strong>
        <span>${pkg.credits.toLocaleString('zh-CN')} 点数 / ${formatDuration(pkg)}</span>
      </div>
      <a class="primary-action" href="/checkout?packageId=${encodeURIComponent(pkg.id)}">订阅</a>
    </article>
  `).join('')

  return pageHtml({
    title: 'Gugu Agent 订阅',
    icpRecord: options.icpRecord,
    icpUrl: options.icpUrl,
    body: `
      <header class="topbar">
        <a class="brand" href="/">
          <span class="brand-mark">G</span>
          <span>Gugu Agent</span>
        </a>
        <a class="text-link" href="/download">下载客户端</a>
      </header>

      <section class="buy-hero">
        <div class="hero-copy">
          <p class="eyebrow">Gugu Agent 订阅</p>
          <h1>给你的 AI 开发工作流留好余量</h1>
          <p>从偶尔修小问题，到日常开发、调试和文件解析，按当月工作量选择套餐。订单与支付已经独立到结算页，购买页只负责帮你选对档位。</p>
          <div class="hero-actions">
            <a class="primary-action inline" href="#subscriptions">查看套餐</a>
            <a class="secondary-action" href="/download">先下载客户端</a>
          </div>
        </div>
        <aside class="hero-panel" aria-label="订阅流程概览">
          <div class="panel-head">
            <span>当前购买流程</span>
            <strong>在线发码</strong>
          </div>
          <ol class="hero-steps">
            <li><span>1</span><p><strong>选择套餐</strong><small>购买页只展示订阅列表</small></p></li>
            <li><span>2</span><p><strong>进入结算页</strong><small>填写联系方式并选择支付方式</small></p></li>
            <li><span>3</span><p><strong>支付后激活</strong><small>微信支付成功自动展示激活码</small></p></li>
          </ol>
        </aside>
      </section>

      <section class="trust-row" aria-label="购买保障">
        <div><strong>微信 Native</strong><span>扫码支付后自动发码</span></div>
        <div><strong>31 天有效</strong><span>套餐按自然月工作周期设计</span></div>
        <div><strong>人工兜底</strong><span>支付异常可在后台处理</span></div>
        <div><strong>桌面端激活</strong><span>复制激活码即可恢复套餐</span></div>
      </section>

      <section class="subscriptions" id="subscriptions" aria-labelledby="subscriptionsTitle">
        <div class="section-heading">
          <p class="eyebrow">订阅套餐</p>
          <h2 id="subscriptionsTitle">选择适合当前工作量的套餐</h2>
          <p>轻量版适合偶尔使用，Pro 适合日常开发，Max 适合更高频的复杂项目与文件解析额度。</p>
        </div>
        <div class="plans" aria-label="订阅套餐列表">
          ${planCards}
        </div>
      </section>

      <section class="detail-grid" aria-label="套餐说明">
        <article class="detail-panel">
          <p class="eyebrow">怎么选</p>
          <h2>按真实使用频率买</h2>
          <ul class="check-list">
            <li><strong>轻量版</strong><span>适合临时修 bug、少量问答和轻量文件处理。</span></li>
            <li><strong>Pro</strong><span>适合每天打开 Gugu Agent 处理开发任务。</span></li>
            <li><strong>Max</strong><span>适合高频使用、复杂项目和更多解析额度。</span></li>
          </ul>
        </article>
        <article class="detail-panel">
          <p class="eyebrow">支付状态</p>
          <h2>结算页单独处理</h2>
          <p class="detail-copy">点击“订阅”后再创建订单，避免只是浏览购买页就产生待付款订单。支付宝入口已预留，正式接入后会在结算页直接启用。</p>
        </article>
      </section>
    `,
  })
}

export function createCheckoutPageHtml(options: CheckoutPageOptions = {}): string {
  const selected = getGatewayPackage(options.packageId ?? undefined)
  if (!selected || !isPurchasablePackageId(selected.id)) {
    return pageHtml({
      title: 'Gugu Agent 结算',
      icpRecord: options.icpRecord,
      icpUrl: options.icpUrl,
      body: `
        <header class="topbar">
          <a class="brand" href="/">
            <span class="brand-mark">G</span>
            <span>Gugu Agent</span>
          </a>
          <a class="text-link" href="/buy">返回套餐页</a>
        </header>

        <section class="empty-state">
          <p class="eyebrow">结算页</p>
          <h1>套餐不可用</h1>
          <p>当前链接缺少有效套餐，或者该套餐暂不支持在线购买。</p>
          <a class="primary-action inline" href="/buy">返回套餐页</a>
        </section>
      `,
    })
  }

  const publicPackage = {
    id: selected.id,
    name: selected.name,
    description: selected.description,
    amountCents: selected.amountCents,
    credits: selected.credits,
    durationLabel: formatDuration(selected),
  }
  const publicPackageJson = JSON.stringify(publicPackage).replace(/</g, '\\u003c')

  return pageHtml({
    title: `${selected.name} 结算 - Gugu Agent`,
    icpRecord: options.icpRecord,
    icpUrl: options.icpUrl,
    body: `
      <header class="topbar">
        <a class="brand" href="/">
          <span class="brand-mark">G</span>
          <span>Gugu Agent</span>
        </a>
        <a class="text-link" href="/buy">更换套餐</a>
      </header>

      <section class="checkout-head">
        <p class="eyebrow">订单结算</p>
        <h1>${escapeHtml(selected.name)} 订阅</h1>
        <p>填写联系方式后选择支付方式。微信支付完成后，页面会自动展示激活码。</p>
      </section>

      <div class="checkout-layout">
        <section class="order-section" aria-labelledby="orderTitle">
          <div class="section-title">
            <h2 id="orderTitle">订单信息</h2>
            <span>${escapeHtml(formatAmountCny(selected.amountCents))}</span>
          </div>
          <dl class="summary-list">
            <div><dt>套餐</dt><dd>${escapeHtml(selected.name)}</dd></div>
            <div><dt>权益</dt><dd>${selected.credits.toLocaleString('zh-CN')} 点数</dd></div>
            <div><dt>有效期</dt><dd>${escapeHtml(formatDuration(selected))}</dd></div>
            <div><dt>说明</dt><dd>${escapeHtml(selected.description)}</dd></div>
          </dl>

          <label class="field">
            <span>联系方式或备注</span>
            <input id="contact" placeholder="例如微信、手机号、邮箱，便于异常时联系" autocomplete="off">
          </label>

          <div class="payment-methods" aria-label="支付方式">
            <button id="wechatPayButton" class="payment-method selected" type="button" data-provider="wechat">
              ${wechatIcon()}
              <span>
                <strong>微信支付</strong>
                <small>${options.wechatPayEnabled ? '扫码后自动发放激活码' : '当前走人工兜底处理'}</small>
              </span>
              <em>${options.wechatPayEnabled ? '推荐' : '兜底'}</em>
            </button>

            <button id="alipayPayButton" class="payment-method ${options.alipayPayEnabled ? '' : 'unavailable'}" type="button" data-provider="alipay" aria-disabled="${options.alipayPayEnabled ? 'false' : 'true'}">
              ${alipayIcon()}
              <span>
                <strong>支付宝</strong>
                <small>${options.alipayPayEnabled ? '扫码后自动发放激活码' : '即将上线，请先使用微信支付'}</small>
              </span>
              <em>${options.alipayPayEnabled ? '可用' : '即将上线'}</em>
            </button>
          </div>

          <div id="notice" class="notice" role="status" aria-live="polite"></div>
        </section>

        <section class="pay-section" aria-labelledby="payTitle">
          <div class="section-title">
            <h2 id="payTitle">支付状态</h2>
            <span id="payAmount">${escapeHtml(formatAmountCny(selected.amountCents))}</span>
          </div>
          <div id="paymentState" class="payment-state">
            <p>请选择微信支付生成二维码。</p>
          </div>
          <div id="orderResult" class="order-result" hidden></div>
        </section>
      </div>

      <script>
        const selectedPackage = ${publicPackageJson}
        const wechatPayEnabled = ${options.wechatPayEnabled ? 'true' : 'false'}
        const alipayPayEnabled = ${options.alipayPayEnabled ? 'true' : 'false'}
        let pollTimer = null
        let countdownTimer = null
        const contact = document.getElementById('contact')
        const notice = document.getElementById('notice')
        const paymentState = document.getElementById('paymentState')
        const orderResult = document.getElementById('orderResult')
        const wechatPayButton = document.getElementById('wechatPayButton')
        const alipayPayButton = document.getElementById('alipayPayButton')

        wechatPayButton.addEventListener('click', function () { createPaymentOrder('wechat') })
        alipayPayButton.addEventListener('click', function () {
          if (!alipayPayEnabled) {
            showNotice('支付宝即将上线，请先使用微信支付。', 'info')
            return
          }
          createPaymentOrder('alipay')
        })

        async function createPaymentOrder(provider) {
          stopTimers()
          setBusy(true)
          showNotice('', '')
          orderResult.hidden = true
          orderResult.innerHTML = ''
          paymentState.innerHTML = '<p>正在生成订单...</p>'

          try {
            const response = await fetch('/v1/orders', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                packageId: selectedPackage.id,
                contact: contact.value.trim(),
                paymentProvider: provider,
              }),
            })
            const body = await response.json().catch(function () { return {} })
            if (!response.ok) {
              throw new Error((body.error && body.error.message) || '订单创建失败')
            }
            renderOrder(body)
          } catch (error) {
            paymentState.innerHTML = '<p>订单创建失败，请稍后重试。</p>'
            showNotice(error.message || String(error), 'error')
          } finally {
            setBusy(false)
          }
        }

        function renderOrder(body) {
          const order = body.order
          const payment = body.payment
          if (!order) {
            showNotice('订单响应异常，请稍后重试。', 'error')
            return
          }

          if (payment && payment.qrDataUrl) {
            const providerLabel = payment.provider === 'alipay' ? '支付宝' : '微信'
            paymentState.innerHTML = [
              '<img class="qr" src="' + escapeAttr(payment.qrDataUrl) + '" alt="' + providerLabel + '支付二维码">',
              '<p>请使用' + providerLabel + '扫码支付。</p>',
              '<p id="countdown" class="muted"></p>',
            ].join('')
            renderPendingOrder(order, providerLabel + '订单已创建，等待支付。')
            startCountdown(payment.expiresAt)
            startPolling(order.orderId, body.orderToken)
            return
          }

          paymentState.innerHTML = [
            '<p>在线支付暂不可用，订单已进入人工处理。</p>',
            '<p class="muted">我们会根据联系方式完成收款和发码。</p>',
          ].join('')
          renderPendingOrder(order, body.paymentError || '订单已创建，等待人工处理。')
          startPolling(order.orderId, body.orderToken)
        }

        function renderPendingOrder(order, message) {
          orderResult.hidden = false
          orderResult.innerHTML = [
            '<div class="result-row"><span>订单号</span><strong>' + escapeHtml(order.orderId) + '</strong></div>',
            '<div class="result-row"><span>套餐</span><strong>' + escapeHtml(order.packageName) + '</strong></div>',
            '<div class="result-row"><span>金额</span><strong>' + formatCny(order.amountCents) + '</strong></div>',
            '<p class="muted">' + escapeHtml(message) + '</p>',
          ].join('')
        }

        function startPolling(orderId, orderToken) {
          if (!orderId || !orderToken) return
          const poll = async function () {
            try {
              const response = await fetch('/v1/orders/' + encodeURIComponent(orderId) + '/status', {
                headers: { 'X-Gugu-Order-Token': orderToken },
              })
              const body = await response.json().catch(function () { return {} })
              if (!response.ok) throw new Error((body.error && body.error.message) || '订单状态查询失败')
              if (body.licenseKey) {
                stopTimers()
                renderFulfilled(body.order, body.licenseKey)
                return
              }
              if (body.order && body.order.status === 'cancelled') {
                stopTimers()
                showNotice('订单已取消。', 'error')
              }
            } catch (error) {
              showNotice(error.message || String(error), 'error')
            }
          }
          poll()
          pollTimer = window.setInterval(poll, 3000)
        }

        function renderFulfilled(order, licenseKey) {
          paymentState.innerHTML = '<p class="success-text">支付成功，激活码已生成。</p>'
          orderResult.hidden = false
          orderResult.innerHTML = [
            '<div class="result-row"><span>订单号</span><strong>' + escapeHtml(order.orderId) + '</strong></div>',
            '<code class="license">' + escapeHtml(licenseKey) + '</code>',
            '<button class="primary-action inline" type="button" data-copy-license="' + escapeAttr(licenseKey) + '">复制激活码</button>',
            '<p class="muted">回到桌面端“设置 → 订阅”粘贴激活。</p>',
          ].join('')
          showNotice('订单已完成。', 'success')
        }

        function startCountdown(expiresAt) {
          const countdown = document.getElementById('countdown')
          if (!countdown || !expiresAt) return
          const tick = function () {
            const remain = Date.parse(expiresAt) - Date.now()
            if (remain <= 0) {
              countdown.textContent = '二维码已过期，请重新生成订单。'
              stopTimers()
              return
            }
            const minutes = Math.floor(remain / 60000)
            const seconds = Math.floor((remain % 60000) / 1000)
            countdown.textContent = '剩余 ' + minutes + ' 分 ' + String(seconds).padStart(2, '0') + ' 秒'
          }
          tick()
          countdownTimer = window.setInterval(tick, 1000)
        }

        document.addEventListener('click', function (event) {
          const button = event.target.closest('[data-copy-license]')
          if (button) copyText(button.dataset.copyLicense)
        })

        function setBusy(busy) {
          wechatPayButton.disabled = busy
          alipayPayButton.disabled = busy
        }

        function showNotice(message, tone) {
          notice.textContent = message
          notice.className = 'notice' + (tone ? ' ' + tone : '')
        }

        function stopTimers() {
          if (pollTimer) window.clearInterval(pollTimer)
          if (countdownTimer) window.clearInterval(countdownTimer)
          pollTimer = null
          countdownTimer = null
        }

        async function copyText(value) {
          if (!value) return
          if (navigator.clipboard) await navigator.clipboard.writeText(value)
        }

        function formatCny(cents) {
          const amount = Number(cents || 0)
          return '¥' + (amount / 100).toFixed(amount % 100 === 0 ? 0 : 2)
        }

        function escapeHtml(value) {
          return String(value).replace(/[&<>"']/g, function (char) {
            return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[char] || char
          })
        }

        function escapeAttr(value) {
          return escapeHtml(value)
        }
      </script>
    `,
  })
}

function pageHtml(input: { title: string; body: string; icpRecord?: string | null; icpUrl?: string | null }): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(input.title)}</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f4f6f8;
      --surface: #ffffff;
      --surface-soft: #f7faf8;
      --ink: #201b17;
      --muted: #675f57;
      --line: #dfe5e1;
      --brand: #9b5a32;
      --brand-dark: #713d21;
      --green: #168a54;
      --blue: #1769c2;
      --red: #a33f32;
      --shadow: 0 18px 44px rgba(36, 31, 26, 0.08);
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
    .shell {
      width: min(1120px, calc(100% - 32px));
      margin: 0 auto;
      padding: 28px 0 48px;
    }
    .topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 38px;
    }
    .brand, .text-link {
      color: inherit;
      text-decoration: none;
    }
    .brand {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      font-weight: 850;
    }
    .brand-mark {
      display: grid;
      width: 34px;
      height: 34px;
      place-items: center;
      border: 1px solid rgba(155, 90, 50, 0.3);
      border-radius: 8px;
      background: var(--surface);
      color: var(--brand);
      box-shadow: 0 8px 20px rgba(36, 31, 26, 0.08);
      font-weight: 900;
    }
    .text-link {
      color: var(--brand-dark);
      font-weight: 750;
    }
    .buy-hero {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 360px;
      gap: 34px;
      align-items: stretch;
      margin-bottom: 22px;
    }
    .hero-copy {
      min-height: 360px;
      display: grid;
      align-content: center;
      padding: 18px 0 28px;
    }
    .hero-copy p:not(.eyebrow), .checkout-head p, .empty-state p {
      margin-top: 14px;
      color: var(--muted);
      font-size: 18px;
    }
    .hero-actions {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-top: 26px;
      flex-wrap: wrap;
    }
    .hero-actions .primary-action.inline {
      margin-top: 0;
    }
    .hero-panel {
      align-self: center;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: linear-gradient(180deg, #ffffff 0%, #f7faf8 100%);
      box-shadow: var(--shadow);
      padding: 18px;
    }
    .panel-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding-bottom: 14px;
      border-bottom: 1px solid #edf1ee;
    }
    .panel-head span {
      color: var(--muted);
      font-weight: 750;
    }
    .panel-head strong {
      color: var(--green);
      font-size: 20px;
    }
    .hero-steps {
      display: grid;
      gap: 14px;
      margin: 18px 0 0;
      padding: 0;
      list-style: none;
    }
    .hero-steps li {
      display: grid;
      grid-template-columns: 34px minmax(0, 1fr);
      gap: 12px;
      align-items: start;
    }
    .hero-steps li > span {
      display: grid;
      width: 34px;
      height: 34px;
      place-items: center;
      border-radius: 8px;
      background: rgba(22, 138, 84, 0.1);
      color: var(--green);
      font-weight: 900;
    }
    .hero-steps strong,
    .hero-steps small {
      display: block;
    }
    .hero-steps small {
      color: var(--muted);
      font-size: 13px;
    }
    .checkout-head, .empty-state {
      max-width: 760px;
      margin-bottom: 24px;
    }
    .eyebrow {
      margin: 0 0 10px;
      color: var(--green);
      font-size: 14px;
      font-weight: 850;
    }
    h1, h2, p, dl, dd {
      margin: 0;
    }
    h1 {
      font-size: 44px;
      line-height: 1.08;
      letter-spacing: 0;
    }
    .trust-row {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 1px;
      overflow: hidden;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--line);
      margin-bottom: 34px;
    }
    .trust-row div {
      min-height: 90px;
      display: grid;
      align-content: center;
      gap: 4px;
      background: var(--surface);
      padding: 16px;
    }
    .trust-row strong {
      font-size: 17px;
    }
    .trust-row span {
      color: var(--muted);
      font-size: 14px;
    }
    .subscriptions {
      scroll-margin-top: 22px;
      margin-bottom: 30px;
    }
    .section-heading {
      max-width: 760px;
      margin-bottom: 20px;
    }
    .section-heading h2 {
      font-size: 34px;
      line-height: 1.12;
      letter-spacing: 0;
    }
    .section-heading p:not(.eyebrow) {
      margin-top: 10px;
      color: var(--muted);
      font-size: 17px;
    }
    .plans {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 14px;
    }
    .plan-card, .order-section, .pay-section, .empty-state {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--surface);
      box-shadow: var(--shadow);
    }
    .plan-card {
      display: grid;
      grid-template-rows: 128px auto auto;
      gap: 18px;
      padding: 20px;
    }
    .plan-kind {
      color: var(--muted);
      font-size: 13px;
      font-weight: 800;
    }
    .plan-card h2 {
      margin-top: 4px;
      font-size: 24px;
      letter-spacing: 0;
    }
    .plan-card p:not(.plan-kind), .plan-meta span {
      color: var(--muted);
    }
    .plan-meta {
      display: grid;
      gap: 6px;
    }
    .plan-meta strong {
      font-size: 34px;
      line-height: 1;
    }
    .primary-action {
      display: inline-flex;
      min-height: 44px;
      align-items: center;
      justify-content: center;
      border: 1px solid var(--brand);
      border-radius: 8px;
      background: var(--brand);
      color: #fff;
      padding: 0 18px;
      font: inherit;
      font-weight: 850;
      text-decoration: none;
      cursor: pointer;
    }
    .secondary-action {
      display: inline-flex;
      min-height: 44px;
      align-items: center;
      justify-content: center;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--surface);
      color: var(--brand-dark);
      padding: 0 18px;
      font-weight: 850;
      text-decoration: none;
    }
    .primary-action.inline {
      width: fit-content;
      min-height: 40px;
      margin-top: 16px;
    }
    button.primary-action.inline {
      margin-top: 10px;
    }
    .checkout-layout {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 380px;
      gap: 16px;
      align-items: start;
    }
    .order-section, .pay-section {
      padding: 20px;
    }
    .section-title {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 16px;
    }
    .section-title h2 {
      font-size: 22px;
      letter-spacing: 0;
    }
    .section-title span {
      color: var(--brand-dark);
      font-size: 22px;
      font-weight: 900;
      white-space: nowrap;
    }
    .summary-list {
      display: grid;
      gap: 10px;
      margin-bottom: 18px;
    }
    .summary-list div {
      display: grid;
      grid-template-columns: 76px minmax(0, 1fr);
      gap: 12px;
    }
    .summary-list dt {
      color: var(--muted);
    }
    .summary-list dd {
      font-weight: 750;
      overflow-wrap: anywhere;
    }
    .field {
      display: grid;
      gap: 8px;
      margin-bottom: 18px;
      font-weight: 750;
    }
    input {
      width: 100%;
      height: 46px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #fbfcfb;
      color: var(--ink);
      padding: 0 12px;
      font: inherit;
      outline: none;
    }
    input:focus {
      border-color: rgba(22, 138, 84, 0.8);
      box-shadow: 0 0 0 3px rgba(22, 138, 84, 0.12);
    }
    .payment-methods {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
    }
    .payment-method {
      display: grid;
      grid-template-columns: 38px minmax(0, 1fr);
      gap: 10px;
      position: relative;
      min-height: 84px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--surface);
      color: var(--ink);
      padding: 12px;
      text-align: left;
      font: inherit;
      cursor: pointer;
    }
    .payment-method.selected {
      border-color: rgba(22, 138, 84, 0.62);
      background: var(--surface-soft);
    }
    .payment-method.unavailable {
      opacity: 0.64;
    }
    .payment-method:disabled {
      cursor: wait;
      opacity: 0.72;
    }
    .payment-method strong,
    .payment-method small {
      display: block;
    }
    .payment-method small {
      color: var(--muted);
      font-size: 13px;
      line-height: 1.4;
    }
    .payment-method em {
      position: absolute;
      right: 10px;
      top: 9px;
      color: var(--muted);
      font-size: 12px;
      font-style: normal;
      font-weight: 800;
    }
    .pay-icon {
      width: 38px;
      height: 38px;
      flex: 0 0 auto;
    }
    .notice {
      min-height: 24px;
      margin-top: 14px;
      color: var(--muted);
      font-weight: 750;
    }
    .notice.error { color: var(--red); }
    .notice.success { color: var(--green); }
    .notice.info { color: var(--blue); }
    .payment-state {
      display: grid;
      min-height: 300px;
      place-items: center;
      border: 1px dashed #bfcbc5;
      border-radius: 8px;
      background: #fbfcfb;
      padding: 18px;
      text-align: center;
      color: var(--muted);
    }
    .payment-state .qr {
      width: 230px;
      height: 230px;
      image-rendering: crisp-edges;
    }
    .success-text {
      color: var(--green);
      font-weight: 850;
    }
    .order-result {
      margin-top: 14px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--surface);
      padding: 14px;
    }
    .result-row {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      padding: 8px 0;
      border-bottom: 1px solid #edf1ee;
    }
    .result-row span, .muted {
      color: var(--muted);
    }
    .result-row strong {
      text-align: right;
      overflow-wrap: anywhere;
    }
    .license {
      display: block;
      margin: 12px 0 2px;
      color: var(--brand-dark);
      font-family: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace;
      font-size: 17px;
      overflow-wrap: anywhere;
    }
    .detail-grid {
      display: grid;
      grid-template-columns: minmax(0, 1.15fr) minmax(0, 0.85fr);
      gap: 16px;
      align-items: stretch;
    }
    .detail-panel {
      border-top: 1px solid var(--line);
      padding: 22px 0 0;
    }
    .detail-panel h2 {
      margin-bottom: 12px;
      font-size: 24px;
      letter-spacing: 0;
    }
    .detail-copy {
      color: var(--muted);
      font-size: 16px;
    }
    .check-list {
      display: grid;
      gap: 12px;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .check-list li {
      display: grid;
      grid-template-columns: 76px minmax(0, 1fr);
      gap: 12px;
      align-items: start;
    }
    .check-list strong {
      color: var(--brand-dark);
    }
    .check-list span {
      color: var(--muted);
    }
    .empty-state {
      max-width: 680px;
      padding: 28px;
    }
    .site-footer {
      margin-top: 30px;
      border-top: 1px solid var(--line);
      padding-top: 18px;
      color: var(--muted);
      font-size: 13px;
      text-align: center;
    }
    .site-footer a {
      color: inherit;
      text-decoration: none;
    }
    @media (max-width: 840px) {
      .shell {
        width: min(100% - 24px, 620px);
        padding-top: 20px;
      }
      h1 {
        font-size: 34px;
      }
      .buy-hero, .plans, .checkout-layout, .payment-methods, .trust-row, .detail-grid {
        grid-template-columns: 1fr;
      }
      .hero-copy {
        min-height: auto;
        padding-bottom: 8px;
      }
      .plan-card {
        grid-template-rows: auto auto auto;
      }
    }
  </style>
</head>
<body>
  <main class="shell">
    ${input.body}
    ${siteFooterHtml(input)}
  </main>
</body>
</html>`
}

function siteFooterHtml(input: { icpRecord?: string | null; icpUrl?: string | null }): string {
  if (!input.icpRecord) return ''
  const href = escapeHtml(input.icpUrl || 'https://beian.miit.gov.cn/')
  return `<footer class="site-footer">
      <a href="${href}" target="_blank" rel="noreferrer">${escapeHtml(input.icpRecord)}</a>
    </footer>`
}

function wechatIcon(): string {
  return `
    <svg class="pay-icon" viewBox="0 0 40 40" role="img" aria-label="微信支付图标">
      <rect width="40" height="40" rx="8" fill="#168a54"></rect>
      <circle cx="17" cy="18" r="9" fill="#ffffff"></circle>
      <circle cx="24" cy="23" r="8" fill="#dff5e8"></circle>
      <circle cx="14" cy="16" r="1.4" fill="#168a54"></circle>
      <circle cx="19" cy="16" r="1.4" fill="#168a54"></circle>
      <circle cx="22" cy="21" r="1.2" fill="#168a54"></circle>
      <circle cx="26" cy="21" r="1.2" fill="#168a54"></circle>
    </svg>
  `
}

function alipayIcon(): string {
  return `
    <svg class="pay-icon" viewBox="0 0 40 40" role="img" aria-label="支付宝图标">
      <rect width="40" height="40" rx="8" fill="#1769c2"></rect>
      <path d="M10 13h20v4H18.8c-.3 1-.6 1.9-1 2.8 2 .7 3.8 1.4 5.4 2.2 1-1.1 1.8-2.3 2.5-3.7h4.1c-.8 2.1-1.9 3.9-3.3 5.5 1.5.8 2.9 1.7 4.2 2.6l-2.3 3.2c-1.5-1.1-3-2.1-4.7-3.1-2.7 1.9-6.2 2.9-10.4 3.1l-1.2-3.5c3-.1 5.5-.6 7.5-1.6-1.1-.5-2.3-1-3.6-1.5l-.7 1.1-3.7-1.3c1.2-1.8 2.2-3.9 3-6.2H10v-4Z" fill="#ffffff"></path>
    </svg>
  `
}

function formatDuration(pkg: GatewayPackage): string {
  return pkg.durationDays ? `${pkg.durationDays} 天有效` : '长期有效'
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
