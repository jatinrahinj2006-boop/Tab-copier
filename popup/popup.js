// ══════════════════════════════════════════════════════════════
// Tab Link Copier — Popup Controller
// ══════════════════════════════════════════════════════════════

// ─── State ────────────────────────────────────────────────────

const excludedTabIds = new Set();
let currentPreviewTabs = [];
let qrcodeInstance = null;
let selectedDomainFilter = null;

// ─── Format & Privacy Helpers ─────────────────────────────────

function cleanUrl(rawUrl) {
  if (!rawUrl) return rawUrl;
  try {
    const u = new URL(rawUrl);
    // Amazon clean shortener: canonicalize to /dp/ASIN
    if (/amazon\.[a-z.]+/i.test(u.hostname)) {
      const asinMatch = u.pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i);
      if (asinMatch) {
        return `${u.protocol}//${u.hostname}/dp/${asinMatch[1]}`;
      }
    }

    // Tracking query parameter keys to strip
    const trackingParams = [
      'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
      'utm_id', 'utm_source_platform', 'utm_creative_format', 'utm_marketing_tactic',
      'fbclid', 'gclid', 'gclsrc', 'dclid', 'wbraid', 'gbraid', 'msclkid', 'yclid',
      'mc_cid', 'mc_eid', '_ga', '_gl', '_hsenc', '_hsmi', 'hsCtsTracking',
      'si', 'ref', 'ref_src', 'ref_url', 'igshid', 'share_id', 'feature',
      'mkt_tok', 'trk', 'sc_channel'
    ];

    trackingParams.forEach(p => u.searchParams.delete(p));

    const keysToDelete = [];
    for (const key of u.searchParams.keys()) {
      if (key.startsWith('utm_') || key.startsWith('fb_') || key.startsWith('ig_')) {
        keysToDelete.push(key);
      }
    }
    keysToDelete.forEach(k => u.searchParams.delete(k));

    return u.toString();
  } catch (e) {
    return rawUrl;
  }
}

function formatUrls(tabs, format, numbered = true, clean = false) {
  const urls   = tabs.map(t => clean ? cleanUrl(t.url) : t.url).filter(Boolean);
  const titles = tabs.map(t => t.title || (clean ? cleanUrl(t.url) : t.url));

  switch (format) {
    case 'plain':
    case 'txt':
      return urls.map((u, i) => numbered ? `${i + 1}. ${u}` : u).join('\n');

    case 'markdown':
    case 'md': {
      const heading = `# Tab Links\n*Exported on ${new Date().toLocaleString()} · ${tabs.length} tabs*\n\n`;
      const links = urls
        .map((url, i) => numbered
          ? `${i + 1}. [${titles[i].replace(/[\[\]]/g, '')}](${url})`
          : `- [${titles[i].replace(/[\[\]]/g, '')}](${url})`)
        .join('\n');
      return heading + links;
    }

    case 'json':
      return JSON.stringify(
        urls.map((url, i) => numbered
          ? { index: i + 1, title: titles[i], url }
          : { title: titles[i], url }),
        null,
        2
      );

    case 'csv': {
      const header = numbered ? '"#","title","url"' : '"title","url"';
      const rows = urls.map((url, i) => numbered
        ? `"${i + 1}","${titles[i].replace(/"/g, '""')}","${url}"`
        : `"${titles[i].replace(/"/g, '""')}","${url}"`);
      return [header, ...rows].join('\n');
    }

    case 'html': {
      const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const tag = numbered ? 'ol' : 'ul';
      const items = urls.map((url, i) =>
        `  <li><a href="${url}">${esc(titles[i])}</a></li>`
      );
      return `<${tag}>\n${items.join('\n')}\n</${tag}>`;
    }

    default:
      return urls.join('\n');
  }
}

function getFilename(ext) {
  const d = new Date();
  const dateStr = d.toISOString().slice(0, 10);
  const timeStr = `${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`;
  return `tab-links-${dateStr}-${timeStr}.${ext}`;
}

// ─── Toast Feedback ───────────────────────────────────────────

function showToast(targetId, message, type = 'success') {
  const toast = document.getElementById(targetId);
  if (!toast) return;
  toast.textContent = message;
  toast.className = `toast ${type}`;
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { toast.className = 'toast hidden'; }, 3200);
}

// ─── Tab Query & Deduplication ────────────────────────────────

async function getScopedTabsRaw(scope) {
  const currentWindow = await chrome.windows.getCurrent();
  if (scope === 'thisTab') {
    return chrome.tabs.query({ windowId: currentWindow.id, active: true });
  } else if (scope === 'selected') {
    return chrome.tabs.query({ windowId: currentWindow.id, highlighted: true });
  } else if (scope === 'window' || scope === 'all') {
    return chrome.tabs.query({ windowId: currentWindow.id });
  } else if (scope === 'allWindows') {
    return chrome.tabs.query({});
  }
  return [];
}

async function getScopedTabs(scope) {
  const tabs = await getScopedTabsRaw(scope);
  return tabs.filter(t => !excludedTabIds.has(t.id));
}

function filterDeduplicate(tabs) {
  const seen = new Set();
  return tabs.filter(t => {
    if (!t.url || seen.has(t.url)) return false;
    seen.add(t.url);
    return true;
  });
}

function getScopeAndDedupSettings() {
  const scopeEl = document.querySelector('input[name="scope"]:checked');
  const scope = scopeEl ? scopeEl.value : 'selected';
  const dedup = document.getElementById('dedup-toggle')?.checked || false;
  const numbered = document.getElementById('numbering-toggle')?.checked !== false;
  const clean = (document.getElementById('clean-url-toggle')?.checked || document.getElementById('export-clean-url-toggle')?.checked) || false;
  const format = document.getElementById('format-select')?.value || 'plain';
  return { scope, dedup, format, numbered, clean };
}

// ─── File Download Helper ─────────────────────────────────────

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// ─── Helpers ──────────────────────────────────────────────────

const sleep = ms => new Promise(r => setTimeout(r, ms));

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ─── History Logging & Restoration ────────────────────────────

async function logHistory(count, actionLabel, scopeLabel, incognito, tabs = []) {
  const { history = [] } = await chrome.storage.local.get({ history: [] });
  history.unshift({
    count,
    format: actionLabel,
    scope: scopeLabel,
    time: new Date().toLocaleString(),
    incognito: !!incognito,
    tabs: (tabs || []).map(t => ({
      title: t.title || t.url,
      url: t.url,
      windowId: t.windowId,
      incognito: !!t.incognito,
      favIconUrl: t.favIconUrl || ''
    }))
  });
  await chrome.storage.local.set({ history: history.slice(0, 30) });
  await renderHistory(history.slice(0, 30));
}

async function renderHistory(history) {
  const list = document.getElementById('history-list');
  if (!list) return;

  if (!history || !history.length) {
    list.innerHTML = '<li><div class="empty-state">No operations yet</div></li>';
    return;
  }

  // Live detection: query all currently open tabs to check open/closed status
  let openTabs = [];
  try {
    openTabs = await chrome.tabs.query({});
  } catch (err) {
    console.warn('Could not query open tabs:', err);
  }
  const openUrls = new Set(openTabs.map(t => t.url).filter(Boolean));

  list.innerHTML = history.map((entry, idx) => {
    const tabs = entry.tabs || [];
    let openCount = 0;
    let closedCount = 0;
    if (tabs.length) {
      tabs.forEach(t => {
        if (openUrls.has(t.url)) openCount++;
        else closedCount++;
      });
    }

    const hasTabs = tabs.length > 0;
    const allOpen = hasTabs && closedCount === 0;

    const statusBadge = hasTabs
      ? `<span class="history-scope" title="${openCount} open, ${closedCount} closed">(${openCount} open · ${closedCount} closed)</span>`
      : `<span class="badge" style="font-size:8.5px;background:#f1f3f4;color:#70757a;margin-left:4px;" title="Older entry saved before URL history was enabled">Legacy</span>`;

    const tabsListHtml = hasTabs ? `
      <div id="history-accordion-${idx}" class="history-links-accordion hidden">
        ${tabs.map(t => {
          const isOpen = openUrls.has(t.url);
          const winLabel = t.windowId != null ? `Win ${t.windowId}` : '';
          return `
            <div class="history-link-row-wrapper" style="display:flex;align-items:center;justify-content:space-between;gap:4px;">
              <a href="#" class="history-link-row" data-url="${escapeHtml(t.url)}" title="${escapeHtml(t.url)}" style="flex:1;">
                <span class="status-dot ${isOpen ? 'open' : 'closed'}" title="${isOpen ? 'Currently open in Chrome' : 'Closed — click to open'}"></span>
                <span class="history-link-title">${escapeHtml(t.title || t.url)}</span>
                ${winLabel ? `<span class="badge" style="font-size:8px;padding:1px 4px;background:#e8f0fe;color:#1967d2;">${winLabel}</span>` : ''}
                ${t.incognito ? `<span class="badge badge-incognito" style="font-size:8px;">🕵</span>` : ''}
              </a>
              <button class="btn-open-link-incog" data-url="${escapeHtml(t.url)}" title="Open this specific tab in Incognito">🕵 Incog</button>
            </div>
          `;
        }).join('')}
      </div>
    ` : '';

    return `
      <li class="history-item">
        <div class="history-main">
          <span class="history-label">${entry.count} tab${entry.count !== 1 ? 's' : ''} · ${escapeHtml(entry.format)}</span>
          <span class="history-time">${escapeHtml(entry.time)}</span>
        </div>
        <div class="history-sub-row">
          <div class="history-scope">
            Scope: ${escapeHtml(entry.scope || 'Window')}${entry.incognito ? ' · 🕵 incognito' : ''} ${statusBadge}
          </div>
          <div class="history-actions">
            ${hasTabs ? `
              <button class="btn-restore-history" data-index="${idx}" title="${allOpen ? 'Reopen all tabs in a new window' : 'Restore closed tabs into original windows'}">
                🔄 Restore${closedCount > 0 ? ` (${closedCount})` : ''}
              </button>
              <button class="btn-restore-incog" data-index="${idx}" title="Restore this session inside private Incognito window(s)">
                🕵 Incog
              </button>
              <button class="btn-toggle-links" data-index="${idx}">View Links</button>
            ` : `
              <button class="btn-restore-history legacy" data-index="${idx}" title="Legacy entry without saved URLs — click for details">
                🔄 Restore (Legacy)
              </button>
            `}
          </div>
        </div>
        ${tabsListHtml}
      </li>
    `;
  }).join('');
}

async function restoreHistoryEntry(entry, forceIncognito = false) {
  if (!entry || !entry.tabs || !entry.tabs.length) {
    showToast('history-toast', 'No tab URLs found in this history entry', 'error');
    return;
  }

  // Check incognito mode: either explicitly requested via button or checked in header toggle
  const isIncognito = forceIncognito || (document.getElementById('history-incognito-mode')?.checked ?? false);

  if (isIncognito) {
    const isAllowed = await chrome.extension.isAllowedIncognitoAccess();
    if (!isAllowed) {
      showToast('history-toast', '⚠️ Enable "Allow in Incognito" in chrome://extensions to restore in Incognito', 'error');
      chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` });
      return;
    }
  }

  // 1. Query current open tabs to detect which are already open
  const openTabs = await chrome.tabs.query({});
  const openUrls = new Set(
    (isIncognito ? openTabs.filter(t => t.incognito) : openTabs.filter(t => !t.incognito))
      .map(t => t.url).filter(Boolean)
  );

  // 2. Identify closed tabs
  let closedTabs = entry.tabs.filter(t => t.url && !openUrls.has(t.url));

  // If all are already open in target context, restore all of them into a new window!
  if (!closedTabs.length) {
    closedTabs = entry.tabs.filter(t => t.url);
  }

  // 3. Query existing open windows
  const openWindows = await chrome.windows.getAll();
  const openWinIds = new Set(
    (isIncognito ? openWindows.filter(w => w.incognito) : openWindows.filter(w => !w.incognito))
      .map(w => w.id)
  );

  // 4. Group closed tabs by their original windowId
  const winGroups = new Map();
  for (const t of closedTabs) {
    const wId = t.windowId != null ? t.windowId : 'single';
    if (!winGroups.has(wId)) {
      winGroups.set(wId, []);
    }
    winGroups.get(wId).push(t);
  }

  showToast('history-toast', `Restoring ${closedTabs.length} tabs${isIncognito ? ' in Incognito' : ''}...`, 'info');

  let windowsCreatedCount = 0;
  let tabsRestoredCount = 0;

  for (const [wId, tabsInWin] of winGroups.entries()) {
    const urls = tabsInWin.map(t => t.url);
    if (!urls.length) continue;

    if (!isIncognito && wId !== 'single' && openWinIds.has(wId)) {
      // Normal restoration & original window is STILL open! Restore into that existing window
      for (const u of urls) {
        await chrome.tabs.create({ windowId: wId, url: u, active: false });
        tabsRestoredCount++;
        await sleep(25);
      }
    } else {
      // Original window was closed, or restoring in Incognito (creates private window per window group!)
      await chrome.windows.create({ url: urls, incognito: isIncognito });
      tabsRestoredCount += urls.length;
      windowsCreatedCount++;
      await sleep(50);
    }
  }

  const winMsg = windowsCreatedCount > 0
    ? ` across ${windowsCreatedCount} ${isIncognito ? 'Incognito ' : ''}window${windowsCreatedCount > 1 ? 's' : ''}`
    : '';

  showToast('history-toast', `✓ Restored ${tabsRestoredCount} tabs${winMsg}!`, 'success');

  // Re-render history so open status dots update immediately
  const { history = [] } = await chrome.storage.local.get({ history: [] });
  await renderHistory(history);
}

// ─── Unified Export Handler ───────────────────────────────────

async function executeExport(scope, format, mode = 'both', closeAfter = false) {
  // mode: 'copy' | 'export' | 'both'
  const { dedup, numbered, clean } = getScopeAndDedupSettings();
  let tabs = await getScopedTabs(scope);
  tabs = tabs.filter(t => t.url);

  if (dedup) tabs = filterDeduplicate(tabs);
  if (clean) tabs = tabs.map(t => ({ ...t, url: cleanUrl(t.url) }));

  if (!tabs.length) {
    showToast('export-toast', 'No tabs found matching selection', 'error');
    return;
  }

  const ext = format;
  const isDocx = format === 'docx';
  const filename = getFilename(ext);
  const textContent = isDocx ? '' : formatUrls(tabs, format, numbered, false);

  let didCopy = false;
  let didDownload = false;

  // 1. Copy to clipboard
  if (mode === 'copy' || mode === 'both') {
    try {
      const copyPayload = isDocx ? formatUrls(tabs, 'markdown', numbered) : textContent;
      await navigator.clipboard.writeText(copyPayload);
      didCopy = true;
    } catch (err) {
      console.error('Clipboard write failed:', err);
    }
  }

  // 2. Download File
  if (mode === 'export' || mode === 'both') {
    try {
      if (isDocx) {
        showToast('export-toast', 'Generating Word document...', 'info');
        const docxBlob = await generateDocx(tabs, 'blob', numbered);
        downloadBlob(docxBlob, filename);
        didDownload = true;
      } else {
        const mimeMap = {
          txt: 'text/plain;charset=utf-8',
          md: 'text/markdown;charset=utf-8',
          json: 'application/json;charset=utf-8',
          csv: 'text/csv;charset=utf-8'
        };
        const blob = new Blob([textContent], { type: mimeMap[format] || 'text/plain' });
        downloadBlob(blob, filename);
        didDownload = true;
      }
    } catch (err) {
      console.error('Download error:', err);
      showToast('export-toast', 'File generation/download failed', 'error');
      return;
    }
  }

  // Close tabs if requested
  if (closeAfter) {
    const tabIdsToClose = tabs.map(t => t.id);
    await chrome.tabs.remove(tabIdsToClose);
  }

  const scopeNames = {
    thisTab: 'This Tab',
    selected: 'Selected Tabs',
    window: 'This Window',
    allWindows: 'All Windows'
  };

  const actionMsg = closeAfter
    ? `✓ Exported & closed ${tabs.length} tabs (.${ext})`
    : mode === 'both'
      ? `✓ Copied & downloaded ${tabs.length} tabs (.${ext})`
      : mode === 'export'
        ? `✓ Downloaded ${tabs.length} tabs (${filename})`
        : `✓ Copied ${tabs.length} tabs to clipboard`;

  showToast('export-toast', actionMsg, 'success');

  const historyAction = closeAfter
    ? `Exported & Closed .${ext}`
    : mode === 'both'
      ? `Copied & Downloaded .${ext}`
      : `Downloaded .${ext}`;

  await logHistory(tabs.length, historyAction, scopeNames[scope] || scope, tabs.some(t => t.incognito), tabs);
}

// ─── Advanced Preview, Search & Sorting ───────────────────────

async function refreshPreview() {
  const { scope, dedup, numbered } = getScopeAndDedupSettings();
  let rawTabs = await getScopedTabsRaw(scope);
  rawTabs = rawTabs.filter(t => t.url);

  // Update memory stats heuristic (~36 MB per tab)
  const memStatsEl = document.getElementById('memory-stats-text');
  if (memStatsEl) {
    const estMb = Math.round(rawTabs.length * 36);
    memStatsEl.textContent = `🧠 ~${estMb} MB RAM`;
  }

  // Build domain analytics map for domain filter pills
  const domainCounts = new Map();
  rawTabs.forEach(t => {
    try {
      const host = new URL(t.url).hostname.replace(/^www\./, '');
      if (host) domainCounts.set(host, (domainCounts.get(host) || 0) + 1);
    } catch (e) {}
  });
  const sortedDomains = Array.from(domainCounts.entries()).sort((a, b) => b[1] - a[1]);

  const domainBarEl = document.getElementById('preview-domain-bar');
  if (domainBarEl) {
    if (sortedDomains.length > 1) {
      domainBarEl.style.display = 'flex';
      const allActive = !selectedDomainFilter;
      let barHtml = `<button class="domain-pill ${allActive ? 'active' : ''}" data-domain="">🌐 All (${rawTabs.length})</button>`;
      sortedDomains.slice(0, 10).forEach(([domain, cnt]) => {
        const isActive = selectedDomainFilter === domain;
        barHtml += `<button class="domain-pill ${isActive ? 'active' : ''}" data-domain="${escapeHtml(domain)}">${escapeHtml(domain)} (${cnt})</button>`;
      });
      domainBarEl.innerHTML = barHtml;

      domainBarEl.querySelectorAll('.domain-pill').forEach(btn => {
        btn.addEventListener('click', () => {
          const d = btn.dataset.domain;
          selectedDomainFilter = (selectedDomainFilter === d || !d) ? null : d;
          refreshPreview();
        });
      });
    } else {
      domainBarEl.innerHTML = '';
      domainBarEl.style.display = 'none';
    }
  }

  // Tabs remaining after exclusion
  let tabs = rawTabs.filter(t => !excludedTabIds.has(t.id));

  // Domain filter
  if (selectedDomainFilter) {
    tabs = tabs.filter(t => {
      try {
        return new URL(t.url).hostname.replace(/^www\./, '') === selectedDomainFilter;
      } catch (e) { return false; }
    });
  }

  // 1. Search / Filter query
  const searchInput = document.getElementById('preview-search');
  const searchQuery = (searchInput?.value || '').trim().toLowerCase();
  if (searchQuery) {
    tabs = tabs.filter(t =>
      (t.title && t.title.toLowerCase().includes(searchQuery)) ||
      (t.url && t.url.toLowerCase().includes(searchQuery))
    );
  }

  // 2. Sort option
  const sortSelect = document.getElementById('preview-sort');
  const sortBy = sortSelect?.value || 'default';

  if (sortBy === 'alpha') {
    tabs.sort((a, b) => (a.title || a.url).localeCompare(b.title || b.url));
  } else if (sortBy === 'domain') {
    tabs.sort((a, b) => {
      try {
        const hostA = new URL(a.url).hostname;
        const hostB = new URL(b.url).hostname;
        return hostA.localeCompare(hostB);
      } catch (e) { return 0; }
    });
  } else if (sortBy === 'reverse') {
    tabs.reverse();
  }

  // Count URL occurrences on active preview tabs for duplicate badges
  const urlCounts = new Map();
  tabs.forEach(t => {
    urlCounts.set(t.url, (urlCounts.get(t.url) || 0) + 1);
  });

  let duplicateCount = 0;
  for (const count of urlCounts.values()) {
    if (count > 1) duplicateCount += (count - 1);
  }

  const finalTabs = dedup ? filterDeduplicate(tabs) : tabs;
  currentPreviewTabs = finalTabs;

  const summaryEl = document.getElementById('preview-summary');
  const incognitoCount = finalTabs.filter(t => t.incognito).length;

  summaryEl.innerHTML = `
    <span class="preview-count">${finalTabs.length} tab${finalTabs.length !== 1 ? 's' : ''}${searchQuery || selectedDomainFilter ? ` (filtered from ${rawTabs.length})` : ''}</span>
    ${excludedTabIds.size > 0 ? `<span class="preview-excluded-badge">${excludedTabIds.size} excluded</span> <button id="btn-restore-excluded" class="btn-restore-excluded" title="Restore all excluded tabs">Restore all</button>` : ''}
    ${duplicateCount > 0 ? `<span class="preview-dups">⚠️ ${duplicateCount} duplicate${duplicateCount !== 1 ? 's' : ''}${dedup ? ' (filtered)' : ''}</span>` : ''}
    ${incognitoCount > 0 ? `<span class="preview-incog">🕵 ${incognitoCount} incognito</span>` : ''}
  `;

  // Attach restore button listener if visible
  const restoreBtn = document.getElementById('btn-restore-excluded');
  if (restoreBtn) {
    restoreBtn.addEventListener('click', () => {
      excludedTabIds.clear();
      refreshPreview();
      showToast('preview-toast', 'Restored all excluded tabs', 'success');
    });
  }

  const listEl = document.getElementById('preview-list');
  const copyBtn = document.getElementById('btn-preview-copy');
  const exportBtn = document.getElementById('btn-preview-export');

  if (!finalTabs.length) {
    listEl.innerHTML = '<div class="empty-state">No tabs matching filter</div>';
    copyBtn.disabled = true;
    if (exportBtn) exportBtn.disabled = true;
    return;
  }

  copyBtn.disabled = false;
  if (exportBtn) exportBtn.disabled = false;

  listEl.innerHTML = finalTabs.map((t, i) => {
    const isDup = (urlCounts.get(t.url) || 0) > 1;
    const favicon = t.favIconUrl && !t.favIconUrl.startsWith('chrome://')
      ? `<img class="favicon" src="${t.favIconUrl}" alt="">`
      : '<div class="favicon-placeholder">🌐</div>';

    return `
      <div class="preview-item ${isDup ? 'is-dup' : ''}">
        <input type="checkbox" class="preview-item-check" data-tab-id="${t.id}" checked title="Include in copy/export">
        ${numbered ? `<span class="preview-item-num">${i + 1}.</span>` : ''}
        ${favicon}
        <div class="preview-item-text">
          <div class="preview-title" title="${t.title || t.url}">${escapeHtml(t.title || 'Untitled')}</div>
          <div class="preview-url" title="${t.url}">${escapeHtml(t.url)}</div>
        </div>
        <div class="preview-badges">
          ${isDup ? '<span class="badge badge-dup">DUP</span>' : ''}
          ${t.incognito ? '<span class="badge badge-incognito">🕵</span>' : ''}
        </div>
        <button class="btn-jump-tab" data-tab-id="${t.id}" data-win-id="${t.windowId}" title="Jump directly to this tab in Chrome">🔀</button>
        <button class="btn-remove-tab" data-tab-id="${t.id}" title="Exclude / remove this link">✕</button>
      </div>
    `;
  }).join('');

  // Handle broken favicon images safely via addEventListener (CSP compliant)
  listEl.querySelectorAll('.favicon').forEach(img => {
    img.addEventListener('error', () => {
      img.style.display = 'none';
    });
  });

  // Attach jump button listeners
  listEl.querySelectorAll('.btn-jump-tab').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const tabId = parseInt(btn.dataset.tabId, 10);
      const winId = parseInt(btn.dataset.winId, 10);
      try {
        if (tabId) await chrome.tabs.update(tabId, { active: true });
        if (winId) await chrome.windows.update(winId, { focused: true });
        window.close();
      } catch (err) {
        console.warn('Could not jump to tab:', err);
      }
    });
  });

  // Attach click listener to each ✕ button
  listEl.querySelectorAll('.btn-remove-tab').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const tabId = parseInt(btn.dataset.tabId, 10);
      excludedTabIds.add(tabId);
      refreshPreview();
      showToast('preview-toast', 'Link excluded from copy & export', 'info');
    });
  });

  // Bulk item check changes
  listEl.querySelectorAll('.preview-item-check').forEach(chk => {
    chk.addEventListener('change', () => {
      const allChecks = listEl.querySelectorAll('.preview-item-check');
      const checkedCount = Array.from(allChecks).filter(c => c.checked).length;
      const selectAll = document.getElementById('preview-select-all');
      if (selectAll) selectAll.checked = checkedCount === allChecks.length;
    });
  });
}

// ─── Workspaces Management ────────────────────────────────────

async function renderWorkspaces() {
  const { workspaces = [] } = await chrome.storage.local.get({ workspaces: [] });
  const countBadge = document.getElementById('workspaces-count');
  if (countBadge) countBadge.textContent = workspaces.length;

  const listEl = document.getElementById('workspaces-list');
  if (!listEl) return;

  if (!workspaces.length) {
    listEl.innerHTML = '<div class="empty-state">No saved workspaces yet.<br>Save your open tabs above to keep them permanently!</div>';
    return;
  }

  listEl.innerHTML = workspaces.map((w, idx) => `
    <div class="workspace-card" data-index="${idx}">
      <div class="workspace-card-header">
        <span class="workspace-title">${escapeHtml(w.name)}</span>
        <span class="workspace-meta">${w.tabs ? w.tabs.length : 0} tabs · ${escapeHtml(w.createdAt || '')}</span>
      </div>
      <div class="workspace-actions">
        <button class="btn primary small btn-restore-workspace" data-index="${idx}" title="Open all tabs from this workspace">🔄 Open</button>
        <button class="btn secondary small btn-restore-workspace-incog" data-index="${idx}" title="Open this workspace in Incognito">🕵 Incog</button>
        <button class="btn ghost small btn-copy-workspace" data-index="${idx}" title="Copy all links in this workspace">📋 Copy</button>
        <button class="btn-delete-workspace" data-index="${idx}" title="Delete this workspace">✕</button>
      </div>
    </div>
  `).join('');
}

// ─── QR Code Generator ────────────────────────────────────────

async function updateQRCode() {
  const container = document.getElementById('qr-container');
  const urlText = document.getElementById('qr-url-text');
  if (!container || typeof QRCode === 'undefined') return;

  container.innerHTML = '';

  const targetSelect = document.getElementById('qr-target-select');
  const target = targetSelect ? targetSelect.value : 'active';

  let targetContent = '';

  if (target === 'active') {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    targetContent = activeTab?.url || 'https://google.com';
    if (urlText) urlText.textContent = targetContent;
  } else {
    const { scope, dedup } = getScopeAndDedupSettings();
    let tabs = await getScopedTabs(scope);
    tabs = tabs.filter(t => t.url);
    if (dedup) tabs = filterDeduplicate(tabs);
    targetContent = tabs.map(t => t.url).join('\n');
    if (urlText) urlText.textContent = `${tabs.length} URLs bundled`;
  }

  try {
    qrcodeInstance = new QRCode(container, {
      text: targetContent,
      width: 80,
      height: 80,
      colorDark: '#202124',
      colorLight: '#ffffff',
      correctLevel: QRCode.CorrectLevel.M
    });
  } catch (err) {
    console.error('QR code generation error:', err);
    container.innerHTML = '<span style="font-size:10px;color:#c5221f">QR failed (data too long)</span>';
  }
}

// ─── Import & Open Tabs Logic ─────────────────────────────────

function parseUrlsFromText(text) {
  if (!text) return [];
  // Match URLs in markdown [title](url) or plain URLs
  const urlRegex = /(https?:\/\/[^\s<>'")]+)/gi;
  const matches = text.match(urlRegex) || [];
  // Strip trailing punctuation like .,;)
  return matches.map(u => u.replace(/[.,;)]+$/, '')).filter(Boolean);
}

// ─── Tab Groups Rendering ─────────────────────────────────────

const CHROME_GROUP_COLORS = {
  grey:   '#5f6368',
  blue:   '#1a73e8',
  red:    '#d93025',
  yellow: '#f9ab00',
  green:  '#1e8e3e',
  pink:   '#d01884',
  purple: '#a142f4',
  cyan:   '#12b5cb',
  orange: '#e8710a'
};

async function refreshGroups() {
  const groupsList = document.getElementById('groups-list');
  if (!chrome.tabGroups) {
    groupsList.innerHTML = '<div class="empty-state">Tab Groups API unavailable</div>';
    return;
  }

  const currentWindow = await chrome.windows.getCurrent();
  const groups = await chrome.tabGroups.query({ windowId: currentWindow.id });

  if (!groups || !groups.length) {
    groupsList.innerHTML = '<div class="empty-state">No tab groups found in this window.<br>Right-click tabs to create a group.</div>';
    return;
  }

  const groupHtmls = await Promise.all(groups.map(async g => {
    const tabsInGroup = await chrome.tabs.query({ groupId: g.id });
    const colorHex = CHROME_GROUP_COLORS[g.color] || '#5f6368';
    const title = g.title || 'Untitled Group';
    return `
      <div class="group-item">
        <span class="group-dot" style="background-color: ${colorHex}"></span>
        <div class="group-name" title="${title}">${title}</div>
        <span class="group-count">${tabsInGroup.length} tab${tabsInGroup.length !== 1 ? 's' : ''}</span>
        <div class="group-btns">
          <button class="btn secondary small btn-copy-group" data-group-id="${g.id}">Copy</button>
          <button class="btn ghost small btn-export-group" data-group-id="${g.id}">Export</button>
        </div>
      </div>
    `;
  }));

  groupsList.innerHTML = groupHtmls.join('');

  document.querySelectorAll('.btn-copy-group').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const gId = parseInt(e.currentTarget.getAttribute('data-group-id'), 10);
      let tabs = await chrome.tabs.query({ groupId: gId });
      tabs = tabs.filter(t => t.url);
      const { dedup, format, numbered } = getScopeAndDedupSettings();
      if (dedup) tabs = filterDeduplicate(tabs);

      if (!tabs.length) {
        showToast('groups-toast', 'Group contains no valid tabs', 'error');
        return;
      }

      const text = formatUrls(tabs, format, numbered);
      await navigator.clipboard.writeText(text);
      showToast('groups-toast', `✓ Copied ${tabs.length} tabs from group`);
      await logHistory(tabs.length, `Group (${format})`, 'Group', tabs.some(t => t.incognito), tabs);
    });
  });

  document.querySelectorAll('.btn-export-group').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const gId = parseInt(e.currentTarget.getAttribute('data-group-id'), 10);
      let tabs = await chrome.tabs.query({ groupId: gId });
      tabs = tabs.filter(t => t.url);
      const { dedup, numbered } = getScopeAndDedupSettings();
      if (dedup) tabs = filterDeduplicate(tabs);

      if (!tabs.length) {
        showToast('groups-toast', 'Group contains no valid tabs', 'error');
        return;
      }

      const format = document.getElementById('export-format-select').value;
      const isDocx = format === 'docx';
      const filename = getFilename(format);

      if (isDocx) {
        const docxBlob = await generateDocx(tabs, 'blob', numbered);
        downloadBlob(docxBlob, filename);
      } else {
        const text = formatUrls(tabs, format, numbered);
        const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
        downloadBlob(blob, filename);
      }

      showToast('groups-toast', `✓ Exported ${tabs.length} tabs from group`);
      await logHistory(tabs.length, `Exported Group (.${format})`, 'Group', tabs.some(t => t.incognito), tabs);
    });
  });
}

// ─── Document Ready & Initialization ──────────────────────────

document.addEventListener('DOMContentLoaded', async () => {

  // 1. Check Incognito permission
  const isIncognitoAllowed = await chrome.extension.isAllowedIncognitoAccess();
  const incognitoBanner = document.getElementById('incognito-banner');
  const incognitoChip = document.getElementById('incognito-active-chip');

  if (!isIncognitoAllowed) {
    incognitoBanner.classList.remove('hidden');
    document.getElementById('btn-enable-incognito').addEventListener('click', () => {
      chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` });
    });
  } else {
    incognitoChip.classList.remove('hidden');
  }

  // 2. Restore saved preferences
  const {
    savedFormat = 'plain',
    savedExportFormat = 'docx',
    deduplicate = false,
    includeNumbers = true,
    cleanUrls = false,
    theme = 'auto',
    history = []
  } = await chrome.storage.local.get(['savedFormat', 'savedExportFormat', 'deduplicate', 'includeNumbers', 'cleanUrls', 'theme', 'history']);

  // Apply Theme
  function applyTheme(t) {
    const btn = document.getElementById('btn-theme-toggle');
    if (t === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
      if (btn) {
        btn.textContent = '🌙';
        btn.title = 'Theme: Dark (click for Light)';
      }
    } else if (t === 'light') {
      document.documentElement.setAttribute('data-theme', 'light');
      if (btn) {
        btn.textContent = '☀️';
        btn.title = 'Theme: Light (click for Auto)';
      }
    } else {
      document.documentElement.removeAttribute('data-theme');
      if (btn) {
        btn.textContent = '🌓';
        btn.title = 'Theme: Auto (system) (click for Dark)';
      }
    }
  }
  applyTheme(theme);

  document.getElementById('format-select').value = savedFormat;
  document.getElementById('export-format-select').value = savedExportFormat;
  
  // Dedup toggles
  document.getElementById('dedup-toggle').checked = deduplicate;
  if (document.getElementById('export-dedup-toggle')) {
    document.getElementById('export-dedup-toggle').checked = deduplicate;
  }

  // Numbering toggles
  document.getElementById('numbering-toggle').checked = includeNumbers;
  if (document.getElementById('export-numbering-toggle')) {
    document.getElementById('export-numbering-toggle').checked = includeNumbers;
  }

  // Clean URLs toggles
  if (document.getElementById('clean-url-toggle')) {
    document.getElementById('clean-url-toggle').checked = cleanUrls;
  }
  if (document.getElementById('export-clean-url-toggle')) {
    document.getElementById('export-clean-url-toggle').checked = cleanUrls;
  }

  // If history has no restorable sessions yet (e.g. only legacy logs or empty), auto-capture the current open tabs!
  const hasRestorable = history.some(e => e.tabs && e.tabs.length > 0);
  if (!hasRestorable) {
    try {
      const openTabs = await chrome.tabs.query({});
      const validTabs = openTabs.filter(t => t.url);
      if (validTabs.length) {
        const autoEntry = {
          count: validTabs.length,
          format: 'Current Session Snapshot',
          scope: 'All Windows',
          time: new Date().toLocaleString(),
          incognito: validTabs.some(t => t.incognito),
          tabs: validTabs.map(t => ({
            title: t.title || t.url,
            url: t.url,
            windowId: t.windowId,
            incognito: !!t.incognito,
            favIconUrl: t.favIconUrl || ''
          }))
        };
        history.unshift(autoEntry);
        await chrome.storage.local.set({ history: history.slice(0, 30) });
      }
    } catch (err) {
      console.warn('Auto snapshot error:', err);
    }
  }

  // Restore history incognito checkbox preference
  const { historyIncognito = false } = await chrome.storage.local.get({ historyIncognito: false });
  const histIncogCheck = document.getElementById('history-incognito-mode');
  if (histIncogCheck) {
    histIncogCheck.checked = historyIncognito;
    histIncogCheck.addEventListener('change', () => {
      chrome.storage.local.set({ historyIncognito: histIncogCheck.checked });
    });
  }

  await renderHistory(history);
  await renderWorkspaces();

  // Sync helpers
  function syncNumbering(val) {
    document.getElementById('numbering-toggle').checked = val;
    if (document.getElementById('export-numbering-toggle')) {
      document.getElementById('export-numbering-toggle').checked = val;
    }
    chrome.storage.local.set({ includeNumbers: val });
    const activeTab = document.querySelector('.tab-btn.active')?.dataset.tab;
    if (activeTab === 'preview') refreshPreview();
  }

  function syncDedup(val) {
    document.getElementById('dedup-toggle').checked = val;
    if (document.getElementById('export-dedup-toggle')) {
      document.getElementById('export-dedup-toggle').checked = val;
    }
    chrome.storage.local.set({ deduplicate: val });
    const activeTab = document.querySelector('.tab-btn.active')?.dataset.tab;
    if (activeTab === 'preview') refreshPreview();
  }

  function syncClean(val) {
    if (document.getElementById('clean-url-toggle')) {
      document.getElementById('clean-url-toggle').checked = val;
    }
    if (document.getElementById('export-clean-url-toggle')) {
      document.getElementById('export-clean-url-toggle').checked = val;
    }
    chrome.storage.local.set({ cleanUrls: val });
    const activeTab = document.querySelector('.tab-btn.active')?.dataset.tab;
    if (activeTab === 'preview') refreshPreview();
  }

  document.getElementById('numbering-toggle').addEventListener('change', e => syncNumbering(e.target.checked));
  document.getElementById('export-numbering-toggle')?.addEventListener('change', e => syncNumbering(e.target.checked));

  document.getElementById('dedup-toggle').addEventListener('change', e => syncDedup(e.target.checked));
  document.getElementById('export-dedup-toggle')?.addEventListener('change', e => syncDedup(e.target.checked));

  document.getElementById('clean-url-toggle')?.addEventListener('change', e => syncClean(e.target.checked));
  document.getElementById('export-clean-url-toggle')?.addEventListener('change', e => syncClean(e.target.checked));

  // Theme toggle button
  document.getElementById('btn-theme-toggle')?.addEventListener('click', async () => {
    const { theme: curTheme = 'auto' } = await chrome.storage.local.get({ theme: 'auto' });
    let nextTheme = 'auto';
    if (curTheme === 'auto') nextTheme = 'dark';
    else if (curTheme === 'dark') nextTheme = 'light';
    else if (curTheme === 'light') nextTheme = 'auto';

    await chrome.storage.local.set({ theme: nextTheme });
    applyTheme(nextTheme);
  });

  document.getElementById('format-select').addEventListener('change', (e) => {
    chrome.storage.local.set({ savedFormat: e.target.value });
  });

  document.getElementById('export-format-select').addEventListener('change', (e) => {
    chrome.storage.local.set({ savedExportFormat: e.target.value });
  });

  document.querySelectorAll('input[name="scope"]').forEach(radio => {
    radio.addEventListener('change', () => {
      excludedTabIds.clear();
      const activeTab = document.querySelector('.tab-btn.active')?.dataset.tab;
      if (activeTab === 'preview') refreshPreview();
    });
  });

  // 3. Tab Navigation
  const tabButtons = document.querySelectorAll('.tab-btn');
  const tabPanels  = document.querySelectorAll('.tab-panel');

  tabButtons.forEach(btn => {
    btn.addEventListener('click', async () => {
      tabButtons.forEach(b => b.classList.remove('active'));
      tabPanels.forEach(p => {
        p.classList.remove('active');
        p.classList.add('hidden');
      });

      btn.classList.add('active');
      const targetId = `tab-${btn.dataset.tab}`;
      const panel = document.getElementById(targetId);
      if (panel) {
        panel.classList.remove('hidden');
        panel.classList.add('active');
      }

      if (btn.dataset.tab === 'preview') refreshPreview();
      if (btn.dataset.tab === 'groups')  refreshGroups();
      if (btn.dataset.tab === 'sendto')  updateQRCode();
      if (btn.dataset.tab === 'history') {
        const { history = [] } = await chrome.storage.local.get({ history: [] });
        await renderHistory(history);
        await renderWorkspaces();
      }
    });
  });

  // 4. Main Copy Tab
  document.getElementById('btn-copy').addEventListener('click', async () => {
    const { scope, dedup, format, numbered, clean } = getScopeAndDedupSettings();
    let tabs = await getScopedTabs(scope);
    tabs = tabs.filter(t => t.url);

    if (dedup) tabs = filterDeduplicate(tabs);

    if (!tabs.length) {
      showToast('copy-toast', 'No tabs found matching selection', 'error');
      return;
    }

    const text = formatUrls(tabs, format, numbered, clean);
    try {
      await navigator.clipboard.writeText(text);
      const labels = { plain: 'plain URLs', markdown: 'Markdown links', json: 'JSON', csv: 'CSV', html: 'HTML' };
      const cleanNote = clean ? ' (cleaned)' : '';
      showToast('copy-toast', `✓ Copied ${tabs.length} ${labels[format] || 'links'}${cleanNote}`);
      await logHistory(tabs.length, `${labels[format] || format}${cleanNote}`, scope, tabs.some(t => t.incognito), tabs);
    } catch (err) {
      showToast('copy-toast', 'Clipboard copy failed', 'error');
      console.error(err);
    }
  });

  // Copy & Close Button
  document.getElementById('btn-copy-close').addEventListener('click', async () => {
    const { scope, dedup, format, numbered, clean } = getScopeAndDedupSettings();
    let tabs = await getScopedTabs(scope);
    tabs = tabs.filter(t => t.url);
    if (dedup) tabs = filterDeduplicate(tabs);

    if (!tabs.length) {
      showToast('copy-toast', 'No tabs found to copy & close', 'error');
      return;
    }

    const text = formatUrls(tabs, format, numbered, clean);
    await navigator.clipboard.writeText(text);
    const tabIds = tabs.map(t => t.id);
    await chrome.tabs.remove(tabIds);

    const cleanNote = clean ? ' (cleaned)' : '';
    showToast('copy-toast', `🧹 Copied & closed ${tabs.length} tabs!${cleanNote}`);
    await logHistory(tabs.length, `Copied & Closed${cleanNote}`, scope, tabs.some(t => t.incognito), tabs);
  });

  // 5. Export Tab Actions
  document.getElementById('btn-export-thistab').addEventListener('click', () => {
    const format = document.getElementById('export-format-select').value;
    executeExport('thisTab', format, 'both');
  });

  document.getElementById('btn-export-selected').addEventListener('click', () => {
    const format = document.getElementById('export-format-select').value;
    executeExport('selected', format, 'both');
  });

  document.getElementById('btn-export-window').addEventListener('click', () => {
    const format = document.getElementById('export-format-select').value;
    executeExport('window', format, 'both');
  });

  document.getElementById('btn-export-allwindows').addEventListener('click', () => {
    const format = document.getElementById('export-format-select').value;
    executeExport('allWindows', format, 'both');
  });

  document.getElementById('btn-do-copy-export').addEventListener('click', () => {
    const scopeEl = document.querySelector('input[name="export-scope"]:checked');
    const scope = scopeEl ? scopeEl.value : 'selected';
    const format = document.getElementById('export-format-select').value;
    executeExport(scope, format, 'both');
  });

  document.getElementById('btn-do-export-only').addEventListener('click', () => {
    const scopeEl = document.querySelector('input[name="export-scope"]:checked');
    const scope = scopeEl ? scopeEl.value : 'selected';
    const format = document.getElementById('export-format-select').value;
    executeExport(scope, format, 'export');
  });

  document.getElementById('btn-do-export-close').addEventListener('click', () => {
    const scopeEl = document.querySelector('input[name="export-scope"]:checked');
    const scope = scopeEl ? scopeEl.value : 'selected';
    const format = document.getElementById('export-format-select').value;
    executeExport(scope, format, 'export', true);
  });

  // 6. Preview Tab Search, Sort, Bulk Select
  document.getElementById('preview-search')?.addEventListener('input', () => {
    refreshPreview();
  });

  document.getElementById('preview-sort')?.addEventListener('change', () => {
    refreshPreview();
  });

  document.getElementById('preview-select-all')?.addEventListener('change', (e) => {
    const checked = e.target.checked;
    document.querySelectorAll('.preview-item-check').forEach(chk => {
      chk.checked = checked;
    });
  });

  document.getElementById('btn-preview-remove-selected')?.addEventListener('click', () => {
    const uncheckedBoxes = document.querySelectorAll('.preview-item-check:not(:checked)');
    if (!uncheckedBoxes.length) {
      showToast('preview-toast', 'All tabs are selected — none to exclude', 'info');
      return;
    }
    uncheckedBoxes.forEach(chk => {
      const tabId = parseInt(chk.dataset.tabId, 10);
      excludedTabIds.add(tabId);
    });
    refreshPreview();
    showToast('preview-toast', `Excluded ${uncheckedBoxes.length} unselected tab(s)`);
  });

  // Preview Tab — Confirm & Copy
  document.getElementById('btn-preview-copy').addEventListener('click', async () => {
    if (!currentPreviewTabs.length) return;
    const { format, scope, numbered, clean } = getScopeAndDedupSettings();
    const text = formatUrls(currentPreviewTabs, format, numbered, clean);
    try {
      await navigator.clipboard.writeText(text);
      const cleanNote = clean ? ' (cleaned)' : '';
      showToast('preview-toast', `✓ Copied ${currentPreviewTabs.length} links${cleanNote}`);
      await logHistory(currentPreviewTabs.length, `${format}${cleanNote}`, scope, currentPreviewTabs.some(t => t.incognito), currentPreviewTabs);
    } catch (err) {
      showToast('preview-toast', 'Copy failed', 'error');
    }
  });

  // Preview Tab — Export File
  document.getElementById('btn-preview-export').addEventListener('click', async () => {
    if (!currentPreviewTabs.length) return;
    const { numbered, clean } = getScopeAndDedupSettings();
    const format = document.getElementById('export-format-select').value || 'docx';
    const isDocx = format === 'docx';
    const filename = getFilename(format);
    const tabsToExport = clean ? currentPreviewTabs.map(t => ({ ...t, url: cleanUrl(t.url) })) : currentPreviewTabs;

    try {
      if (isDocx) {
        showToast('preview-toast', 'Generating Word document...', 'info');
        const docxBlob = await generateDocx(tabsToExport, 'blob', numbered);
        downloadBlob(docxBlob, filename);
      } else {
        const text = formatUrls(tabsToExport, format, numbered, false);
        const mimeMap = {
          txt: 'text/plain;charset=utf-8',
          md: 'text/markdown;charset=utf-8',
          json: 'application/json;charset=utf-8',
          csv: 'text/csv;charset=utf-8'
        };
        const blob = new Blob([text], { type: mimeMap[format] || 'text/plain' });
        downloadBlob(blob, filename);
      }
      const cleanNote = clean ? ' (cleaned)' : '';
      showToast('preview-toast', `✓ Downloaded ${tabsToExport.length} tabs (.${format})${cleanNote}`, 'success');
      await logHistory(tabsToExport.length, `Exported .${format}${cleanNote}`, 'Preview', tabsToExport.some(t => t.incognito), tabsToExport);
    } catch (err) {
      console.error('Export from preview failed:', err);
      showToast('preview-toast', 'Download failed', 'error');
    }
  });

  // 7. Cloud & Sharing Actions
  document.getElementById('qr-target-select')?.addEventListener('change', updateQRCode);

  document.getElementById('btn-qr-download')?.addEventListener('click', () => {
    const canvas = document.querySelector('#qr-container canvas');
    const img = document.querySelector('#qr-container img');
    if (canvas) {
      const a = document.createElement('a');
      a.href = canvas.toDataURL('image/png');
      a.download = 'tab-links-qr.png';
      a.click();
      showToast('sendto-toast', '✓ Saved QR code image');
    } else if (img && img.src) {
      const a = document.createElement('a');
      a.href = img.src;
      a.download = 'tab-links-qr.png';
      a.click();
      showToast('sendto-toast', '✓ Saved QR code image');
    } else {
      showToast('sendto-toast', 'No QR code available', 'error');
    }
  });

  document.getElementById('btn-qr-copy-url')?.addEventListener('click', async () => {
    const urlText = document.getElementById('qr-url-text')?.textContent;
    if (urlText) {
      await navigator.clipboard.writeText(urlText);
      showToast('sendto-toast', '✓ Copied URL to clipboard');
    }
  });

  // Email Sharing
  document.getElementById('btn-share-email')?.addEventListener('click', async () => {
    const { scope, dedup, numbered } = getScopeAndDedupSettings();
    let tabs = await getScopedTabs(scope);
    tabs = tabs.filter(t => t.url);
    if (dedup) tabs = filterDeduplicate(tabs);

    if (!tabs.length) {
      showToast('sendto-toast', 'No tabs to email', 'error');
      return;
    }

    const dateStr = new Date().toISOString().slice(0, 10);
    const subject = encodeURIComponent(`Tab Links (${tabs.length} tabs) - ${dateStr}`);
    const bodyText = formatUrls(tabs, 'plain', numbered);
    const body = encodeURIComponent(bodyText);

    chrome.tabs.create({ url: `mailto:?subject=${subject}&body=${body}` });
    showToast('sendto-toast', '✓ Opening email client...');
    await logHistory(tabs.length, 'Email Share', scope, tabs.some(t => t.incognito), tabs);
  });

  // WhatsApp Web
  document.getElementById('btn-share-whatsapp')?.addEventListener('click', async () => {
    const { scope, dedup, numbered } = getScopeAndDedupSettings();
    let tabs = await getScopedTabs(scope);
    tabs = tabs.filter(t => t.url);
    if (dedup) tabs = filterDeduplicate(tabs);

    if (!tabs.length) {
      showToast('sendto-toast', 'No tabs to share', 'error');
      return;
    }

    const text = encodeURIComponent(formatUrls(tabs, 'plain', numbered));
    chrome.tabs.create({ url: `https://wa.me/?text=${text}` });
    showToast('sendto-toast', '✓ Opening WhatsApp Web...');
    await logHistory(tabs.length, 'WhatsApp Share', scope, tabs.some(t => t.incognito), tabs);
  });

  // Telegram
  document.getElementById('btn-share-telegram')?.addEventListener('click', async () => {
    const { scope, dedup, numbered } = getScopeAndDedupSettings();
    let tabs = await getScopedTabs(scope);
    tabs = tabs.filter(t => t.url);
    if (dedup) tabs = filterDeduplicate(tabs);

    if (!tabs.length) {
      showToast('sendto-toast', 'No tabs to share', 'error');
      return;
    }

    const text = encodeURIComponent(formatUrls(tabs, 'plain', numbered));
    chrome.tabs.create({ url: `https://t.me/share/url?url=${encodeURIComponent(tabs[0].url)}&text=${text}` });
    showToast('sendto-toast', '✓ Opening Telegram...');
    await logHistory(tabs.length, 'Telegram Share', scope, tabs.some(t => t.incognito), tabs);
  });

  // Productivity apps (Obsidian, Notion, Google Docs)
  document.getElementById('btn-obsidian')?.addEventListener('click', async () => {
    const { scope, dedup, numbered } = getScopeAndDedupSettings();
    let tabs = await getScopedTabs(scope);
    tabs = tabs.filter(t => t.url);
    if (dedup) tabs = filterDeduplicate(tabs);

    if (!tabs.length) {
      showToast('sendto-toast', 'No tabs found', 'error');
      return;
    }

    const dateStr = new Date().toISOString().slice(0, 10);
    const content = formatUrls(tabs, 'markdown', numbered);
    await navigator.clipboard.writeText(content);

    const title = encodeURIComponent(`Tab Links ${dateStr}`);
    const encodedContent = encodeURIComponent(content);
    chrome.tabs.create({ url: `obsidian://new?name=${title}&content=${encodedContent}` });
    showToast('sendto-toast', '✓ Opening Obsidian (links also copied)');
    await logHistory(tabs.length, 'Obsidian', scope, tabs.some(t => t.incognito), tabs);
  });

  document.getElementById('btn-notion')?.addEventListener('click', async () => {
    const { scope, dedup, numbered } = getScopeAndDedupSettings();
    let tabs = await getScopedTabs(scope);
    tabs = tabs.filter(t => t.url);
    if (dedup) tabs = filterDeduplicate(tabs);

    if (!tabs.length) {
      showToast('sendto-toast', 'No tabs found', 'error');
      return;
    }

    const content = formatUrls(tabs, 'markdown', numbered);
    await navigator.clipboard.writeText(content);
    chrome.tabs.create({ url: 'https://www.notion.so' });
    showToast('sendto-toast', '✓ Copied Markdown! Opening Notion to paste...');
    await logHistory(tabs.length, 'Notion', scope, tabs.some(t => t.incognito), tabs);
  });

  document.getElementById('btn-gdocs')?.addEventListener('click', async () => {
    const { scope, dedup } = getScopeAndDedupSettings();
    let tabs = await getScopedTabs(scope);
    tabs = tabs.filter(t => t.url);
    if (dedup) tabs = filterDeduplicate(tabs);

    if (!tabs.length) {
      showToast('sendto-toast', 'No tabs found', 'error');
      return;
    }

    const content = tabs.map((t, i) => `${i + 1}. ${t.title || t.url}\n   ${t.url}`).join('\n\n');
    await navigator.clipboard.writeText(content);
    chrome.tabs.create({ url: 'https://docs.new' });
    showToast('sendto-toast', '✓ Copied links! Opening Google Docs to paste...');
    await logHistory(tabs.length, 'Google Docs', scope, tabs.some(t => t.incognito), tabs);
  });

  // 8. Bulk Tab Opener (Supports 150+ Links)
  const importTextarea = document.getElementById('import-textarea');
  const importCountBadge = document.getElementById('import-count-badge');
  const importTargetSelect = document.getElementById('import-target-select');
  const importGroupRow = document.getElementById('import-group-row');

  function updateImportCount() {
    const text = importTextarea ? importTextarea.value : '';
    const urls = parseUrlsFromText(text);
    if (importCountBadge) {
      if (!urls.length) {
        importCountBadge.textContent = '0 / 150+ links';
      } else {
        importCountBadge.textContent = `${urls.length} link${urls.length !== 1 ? 's' : ''}`;
      }
    }
  }

  importTextarea?.addEventListener('input', updateImportCount);

  importTargetSelect?.addEventListener('change', () => {
    if (importTargetSelect.value === 'group') {
      importGroupRow?.classList.remove('hidden');
    } else {
      importGroupRow?.classList.add('hidden');
    }
  });

  document.getElementById('btn-import-clipboard')?.addEventListener('click', async () => {
    try {
      const clipText = await navigator.clipboard.readText();
      if (importTextarea) {
        importTextarea.value = clipText;
        updateImportCount();
        showToast('import-toast', '✓ Pasted from clipboard');
      }
    } catch (err) {
      showToast('import-toast', 'Could not read clipboard', 'error');
    }
  });

  const fileInput = document.getElementById('import-file-input');
  document.getElementById('btn-import-file-btn')?.addEventListener('click', () => {
    fileInput?.click();
  });

  fileInput?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      if (importTextarea) {
        importTextarea.value = evt.target.result;
        updateImportCount();
        showToast('import-toast', `✓ Loaded ${file.name}`);
      }
    };
    reader.readAsText(file);
  });

  document.getElementById('btn-import-clear')?.addEventListener('click', () => {
    if (importTextarea) {
      importTextarea.value = '';
      updateImportCount();
      showToast('import-toast', 'Cleared input', 'info');
    }
  });

  const importIncogCheck = document.getElementById('import-incognito');
  importIncogCheck?.addEventListener('change', () => {
    const doImportBtn = document.getElementById('btn-do-import');
    if (doImportBtn) {
      doImportBtn.textContent = importIncogCheck.checked
        ? '🕵 Open Tabs in Incognito'
        : '🚀 Open Tabs in Browser';
    }
  });

  async function executeBulkImport(forceIncognito = false) {
    const text = importTextarea ? importTextarea.value : '';
    const rawUrls = parseUrlsFromText(text);

    if (!rawUrls.length) {
      showToast('import-toast', 'No valid URLs found to open', 'error');
      return;
    }

    const skipOpen = document.getElementById('import-skip-open')?.checked ?? true;
    const safeMode = document.getElementById('import-safe-mode')?.checked ?? true;
    const targetMode = importTargetSelect ? importTargetSelect.value : 'current';
    const isIncognito = forceIncognito || (importIncogCheck?.checked ?? false) || targetMode === 'incognito';

    if (isIncognito) {
      const isAllowed = await chrome.extension.isAllowedIncognitoAccess();
      if (!isAllowed) {
        showToast('import-toast', '⚠️ Enable "Allow in Incognito" in chrome://extensions to open in Incognito', 'error');
        chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` });
        return;
      }
    }

    let urlsToOpen = rawUrls;
    let skippedCount = 0;

    if (skipOpen) {
      try {
        const openTabs = await chrome.tabs.query({});
        const openUrls = new Set(
          (isIncognito ? openTabs.filter(t => t.incognito) : openTabs)
            .map(t => t.url).filter(Boolean)
        );
        urlsToOpen = rawUrls.filter(u => !openUrls.has(u));
        skippedCount = rawUrls.length - urlsToOpen.length;
      } catch (err) {
        console.warn('Could not query open tabs:', err);
      }

      if (!urlsToOpen.length) {
        showToast('import-toast', `All ${rawUrls.length} links are already open${isIncognito ? ' in Incognito' : ''}!`, 'info');
        return;
      }
    }

    // Progress bar setup
    const progContainer = document.getElementById('import-progress-container');
    const progFill = document.getElementById('import-progress-fill');
    const progText = document.getElementById('import-progress-text');

    progContainer?.classList.remove('hidden');
    if (progFill) progFill.style.width = '0%';
    if (progText) progText.textContent = `Preparing to open ${urlsToOpen.length} tabs${isIncognito ? ' in Incognito' : ''}...`;

    try {
      if (targetMode === 'split50') {
        const chunkSize = 50;
        let openedCount = 0;
        for (let i = 0; i < urlsToOpen.length; i += chunkSize) {
          const chunk = urlsToOpen.slice(i, i + chunkSize);
          await chrome.windows.create({ url: chunk, incognito: isIncognito });
          openedCount += chunk.length;
          const pct = Math.min(100, Math.round((openedCount / urlsToOpen.length) * 100));
          if (progFill) progFill.style.width = `${pct}%`;
          if (progText) progText.textContent = `Opened ${openedCount} of ${urlsToOpen.length} tabs (${isIncognito ? 'Incognito ' : ''}Window ${Math.floor(i / chunkSize) + 1})...`;
          if (safeMode) await sleep(60);
        }
      } else if (targetMode === 'newWindow' || targetMode === 'incognito' || isIncognito) {
        // Open in a dedicated new window (or Incognito window)
        if (urlsToOpen.length <= 15) {
          await chrome.windows.create({ url: urlsToOpen, incognito: isIncognito });
        } else {
          const newWin = await chrome.windows.create({ url: urlsToOpen[0], incognito: isIncognito });
          if (progFill) progFill.style.width = `${Math.round((1 / urlsToOpen.length) * 100)}%`;
          for (let i = 1; i < urlsToOpen.length; i++) {
            await chrome.tabs.create({ windowId: newWin.id, url: urlsToOpen[i], active: false });
            if (i % 5 === 0 || i === urlsToOpen.length - 1) {
              const pct = Math.round(((i + 1) / urlsToOpen.length) * 100);
              if (progFill) progFill.style.width = `${pct}%`;
              if (progText) progText.textContent = `Opened ${i + 1} of ${urlsToOpen.length} tabs in ${isIncognito ? 'Incognito ' : ''}window...`;
            }
            if (safeMode) await sleep(25);
          }
        }
      } else if (targetMode === 'group') {
        const currentWin = await chrome.windows.getCurrent();
        const createdTabIds = [];
        for (let i = 0; i < urlsToOpen.length; i++) {
          const t = await chrome.tabs.create({ windowId: currentWin.id, url: urlsToOpen[i], active: false });
          createdTabIds.push(t.id);
          if (i % 5 === 0 || i === urlsToOpen.length - 1) {
            const pct = Math.round(((i + 1) / urlsToOpen.length) * 100);
            if (progFill) progFill.style.width = `${pct}%`;
            if (progText) progText.textContent = `Opened ${i + 1} of ${urlsToOpen.length} tabs...`;
          }
          if (safeMode) await sleep(25);
        }

        if (chrome.tabGroups && createdTabIds.length) {
          const groupId = await chrome.tabs.group({ tabIds: createdTabIds });
          const groupName = document.getElementById('import-group-name')?.value || 'Bulk Opened Tabs';
          await chrome.tabGroups.update(groupId, { title: groupName, color: 'blue' });
        }
      } else {
        // 'current' window
        const currentWin = await chrome.windows.getCurrent();
        for (let i = 0; i < urlsToOpen.length; i++) {
          await chrome.tabs.create({ windowId: currentWin.id, url: urlsToOpen[i], active: false });
          if (i % 5 === 0 || i === urlsToOpen.length - 1) {
            const pct = Math.round(((i + 1) / urlsToOpen.length) * 100);
            if (progFill) progFill.style.width = `${pct}%`;
            if (progText) progText.textContent = `Opened ${i + 1} of ${urlsToOpen.length} tabs in current window...`;
          }
          if (safeMode) await sleep(25);
        }
      }

      if (progFill) progFill.style.width = '100%';
      if (progText) progText.textContent = `✓ Done! ${urlsToOpen.length} tabs opened${isIncognito ? ' in Incognito' : ''}.`;

      const modeLabels = {
        current: 'Current Window',
        newWindow: 'New Window',
        incognito: 'Incognito Window',
        split50: isIncognito ? 'Split Incognito (50/win)' : 'Split Windows (50/win)',
        group: 'Tab Group'
      };

      const historyTabs = urlsToOpen.map(u => ({ title: u, url: u, windowId: null, incognito: isIncognito }));
      await logHistory(urlsToOpen.length, 'Bulk Opener', `${modeLabels[targetMode] || targetMode}${isIncognito ? ' 🕵' : ''}`, isIncognito, historyTabs);

      const skipNotice = skippedCount > 0 ? ` (${skippedCount} skipped as already open)` : '';
      showToast('import-toast', `✓ Opened ${urlsToOpen.length} tabs successfully${isIncognito ? ' in Incognito' : ''}!${skipNotice}`, 'success');

      setTimeout(() => {
        progContainer?.classList.add('hidden');
      }, 3500);
    } catch (err) {
      console.error('Import error:', err);
      showToast('import-toast', `Failed while opening tabs: ${err.message}`, 'error');
    }
  }

  document.getElementById('btn-do-import')?.addEventListener('click', () => executeBulkImport(false));
  document.getElementById('btn-do-import-incog')?.addEventListener('click', () => executeBulkImport(true));

  // 9. History Tab Actions (Restoration delegation, Snapshot & Clear)
  const historyListEl = document.getElementById('history-list');
  historyListEl?.addEventListener('click', async (e) => {
    const restoreBtn = e.target.closest('.btn-restore-history');
    if (restoreBtn) {
      const idx = parseInt(restoreBtn.dataset.index, 10);
      const { history = [] } = await chrome.storage.local.get({ history: [] });
      const entry = history[idx];
      if (!entry) return;

      if (!entry.tabs || !entry.tabs.length) {
        showToast('history-toast', 'ℹ️ Legacy entry without saved URLs. Click "💾 Snapshot Session" to save your current tabs!', 'info');
        return;
      }

      await restoreHistoryEntry(entry);
      return;
    }

    const restoreIncogBtn = e.target.closest('.btn-restore-incog');
    if (restoreIncogBtn) {
      const idx = parseInt(restoreIncogBtn.dataset.index, 10);
      const { history = [] } = await chrome.storage.local.get({ history: [] });
      const entry = history[idx];
      if (!entry) return;

      if (!entry.tabs || !entry.tabs.length) {
        showToast('history-toast', 'ℹ️ Legacy entry without saved URLs. Click "💾 Snapshot" to save your current tabs!', 'info');
        return;
      }

      await restoreHistoryEntry(entry, true);
      return;
    }

    const incogLinkBtn = e.target.closest('.btn-open-link-incog');
    if (incogLinkBtn && incogLinkBtn.dataset.url) {
      e.preventDefault();
      e.stopPropagation();
      const isAllowed = await chrome.extension.isAllowedIncognitoAccess();
      if (!isAllowed) {
        showToast('history-toast', '⚠️ Enable "Allow in Incognito" in chrome://extensions to open in Incognito', 'error');
        chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` });
        return;
      }
      const incogWins = await chrome.windows.getAll().then(wins => wins.filter(w => w.incognito));
      if (incogWins.length > 0) {
        await chrome.tabs.create({ windowId: incogWins[0].id, url: incogLinkBtn.dataset.url, active: true });
      } else {
        await chrome.windows.create({ url: incogLinkBtn.dataset.url, incognito: true });
      }
      const { history = [] } = await chrome.storage.local.get({ history: [] });
      await renderHistory(history);
      return;
    }

    const toggleBtn = e.target.closest('.btn-toggle-links');
    if (toggleBtn) {
      const idx = toggleBtn.dataset.index;
      const accordion = document.getElementById(`history-accordion-${idx}`);
      if (accordion) {
        const isHidden = accordion.classList.contains('hidden');
        accordion.classList.toggle('hidden');
        toggleBtn.textContent = isHidden ? 'Hide Links' : 'View Links';
      }
      return;
    }

    const linkRow = e.target.closest('.history-link-row');
    if (linkRow && linkRow.dataset.url) {
      e.preventDefault();
      await chrome.tabs.create({ url: linkRow.dataset.url, active: true });
      const { history = [] } = await chrome.storage.local.get({ history: [] });
      await renderHistory(history);
    }
  });

  document.getElementById('btn-snapshot-now')?.addEventListener('click', async () => {
    try {
      const allTabs = await chrome.tabs.query({});
      const validTabs = allTabs.filter(t => t.url);
      if (!validTabs.length) {
        showToast('history-toast', 'No active tabs found to snapshot', 'error');
        return;
      }
      await logHistory(validTabs.length, 'Manual Session Snapshot', 'All Windows', validTabs.some(t => t.incognito), validTabs);
      showToast('history-toast', `✓ Saved ${validTabs.length} tabs into history! Ready to restore anytime.`, 'success');
    } catch (err) {
      console.error('Snapshot failed:', err);
      showToast('history-toast', 'Failed to snapshot current session', 'error');
    }
  });

  document.getElementById('btn-clear-history')?.addEventListener('click', async () => {
    await chrome.storage.local.set({ history: [] });
    await renderHistory([]);
    showToast('history-toast', 'History cleared', 'info');
  });

  document.getElementById('btn-restore-latest')?.addEventListener('click', async () => {
    const { history = [] } = await chrome.storage.local.get({ history: [] });
    const restorableEntry = history.find(e => e.tabs && e.tabs.length > 0);
    if (!restorableEntry) {
      showToast('history-toast', 'No restorable sessions found yet. Click "💾 Snapshot Session" above to save one!', 'error');
      return;
    }
    await restoreHistoryEntry(restorableEntry);
  });

  // 10. Memory Saver Tools (Preview Tab)
  document.getElementById('btn-hibernate-tabs')?.addEventListener('click', async () => {
    try {
      const allTabs = await chrome.tabs.query({});
      const candidates = allTabs.filter(t => !t.active && !t.pinned && !t.discarded);
      let discarded = 0;
      for (const t of candidates) {
        try {
          await chrome.tabs.discard(t.id);
          discarded++;
        } catch (e) {}
      }
      showToast('preview-toast', `💤 Put ${discarded} inactive tab${discarded !== 1 ? 's' : ''} to sleep! RAM freed.`, 'success');
      refreshPreview();
    } catch (err) {
      console.error('Hibernate failed:', err);
      showToast('preview-toast', 'Could not sleep tabs', 'error');
    }
  });

  document.getElementById('btn-close-duplicates')?.addEventListener('click', async () => {
    try {
      const allTabs = await chrome.tabs.query({});
      const seen = new Set();
      const toRemove = [];
      for (const t of allTabs) {
        if (!t.url) continue;
        if (t.active) {
          seen.add(t.url);
          continue;
        }
        if (seen.has(t.url)) {
          toRemove.push(t.id);
        } else {
          seen.add(t.url);
        }
      }
      if (!toRemove.length) {
        showToast('preview-toast', 'No live duplicate tabs found in Chrome!', 'info');
        return;
      }
      await chrome.tabs.remove(toRemove);
      showToast('preview-toast', `🧹 Closed ${toRemove.length} duplicate tab${toRemove.length !== 1 ? 's' : ''}! RAM freed.`, 'success');
      refreshPreview();
    } catch (err) {
      console.error('Close duplicates failed:', err);
      showToast('preview-toast', 'Failed to close duplicate tabs', 'error');
    }
  });

  // 11. Workspaces Sub-view Actions
  document.getElementById('btn-save-workspace')?.addEventListener('click', async () => {
    const nameInput = document.getElementById('workspace-name-input');
    const name = (nameInput?.value || '').trim() || `Workspace ${new Date().toLocaleDateString()}`;

    try {
      const allTabs = await chrome.tabs.query({});
      const validTabs = allTabs.filter(t => t.url);
      if (!validTabs.length) {
        showToast('workspaces-toast', 'No active tabs to save', 'error');
        return;
      }

      const { workspaces = [] } = await chrome.storage.local.get({ workspaces: [] });
      const newWorkspace = {
        id: 'ws_' + Date.now(),
        name,
        createdAt: new Date().toLocaleString(),
        tabs: validTabs.map(t => ({
          title: t.title || t.url,
          url: t.url,
          windowId: t.windowId,
          incognito: !!t.incognito,
          favIconUrl: t.favIconUrl || ''
        }))
      };

      workspaces.unshift(newWorkspace);
      await chrome.storage.local.set({ workspaces });
      if (nameInput) nameInput.value = '';
      await renderWorkspaces();
      showToast('workspaces-toast', `✓ Saved workspace "${name}" (${validTabs.length} tabs)!`, 'success');
    } catch (err) {
      console.error('Save workspace failed:', err);
      showToast('workspaces-toast', 'Failed to save workspace', 'error');
    }
  });

  document.getElementById('workspaces-list')?.addEventListener('click', async (e) => {
    const { workspaces = [] } = await chrome.storage.local.get({ workspaces: [] });

    // Open normal
    const openBtn = e.target.closest('.btn-restore-workspace');
    if (openBtn) {
      const idx = parseInt(openBtn.dataset.index, 10);
      const w = workspaces[idx];
      if (w) await restoreHistoryEntry(w, false);
      return;
    }

    // Open incognito
    const incogBtn = e.target.closest('.btn-restore-workspace-incog');
    if (incogBtn) {
      const idx = parseInt(incogBtn.dataset.index, 10);
      const w = workspaces[idx];
      if (w) await restoreHistoryEntry(w, true);
      return;
    }

    // Copy links
    const copyBtn = e.target.closest('.btn-copy-workspace');
    if (copyBtn) {
      const idx = parseInt(copyBtn.dataset.index, 10);
      const w = workspaces[idx];
      if (w && w.tabs) {
        const text = w.tabs.map(t => t.url).join('\n');
        await navigator.clipboard.writeText(text);
        showToast('workspaces-toast', `✓ Copied ${w.tabs.length} links to clipboard!`);
      }
      return;
    }

    // Delete workspace
    const delBtn = e.target.closest('.btn-delete-workspace');
    if (delBtn) {
      const idx = parseInt(delBtn.dataset.index, 10);
      const removed = workspaces.splice(idx, 1);
      await chrome.storage.local.set({ workspaces });
      await renderWorkspaces();
      showToast('workspaces-toast', `Removed workspace "${removed[0]?.name || ''}"`, 'info');
      return;
    }
  });

  // 12. Backup & Sync Actions
  document.getElementById('btn-export-backup')?.addEventListener('click', async () => {
    try {
      const allData = await chrome.storage.local.get(null);
      const backupPayload = {
        version: 1,
        appName: 'Tab Link Copier',
        exportedAt: new Date().toISOString(),
        data: allData
      };
      const jsonStr = JSON.stringify(backupPayload, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8' });
      const filename = `tab-copier-backup-${new Date().toISOString().slice(0, 10)}.json`;
      downloadBlob(blob, filename);
      showToast('backup-toast', '✓ Backup file exported successfully!', 'success');
    } catch (err) {
      console.error('Backup export failed:', err);
      showToast('backup-toast', 'Export failed', 'error');
    }
  });

  const backupFileInput = document.getElementById('backup-file-input');
  document.getElementById('btn-import-backup-trigger')?.addEventListener('click', () => {
    backupFileInput?.click();
  });

  backupFileInput?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const parsed = JSON.parse(evt.target.result);
        const dataToRestore = parsed.data || parsed;
        if (typeof dataToRestore !== 'object') throw new Error('Invalid JSON structure');

        await chrome.storage.local.set(dataToRestore);

        if (dataToRestore.theme) applyTheme(dataToRestore.theme);

        const { history: restoredHistory = [] } = await chrome.storage.local.get({ history: [] });
        await renderHistory(restoredHistory);
        await renderWorkspaces();

        if (typeof dataToRestore.deduplicate === 'boolean') syncDedup(dataToRestore.deduplicate);
        if (typeof dataToRestore.includeNumbers === 'boolean') syncNumbering(dataToRestore.includeNumbers);
        if (typeof dataToRestore.cleanUrls === 'boolean') syncClean(dataToRestore.cleanUrls);

        showToast('backup-toast', '✓ Backup restored successfully!', 'success');
      } catch (err) {
        console.error('Backup import error:', err);
        showToast('backup-toast', 'Failed to import backup: invalid file', 'error');
      } finally {
        backupFileInput.value = '';
      }
    };
    reader.readAsText(file);
  });

  // 13. History Sub-views Navigation (Sessions | Workspaces | Backup)
  document.querySelectorAll('.subnav-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      document.querySelectorAll('.subnav-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.history-subview').forEach(v => v.classList.add('hidden'));

      btn.classList.add('active');
      const targetSubview = document.getElementById(`subview-${btn.dataset.subview}`);
      if (targetSubview) targetSubview.classList.remove('hidden');

      if (btn.dataset.subview === 'workspaces') {
        await renderWorkspaces();
      } else if (btn.dataset.subview === 'sessions') {
        const { history = [] } = await chrome.storage.local.get({ history: [] });
        await renderHistory(history);
      }
    });
  });

});
