// ══════════════════════════════════════════════════════════════
// Tab Link Copier — Service Worker (background.js)
// ══════════════════════════════════════════════════════════════

importScripts('lib/jszip.min.js', 'lib/docx-generator.js');

// ─── Menu Configurations ──────────────────────────────────────

const SCOPES = [
  { id: 'thisTab',    title: 'This tab'                       },
  { id: 'selected',   title: 'Selected tabs'                  },
  { id: 'window',     title: 'All tabs in this window'        },
  { id: 'allWindows', title: 'All tabs from all windows'      }
];

const COPY_FORMATS = [
  { id: 'plain',    label: 'One URL per line'           },
  { id: 'markdown', label: 'Markdown  [title](url)'    },
  { id: 'json',     label: 'JSON array'                 },
  { id: 'csv',      label: 'CSV (title, url)'           },
  { id: 'html',     label: 'HTML list'                  }
];

const EXPORT_FORMATS = [
  { id: 'txt',   ext: 'txt',   label: 'Plain text (.txt)'            },
  { id: 'md',    ext: 'md',    label: 'Markdown (.md)'               },
  { id: 'docx',  ext: 'docx',  label: 'Word document (.docx)'        },
  { id: 'json',  ext: 'json',  label: 'JSON (.json)'                 },
  { id: 'csv',   ext: 'csv',   label: 'Spreadsheet (.csv)'           }
];

// Contexts: support tab strip as well as page context so it works everywhere
const CTXS = ['tab', 'page'];

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {

    // 1. "Copy Tab Links" Menu
    chrome.contextMenus.create({
      id:       'menu_copy',
      title:    '📋 Copy Tab Links',
      contexts: CTXS
    });

    for (const scope of SCOPES) {
      chrome.contextMenus.create({
        id:       `copy__${scope.id}`,
        parentId: 'menu_copy',
        title:    scope.title,
        contexts: CTXS
      });

      for (const fmt of COPY_FORMATS) {
        chrome.contextMenus.create({
          id:       `copy__${scope.id}__${fmt.id}`,
          parentId: `copy__${scope.id}`,
          title:    fmt.label,
          contexts: CTXS
        });
      }
    }

    // 2. "Export & Download File" Menu
    chrome.contextMenus.create({
      id:       'menu_export',
      title:    '💾 Export & Download File',
      contexts: CTXS
    });

    for (const scope of SCOPES) {
      chrome.contextMenus.create({
        id:       `export__${scope.id}`,
        parentId: 'menu_export',
        title:    scope.title,
        contexts: CTXS
      });

      for (const fmt of EXPORT_FORMATS) {
        chrome.contextMenus.create({
          id:       `export__${scope.id}__${fmt.id}`,
          parentId: `export__${scope.id}`,
          title:    fmt.label,
          contexts: CTXS
        });
      }
    }

    // 3. "Copy & Export (Both)" Menu
    chrome.contextMenus.create({
      id:       'menu_both',
      title:    '⚡ Copy & Export (Both)',
      contexts: CTXS
    });

    for (const scope of SCOPES) {
      chrome.contextMenus.create({
        id:       `both__${scope.id}`,
        parentId: 'menu_both',
        title:    scope.title,
        contexts: CTXS
      });

      for (const fmt of EXPORT_FORMATS) {
        chrome.contextMenus.create({
          id:       `both__${scope.id}__${fmt.id}`,
          parentId: `both__${scope.id}`,
          title:    fmt.label,
          contexts: CTXS
        });
      }
    }

  });
});

// ─── Format Builders ──────────────────────────────────────────

function buildText(tabs, format, numbered = true) {
  const urls   = tabs.map(t => t.url).filter(Boolean);
  const titles = tabs.map(t => t.title || t.url);

  switch (format) {
    case 'plain':
    case 'txt':
      return urls.map((u, i) => numbered ? `${i + 1}. ${u}` : u).join('\n');

    case 'markdown':
    case 'md': {
      const heading = `# Tab Links\n*Exported on ${new Date().toLocaleString()} · ${tabs.length} tabs*\n\n`;
      const links = urls.map((u, i) => numbered
        ? `${i + 1}. [${titles[i].replace(/[\[\]]/g, '')}](${u})`
        : `- [${titles[i].replace(/[\[\]]/g, '')}](${u})`).join('\n');
      return heading + links;
    }

    case 'json':
      return JSON.stringify(
        urls.map((u, i) => numbered
          ? { index: i + 1, title: titles[i], url: u }
          : { title: titles[i], url: u }),
        null,
        2
      );

    case 'csv': {
      const header = numbered ? '"#","title","url"' : '"title","url"';
      const rows = urls.map((u, i) => numbered
        ? `"${i + 1}","${titles[i].replace(/"/g, '""')}","${u}"`
        : `"${titles[i].replace(/"/g, '""')}","${u}"`);
      return [header, ...rows].join('\n');
    }

    case 'html': {
      const esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      const tag = numbered ? 'ol' : 'ul';
      const items = urls.map((u, i) => `  <li><a href="${u}">${esc(titles[i])}</a></li>`);
      return `<${tag}>\n${items.join('\n')}\n</${tag}>`;
    }

    default:
      return urls.map((u, i) => numbered ? `${i + 1}. ${u}` : u).join('\n');
  }
}

function getFilename(ext) {
  const d = new Date();
  const dateStr = d.toISOString().slice(0, 10);
  const timeStr = `${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`;
  return `tab-links-${dateStr}-${timeStr}.${ext}`;
}

// ─── Tab Gathering ────────────────────────────────────────────

async function gatherTabs(scope, clickedTab) {
  if (scope === 'thisTab') {
    return clickedTab ? [clickedTab] : [];
  } else if (scope === 'selected') {
    return chrome.tabs.query({ windowId: clickedTab.windowId, highlighted: true });
  } else if (scope === 'window') {
    return chrome.tabs.query({ windowId: clickedTab.windowId });
  } else if (scope === 'allWindows') {
    return chrome.tabs.query({});
  }
  return [];
}

function deduplicateTabs(tabs) {
  const seen = new Set();
  return tabs.filter(t => {
    if (!t.url || seen.has(t.url)) return false;
    seen.add(t.url);
    return true;
  });
}

// ─── Download Helper for Service Worker ───────────────────────

async function triggerDownload(content, ext, filename, isDocx = false, tabs = [], numbered = true) {
  let dataUrl = '';
  if (isDocx) {
    const b64 = await generateDocx(tabs, 'base64', numbered);
    dataUrl = 'data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,' + b64;
  } else {
    const mimeMap = {
      txt: 'text/plain',
      plain: 'text/plain',
      md: 'text/markdown',
      markdown: 'text/markdown',
      json: 'application/json',
      csv: 'text/csv',
      html: 'text/html'
    };
    const mime = mimeMap[ext] || 'text/plain';
    const utf8Bytes = new TextEncoder().encode(content);
    let binary = '';
    for (let i = 0; i < utf8Bytes.length; i++) {
      binary += String.fromCharCode(utf8Bytes[i]);
    }
    const b64 = btoa(binary);
    dataUrl = `data:${mime};charset=utf-8;base64,${b64}`;
  }

  return chrome.downloads.download({
    url: dataUrl,
    filename: filename,
    saveAs: false
  });
}

// ─── Context Menu Click Handler ───────────────────────────────

chrome.contextMenus.onClicked.addListener(async (info, clickedTab) => {
  const parts = info.menuItemId.split('__');
  if (parts.length < 3) return; // Ignore clicks on parent menus

  const [mode, scope, format] = parts;
  // mode: 'copy' | 'export' | 'both'

  let tabs = await gatherTabs(scope, clickedTab);
  tabs = tabs.filter(t => t.url);
  if (!tabs.length) return;

  const { deduplicate = false, includeNumbers = true } =
    await chrome.storage.local.get({ deduplicate: false, includeNumbers: true });
  if (deduplicate) tabs = deduplicateTabs(tabs);

  const isDocx = format === 'docx';
  const textContent = buildText(tabs, format, includeNumbers);
  const ext = format === 'markdown' ? 'md' : format === 'plain' ? 'txt' : format;
  const filename = getFilename(ext);

  let didCopy = false;
  let didDownload = false;

  // 1. Copy to clipboard
  if (mode === 'copy' || mode === 'both') {
    try {
      const copyPayload = isDocx ? buildText(tabs, 'markdown', includeNumbers) : textContent;
      await chrome.scripting.executeScript({
        target: { tabId: clickedTab.id },
        func: async (clipText) => { await navigator.clipboard.writeText(clipText); },
        args: [copyPayload]
      });
      didCopy = true;
    } catch (err) {
      console.error('[Tab Link Copier] Clipboard copy failed:', err);
    }
  }

  // 2. Download file
  if (mode === 'export' || mode === 'both') {
    try {
      await triggerDownload(textContent, ext, filename, isDocx, tabs, includeNumbers);
      didDownload = true;
    } catch (err) {
      console.error('[Tab Link Copier] Download trigger failed:', err);
    }
  }

  // Badge flash
  await chrome.action.setBadgeText({ text: didDownload ? '📥' : '✓' });
  await chrome.action.setBadgeBackgroundColor({ color: didDownload ? '#137333' : '#1a73e8' });
  chrome.alarms.create('clearBadge', { delayInMinutes: 0.05 });

  // History logging
  const scopeLabels = {
    thisTab: 'This tab',
    selected: 'Selected tabs',
    window: 'This window',
    allWindows: 'All windows'
  };
  const modeLabels = {
    copy: 'Copied',
    export: 'Downloaded',
    both: 'Copied & Downloaded'
  };

  const { history = [] } = await chrome.storage.local.get({ history: [] });
  history.unshift({
    count:     tabs.length,
    format:    `${modeLabels[mode]} .${ext}`,
    scope:     scopeLabels[scope] || scope,
    time:      new Date().toLocaleString(),
    incognito: tabs.some(t => t.incognito),
    tabs:      tabs.map(t => ({
      title: t.title || t.url,
      url: t.url,
      windowId: t.windowId,
      incognito: !!t.incognito,
      favIconUrl: t.favIconUrl || ''
    }))
  });
  await chrome.storage.local.set({ history: history.slice(0, 30) });
});

// ─── Alarm: clear badge ───────────────────────────────────────

chrome.alarms.onAlarm.addListener(async alarm => {
  if (alarm.name === 'clearBadge') {
    await chrome.action.setBadgeText({ text: '' });
  }
});

// ─── Keyboard Shortcut Commands ───────────────────────────────

chrome.commands.onCommand.addListener(async (command) => {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!activeTab) return;

  const tabs = await chrome.tabs.query({ windowId: activeTab.windowId, highlighted: true });
  if (!tabs.length) return;

  const { deduplicate = false, includeNumbers = true, savedFormat = 'plain' } =
    await chrome.storage.local.get({ deduplicate: false, includeNumbers: true, savedFormat: 'plain' });

  const finalTabs = deduplicate ? deduplicateTabs(tabs) : tabs.filter(t => t.url);
  const text = buildText(finalTabs, savedFormat, includeNumbers);

  try {
    await chrome.scripting.executeScript({
      target: { tabId: activeTab.id },
      func: async (clipText) => { await navigator.clipboard.writeText(clipText); },
      args: [text]
    });

    const isClose = command === 'copy-and-close-selected';
    if (isClose) {
      const tabIds = finalTabs.map(t => t.id);
      await chrome.tabs.remove(tabIds);
    }

    await chrome.action.setBadgeText({ text: isClose ? '🧹' : '✓' });
    await chrome.action.setBadgeBackgroundColor({ color: isClose ? '#e37400' : '#1a73e8' });
    chrome.alarms.create('clearBadge', { delayInMinutes: 0.05 });

    const { history = [] } = await chrome.storage.local.get({ history: [] });
    history.unshift({
      count:     finalTabs.length,
      format:    isClose ? 'Copied & Closed' : `Hotkey (${savedFormat})`,
      scope:     'Selected tabs',
      time:      new Date().toLocaleString(),
      incognito: finalTabs.some(t => t.incognito),
      tabs:      finalTabs.map(t => ({
        title: t.title || t.url,
        url: t.url,
        windowId: t.windowId,
        incognito: !!t.incognito,
        favIconUrl: t.favIconUrl || ''
      }))
    });
    await chrome.storage.local.set({ history: history.slice(0, 30) });
  } catch (err) {
    console.error('[Tab Link Copier] Command execution failed:', err);
  }
});

