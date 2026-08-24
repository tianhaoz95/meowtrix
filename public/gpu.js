// ── GPU Monitor Client Logic ─────────────────────────────────────────────────
let latestGpuStats = null;

function onGpuState(stats) {
  latestGpuStats = stats;
  renderGpuBadge();
}

function renderGpuBadge() {
  const btn = document.getElementById('btn-gpu');
  const badgeText = document.getElementById('gpu-badge-text');
  if (!btn || !badgeText) return;
  const enabled = typeof getSettings === 'function' && getSettings().gpuMonitor;
  const gpus = latestGpuStats && latestGpuStats.available ? latestGpuStats.gpus : null;
  if (enabled && gpus && gpus.length > 0) {
    const avgUtil = Math.round(gpus.reduce((s, g) => s + (g.utilization || 0), 0) / gpus.length);
    badgeText.textContent = `${avgUtil}%`;
    btn.removeAttribute('hidden');
  } else {
    btn.setAttribute('hidden', '');
    const popover = document.querySelector('.gpu-popover');
    if (popover) popover.remove();
  }
}

function toggleGpuPopover() {
  const btn = document.getElementById('btn-gpu');
  if (!btn) return;

  const existing = document.querySelector('.gpu-popover');
  if (existing) {
    existing.remove();
    document.removeEventListener('click', onGpuDocClick, true);
    return;
  }

  const gpus = (latestGpuStats && latestGpuStats.gpus) || [];
  const popover = document.createElement('div');
  popover.className = 'gpu-popover';

  let html = `<div class="gpu-popover-header">GPU Stats (${gpus.length})</div>`;
  if (gpus.length === 0) {
    html += `<div style="padding: 12px; font-size: 12px; color: var(--text3); text-align: center;">No GPU data available</div>`;
  } else {
    gpus.forEach(g => {
      html += `
        <div class="gpu-popover-item">
          <div class="gpu-popover-name">#${g.index} ${g.name || 'GPU'}</div>
          <div class="gpu-popover-stats">
            <span>Util ${g.utilization ?? '–'}%</span>
            <span>Mem ${g.memoryUsedMb ?? '–'}/${g.memoryTotalMb ?? '–'} MB</span>
            <span>${g.temperatureC ?? '–'}°C</span>
            <span>${g.powerDrawW ?? '–'}/${g.powerLimitW ?? '–'} W</span>
          </div>
        </div>
      `;
    });
  }

  popover.innerHTML = html;
  document.body.appendChild(popover);

  const rect = btn.getBoundingClientRect();
  popover.style.top = `${rect.bottom + 6}px`;
  const popoverWidth = 260;
  let left = rect.left + (rect.width - popoverWidth) / 2;
  if (left + popoverWidth > window.innerWidth) {
    left = window.innerWidth - popoverWidth - 10;
  }
  popover.style.left = `${Math.max(10, left)}px`;

  setTimeout(() => {
    document.addEventListener('click', onGpuDocClick, true);
  }, 0);
}

function onGpuDocClick(e) {
  const popover = document.querySelector('.gpu-popover');
  const btn = document.getElementById('btn-gpu');
  if (popover && !popover.contains(e.target) && (!btn || !btn.contains(e.target))) {
    popover.remove();
    document.removeEventListener('click', onGpuDocClick, true);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('btn-gpu');
  if (btn) btn.addEventListener('click', toggleGpuPopover);
});
