/**
 * iStar Side Panel 逻辑
 * 全部笔记一览、搜索、按域名+页面分组、设置管理
 */

document.addEventListener('DOMContentLoaded', async () => {
    // ---- DOM 引用 ----
    const $tabs = document.querySelectorAll('.sp-tab');
    const $panels = document.querySelectorAll('.sp-panel');
    const $searchInput = document.getElementById('searchInput');
    const $searchClear = document.getElementById('searchClear');
    const $notesList = document.getElementById('notesList');
    const $syncBtn = document.getElementById('syncBtn');
    const $exportBtn = document.getElementById('exportBtn');
    const $positionGrid = document.getElementById('positionGrid');
    const $themeGrid = document.getElementById('themeGrid');
    const $syncProvider = document.getElementById('syncProvider');
    const $githubConfig = document.getElementById('githubConfig');
    const $feishuConfig = document.getElementById('feishuConfig');
    const $githubToken = document.getElementById('githubToken');
    const $feishuAppId = document.getElementById('feishuAppId');
    const $feishuAppSecret = document.getElementById('feishuAppSecret');
    const $feishuAppToken = document.getElementById('feishuAppToken');
    const $feishuTableId = document.getElementById('feishuTableId');
    const $saveSettings = document.getElementById('saveSettings');
    const $offsetDomains = document.getElementById('offsetDomains');
    const $saveOffsetDomains = document.getElementById('saveOffsetDomains');

    // ---- 标签页切换 ----
    $tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            $tabs.forEach(t => t.classList.remove('active'));
            $panels.forEach(p => p.classList.add('hidden'));
            tab.classList.add('active');
            document.querySelector(`[data-panel="${tab.dataset.tab}"]`).classList.remove('hidden');
        });
    });

    // ---- 加解密工具（侧边栏无法访问 content script） ----
    async function decryptData(encryptedBase64, keyBase64) {
        try {
            const combined = Uint8Array.from(atob(encryptedBase64), c => c.charCodeAt(0));
            const iv = combined.slice(0, 12);
            const ciphertext = combined.slice(12);
            const rawKey = Uint8Array.from(atob(keyBase64), c => c.charCodeAt(0));
            const key = await crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
            const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
            return JSON.parse(new TextDecoder().decode(decrypted));
        } catch {
            return { v: 1, domains: {} };
        }
    }

    async function getEncKey() {
        return new Promise(resolve => {
            chrome.storage.sync.get(['_istar_enc_key'], r => resolve(r._istar_enc_key || null));
        });
    }

    async function getLocalData() {
        const encKey = await getEncKey();
        return new Promise(resolve => {
            chrome.storage.local.get(['_istar_data'], async (result) => {
                if (result._istar_data && encKey) {
                    resolve(await decryptData(result._istar_data, encKey));
                } else {
                    resolve({ v: 1, domains: {} });
                }
            });
        });
    }

    async function loadSettings() {
        return new Promise(resolve => {
            chrome.storage.sync.get(['_istar_settings'], r => {
                resolve(r._istar_settings || {
                    position: 'top-right',
                    displayMode: 'collapsed',
                    syncProvider: 'chrome'
                });
            });
        });
    }

    // ---- Markdown 渲染（简化版） ----
    function renderMd(text) {
        if (!text) return '';
        let html = escHtml(text);
        // 行内代码
        html = html.replace(/`([^`]+)`/g, '<code class="istar-inline-code">$1</code>');
        // 加粗
        html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        // 斜体
        html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
        // #标签
        html = html.replace(/#([^\s#]+)/g, '<span class="istar-tag">#$1</span>');
        // 换行
        html = html.replace(/\n/g, '<br>');
        return html;
    }

    // ---- 加载笔记 ----
    async function loadNotes(searchQuery = '') {
        const data = await getLocalData();
        const domains = [];

        for (const [domain, domainData] of Object.entries(data.domains || {})) {
            const pages = [];
            for (const [path, pageData] of Object.entries(domainData.pages || {})) {
                let notes = (pageData.notes || []).filter(n => !n.del);
                if (searchQuery) {
                    notes = notes.filter(n => n.text.toLowerCase().includes(searchQuery.toLowerCase()));
                }
                if (notes.length > 0) {
                    pages.push({ path, notes });
                }
            }

            if (pages.length > 0) {
                const totalNotes = pages.reduce((sum, p) => sum + p.notes.length, 0);
                domains.push({
                    domain,
                    pinned: domainData.pinned,
                    pages,
                    totalNotes,
                    totalPages: pages.length
                });
            }
        }

        // 排序：收藏的在前，然后按笔记数量降序
        domains.sort((a, b) => {
            if (a.pinned !== b.pinned) return b.pinned ? 1 : -1;
            return b.totalNotes - a.totalNotes;
        });

        renderNotesList(domains);
    }

    function renderNotesList(domains) {
        if (domains.length === 0) {
            $notesList.innerHTML = `
        <div class="sp-empty">
          <div class="sp-empty-icon">📝</div>
          <div class="sp-empty-text">还没有任何网页便签<br>在页面中悬浮 📝 图标即可创建</div>
        </div>
      `;
            return;
        }

        $notesList.innerHTML = domains.map((d, i) => `
      <div class="sp-domain-group" data-domain="${escAttr(d.domain)}">
        <div class="sp-domain-header" data-index="${i}">
          <span class="sp-domain-arrow expanded">▶</span>
          <img class="sp-domain-favicon" src="https://www.google.com/s2/favicons?domain=${escAttr(d.domain)}&sz=32" alt="" onerror="this.style.display='none'">
          <div class="sp-domain-info">
            <div class="sp-domain-name">${escHtml(d.domain)}</div>
            <div class="sp-domain-url">${d.totalPages} 个页面</div>
          </div>
          <span class="sp-domain-badge">${d.totalNotes}</span>
          ${d.pinned ? '<span class="sp-domain-pin">⭐</span>' : ''}
        </div>
        <div class="sp-domain-pages expanded">
          ${d.pages.map(page => `
            <div class="sp-page-group">
              <div class="sp-page-path">
                <span>📄</span>
                <span class="sp-page-path-text" title="${escAttr(page.path)}">${escHtml(page.path)}</span>
              </div>
              ${page.notes.map(note => `
                <div class="sp-note" data-note-id="${note.id}" data-domain="${escAttr(d.domain)}" data-path="${escAttr(page.path)}">
                  <div class="sp-note-content">${renderMd(note.text)}</div>
                  <div class="sp-note-meta">
                    <span class="sp-note-time">${formatTime(note.ts)}</span>
                    <button class="sp-note-delete" data-action="delete" title="删除">🗑️</button>
                  </div>
                </div>
              `).join('')}
            </div>
          `).join('')}
        </div>
      </div>
    `).join('');

        // ---- 域名折叠/展开 ----
        $notesList.querySelectorAll('.sp-domain-header').forEach(header => {
            header.addEventListener('click', () => {
                const pages = header.nextElementSibling;
                const arrow = header.querySelector('.sp-domain-arrow');
                pages.classList.toggle('expanded');
                arrow.classList.toggle('expanded');
            });
        });

        // ---- 删除笔记 ----
        $notesList.querySelectorAll('.sp-note-delete').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const $note = btn.closest('.sp-note');
                const noteId = $note.dataset.noteId;
                const domain = $note.dataset.domain;
                const path = $note.dataset.path;

                // 直接操作 storage 删除（软删除）
                const data = await getLocalData();
                const page = data.domains[domain]?.pages[path];
                if (page) {
                    const note = page.notes.find(n => n.id === noteId);
                    if (note) {
                        note.del = true;
                        note.uTs = Date.now();
                        // 重新加密保存
                        const encKey = await getEncKey();
                        const rawKey = Uint8Array.from(atob(encKey), c => c.charCodeAt(0));
                        const key = await crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM', length: 256 }, true, ['encrypt']);
                        const iv = crypto.getRandomValues(new Uint8Array(12));
                        const encoded = new TextEncoder().encode(JSON.stringify(data));
                        const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
                        const combined = new Uint8Array(12 + ciphertext.byteLength);
                        combined.set(iv);
                        combined.set(new Uint8Array(ciphertext), 12);
                        let binary = '';
                        for (let i = 0; i < combined.byteLength; i++) binary += String.fromCharCode(combined[i]);
                        const encrypted = btoa(binary);
                        chrome.storage.local.set({ '_istar_data': encrypted }, () => {
                            chrome.runtime.sendMessage({ type: 'DATA_CHANGED' });
                            loadNotes($searchInput.value.trim());
                        });
                    }
                }
            });
        });
    }

    // ---- 搜索 ----
    let searchTimer;
    $searchInput.addEventListener('input', () => {
        const val = $searchInput.value.trim();
        $searchClear.classList.toggle('hidden', !val);
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => loadNotes(val), 200);
    });

    $searchClear.addEventListener('click', () => {
        $searchInput.value = '';
        $searchClear.classList.add('hidden');
        loadNotes();
    });

    // ---- 同步按钮 ----
    $syncBtn.addEventListener('click', () => {
        $syncBtn.style.animation = 'spin 0.8s linear infinite';
        chrome.runtime.sendMessage({ type: 'FORCE_SYNC' }, (res) => {
            $syncBtn.style.animation = '';
            showToast(res?.ok ? '同步完成 ✓' : '同步失败');
            loadNotes($searchInput.value.trim());
        });
    });

    // ---- 导出 ----
    $exportBtn.addEventListener('click', () => {
        chrome.runtime.sendMessage({ type: 'EXPORT_DATA' }, (res) => {
            if (res?.ok && res.data) {
                const blob = new Blob([res.data], { type: 'text/markdown' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `istar-export-${new Date().toISOString().slice(0, 10)}.md`;
                a.click();
                URL.revokeObjectURL(url);
                showToast('导出成功 ✓');
            }
        });
    });

    // ---- 设置加载 ----
    const settings = await loadSettings();

    // 位置
    $positionGrid.querySelectorAll('.sp-pos-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.pos === (settings.position || 'top-right'));
        btn.addEventListener('click', () => {
            $positionGrid.querySelectorAll('.sp-pos-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        });
    });

    // 主题风格
    $themeGrid.querySelectorAll('.sp-theme-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.theme === (settings.theme || 'sticky'));
        btn.addEventListener('click', () => {
            $themeGrid.querySelectorAll('.sp-theme-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        });
    });

    // 展开模式
    document.querySelectorAll('[name="displayMode"]').forEach(radio => {
        radio.checked = radio.value === (settings.displayMode || 'collapsed');
    });

    // 同步方案
    $syncProvider.value = settings.syncProvider || 'chrome';
    toggleSyncConfig(settings.syncProvider);
    $syncProvider.addEventListener('change', () => toggleSyncConfig($syncProvider.value));

    if (settings.githubToken) $githubToken.value = settings.githubToken;
    if (settings.feishuConfig) {
        $feishuAppId.value = settings.feishuConfig.appId || '';
        $feishuAppSecret.value = settings.feishuConfig.appSecret || '';
        $feishuAppToken.value = settings.feishuConfig.appToken || '';
        $feishuTableId.value = settings.feishuConfig.tableId || '';
    }

    // 偏移域名列表
    if ($offsetDomains && settings.offsetDomains) {
        $offsetDomains.value = settings.offsetDomains.join('\n');
    }

    // 偏移域名独立保存按钮
    if ($saveOffsetDomains) {
        $saveOffsetDomains.addEventListener('click', async () => {
            const current = await loadSettings();
            const lines = $offsetDomains.value.split('\n')
                .map(s => s.trim().toLowerCase())
                .filter(s => s.length > 0);
            // 去重
            const unique = [...new Set(lines)];
            current.offsetDomains = unique;
            chrome.storage.sync.set({ _istar_settings: current }, () => {
                $offsetDomains.value = unique.join('\n');
                showToast('偏移域名已保存 ✓');
            });
        });
    }

    function toggleSyncConfig(provider) {
        $githubConfig.classList.toggle('hidden', provider !== 'github');
        $feishuConfig.classList.toggle('hidden', provider !== 'feishu');
    }

    // 保存
    $saveSettings.addEventListener('click', async () => {
        const current = await loadSettings();
        const newSettings = {
            ...current,
            position: $positionGrid.querySelector('.sp-pos-btn.active')?.dataset.pos || 'top-right',
            theme: $themeGrid.querySelector('.sp-theme-btn.active')?.dataset.theme || 'sticky',
            displayMode: document.querySelector('[name="displayMode"]:checked')?.value || 'collapsed',
            syncProvider: $syncProvider.value,
            githubToken: $githubToken.value.trim() || null,
            feishuConfig: $syncProvider.value === 'feishu' ? {
                appId: $feishuAppId.value.trim(),
                appSecret: $feishuAppSecret.value.trim(),
                appToken: $feishuAppToken.value.trim(),
                tableId: $feishuTableId.value.trim()
            } : (current.feishuConfig || null)
        };

        chrome.storage.sync.set({ _istar_settings: newSettings }, () => {
            showToast('设置已保存 ✓');
        });
    });

    // ---- 监听存储变更，实时刷新 ----
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes._istar_data) {
            loadNotes($searchInput.value.trim());
        }
    });

    // ---- 工具函数 ----
    function escHtml(str) {
        const div = document.createElement('div');
        div.textContent = str || '';
        return div.innerHTML;
    }

    function escAttr(str) {
        return (str || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function formatTime(ts) {
        const d = new Date(ts);
        const now = new Date();
        const diff = now - d;
        if (diff < 60000) return '刚刚';
        if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`;
        if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`;
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        if (d.getFullYear() === now.getFullYear()) return `${m}-${day}`;
        return `${d.getFullYear()}-${m}-${day}`;
    }

    function showToast(msg) {
        const $toast = document.getElementById('toast');
        $toast.textContent = msg;
        $toast.classList.add('show');
        setTimeout(() => $toast.classList.remove('show'), 2000);
    }

    // ---- 初始化 ----
    loadNotes();
});
