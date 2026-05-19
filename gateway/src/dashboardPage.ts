export function createDashboardPageHtml(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Gugu Gateway 用量 Dashboard</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f8f1e5;
      --surface: #fffaf2;
      --ink: #231a13;
      --muted: #756050;
      --line: #e5cdb5;
      --brand: #9b5a32;
      --green: #2f7d69;
      --red: #a33f32;
      --blue: #315f91;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--ink);
      font-family: "PingFang SC", "Microsoft YaHei", "Noto Sans SC", system-ui, sans-serif;
      line-height: 1.5;
    }
    .shell { width: min(1240px, calc(100% - 32px)); margin: 0 auto; padding: 28px 0 42px; }
    header { display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; margin-bottom: 20px; }
    h1 { margin: 0; font-size: 30px; letter-spacing: 0; }
    p { margin: 0; color: var(--muted); }
    .token {
      display: flex;
      gap: 8px;
      align-items: center;
      padding: 10px;
      border: 1px solid var(--line);
      border-radius: 14px;
      background: var(--surface);
    }
    input, select, button {
      height: 38px;
      border: 1px solid var(--line);
      border-radius: 10px;
      background: #fffdf8;
      color: var(--ink);
      padding: 0 12px;
      font: inherit;
    }
    button {
      cursor: pointer;
      background: var(--brand);
      color: #fffaf2;
      border-color: var(--brand);
      font-weight: 700;
    }
    button.secondary {
      background: #fffdf8;
      color: var(--brand);
    }
    .toolbar { display: flex; gap: 10px; align-items: center; margin: 18px 0; }
    .grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
    .card, section {
      border: 1px solid var(--line);
      border-radius: 16px;
      background: var(--surface);
      box-shadow: 0 18px 40px rgba(92, 58, 30, 0.08);
    }
    .card { padding: 16px; }
    .label { color: var(--muted); font-size: 13px; }
    .value { margin-top: 6px; font-size: 26px; font-weight: 850; }
    .value small { font-size: 14px; color: var(--muted); font-weight: 600; }
    .layout { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-top: 14px; }
    section { overflow: hidden; }
    section h2 { margin: 0; padding: 14px 16px; border-bottom: 1px solid var(--line); font-size: 18px; }
    table { width: 100%; border-collapse: collapse; font-size: 14px; }
    th, td { padding: 10px 12px; border-bottom: 1px solid #efdfce; text-align: left; vertical-align: top; }
    th { color: var(--muted); font-weight: 700; background: rgba(255, 253, 248, 0.7); }
    .muted { color: var(--muted); }
    .status { display: inline-flex; border-radius: 999px; padding: 3px 8px; background: #f0dfce; font-size: 12px; font-weight: 800; }
    .status.paid { background: rgba(49, 95, 145, 0.13); color: var(--blue); }
    .status.fulfilled { background: rgba(47, 125, 105, 0.14); color: var(--green); }
    .status.cancelled { background: rgba(163, 63, 50, 0.12); color: var(--red); }
    .actions { display: flex; gap: 6px; flex-wrap: wrap; }
    .actions button { height: 30px; padding: 0 9px; font-size: 12px; }
    .error { margin-top: 10px; color: var(--red); font-weight: 700; min-height: 22px; }
    @media (max-width: 920px) {
      header, .token, .toolbar { align-items: stretch; flex-direction: column; }
      .grid, .layout { grid-template-columns: 1fr; }
      table { display: block; overflow-x: auto; }
    }
  </style>
</head>
<body>
  <main class="shell">
    <header>
      <div>
        <h1>Gugu Gateway 用量 Dashboard</h1>
        <p>查看点数、真实 token、模型用量、设备和人工订单状态。</p>
      </div>
      <form id="tokenForm" class="token">
        <input id="tokenInput" type="password" placeholder="Admin Token" autocomplete="current-password">
        <button type="submit">加载</button>
      </form>
    </header>

    <div class="toolbar">
      <select id="range">
        <option value="7d">最近 7 天</option>
        <option value="30d">最近 30 天</option>
        <option value="all">全部</option>
      </select>
      <button id="refresh" class="secondary" type="button">刷新</button>
      <span id="generated" class="muted"></span>
    </div>
    <div id="error" class="error"></div>

    <div class="grid" id="cards"></div>

    <div class="layout">
      <section>
        <h2>模型用量</h2>
        <table>
          <thead><tr><th>模型</th><th>事件</th><th>点数</th><th>Input</th><th>Output</th></tr></thead>
          <tbody id="models"></tbody>
        </table>
      </section>
      <section>
        <h2>类型用量</h2>
        <table>
          <thead><tr><th>类型</th><th>事件</th><th>点数</th><th>Input</th><th>Output</th></tr></thead>
          <tbody id="kinds"></tbody>
        </table>
      </section>
      <section>
        <h2>Top 设备</h2>
        <table>
          <thead><tr><th>设备</th><th>套餐</th><th>点数</th><th>Token</th><th>最后活跃</th></tr></thead>
          <tbody id="topDevices"></tbody>
        </table>
      </section>
      <section>
        <h2>待处理订单</h2>
        <table>
          <thead><tr><th>订单</th><th>套餐</th><th>金额</th><th>状态</th><th>操作</th></tr></thead>
          <tbody id="orders"></tbody>
        </table>
      </section>
    </div>
  </main>

  <script>
    const tokenInput = document.getElementById('tokenInput')
    const tokenForm = document.getElementById('tokenForm')
    const range = document.getElementById('range')
    const refresh = document.getElementById('refresh')
    const errorBox = document.getElementById('error')
    const token = sessionStorage.getItem('gugu_admin_token') || ''
    tokenInput.value = token

    tokenForm.addEventListener('submit', (event) => {
      event.preventDefault()
      sessionStorage.setItem('gugu_admin_token', tokenInput.value.trim())
      load()
    })
    refresh.addEventListener('click', load)
    range.addEventListener('change', load)
    if (token) load()

    async function api(path, options = {}) {
      const response = await fetch(path, {
        ...options,
        headers: {
          Authorization: 'Bearer ' + tokenInput.value.trim(),
          'Content-Type': 'application/json',
          ...(options.headers || {}),
        },
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body?.error?.message || '请求失败')
      return body
    }

    async function load() {
      errorBox.textContent = ''
      try {
        const summary = await api('/admin/api/summary?range=' + encodeURIComponent(range.value))
        renderSummary(summary)
      } catch (error) {
        errorBox.textContent = error.message || String(error)
      }
    }

    function renderSummary(summary) {
      document.getElementById('generated').textContent = '生成时间 ' + formatTime(summary.generatedAt)
      const totalTokens = (summary.usage.inputTokens || 0) + (summary.usage.outputTokens || 0)
      document.getElementById('cards').innerHTML = [
        card('总设备', summary.devices.total, '7 天活跃 ' + summary.devices.active7d),
        card('点数', summary.credits.used + ' / ' + summary.credits.total, '剩余 ' + summary.credits.remaining),
        card('真实 Token', formatNumber(totalTokens), 'Input ' + formatNumber(summary.usage.inputTokens) + ' / Output ' + formatNumber(summary.usage.outputTokens)),
        card('订单', summary.orders.pending + ' 待付款', summary.orders.paid + ' 已付款 / ' + summary.orders.fulfilled + ' 已发码 / ' + summary.orders.cancelled + ' 已取消'),
      ].join('')
      renderRows('models', summary.usage.byModel, (row) => [row.model, row.events, row.credits, formatNumber(row.inputTokens), formatNumber(row.outputTokens)])
      renderRows('kinds', summary.usage.byKind, (row) => [row.kind, row.events, row.credits, formatNumber(row.inputTokens), formatNumber(row.outputTokens)])
      renderRows('topDevices', summary.usage.topDevices, (row) => [mask(row.deviceId), row.plan, row.credits, formatNumber((row.inputTokens || 0) + (row.outputTokens || 0)), formatTime(row.lastSeenAt)])
      renderOrders(summary.orders.recent)
    }

    function card(label, value, note) {
      return '<article class="card"><div class="label">' + escapeHtml(label) + '</div><div class="value">' + escapeHtml(String(value)) + '</div><p>' + escapeHtml(note) + '</p></article>'
    }

    function renderRows(id, rows, map) {
      document.getElementById(id).innerHTML = (rows || []).map((row) => {
        return '<tr>' + map(row).map((cell) => '<td>' + escapeHtml(String(cell ?? '')) + '</td>').join('') + '</tr>'
      }).join('') || '<tr><td class="muted" colspan="5">暂无数据</td></tr>'
    }

    function renderOrders(rows) {
      document.getElementById('orders').innerHTML = (rows || []).map((order) => {
        const actions = order.status === 'fulfilled' || order.status === 'cancelled'
          ? ''
          : '<div class="actions"><button onclick="orderAction(\\'' + order.orderId + '\\',\\'pay\\')">已收款</button><button onclick="orderAction(\\'' + order.orderId + '\\',\\'fulfill\\')">发码</button><button class="secondary" onclick="orderAction(\\'' + order.orderId + '\\',\\'cancel\\')">取消</button></div>'
        return '<tr><td><strong>' + escapeHtml(order.orderId) + '</strong><br><span class="muted">' + escapeHtml(order.contact || '-') + '</span></td><td>' + escapeHtml(order.packageName) + '<br><span class="muted">' + order.credits + ' 点</span></td><td>' + formatCny(order.amountCents) + '</td><td><span class="status ' + order.status + '">' + escapeHtml(order.status) + '</span></td><td>' + actions + (order.licenseKey ? '<div class="muted">' + escapeHtml(order.licenseKey) + '</div>' : '') + '</td></tr>'
      }).join('') || '<tr><td class="muted" colspan="5">暂无订单</td></tr>'
    }

    async function orderAction(orderId, action) {
      try {
        await api('/admin/api/orders/' + encodeURIComponent(orderId) + '/' + action, { method: 'POST' })
        await load()
      } catch (error) {
        errorBox.textContent = error.message || String(error)
      }
    }
    window.orderAction = orderAction

    function formatNumber(value) { return Number(value || 0).toLocaleString('zh-CN') }
    function formatCny(cents) { return '¥' + (Number(cents || 0) / 100).toFixed(Number(cents || 0) % 100 === 0 ? 0 : 2) }
    function formatTime(value) { return value ? new Date(value).toLocaleString('zh-CN') : '-' }
    function mask(value) { return value && value.length > 12 ? value.slice(0, 8) + '...' + value.slice(-4) : value || '-' }
    function escapeHtml(value) {
      return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]))
    }
  </script>
</body>
</html>`
}
