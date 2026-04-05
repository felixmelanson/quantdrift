// ── model definitions ──────────────────────────────────────────────────────
const CHART_MODELS = [
  { key: 'claude',   label: 'Claude 3.5', logo: 'assets/company-logos/claude.svg',    neon: 'hsl(27,100%,62%)',  final: 111583, seed: 1, facet: 'lava'      },
  { key: 'gpt4o',    label: 'GPT-4O',     logo: 'assets/company-logos/chatgpt.webp',  neon: 'hsl(174,100%,55%)', final: 107842, seed: 2, facet: 'aquamarine' },
  { key: 'gemini',   label: 'Gemini 2.0', logo: 'assets/company-logos/gemini.png',    neon: 'hsl(142,100%,62%)', final: 104219, seed: 3, facet: 'jade'       },
  { key: 'grok',     label: 'Grok 4.1',   logo: 'assets/company-logos/grokwhite.png', neon: 'hsl(213,80%,74%)',  final: 101653, seed: 4, facet: 'slate'      },
  { key: 'deepseek', label: 'DeepSeek',   logo: 'assets/company-logos/deepseek.png',  neon: 'hsl(210,100%,72%)', final:  97408, seed: 5, facet: 'moonstone'  },
  { key: 'llama',    label: 'Llama 3.1',  logo: 'assets/company-logos/meta.png',      neon: 'hsl(217,100%,68%)', final:  93174, seed: 6, facet: 'sapphire'   },
  { key: 'qwen',     label: 'Qwen 2.5',   logo: 'assets/company-logos/qwen.webp',     neon: 'hsl(264,100%,72%)', final:  87291, seed: 7, facet: 'iolite'     },
]
const SP500 = { key: 'sp500', label: 'S&P 500', color: 'rgba(165,165,165,0.65)', final: 102580, seed: 8 }
const N_POINTS = 60
const MARGIN   = { top: 58, right: 58, bottom: 46, left: 82 }
const ANIM_DUR = 1200
const STAGGER  = 80

// ── seeded random ──────────────────────────────────────────────────────────
function lcgRand(seed) {
  let s = (seed * 9301 + 49297) % 233280
  return function () {
    s = (s * 9301 + 49297) % 233280
    return s / 233280
  }
}

// ── data generation ────────────────────────────────────────────────────────
function generateData(finalValue, seed) {
  const rand = lcgRand(seed)
  const n = N_POINTS
  const start = 100000
  const raw = new Array(n)
  raw[0] = start
  for (let i = 1; i < n; i++) {
    const t = i / (n - 1)
    const trend = start + (finalValue - start) * t
    const vol = 2800 * (1 - t * 0.45)
    raw[i] = trend + (rand() - 0.5) * 2 * vol
  }
  raw[n - 1] = finalValue
  const data = raw.slice()
  for (let i = 1; i < n - 1; i++) {
    data[i] = Math.round((raw[i - 1] + raw[i] * 2 + raw[i + 1]) / 4)
  }
  data[0] = start
  data[n - 1] = finalValue
  return data
}

// ── trading dates ──────────────────────────────────────────────────────────
function tradingDates(startISO, count) {
  const dates = []
  const d = new Date(startISO + 'T12:00:00Z')
  while (dates.length < count) {
    const day = d.getUTCDay()
    if (day !== 0 && day !== 6) dates.push(new Date(d))
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return dates
}
function fmtDate(d) {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}
function fmtDollar(n) {
  return '$' + Math.round(n).toLocaleString('en-US')
}

// ── arc-length helpers ──────────────────────────────────────────────────────
function arcLengths(pts) {
  const lens = [0]
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i].x - pts[i - 1].x
    const dy = pts[i].y - pts[i - 1].y
    lens.push(lens[i - 1] + Math.sqrt(dx * dx + dy * dy))
  }
  return lens
}

function drawAtProgress(ctx, pts, lens, totalLen, progress) {
  const target = progress * totalLen
  ctx.beginPath()
  ctx.moveTo(pts[0].x, pts[0].y)
  for (let i = 1; i < pts.length; i++) {
    if (lens[i] >= target) {
      const seg = lens[i] - lens[i - 1]
      const t   = seg > 0 ? (target - lens[i - 1]) / seg : 0
      ctx.lineTo(pts[i - 1].x + t * (pts[i].x - pts[i - 1].x),
                 pts[i - 1].y + t * (pts[i].y - pts[i - 1].y))
      break
    }
    ctx.lineTo(pts[i].x, pts[i].y)
  }
  ctx.stroke()
}

// ── main entry point ────────────────────────────────────────────────────────
function buildChart() {
  const panel  = document.getElementById('graph-panel')
  const canvas = document.getElementById('portfolio-chart')
  const dpr    = window.devicePixelRatio || 1
  const W      = panel.clientWidth
  const H      = panel.clientHeight

  canvas.width  = W * dpr
  canvas.height = H * dpr
  canvas.style.width  = W + 'px'
  canvas.style.height = H + 'px'

  const ctx = canvas.getContext('2d')
  ctx.scale(dpr, dpr)

  const cW = W - MARGIN.left - MARGIN.right
  const cH = H - MARGIN.top  - MARGIN.bottom

  // prepare data
  const dates     = tradingDates('2026-01-06', N_POINTS)
  const allSeries = CHART_MODELS.map(m => ({ ...m, data: generateData(m.final, m.seed) }))
  const spSeries  = { ...SP500,   data: generateData(SP500.final,  SP500.seed)  }

  // y scale
  let yMin = Infinity, yMax = -Infinity
  ;[...allSeries, spSeries].forEach(s => {
    s.data.forEach(v => { if (v < yMin) yMin = v; if (v > yMax) yMax = v })
  })
  const yPad = (yMax - yMin) * 0.08
  yMin -= yPad; yMax += yPad

  function xOf(i) { return MARGIN.left + (i / (N_POINTS - 1)) * cW }
  function yOf(v) { return MARGIN.top  + (1 - (v - yMin) / (yMax - yMin)) * cH }

  function toPoints(data) {
    return data.map((v, i) => ({ x: xOf(i), y: yOf(v) }))
  }

  const lines = allSeries.map(s => {
    const pts  = toPoints(s.data)
    const lens = arcLengths(pts)
    return { ...s, pts, lens, totalLen: lens[lens.length - 1] }
  })
  const spLine = (() => {
    const pts  = toPoints(spSeries.data)
    const lens = arcLengths(pts)
    return { ...spSeries, pts, lens, totalLen: lens[lens.length - 1] }
  })()

  // ── static draw functions ──────────────────────────────────────────────────
  function drawGrid() {
    ctx.strokeStyle = 'rgba(255,255,255,0.055)'
    ctx.lineWidth   = 1
    ctx.setLineDash([])
    for (let k = 0; k <= 5; k++) {
      const y = MARGIN.top + (k / 5) * cH
      ctx.beginPath(); ctx.moveTo(MARGIN.left, y); ctx.lineTo(W - MARGIN.right, y); ctx.stroke()
    }
    for (let i = 0; i < N_POINTS; i += 10) {
      const x = xOf(i)
      ctx.beginPath(); ctx.moveTo(x, MARGIN.top); ctx.lineTo(x, MARGIN.top + cH); ctx.stroke()
    }
  }

  function drawAxes() {
    ctx.fillStyle    = 'rgba(255,255,255,0.26)'
    ctx.font         = '500 10px "Space Grotesk", system-ui, sans-serif'
    ctx.shadowBlur   = 0

    ctx.textAlign    = 'right'
    ctx.textBaseline = 'middle'
    for (let k = 0; k <= 5; k++) {
      const v = yMin + (1 - k / 5) * (yMax - yMin)
      const y = MARGIN.top + (k / 5) * cH
      ctx.fillText(fmtDollar(v), MARGIN.left - 8, y)
    }
    ctx.textAlign    = 'center'
    ctx.textBaseline = 'top'
    for (let i = 0; i < N_POINTS; i += 10) {
      ctx.fillText(fmtDate(dates[i]), xOf(i), MARGIN.top + cH + 10)
    }
  }

  // ── animation loop ─────────────────────────────────────────────────────────
  let animStart    = null
  const totalAnim  = ANIM_DUR + lines.length * STAGGER
  let animDone     = false

  function frame(ts) {
    if (!animStart) animStart = ts
    const elapsed = ts - animStart

    ctx.clearRect(0, 0, W, H)
    drawGrid()
    drawAxes()

    ctx.save()
    ctx.beginPath()
    ctx.rect(MARGIN.left, MARGIN.top, cW, cH)
    ctx.clip()

    // S&P (dashed, no glow)
    const spProgress = Math.min(1, Math.max(0, elapsed) / ANIM_DUR)
    ctx.strokeStyle = spLine.color
    ctx.lineWidth   = 1.5
    ctx.setLineDash([4, 5])
    ctx.lineCap  = 'round'
    ctx.lineJoin = 'round'
    ctx.shadowBlur = 0
    drawAtProgress(ctx, spLine.pts, spLine.lens, spLine.totalLen, spProgress)
    ctx.setLineDash([])

    // model lines with neon glow
    lines.forEach((line, i) => {
      const lineElapsed  = Math.max(0, elapsed - (i + 1) * STAGGER)
      const lineProgress = Math.min(1, lineElapsed / ANIM_DUR)

      ctx.strokeStyle  = line.neon
      ctx.lineWidth    = 2
      ctx.lineCap      = 'round'
      ctx.lineJoin     = 'round'
      // outer glow pass (wider, more transparent)
      ctx.shadowColor  = line.neon
      ctx.shadowBlur   = 14
      ctx.globalAlpha  = 0.5
      drawAtProgress(ctx, line.pts, line.lens, line.totalLen, lineProgress)
      // sharp inner pass
      ctx.shadowBlur   = 6
      ctx.globalAlpha  = 1
      drawAtProgress(ctx, line.pts, line.lens, line.totalLen, lineProgress)
    })

    ctx.shadowBlur  = 0
    ctx.globalAlpha = 1
    ctx.restore()

    if (elapsed < totalAnim) {
      requestAnimationFrame(frame)
    } else if (!animDone) {
      animDone = true
      buildEndpointCircles(lines, spLine, yMin, yMax, W, H)
    }
  }

  requestAnimationFrame(frame)
  setupTooltip(canvas, lines, spLine, xOf, dates, W, H)
}

// ── endpoint circles ─────────────────────────────────────────────────────────
function buildEndpointCircles(lines, spLine, yMin, yMax, W, H) {
  const container = document.getElementById('endpoint-circles')
  container.innerHTML = ''

  const cW = W - MARGIN.left - MARGIN.right
  const cH = H - MARGIN.top  - MARGIN.bottom
  function xOf(i) { return MARGIN.left + (i / (N_POINTS - 1)) * cW }
  function yOf(v) { return MARGIN.top  + (1 - (v - yMin) / (yMax - yMin)) * cH }

  const finalX = xOf(N_POINTS - 1)

  lines.forEach((line, idx) => {
    const f = FACETS[line.facet]
    const finalY = yOf(line.final)

    const wrap = document.createElement('div')
    wrap.className = 'endpoint-wrap'
    wrap.style.left = finalX + 'px'
    wrap.style.top  = finalY + 'px'
    wrap.style.animationDelay = (idx * 0.06) + 's'

    // pulse rings
    const pulse1 = document.createElement('div')
    pulse1.className = 'endpoint-pulse'
    pulse1.style.borderColor = line.neon

    const pulse2 = document.createElement('div')
    pulse2.className = 'endpoint-pulse endpoint-pulse-2'
    pulse2.style.borderColor = line.neon

    // circle with 3D gem look
    const circle = document.createElement('div')
    circle.className = 'endpoint-circle'
    circle.style.cssText = `
      background: linear-gradient(135deg, ${f.mid} 0%, ${f.base} 100%);
      border: 1px solid rgba(255,255,255,0.12);
      box-shadow: 0 3px 10px -2px ${f.facet},
                  inset 1.5px 2px 0.5px -0.5px rgba(255,255,255,0.85),
                  inset -1.5px -2px 0.5px -0.5px rgba(0,0,0,0.4),
                  inset 3px 3px 6px -2px rgba(255,255,255,0.25),
                  inset -2px -2px 8px rgba(0,0,0,0.5),
                  inset 0 0 0 1px rgba(255,255,255,0.12);
    `

    // top-left glow
    const glowTL = document.createElement('div')
    glowTL.className = 'endpoint-circle-glow'
    glowTL.style.cssText = `top:-3px;left:-3px;width:14px;height:14px;background:radial-gradient(circle,white 0%,${f.facet} 30%,transparent 70%);`

    // bottom-right glow
    const glowBR = document.createElement('div')
    glowBR.className = 'endpoint-circle-glow'
    glowBR.style.cssText = `bottom:-3px;right:-3px;width:14px;height:14px;background:radial-gradient(circle,white 0%,${f.facet} 30%,transparent 70%);`

    const img = document.createElement('img')
    img.src = line.logo
    img.alt = line.label

    circle.appendChild(glowTL)
    circle.appendChild(glowBR)
    circle.appendChild(img)
    wrap.appendChild(pulse1)
    wrap.appendChild(pulse2)
    wrap.appendChild(circle)
    container.appendChild(wrap)
  })

  // S&P dot — simple grey circle, no pulse
  const spY = yOf(spLine.final)
  const spWrap = document.createElement('div')
  spWrap.className = 'endpoint-wrap'
  spWrap.style.left = finalX + 'px'
  spWrap.style.top  = spY + 'px'
  spWrap.style.animationDelay = (lines.length * 0.06) + 's'

  const spCircle = document.createElement('div')
  spCircle.className = 'endpoint-circle'
  spCircle.style.cssText = `
    background: rgba(60,60,70,0.8);
    border: 1px solid rgba(160,160,160,0.3);
    box-shadow: inset 0 0 6px rgba(160,160,160,0.15);
  `
  const spLabel = document.createElement('span')
  spLabel.className = 'endpoint-circle-sp'
  spLabel.textContent = 'SP'
  spCircle.appendChild(spLabel)
  spWrap.appendChild(spCircle)
  container.appendChild(spWrap)
}

// ── tooltip ───────────────────────────────────────────────────────────────────
function setupTooltip(canvas, lines, spLine, xOf, dates, W, H) {
  const guideline = document.getElementById('chart-guideline')
  const tooltip   = document.getElementById('chart-tooltip')
  const panel     = document.getElementById('graph-panel')
  const cW        = W - MARGIN.left - MARGIN.right

  function show(e) {
    const rect = canvas.getBoundingClientRect()
    const mx   = e.clientX - rect.left
    const idx  = Math.round((mx - MARGIN.left) / (cW / (N_POINTS - 1)))
    if (idx < 0 || idx >= N_POINTS) { hide(); return }

    guideline.style.left    = xOf(idx) + 'px'
    guideline.style.display = 'block'

    let html = `<div class="tooltip-date">${fmtDate(dates[idx])}</div>`
    lines.forEach(line => {
      html += `<div class="tooltip-row">
        <span class="tooltip-dot" style="background:${line.neon}"></span>
        <span class="tooltip-name">${line.label}</span>
        <span class="tooltip-val">${fmtDollar(line.data[idx])}</span>
      </div>`
    })
    html += `<div class="tooltip-row">
      <span class="tooltip-dot" style="background:${spLine.color}"></span>
      <span class="tooltip-name">${spLine.label}</span>
      <span class="tooltip-val">${fmtDollar(spLine.data[idx])}</span>
    </div>`
    tooltip.innerHTML = html

    const panelW = panel.getBoundingClientRect().width
    const tipW   = 200
    let tipLeft  = xOf(idx) + 14
    if (tipLeft + tipW > panelW - 10) tipLeft = xOf(idx) - tipW - 14
    tooltip.style.left    = tipLeft + 'px'
    tooltip.style.top     = MARGIN.top + 'px'
    tooltip.style.display = 'block'
  }

  function hide() {
    guideline.style.display = 'none'
    tooltip.style.display   = 'none'
  }

  canvas.addEventListener('mousemove', show)
  canvas.addEventListener('mouseleave', hide)
}
