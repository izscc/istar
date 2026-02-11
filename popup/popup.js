/**
 * iStar Popup 逻辑
 * 笔记总览、搜索、设置管理
 */

document.addEventListener('DOMContentLoaded', async () => {
    // ---- DOM 引用 ----
    const $tabs = document.querySelectorAll('.popup-tab');
    const $sections = document.querySelectorAll('.popup-section');
    const $searchInput = document.getElementById('searchInput');
    const $domainsList = document.getElementById('domainsList');
    const $exportBtn = document.getElementById('exportBtn');
    const $syncBtn = document.getElementById('syncBtn');
    const $positionGrid = document.getElementById('positionGrid');
    const $syncProvider = document.getElementById('syncProvider');
    const $githubConfig = document.getElementById('githubConfig');
    const $feishuConfig = document.getElementById('feishuConfig');
    const $githubToken = document.getElementById('githubToken');
    const $feishuAppId = document.getElementById('feishuAppId');
    const $feishuAppSecret = document.getElementById('feishuAppSecret');
    const $feishuAppToken = document.getElementById('feishuAppToken');
    const $feishuTableId = document.getElementById('feishuTableId');
    const $saveSettings = document.getElementById('saveSettings');

    // ---- 标签页切换 ----
    $tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            $tabs.forEach(t => t.classList.remove('active'));
            $sections.forEach(s => s.classList.add('hidden'));
            tab.classList.add('active');
            document.querySelector(`[data-section="${tab.dataset.tab}"]`).classList.remove('hidden');
        });
    });

    // ---- 加载设置 ----
    async function loadSettings() {
        return new Promise((resolve) => {
            chrome.storage.sync.get(['_istar_settings'], (r) => {
                resolve(r._istar_settings || {
                    position: 'top-right',
                    displayMode: 'collapsed',
                    syncProvider: 'chrome'
                });
            });
        });
    }

    const settings = await loadSettings();

    // 位置按钮
    $positionGrid.querySelectorAll('.popup-pos-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.pos === settings.position);
        btn.addEventListener('click', () => {
            $positionGrid.querySelectorAll('.popup-pos-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        });
    });

    // 展开模式
    const $displayRadios = document.querySelectorAll('[name="displayMode"]');
    $displayRadios.forEach(radio => {
        radio.checked = radio.value === (settings.displayMode || 'collapsed');
    });

    // 同步方案
    $syncProvider.value = settings.syncProvider || 'chrome';
    toggleSyncConfig(settings.syncProvider);

    $syncProvider.addEventListener('change', () => {
        toggleSyncConfig($syncProvider.value);
    });

    // GitHub Token
    if (settings.githubToken) {
        $githubToken.value = settings.githubToken;
    }

    // 飞书配置
    if (settings.feishuConfig) {
        $feishuAppId.value = settings.feishuConfig.appId || '';
        $feishuAppSecret.value = settings.feishuConfig.appSecret || '';
        $feishuAppToken.value = settings.feishuConfig.appToken || '';
        $feishuTableId.value = settings.feishuConfig.tableId || '';
    }

    function toggleSyncConfig(provider) {
        $githubConfig.classList.toggle('hidden', provider !== 'github');
        $feishuConfig.classList.toggle('hidden', provider !== 'feishu');
    }

    // ---- 保存设置 ----
    $saveSettings.addEventListener('click', async () => {
        const newSettings = {
            position: $positionGrid.querySelector('.popup-pos-btn.active')?.dataset.pos || 'top-right',
            displayMode: document.querySelector('[name="displayMode"]:checked')?.value || 'collapsed',
            syncProvider: $syncProvider.value,
            githubToken: $githubToken.value.trim() || null,
            feishuConfig: $syncProvider.value === 'feishu' ? {
                appId: $feishuAppId.value.trim(),
                appSecret: $feishuAppSecret.value.trim(),
                appToken: $feishuAppToken.value.trim(),
                tableId: $feishuTableId.value.trim()
            } : (settings.feishuConfig || null)
        };

        // 保留密钥和 gist id 等内部字段
        const current = await loadSettings();
        const merged = { ...current, ...newSettings };

        chrome.storage.sync.set({ _istar_settings: merged }, () => {
            showToast('设置已保存 ✓');
        });
    });

    // ---- 加载笔记列表 ----
    async function loadNotes(searchQuery = '') {
        // 从 storage 读取解密数据
        const encKey = await getEncKey();
        const data = await getLocalData(encKey);

        const domains = [];
        for (const [domain, domainData] of Object.entries(data.domains || {})) {
            let totalNotes = 0;
            let totalPages = 0;
            let matchedNotes = [];

            for (const [path, pageData] of Object.entries(domainData.pages || {})) {
                const active = pageData.notes.filter(n => !n.del);
                if (active.length === 0) continue;
                totalPages++;
                totalNotes += active.length;

                if (searchQuery) {
                    const matched = active.filter(n =>
                        n.text.toLowerCase().includes(searchQuery.toLowerCase())
                    );
                    matchedNotes.push(...matched.map(n => ({ ...n, path })));
                }
            }

            if (totalNotes === 0) continue;
            if (searchQuery && matchedNotes.length === 0) continue;

            domains.push({
                domain,
                pinned: domainData.pinned,
                totalNotes: searchQuery ? matchedNotes.length : totalNotes,
                totalPages,
                matchedNotes: searchQuery ? matchedNotes : []
            });
        }

        renderDomains(domains, searchQuery);
    }

    function renderDomains(domains, searchQuery) {
        if (domains.length === 0) {
            $domainsList.innerHTML = `
        <div class="popup-empty">
          <div class="popup-empty-icon">📝</div>
          <div class="popup-empty-text">${searchQuery ? '未找到匹配笔记' : '还没有任何网页便签'}</div>
        </div>
      `;
            return;
        }

        $domainsList.innerHTML = domains.map(d => `
      <div class="popup-domain-card">
        <div class="popup-domain-header">
          <span class="popup-domain-name">${d.pinned ? '⭐ ' : ''}${escHtml(d.domain)}</span>
          <span class="popup-domain-stats">${d.totalNotes} 条 · ${d.totalPages} 页</span>
        </div>
        ${d.matchedNotes.length > 0 ? `
          <div class="popup-domain-meta">
            ${d.matchedNotes.slice(0, 3).map(n =>
            `<div style="margin-top:4px;font-size:11px;color:var(--text-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
                📄 ${escHtml(n.path)}: ${escHtml(n.text.slice(0, 50))}
              </div>`
        ).join('')}
          </div>
        ` : ''}
      </div>
    `).join('');
    }

    // ---- 搜索 ----
    let searchTimer;
    $searchInput.addEventListener('input', () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
            loadNotes($searchInput.value.trim());
        }, 200);
    });

    // ---- 导出 ----
    $exportBtn.addEventListener('click', () => {
        chrome.runtime.sendMessage({ type: 'EXPORT_DATA' }, (res) => {
            if (res?.ok && res.data) {
                // 下载 Markdown 文件
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

    // ---- 手动同步 ----
    $syncBtn.addEventListener('click', () => {
        $syncBtn.disabled = true;
        $syncBtn.textContent = '🔄 同步中…';
        chrome.runtime.sendMessage({ type: 'FORCE_SYNC' }, (res) => {
            $syncBtn.disabled = false;
            $syncBtn.textContent = '🔄 立即同步';
            showToast(res?.ok ? '同步完成 ✓' : '同步失败 ✕');
        });
    });

    // ---- 工具函数 ----
    function escHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    async function getEncKey() {
        return new Promise((resolve) => {
            chrome.storage.sync.get(['_istar_enc_key'], (r) => {
                resolve(r._istar_enc_key || null);
            });
        });
    }

    async function getLocalData(encKey) {
        return new Promise((resolve) => {
            chrome.storage.local.get(['_istar_data'], async (result) => {
                if (result._istar_data && encKey) {
                    try {
                        // 内联解密（popup 无法访问 content script 的 IStarCrypto）
                        const combined = Uint8Array.from(atob(result._istar_data), c => c.charCodeAt(0));
                        const iv = combined.slice(0, 12);
                        const ciphertext = combined.slice(12);
                        const rawKey = Uint8Array.from(atob(encKey), c => c.charCodeAt(0));
                        const key = await crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
                        const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
                        resolve(JSON.parse(new TextDecoder().decode(decrypted)));
                    } catch {
                        resolve({ v: 1, domains: {} });
                    }
                } else {
                    resolve({ v: 1, domains: {} });
                }
            });
        });
    }

    function showToast(message) {
        let toast = document.querySelector('.popup-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.className = 'popup-toast';
            document.body.appendChild(toast);
        }
        toast.textContent = message;
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 2000);
    }

    // ---- 初始化 ----
    loadNotes();
});
