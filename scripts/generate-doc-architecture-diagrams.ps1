Add-Type -AssemblyName System.Drawing

$ErrorActionPreference = 'Stop'
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path -LiteralPath (Join-Path $scriptRoot '..')
$outDir = Resolve-Path -LiteralPath (Join-Path $repoRoot 'docs\images')

$W = 2048
$H = 1152

function ColorOf([string]$hex, [int]$alpha = 255) {
  $c = [System.Drawing.ColorTranslator]::FromHtml($hex)
  return [System.Drawing.Color]::FromArgb($alpha, $c.R, $c.G, $c.B)
}

function BrushOf([string]$hex, [int]$alpha = 255) {
  return [System.Drawing.SolidBrush]::new((ColorOf $hex $alpha))
}

function PenOf([string]$hex, [float]$width = 3, [int]$alpha = 255) {
  $pen = [System.Drawing.Pen]::new((ColorOf $hex $alpha), $width)
  $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  return $pen
}

function RectF([float]$x, [float]$y, [float]$w, [float]$h) {
  return [System.Drawing.RectangleF]::new($x, $y, $w, $h)
}

function New-RoundPath([float]$x, [float]$y, [float]$w, [float]$h, [float]$r) {
  $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $d = $r * 2
  $path.AddArc($x, $y, $d, $d, 180, 90)
  $path.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $path.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $path.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $path.CloseFigure()
  return $path
}

function New-Canvas {
  $bmp = [System.Drawing.Bitmap]::new($W, $H)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit
  $g.Clear((ColorOf '#fbf3e4'))

  $bg = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
    ([System.Drawing.Rectangle]::new(0, 0, $W, $H)),
    (ColorOf '#fffaf0'),
    (ColorOf '#f2dfc3'),
    [System.Drawing.Drawing2D.LinearGradientMode]::ForwardDiagonal
  )
  $g.FillRectangle($bg, 0, 0, $W, $H)
  $bg.Dispose()

  $gridPen = PenOf '#d8b996' 1 34
  for ($x = 80; $x -lt $W; $x += 72) {
    $g.DrawLine($gridPen, $x, 160, $x, $H - 80)
  }
  for ($y = 160; $y -lt $H; $y += 72) {
    $g.DrawLine($gridPen, 56, $y, $W - 56, $y)
  }
  $gridPen.Dispose()

  return @{ Bitmap = $bmp; Graphics = $g }
}

function Dispose-Canvas($canvas) {
  $canvas.Graphics.Dispose()
  $canvas.Bitmap.Dispose()
}

function Save-Canvas($canvas, [string]$fileName) {
  $path = Join-Path $outDir $fileName
  $canvas.Bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
}

$fontTitle = [System.Drawing.Font]::new('Microsoft YaHei UI', 52, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$fontSub = [System.Drawing.Font]::new('Microsoft YaHei UI', 24, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
$fontCardTitle = [System.Drawing.Font]::new('Microsoft YaHei UI', 32, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$fontCardBody = [System.Drawing.Font]::new('Microsoft YaHei UI', 22, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
$fontSmall = [System.Drawing.Font]::new('Microsoft YaHei UI', 18, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
$fontMono = [System.Drawing.Font]::new('Consolas', 28, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)

function Draw-Header($g, [string]$title, [string]$subtitle) {
  $badgePath = New-RoundPath 76 54 246 42 21
  $g.FillPath((BrushOf '#fff3dd'), $badgePath)
  $g.DrawPath((PenOf '#d8a16f' 2), $badgePath)
  $badgePath.Dispose()

  $fmtLeft = New-Object System.Drawing.StringFormat
  $fmtLeft.Alignment = [System.Drawing.StringAlignment]::Near
  $fmtLeft.LineAlignment = [System.Drawing.StringAlignment]::Center
  $g.DrawString('GUGU ARCHITECTURE', ([System.Drawing.Font]::new('Segoe UI', 18, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)), (BrushOf '#9a572f'), (RectF 100 54 220 42), $fmtLeft)

  $fmtCenter = New-Object System.Drawing.StringFormat
  $fmtCenter.Alignment = [System.Drawing.StringAlignment]::Center
  $fmtCenter.LineAlignment = [System.Drawing.StringAlignment]::Center
  $g.DrawString($title, $fontTitle, (BrushOf '#2b2018'), (RectF 80 92 1888 76), $fmtCenter)
  $g.DrawString($subtitle, $fontSub, (BrushOf '#7b563d'), (RectF 160 162 1728 42), $fmtCenter)
  $fmtLeft.Dispose()
  $fmtCenter.Dispose()
}

function Draw-TextLines($g, [string[]]$lines, [System.Drawing.RectangleF]$rect, $font, $brush, [string]$align = 'Center', [float]$gap = 6) {
  if ($lines.Count -eq 0) { return }
  $fmt = New-Object System.Drawing.StringFormat
  if ($align -eq 'Left') { $fmt.Alignment = [System.Drawing.StringAlignment]::Near }
  elseif ($align -eq 'Right') { $fmt.Alignment = [System.Drawing.StringAlignment]::Far }
  else { $fmt.Alignment = [System.Drawing.StringAlignment]::Center }
  $fmt.LineAlignment = [System.Drawing.StringAlignment]::Center
  $lineH = $font.GetHeight($g)
  $totalH = ($lineH * $lines.Count) + ($gap * ([Math]::Max(0, $lines.Count - 1)))
  $y = $rect.Y + (($rect.Height - $totalH) / 2)
  foreach ($line in $lines) {
    $g.DrawString($line, $font, $brush, (RectF $rect.X $y $rect.Width ($lineH + 6)), $fmt)
    $y += $lineH + $gap
  }
  $fmt.Dispose()
}

function Draw-Card($g, [float]$x, [float]$y, [float]$w, [float]$h, [string[]]$title, [string[]]$body = @(), [string]$fill = '#fffaf2', [string]$stroke = '#d8a16f', [string]$accent = '#a76032') {
  $shadow = New-RoundPath ($x + 8) ($y + 12) $w $h 22
  $g.FillPath((BrushOf '#8a5632' 35), $shadow)
  $shadow.Dispose()

  $path = New-RoundPath $x $y $w $h 22
  $g.FillPath((BrushOf $fill), $path)
  $g.DrawPath((PenOf $stroke 3), $path)
  $g.DrawLine((PenOf $accent 5 210), $x + 24, $y + 2, $x + $w - 24, $y + 2)
  $path.Dispose()

  if ($body.Count -gt 0) {
    Draw-TextLines $g $title (RectF ($x + 20) ($y + 18) ($w - 40) ($h * 0.42)) $fontCardTitle (BrushOf '#2b2018') 'Center' 3
    Draw-TextLines $g $body (RectF ($x + 24) ($y + ($h * 0.52)) ($w - 48) ($h * 0.34)) $fontCardBody (BrushOf '#755238') 'Center' 2
  } else {
    Draw-TextLines $g $title (RectF ($x + 20) ($y + 16) ($w - 40) ($h - 32)) $fontCardTitle (BrushOf '#2b2018') 'Center' 4
  }
}

function Draw-Container($g, [float]$x, [float]$y, [float]$w, [float]$h, [string]$title) {
  $shadow = New-RoundPath ($x + 8) ($y + 12) $w $h 22
  $g.FillPath((BrushOf '#8a5632' 28), $shadow)
  $shadow.Dispose()

  $path = New-RoundPath $x $y $w $h 22
  $g.FillPath((BrushOf '#fffaf2'), $path)
  $g.DrawPath((PenOf '#d8a16f' 3), $path)
  $g.DrawLine((PenOf '#a76032' 5 210), $x + 24, $y + 2, $x + $w - 24, $y + 2)
  $path.Dispose()

  Draw-TextLines $g @($title) (RectF ($x + 20) ($y + 24) ($w - 40) 44) $fontCardBody (BrushOf '#2b2018') 'Center' 0
}

function Draw-Pill($g, [float]$x, [float]$y, [float]$w, [float]$h, [string]$text, [string]$fill = '#f2c58d', [string]$stroke = '#c8844d') {
  $path = New-RoundPath $x $y $w $h 18
  $g.FillPath((BrushOf $fill), $path)
  $g.DrawPath((PenOf $stroke 2), $path)
  $path.Dispose()
  Draw-TextLines $g @($text) (RectF $x $y $w $h) $fontSmall (BrushOf '#5a3826') 'Center' 0
}

function Draw-Arrow($g, [float]$x1, [float]$y1, [float]$x2, [float]$y2, [string]$color = '#a76032', [float]$width = 4) {
  $pen = PenOf $color $width 230
  $cap = [System.Drawing.Drawing2D.AdjustableArrowCap]::new(7, 9)
  $pen.CustomEndCap = $cap
  $g.DrawLine($pen, $x1, $y1, $x2, $y2)
  $pen.Dispose()
  $cap.Dispose()
}

function Draw-BezierArrow($g, [float]$x1, [float]$y1, [float]$cx1, [float]$cy1, [float]$cx2, [float]$cy2, [float]$x2, [float]$y2, [string]$color = '#a76032') {
  $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $path.AddBezier($x1, $y1, $cx1, $cy1, $cx2, $cy2, $x2, $y2)
  $pen = PenOf $color 4 210
  $cap = [System.Drawing.Drawing2D.AdjustableArrowCap]::new(7, 9)
  $pen.CustomEndCap = $cap
  $g.DrawPath($pen, $path)
  $path.Dispose()
  $pen.Dispose()
  $cap.Dispose()
}

function Draw-Step($g, [float]$x, [float]$y, [float]$w, [float]$h, [string]$num, [string[]]$title, [string[]]$body = @()) {
  $shadow = New-RoundPath ($x + 8) ($y + 12) $w $h 22
  $g.FillPath((BrushOf '#8a5632' 35), $shadow)
  $shadow.Dispose()

  $path = New-RoundPath $x $y $w $h 22
  $g.FillPath((BrushOf '#fffaf2'), $path)
  $g.DrawPath((PenOf '#d7b08a' 3), $path)
  $g.DrawLine((PenOf '#b06538' 5 210), $x + 24, $y + 2, $x + $w - 24, $y + 2)
  $path.Dispose()

  $ellipseBrush = BrushOf '#a76032'
  $g.FillEllipse($ellipseBrush, $x + 18, $y + 18, 38, 38)
  Draw-TextLines $g @($num) (RectF ($x + 18) ($y + 18) 38 38) ([System.Drawing.Font]::new('Segoe UI', 18, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)) (BrushOf '#ffffff') 'Center' 0
  $ellipseBrush.Dispose()
  Draw-TextLines $g $title (RectF ($x + 18) ($y + 46) ($w - 36) 48) $fontCardTitle (BrushOf '#2b2018') 'Center' 0
  Draw-TextLines $g $body (RectF ($x + 16) ($y + 98) ($w - 32) 36) $fontSmall (BrushOf '#755238') 'Center' 0
}

function Diagram-Overall {
  $c = New-Canvas
  $g = $c.Graphics
  Draw-Header $g 'Gugu Agent · 整体架构' '即插即用托管线路 + 可自由配置的本地 Agent 工作台'

  Draw-Card $g 704 226 640 110 @('入口与会话编排') @('Desktop / CLI / Gateway') '#fff6ea' '#d59b68' '#a76032'
  Draw-Card $g 704 486 640 132 @('Init / Bootstrap') @('加载配置、服务商、技能与工作目录') '#fff1df' '#c8844d' '#9a572f'

  $left = @(
    @('桌面界面', 'Tauri + React'),
    @('会话与上下文', 'Prompt、附件、历史'),
    @('工具系统', '文件、Shell、MCP、Agent'),
    @('Agent / Task', '本地任务与工作台')
  )
  $right = @(
    @('托管服务', 'Gugu Managed / Gateway'),
    @('订阅与用量', '套餐、到期、剩余百分比'),
    @('Skills / Plugins', '插件包与能力扩展'),
    @('外部集成', 'IM、MCP、模型服务商')
  )
  for ($i = 0; $i -lt 4; $i++) {
    $y = 344 + ($i * 172)
    Draw-Card $g 108 $y 520 112 @($left[$i][0]) @($left[$i][1]) '#ffffff' '#dfbc9b' '#cb7a44'
    Draw-Card $g 1420 $y 520 112 @($right[$i][0]) @($right[$i][1]) '#ffffff' '#dfbc9b' '#cb7a44'
    if ($i -lt 3) {
      Draw-Arrow $g 368 ($y + 116) 368 ($y + 166) '#b77649' 3
      Draw-Arrow $g 1680 ($y + 116) 1680 ($y + 166) '#b77649' 3
    }
    Draw-Arrow $g 704 (552 + ($i - 1.5) * 48) 628 ($y + 56) '#b77649' 3
    Draw-Arrow $g 1344 (552 + ($i - 1.5) * 48) 1420 ($y + 56) '#b77649' 3
  }
  Draw-Arrow $g 1024 336 1024 486 '#a76032' 5
  Draw-BezierArrow $g 760 282 520 260 360 282 368 344 '#a76032'
  Draw-BezierArrow $g 1288 282 1530 260 1680 282 1680 344 '#a76032'
  Draw-Pill $g 760 666 528 54 '默认可用，也能接入自有服务商与插件'

  Save-Canvas $c '01-overall-architecture.png'
  Dispose-Canvas $c
}

function Diagram-Lifecycle {
  $c = New-Canvas
  $g = $c.Graphics
  Draw-Header $g 'Gugu Agent · 请求生命周期' '从用户输入到渲染结果，工具调用会经过权限与沙箱校验'

  $steps = @(
    @('用户输入', 'User Input'),
    @('消息解析', 'Parse'),
    @('上下文组装', 'Context Build'),
    @('模型流式响应', 'Model Stream'),
    @('工具检测', 'Tool Detect'),
    @('权限校验', 'Perm Check'),
    @('工具执行', 'Tool Execute'),
    @('界面渲染', 'UI Render')
  )
  $x = 72
  $y = 474
  $w = 210
  $gap = 34
  for ($i = 0; $i -lt $steps.Count; $i++) {
    Draw-Step $g $x $y $w 150 ([string]($i + 1)) @($steps[$i][0]) @($steps[$i][1])
    if ($i -lt $steps.Count - 1) {
      Draw-Arrow $g ($x + $w + 8) ($y + 75) ($x + $w + $gap - 10) ($y + 75) '#a76032' 4
    }
    $x += $w + $gap
  }

  Draw-BezierArrow $g 1698 470 1698 250 820 250 820 470 '#5f8f7a'
  Draw-TextLines $g @('多轮上下文回流', 'Multi-turn Context') (RectF 1020 278 420 68) $fontCardBody (BrushOf '#4d7b68') 'Center' 2

  Draw-Card $g 192 784 480 128 @('轻量入口') @('默认、计划、CE 统一进入同一流程') '#fff8ec' '#ddb78f' '#c8844d'
  Draw-Card $g 784 784 480 128 @('托管线路') @('模型 / 文件解析 / 订阅额度') '#fff8ec' '#ddb78f' '#c8844d'
  Draw-Card $g 1376 784 480 128 @('可观察结果') @('消息、工具卡片、Diff 与状态更新') '#fff8ec' '#ddb78f' '#c8844d'

  Save-Canvas $c '02-request-lifecycle.png'
  Dispose-Canvas $c
}

function Diagram-ToolSystem {
  $c = New-Canvas
  $g = $c.Graphics
  Draw-Header $g 'Gugu Agent · 工具系统架构' '统一注册、统一校验、统一渲染，让工具调用可控可见'

  $cards = @(
    @{ X=246; Y=254; T='文件工具'; B='Read / Edit / Write / Glob / Grep' },
    @{ X=1310; Y=254; T='命令工具'; B='Bash / PowerShell / REPL' },
    @{ X=154; Y=504; T='系统工具'; B='Process / Env / Info / Config' },
    @{ X=1402; Y=504; T='Agent 工具'; B='Agent / Task / SendMessage' },
    @{ X=246; Y=746; T='外部能力'; B='Web / MCP / LSP / Provider' },
    @{ X=1310; Y=746; T='通信工具'; B='AskUser / IM / Notification' }
  )
  foreach ($card in $cards) {
    Draw-Arrow $g 1024 491 ($card.X + 260) ($card.Y + 65) '#a76032' 3
  }
  Draw-Card $g 742 396 564 190 @('Tool Registry', '工具注册中心') @('名称、Schema、权限、渲染器') '#fff1df' '#c8844d' '#a76032'
  foreach ($card in $cards) {
    Draw-Card $g $card.X $card.Y 520 130 @($card.T) @($card.B) '#ffffff' '#dfbc9b' '#cb7a44'
  }

  $pipeline = @('Input', 'Validate', 'Permission Gate', 'Sandbox', 'Execute', 'Render')
  $px = 154
  for ($i = 0; $i -lt $pipeline.Count; $i++) {
    $pw = if ($i -eq 2) { 270 } else { 210 }
    Draw-Pill $g $px 992 $pw 72 $pipeline[$i] '#fff6e9' '#d5a372'
    if ($i -lt $pipeline.Count - 1) {
      Draw-Arrow $g ($px + $pw + 12) 1028 ($px + $pw + 72) 1028 '#7f8f72' 3
    }
    $px += $pw + 82
  }

  Save-Canvas $c '03-tool-system.png'
  Dispose-Canvas $c
}

function Diagram-MultiAgent {
  $c = New-Canvas
  $g = $c.Graphics
  Draw-Header $g 'Gugu Agent · 多 Agent 编排' '主 Agent 负责协调，子 Agent 在独立上下文中并行处理任务'

  Draw-Card $g 688 252 672 202 @('Main Agent', '主智能体 / Coordinator') @('拆解任务、分派上下文、汇总结果') '#fff1df' '#c8844d' '#a76032'
  $agents = @(
    @{ X=70; Y=760; W=330; T='LocalAgent'; B='本地代理 / 本地工具池'; C='#6fa6a0' },
    @{ X=450; Y=760; W=330; T='RemoteAgent'; B='远程代理 / 云端会话'; C='#679fc9' },
    @{ X=830; Y=760; W=330; T='Fork'; B='子代理 / 分支探索'; C='#d6a94f' },
    @{ X=1210; Y=760; W=330; T='Teammate'; B='队友 / 协同任务'; C='#8fb86a' },
    @{ X=1590; Y=760; W=390; T='DreamTask'; B='记忆整合 / 后台任务'; C='#aa8abd' }
  )
  foreach ($agent in $agents) {
    Draw-Card $g $agent.X $agent.Y $agent.W 190 @($agent.T) @($agent.B) '#fffaf2' $agent.C $agent.C
    Draw-BezierArrow $g ($agent.X + ($agent.W / 2)) 760 ($agent.X + ($agent.W / 2)) 610 1024 580 1024 454 $agent.C
    Draw-TextLines $g @('SendMessage') (RectF ($agent.X + 28) 668 ($agent.W - 56) 42) $fontSmall (BrushOf '#755238') 'Center' 0
  }

  Draw-Card $g 1484 264 440 250 @('Worktree Isolation', '工作树隔离') @('独立环境', '分支管理', '安全上下文') '#f7efe4' '#9fb4aa' '#5f8f7a'
  Draw-Arrow $g 1484 390 1360 354 '#5f8f7a' 4
  Draw-Pill $g 654 520 740 58 '每个子任务拥有自己的工具池、上下文与回传通道' '#edf7ef' '#92b889'

  Save-Canvas $c '04-multi-agent.png'
  Dispose-Canvas $c
}

function Diagram-TerminalUi {
  $c = New-Canvas
  $g = $c.Graphics
  Draw-Header $g 'Gugu Agent · 终端 UI 架构' 'Ink / React 渲染链路与桌面工作台共享同一类状态表达'

  Draw-Card $g 92 214 1500 90 @('App.tsx') @('应用入口、快捷键、全局状态注入') '#fff1df' '#c8844d' '#a76032'
  Draw-Arrow $g 842 304 842 360 '#a76032' 4

  Draw-Container $g 92 360 1500 166 'Screen Components / 屏幕组件'
  $sx = 170
  foreach ($name in @('MainLayout', 'CommandPalette', 'HistoryPanel', 'StatusBar')) {
    Draw-Pill $g $sx 440 280 58 $name '#fff6e9' '#d5a372'
    if ($sx -lt 1130) { Draw-Arrow $g ($sx + 286) 469 ($sx + 348) 469 '#a76032' 3 }
    $sx += 360
  }

  Draw-Container $g 92 600 1500 176 'UI Components / 界面组件'
  $ux = 170
  foreach ($name in @('PromptInput', 'Messages', 'Diff View', 'Markdown')) {
    Draw-Pill $g $ux 682 280 62 $name '#fff6e9' '#d5a372'
    $ux += 360
  }

  Draw-Container $g 92 852 1500 166 'Custom Ink Engine / 自定义渲染引擎'
  $rx = 140
  foreach ($name in @('DOM', 'Yoga Layout', 'Render', 'Blit / Diff', 'Terminal')) {
    Draw-Pill $g $rx 934 240 58 $name '#fff6e9' '#d5a372'
    if ($rx -lt 1160) { Draw-Arrow $g ($rx + 248) 963 ($rx + 300) 963 '#a76032' 3 }
    $rx += 300
  }

  Draw-Card $g 1660 214 300 804 @('Global', '全局功能') @('Vim Mode', 'Keybindings', 'Selection', 'Focus') '#fff3e6' '#c8844d' '#a76032'

  Save-Canvas $c '05-terminal-ui.png'
  Dispose-Canvas $c
}

function Diagram-Security {
  $c = New-Canvas
  $g = $c.Graphics
  Draw-Header $g 'Gugu Agent · 权限与安全模型' '工具调用先解释、再校验、再隔离执行'

  Draw-Card $g 96 252 360 330 @('Trust Model', '信任模型') @('用户白名单', '域名许可名单', '行为分析', '信誉评分') '#fffaf2' '#d9b18a' '#b06538'
  Draw-Card $g 760 268 528 154 @('Permission Engine', '权限引擎') @('统一处理询问、自动接受与跳过权限') '#fff1df' '#c8844d' '#a76032'
  Draw-Card $g 1600 252 360 330 @('Sandbox System', '沙箱系统') @('隔离环境', '资源限制', '网络策略', '进程命名空间') '#fffaf2' '#d9b18a' '#b06538'

  $modes = @(
    @{ X=520; T='Ask Mode'; B='询问模式' },
    @{ X=870; T='Auto Mode'; B='自动模式' },
    @{ X=1220; T='Bypass Mode'; B='旁路模式' }
  )
  foreach ($mode in $modes) {
    Draw-Arrow $g 1024 422 ($mode.X + 145) 592 '#a76032' 4
    Draw-Card $g $mode.X 592 290 124 @($mode.T) @($mode.B) '#fff6ea' '#d59b68' '#b06538'
  }

  $flow = @(
    @{ X=88; W=240; T='Tool Request'; C='#c8844d' },
    @{ X=430; W=190; T='Hook'; C='#b77649' },
    @{ X=720; W=250; T='Permission Gate'; C='#b77649' },
    @{ X=1260; W=250; T='Bash Security'; C='#5f8f7a' },
    @{ X=1600; W=190; T='Sandbox'; C='#5f8f7a' },
    @{ X=1840; W=150; T='Execute'; C='#5f8f7a' }
  )
  foreach ($item in $flow) {
    Draw-Pill $g $item.X 920 $item.W 72 $item.T '#fff6e9' $item.C
  }
  Draw-Arrow $g 328 956 430 956 '#a76032' 4
  Draw-Arrow $g 620 956 720 956 '#a76032' 4
  Draw-Arrow $g 970 956 1260 956 '#5f8f7a' 4
  Draw-Arrow $g 1510 956 1600 956 '#5f8f7a' 4
  Draw-Arrow $g 1790 956 1840 956 '#5f8f7a' 4
  Draw-BezierArrow $g 970 980 1040 1060 1124 1060 1180 1008 '#c74d42'
  Draw-Pill $g 1058 1008 160 62 'Reject' '#fff2ef' '#c74d42'
  Draw-TextLines $g @('allow') (RectF 1060 900 110 42) $fontSmall (BrushOf '#4d7b68') 'Center' 0

  Save-Canvas $c '06-permission-security.png'
  Dispose-Canvas $c
}

function Diagram-Services {
  $c = New-Canvas
  $g = $c.Graphics
  Draw-Header $g 'Gugu Agent · 服务层架构' '本地服务、托管网关与扩展能力围绕 Query Engine 组合'

  $services = @(
    @{ X=304; Y=260; T='MCP 集成'; B='多 transport' },
    @{ X=814; Y=222; T='Memory 记忆系统'; B='提取、检索、整合' },
    @{ X=1376; Y=260; T='OAuth 认证'; B='账号连接与凭证' },
    @{ X=178; Y=520; T='API Client'; B='模型请求与流式解析' },
    @{ X=1478; Y=520; T='Analytics 分析'; B='事件、用量、质量' },
    @{ X=304; Y=790; T='Compact 压缩'; B='长上下文治理' },
    @{ X=814; Y=832; T='Plugin 插件'; B='Agents / Skills / MCP' },
    @{ X=1376; Y=790; T='LSP'; B='代码智能与工程上下文' }
  )
  foreach ($svc in $services) {
    Draw-BezierArrow $g ($svc.X + 180) ($svc.Y + 58) 1024 ($svc.Y + 58) 1024 520 1024 552 '#b77649'
  }
  Draw-Card $g 708 456 632 190 @('Query Engine', '查询引擎') @('上下文、模型流、工具调用与结果汇聚') '#fff1df' '#c8844d' '#a76032'
  foreach ($svc in $services) {
    Draw-Card $g $svc.X $svc.Y 360 116 @($svc.T) @($svc.B) '#ffffff' '#dfbc9b' '#cb7a44'
  }
  Draw-Pill $g 734 710 580 58 'Gateway 负责托管模型、文件解析、订阅与用量统计'

  Save-Canvas $c '07-services-layer.png'
  Dispose-Canvas $c
}

function Diagram-StateFlow {
  $c = New-Canvas
  $g = $c.Graphics
  Draw-Header $g 'Gugu Agent · 状态管理与数据流' '轻量 Store 承接会话状态，React Provider 将变化推送到界面'

  Draw-Card $g 150 336 450 264 @('Custom Store', '自定义 Store') @('getState', 'setState', 'subscribe') '#fffaf2' '#d9b18a' '#b06538'
  Draw-Card $g 814 274 420 460 @('AppState', '100+ fields') @('sessions', 'providers', 'billing', 'workspace', 'permissions') '#fff1df' '#c8844d' '#a76032'
  Draw-Card $g 1464 250 410 88 @('React Providers') @() '#fff1df' '#c8844d' '#a76032'
  $providers = @('AppStateProvider', 'StatsProvider', 'FpsMetrics', 'Modal', 'Voice', 'Notification')
  $py = 370
  foreach ($p in $providers) {
    Draw-Pill $g 1464 $py 410 62 $p '#fff6e9' '#d5a372'
    $py += 86
  }
  Draw-Arrow $g 600 468 814 468 '#a76032' 4
  Draw-Arrow $g 1234 500 1464 500 '#a76032' 4

  $flow = @(
    @{ T='Input'; W=210 },
    @{ T='process'; W=210 },
    @{ T='Query'; W=210 },
    @{ T='Stream'; W=210 },
    @{ T='Update'; W=210 },
    @{ T='Render'; W=210 },
    @{ T='Output'; W=230 }
  )
  $x = 74
  foreach ($item in $flow) {
    Draw-Card $g $x 912 $item.W 106 @($item.T) @() '#fff6ea' '#d59b68' '#b06538'
    if ($item.T -ne 'Output') {
      Draw-Arrow $g ($x + $item.W + 10) 965 ($x + $item.W + 46) 965 '#a76032' 4
    }
    $x += $item.W + 58
  }

  Save-Canvas $c '08-state-data-flow.png'
  Dispose-Canvas $c
}

Diagram-Overall
Diagram-Lifecycle
Diagram-ToolSystem
Diagram-MultiAgent
Diagram-TerminalUi
Diagram-Security
Diagram-Services
Diagram-StateFlow

$fontTitle.Dispose()
$fontSub.Dispose()
$fontCardTitle.Dispose()
$fontCardBody.Dispose()
$fontSmall.Dispose()
$fontMono.Dispose()
