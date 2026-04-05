const STARTING_AMOUNT = 100000

let selectedTileIdx = null

function buildRankRow() {
  const row = document.getElementById('rank-row')
  const labels = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th']

  TILES.forEach((_tile, i) => {
    const badge = document.createElement('div')
    const rankNum = i + 1
    badge.className = 'rank-badge ' + (rankNum <= 3 ? 'rank-' + rankNum : 'rank-other')
    const span = document.createElement('span')
    span.className = 'rank-text'
    span.textContent = labels[i]
    badge.appendChild(span)
    row.appendChild(badge)
  })
}

function selectTile(idx) {
  selectedTileIdx = idx
  document.querySelectorAll('.tile-wrap').forEach((el, i) => {
    el.classList.toggle('dimmed', i !== idx)
    el.classList.toggle('selected', i === idx)
  })
  // switch left panel to portfolio tab
  if (typeof showPortfolio === 'function') showPortfolio(TILES[idx])
}

function deselectTile() {
  selectedTileIdx = null
  document.querySelectorAll('.tile-wrap').forEach(el => {
    el.classList.remove('dimmed', 'selected')
  })
  if (typeof showActivity === 'function') showActivity()
}

function buildGrid() {
  const grid = document.getElementById('tile-grid')

  TILES.forEach((tile, i) => {
    const f = FACETS[tile.facet]

    const rawValue = parseFloat(tile.portfolio.replace(/[$,]/g, ''))
    const delta = rawValue - STARTING_AMOUNT
    const pct = (delta / STARTING_AMOUNT * 100).toFixed(1)
    const deltaAbbrev = (delta >= 0 ? '+' : '') + pct + '%'
    const triangleSymbol = delta >= 0 ? '▲' : '▼'
    const deltaColor = 'rgba(255,255,255,0.32)'

    const wrap = document.createElement('div')
    wrap.className = 'tile-wrap'
    wrap.style.cssText = `
      position: relative;
      aspect-ratio: 1 / 1;
    `

    const inner = document.createElement('div')
    inner.className = 'tile-inner'
    inner.style.cssText = `
      position: relative;
      width: 100%;
      height: 100%;
      border-radius: 24px;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: space-between;
      padding: 1.25rem;
      background: linear-gradient(180deg, ${f.mid} 0%, ${f.base} 100%);
      box-shadow: 0 20px 40px -10px rgba(0,0,0,0.8);
      filter: drop-shadow(0 0 6px ${f.glow});
    `

    inner.innerHTML = `
      <div style="position:absolute;inset:0;border-radius:24px;overflow:hidden;pointer-events:none;z-index:0">
        <div style="position:absolute;inset:-150%;opacity:0.6;mix-blend-mode:screen;transform-origin:50% 50%;animation:sweep-arc 12s linear infinite;animation-delay:${i * 1.2}s">
          <div style="width:100%;height:100%;filter:blur(25px);background:conic-gradient(from 0deg,transparent 0%,${f.light} 4%,#fff 5%,${f.light} 6%,transparent 15%,transparent 100%)"></div>
        </div>
      </div>

      <div style="position:absolute;top:7.5px;left:50%;transform:translateX(-50%);width:90%;height:55%;border-radius:20px 20px 0 0;pointer-events:none;opacity:0.4;mix-blend-mode:plus-lighter;background:linear-gradient(to bottom,rgba(255,255,255,0.4),transparent);z-index:2"></div>
      <div style="position:absolute;bottom:10px;left:50%;transform:translateX(-50%);width:90%;height:45%;border-radius:0 0 20px 20px;pointer-events:none;opacity:0.3;mix-blend-mode:plus-lighter;background:linear-gradient(to top,rgba(255,255,255,0.45),transparent);z-index:2"></div>

      <div style="position:relative;z-index:20;padding:10px;border-radius:14px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.1);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);box-shadow:inset 0 0 14px ${f.facet};margin-top:.25rem;overflow:hidden">
        <img src="${tile.logo}" alt="${tile.model}" style="width:2.4rem;height:2.4rem;object-fit:contain;display:block;position:relative;z-index:2" />
      </div>

      <div style="position:relative;z-index:20;text-align:center;width:100%;padding-bottom:.4rem">
        <span style="display:block;font-size:clamp(9px,1.1vw,11px);font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:rgba(255,255,255,0.65);line-height:1.4">${tile.model}</span>
        <div style="display:flex;align-items:center;justify-content:center;gap:0.35rem;margin-top:3px">
          <span style="font-size:clamp(7px,0.85vw,9px);font-weight:700;letter-spacing:0.06em;color:rgba(255,255,255,0.32);font-variant-numeric:tabular-nums">${tile.portfolio}</span>
          <span style="font-size:clamp(7px,0.82vw,9px);font-weight:700;color:${deltaColor};letter-spacing:0.03em">${triangleSymbol} ${deltaAbbrev}</span>
        </div>
      </div>
    `

    wrap.appendChild(inner)
    wrap.addEventListener('click', () => {
      if (selectedTileIdx === i) {
        deselectTile()
      } else {
        selectTile(i)
      }
    })
    grid.appendChild(wrap)
  })
}

buildRankRow()
buildGrid()
