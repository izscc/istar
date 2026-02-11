/**
 * iStar Content Script（v2 — 单条便签 + 多主题）
 * 每个页面一条网页便签，直接编辑自动保存
 * 使用 closed Shadow DOM 完全隔离
 */

(async () => {
    // 防止重复注入
    if (document.querySelector('#istar-host')) return;

    // 等待 body
    if (!document.body) {
        await new Promise(r => {
            if (document.readyState !== 'loading') return r();
            document.addEventListener('DOMContentLoaded', r, { once: true });
        });
    }

    // ---- 当前页面信息 ----
    const currentUrl = window.location.href;
    const currentDomain = IStarStorage.getDomain(currentUrl);
    const currentPath = IStarStorage.getPath(currentUrl);

    // 状态
    let panelVisible = false;
    let panelLocked = false;
    let hoverTimer = null;
    let saveTimer = null;
    let currentTheme = 'sticky'; // 默认主题

    // ---- 主题配置 ----
    const THEMES = [
        { id: 'sticky', emoji: '📌', name: '经典便签' },
        { id: 'craft', emoji: '📋', name: '牛皮纸' },
        { id: 'typewriter', emoji: '📃', name: '打字机' },
        { id: 'notebook', emoji: '📒', name: '笔记本' },
        { id: 'glass', emoji: '✨', name: '毛玻璃' },
        { id: 'bubble', emoji: '💬', name: '对话气泡' },
        { id: 'ticket', emoji: '🎫', name: '票券' },
        { id: 'clipping', emoji: '📎', name: '剪报' },
    ];

    // ---- 创建 Shadow DOM ----
    const host = document.createElement('div');
    host.id = 'istar-host';
    host.style.cssText = 'all:initial; position:fixed; z-index:2147483646;';
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: 'closed' });

    // 注入 CSS
    const styleLink = document.createElement('link');
    styleLink.rel = 'stylesheet';
    styleLink.href = chrome.runtime.getURL('content.css');
    const cssReady = new Promise(r => { styleLink.onload = r; styleLink.onerror = r; });
    shadow.appendChild(styleLink);

    // ---- 加载配置 ----
    const settings = await IStarStorage.getSettings();
    const position = settings.position || 'top-right';
    // 页面级主题（优先页面→全局默认）
    currentTheme = await IStarStorage.getPageTheme(currentDomain, currentPath);

    // ---- 检测是否需要偏移（避开右上角头像） ----
    const offsetDomains = settings.offsetDomains || [];
    const hostname = window.location.hostname;
    // 提取根域名进行匹配（如 www.github.com → github.com）
    function _matchOffset(host) {
        return offsetDomains.some(d => host === d || host.endsWith('.' + d));
    }
    const needOffset = _matchOffset(hostname);

    // ---- 触发图标 ----
    const trigger = document.createElement('div');
    trigger.className = `istar-trigger ${position}${needOffset ? ' istar-offset' : ''}`;
    trigger.textContent = '📝';
    shadow.appendChild(trigger);

    // ---- 面板 ----
    const panel = document.createElement('div');
    panel.className = `istar-panel ${position}${needOffset ? ' istar-offset' : ''}`;
    panel.dataset.theme = currentTheme;
    panel.innerHTML = `
      <div class="istar-bar">
        <span class="istar-bar-domain">${_escHtml(currentDomain)}</span>
        <div class="istar-bar-actions">
          <button class="istar-bar-btn" data-action="pin" title="收藏">⭐</button>
          <button class="istar-bar-btn" data-action="lock" title="锁定">📌</button>
          <button class="istar-bar-btn" data-action="theme" title="切换风格">🎨</button>
          <button class="istar-bar-btn" data-action="close" title="关闭">✕</button>
        </div>
      </div>
      <div class="istar-picker" id="themePicker">
        ${THEMES.map(t => `
          <button class="istar-picker-item ${t.id === currentTheme ? 'active' : ''}" data-theme="${t.id}">
            <span class="istar-picker-emoji">${t.emoji}</span>
            <span>${t.name}</span>
          </button>
        `).join('')}
      </div>
      <div class="istar-note-wrap">
        <textarea class="istar-note-edit" placeholder="支持 Markdown 语法…" spellcheck="false"></textarea>
        <div class="istar-note-render"></div>
      </div>
      <div class="istar-date"></div>
    `;
    shadow.appendChild(panel);

    // ---- DOM 引用 ----
    const $noteEdit = panel.querySelector('.istar-note-edit');
    const $noteRender = panel.querySelector('.istar-note-render');
    const $noteWrap = panel.querySelector('.istar-note-wrap');
    const $date = panel.querySelector('.istar-date');
    const $pinBtn = panel.querySelector('[data-action="pin"]');
    const $lockBtn = panel.querySelector('[data-action="lock"]');
    const $themeBtn = panel.querySelector('[data-action="theme"]');
    const $closeBtn = panel.querySelector('[data-action="close"]');
    const $picker = panel.querySelector('#themePicker');
    const $bar = panel.querySelector('.istar-bar');

    // ---- 编辑/预览 模式切换 ----
    let isEditing = false;
    let mdSource = ''; // Markdown 源文本

    function enterEditMode() {
        if (isEditing) return;
        isEditing = true;
        $noteEdit.value = mdSource;
        $noteEdit.style.display = 'block';
        $noteRender.style.display = 'none';
        // 延迟聚焦，确保 DOM 更新后
        requestAnimationFrame(() => {
            $noteEdit.focus();
            // 光标移到末尾
            $noteEdit.selectionStart = $noteEdit.selectionEnd = $noteEdit.value.length;
        });
    }

    function exitEditMode() {
        if (!isEditing) return;
        isEditing = false;
        mdSource = $noteEdit.value;
        renderMarkdown();
        $noteEdit.style.display = 'none';
        $noteRender.style.display = 'block';
    }

    function renderMarkdown() {
        if (mdSource.trim()) {
            $noteRender.innerHTML = IStarMarkdown.render(mdSource);
            $noteRender.classList.remove('empty');
        } else {
            $noteRender.innerHTML = '<span class="istar-placeholder">支持 Markdown 语法…</span>';
            $noteRender.classList.add('empty');
        }
    }

    // 点击预览区 → 进入编辑
    $noteRender.addEventListener('click', (e) => {
        // 如果点击的是链接，不进入编辑模式
        if (e.target.closest('a')) return;
        enterEditMode();
    });

    // 编辑区失焦 → 退出编辑
    $noteEdit.addEventListener('blur', () => {
        // 延迟退出，避免点击其他按钮时过早退出
        setTimeout(() => {
            if (!$noteEdit.matches(':focus')) {
                exitEditMode();
            }
        }, 150);
    });

    // ---- 标记是否已加载过笔记 ----
    let noteLoaded = false;
    let isSaving = false;

    // ---- 加载笔记 ----
    async function loadNote(force = false) {
        if (isSaving) return;
        const notes = await IStarStorage.getPageNotes(currentDomain, currentPath);
        const isPinned = await IStarStorage.isPinned(currentDomain);

        // 更新触发图标
        if (notes.length > 0) {
            trigger.textContent = '⭐';
            trigger.classList.add('has-notes');
        } else {
            trigger.textContent = '📝';
            trigger.classList.remove('has-notes');
        }

        // 收藏状态
        $pinBtn.classList.toggle('active', isPinned);

        // 只有首次加载或强制刷新时才覆盖内容
        if (!noteLoaded || force) {
            if (notes.length > 0) {
                const note = notes[0];
                mdSource = note.text || '';
                $date.textContent = _formatTime(note.ts);
            } else {
                mdSource = '';
                $date.textContent = '';
            }
            // 默认进入预览模式
            renderMarkdown();
            $noteEdit.style.display = 'none';
            $noteRender.style.display = 'block';
            isEditing = false;
            noteLoaded = true;
        }
    }

    // ---- 自动保存（600ms 防抖） ----
    function scheduleSave() {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(async () => {
            isSaving = true;
            try {
                const text = $noteEdit.value.trim();
                const notes = await IStarStorage.getPageNotes(currentDomain, currentPath);

                if (text) {
                    if (notes.length > 0) {
                        await IStarStorage.updateNote(currentDomain, currentPath, notes[0].id, text);
                    } else {
                        await IStarStorage.addNote(currentDomain, currentPath, text);
                    }
                    trigger.textContent = '⭐';
                    trigger.classList.add('has-notes');
                    $date.textContent = '刚刚';
                } else if (notes.length > 0) {
                    await IStarStorage.deleteNote(currentDomain, currentPath, notes[0].id);
                    trigger.textContent = '📝';
                    trigger.classList.remove('has-notes');
                    $date.textContent = '';
                }
            } finally {
                isSaving = false;
            }
        }, 600);
    }

    $noteEdit.addEventListener('input', () => {
        mdSource = $noteEdit.value;
        scheduleSave();
    });

    // ---- 面板显隐 ----
    function showPanel() {
        panelVisible = true;
        panel.classList.add('visible');
        loadNote();
    }

    function hidePanel() {
        if (panelLocked) return;
        panelVisible = false;
        panel.classList.remove('visible');
    }

    function togglePanel() {
        if (panelVisible) {
            panelLocked = false;
            hidePanel();
        } else {
            showPanel();
        }
    }

    // ---- 主题切换 ----
    function setTheme(themeId) {
        currentTheme = themeId;
        panel.dataset.theme = themeId;

        // 更新 picker 选中态
        $picker.querySelectorAll('.istar-picker-item').forEach(item => {
            item.classList.toggle('active', item.dataset.theme === themeId);
        });

        // 持久化到页面级存储（不影响其他页面）
        IStarStorage.setPageTheme(currentDomain, currentPath, themeId);

        $picker.classList.remove('show');
    }

    // ---- 展开模式 ----
    async function checkDisplayMode() {
        const settings = await IStarStorage.getSettings();
        const isPinned = await IStarStorage.isPinned(currentDomain);

        if (isPinned) {
            showPanel();
            panelLocked = true;
            // 恢复上次拖拽位置
            await restorePosition();
            return;
        }
        if (settings.displayMode === 'expanded') {
            showPanel();
            await restorePosition();
            return;
        }
    }

    /**
     * 恢复页面级保存的拖拽位置
     */
    async function restorePosition() {
        const pos = await IStarStorage.getPagePosition(currentDomain, currentPath);
        if (pos && typeof pos.left === 'number' && typeof pos.top === 'number') {
            panel.style.position = 'fixed';
            panel.style.left = pos.left + 'px';
            panel.style.top = pos.top + 'px';
            panel.style.right = 'auto';
            panel.style.bottom = 'auto';
        }
    }

    // ---- 事件绑定 ----

    // hover 触发
    trigger.addEventListener('mouseenter', () => {
        hoverTimer = setTimeout(showPanel, 300);
    });
    trigger.addEventListener('mouseleave', () => clearTimeout(hoverTimer));
    trigger.addEventListener('click', () => {
        clearTimeout(hoverTimer);
        panelLocked = true;
        showPanel();
    });

    // 面板离开
    panel.addEventListener('mouseleave', () => {
        if (!panelLocked) {
            setTimeout(() => {
                if (!panel.matches(':hover') && !trigger.matches(':hover')) {
                    hidePanel();
                }
            }, 300);
        }
    });

    // 锁定（stopPropagation 防止被面板的 click 事件拦截）
    $lockBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        panelLocked = !panelLocked;
        $lockBtn.classList.toggle('active', panelLocked);
    });

    // 关闭
    $closeBtn.addEventListener('click', () => {
        panelLocked = false;
        hidePanel();
    });

    // 收藏
    $pinBtn.addEventListener('click', async () => {
        const pinned = await IStarStorage.togglePin(currentDomain);
        $pinBtn.classList.toggle('active', pinned);
    });

    // 主题按钮
    $themeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        $picker.classList.toggle('show');
    });

    // 主题选择
    $picker.querySelectorAll('.istar-picker-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.stopPropagation();
            setTheme(item.dataset.theme);
        });
    });

    // 点击面板外关闭 picker
    panel.addEventListener('click', (e) => {
        if (!e.target.closest('.istar-picker') && !e.target.closest('[data-action="theme"]')) {
            $picker.classList.remove('show');
        }
    });

    // 拖拽头部
    let isDragging = false;
    let dragStartX, dragStartY, panelStartX, panelStartY;

    $bar.addEventListener('mousedown', (e) => {
        if (e.target.closest('.istar-bar-btn') || e.target.closest('.istar-picker')) return;
        isDragging = true;
        dragStartX = e.clientX;
        dragStartY = e.clientY;
        const rect = panel.getBoundingClientRect();
        panelStartX = rect.left;
        panelStartY = rect.top;
        panel.style.transition = 'none';
    });

    shadow.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        panel.style.position = 'fixed';
        panel.style.left = (panelStartX + e.clientX - dragStartX) + 'px';
        panel.style.top = (panelStartY + e.clientY - dragStartY) + 'px';
        panel.style.right = 'auto';
        panel.style.bottom = 'auto';
    });

    let positionSaveTimer = null;

    shadow.addEventListener('mouseup', () => {
        if (isDragging) {
            isDragging = false;
            panel.style.transition = '';
            // 拖拽结束后保存位置（500ms 防抖）
            clearTimeout(positionSaveTimer);
            positionSaveTimer = setTimeout(() => {
                const rect = panel.getBoundingClientRect();
                IStarStorage.setPagePosition(currentDomain, currentPath, rect.left, rect.top);
            }, 500);
        }
    });

    // 监听消息
    chrome.runtime.onMessage.addListener((msg) => {
        if (msg.type === 'TOGGLE_PANEL') togglePanel();
        if (msg.type === 'SAVE_SELECTION') {
            const sel = msg.text || window.getSelection().toString().trim();
            if (sel) {
                mdSource = sel;
                $noteEdit.value = sel;
                renderMarkdown();
                scheduleSave();
                showPanel();
                panelLocked = true;
            }
        }
        if (msg.type === 'SYNC_COMPLETE') loadNote();
    });

    // ---- 设置按钮（打开侧边栏） ----
    // 已在 background.js 中通过 toolbar icon 处理

    // ---- 工具函数 ----
    function _escHtml(str) {
        const d = document.createElement('div');
        d.textContent = str;
        return d.innerHTML;
    }

    function _formatTime(ts) {
        const d = new Date(ts);
        const now = new Date();
        const diff = now - d;
        if (diff < 60000) return '刚刚';
        if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
        if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        if (d.getFullYear() === now.getFullYear()) return `${m}-${day}`;
        return `${d.getFullYear()}-${m}-${day}`;
    }

    // ---- 初始化 ----
    await cssReady;
    checkDisplayMode();
})();
