/**
 * iStar 本地存储抽象层
 * 负责加密读写 chrome.storage.local，并管理数据结构
 */

const IStarStorage = (() => {
    const DATA_KEY = '_istar_data';
    const SETTINGS_KEY = '_istar_settings';

    // 默认设置
    const DEFAULT_SETTINGS = {
        position: 'top-right',       // 图标位置：top-right/top-left/bottom-right/bottom-left
        displayMode: 'collapsed',    // 展开模式：collapsed/expanded/personalized
        syncProvider: 'chrome',      // 同步方案：chrome/drive/github/feishu/none
        githubToken: null,
        feishuConfig: null,
        driveEnabled: false,
        // 右上角头像偏移域名列表（这些网站的触发图标下移 48px 避免遮挡头像）
        offsetDomains: [
            'github.com', 'gitlab.com', 'google.com', 'youtube.com',
            'chatgpt.com', 'chat.openai.com', 'claude.ai', 'gemini.google.com',
            'perplexity.ai', 'huggingface.co', 'stackoverflow.com',
            'vercel.com', 'netlify.com', 'notion.so', 'figma.com',
            'discord.com', 'x.com', 'twitter.com', 'reddit.com', 'linkedin.com',
            'v2ex.com', 'juejin.cn', 'zhihu.com', 'bilibili.com',
            'kimi.moonshot.cn', 'doubao.com', 'colab.research.google.com',
            'greasyfork.org', 'codepen.io', 'replit.com', 'deepseek.com'
        ]
    };

    // 默认数据结构
    const DEFAULT_DATA = {
        v: 1,
        domains: {}
    };

    /**
     * 生成 8 位随机 ID
     */
    function _nanoid() {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        let id = '';
        const values = crypto.getRandomValues(new Uint8Array(8));
        for (let i = 0; i < 8; i++) {
            id += chars[values[i] % chars.length];
        }
        return id;
    }

    /**
     * 从 URL 提取根域名
     */
    function getDomain(url) {
        try {
            return new URL(url).hostname;
        } catch {
            return 'unknown';
        }
    }

    /**
     * 从 URL 提取路径（去除 hash 和 search）
     */
    function getPath(url) {
        try {
            return new URL(url).pathname;
        } catch {
            return '/';
        }
    }

    /**
     * 读取设置（从 chrome.storage.sync）
     */
    async function getSettings() {
        return new Promise((resolve) => {
            chrome.storage.sync.get([SETTINGS_KEY], (result) => {
                resolve({ ...DEFAULT_SETTINGS, ...(result[SETTINGS_KEY] || {}) });
            });
        });
    }

    /**
     * 保存设置（到 chrome.storage.sync）
     */
    async function saveSettings(settings) {
        return new Promise((resolve) => {
            chrome.storage.sync.set({ [SETTINGS_KEY]: settings }, resolve);
        });
    }

    /**
     * 读取所有数据（从 chrome.storage.local，自动解密）
     */
    async function getData() {
        const encKey = await IStarCrypto.getOrCreateKey();
        return new Promise((resolve) => {
            chrome.storage.local.get([DATA_KEY], async (result) => {
                if (result[DATA_KEY]) {
                    try {
                        const decrypted = await IStarCrypto.decrypt(result[DATA_KEY], encKey);
                        resolve(JSON.parse(decrypted));
                    } catch {
                        // 解密失败（密钥变更等），返回默认
                        resolve({ ...DEFAULT_DATA });
                    }
                } else {
                    resolve({ ...DEFAULT_DATA });
                }
            });
        });
    }

    /**
     * 保存所有数据（加密后写入 chrome.storage.local）
     */
    async function saveData(data) {
        const encKey = await IStarCrypto.getOrCreateKey();
        const encrypted = await IStarCrypto.encrypt(JSON.stringify(data), encKey);
        return new Promise((resolve) => {
            chrome.storage.local.set({ [DATA_KEY]: encrypted }, () => {
                // 通知 background 执行同步
                chrome.runtime.sendMessage({ type: 'DATA_CHANGED', data });
                resolve();
            });
        });
    }

    /**
     * 获取指定域名的所有笔记
     */
    async function getDomainData(domain) {
        const data = await getData();
        return data.domains[domain] || { pinned: false, pages: {} };
    }

    /**
     * 获取指定页面的笔记
     */
    async function getPageNotes(domain, path) {
        const domainData = await getDomainData(domain);
        const pageData = domainData.pages[path];
        if (!pageData) return [];
        return pageData.notes.filter(n => !n.del);
    }

    /**
     * 获取页面级主题（优先页面 → 全局默认）
     */
    async function getPageTheme(domain, path) {
        const data = await getData();
        const pageTheme = data.domains[domain]?.pages[path]?.theme;
        if (pageTheme) return pageTheme;
        // 回退到全局设置
        const settings = await getSettings();
        return settings.theme || 'sticky';
    }

    /**
     * 保存页面级主题
     */
    async function setPageTheme(domain, path, theme) {
        const data = await getData();
        if (!data.domains[domain]) {
            data.domains[domain] = { pinned: false, pages: {} };
        }
        if (!data.domains[domain].pages[path]) {
            data.domains[domain].pages[path] = { notes: [] };
        }
        data.domains[domain].pages[path].theme = theme;
        await saveData(data);
    }

    /**
     * 获取页面级面板位置（拖拽后的坐标）
     * 返回 { left, top } 或 null
     */
    async function getPagePosition(domain, path) {
        const data = await getData();
        return data.domains[domain]?.pages[path]?.pos || null;
    }

    /**
     * 保存页面级面板位置
     */
    async function setPagePosition(domain, path, left, top) {
        const data = await getData();
        if (!data.domains[domain]) {
            data.domains[domain] = { pinned: false, pages: {} };
        }
        if (!data.domains[domain].pages[path]) {
            data.domains[domain].pages[path] = { notes: [] };
        }
        data.domains[domain].pages[path].pos = { left, top };
        await saveData(data);
    }

    /**
     * 获取同站其他页面的笔记摘要
     */
    async function getOtherPagesInfo(domain, currentPath) {
        const domainData = await getDomainData(domain);
        const others = [];
        for (const [path, pageData] of Object.entries(domainData.pages)) {
            if (path === currentPath) continue;
            const activeNotes = pageData.notes.filter(n => !n.del);
            if (activeNotes.length > 0) {
                others.push({ path, count: activeNotes.length });
            }
        }
        return others;
    }

    /**
     * 添加笔记
     */
    async function addNote(domain, path, text) {
        const data = await getData();
        if (!data.domains[domain]) {
            data.domains[domain] = { pinned: false, pages: {} };
        }
        if (!data.domains[domain].pages[path]) {
            data.domains[domain].pages[path] = { notes: [] };
        }
        const now = Date.now();
        const note = {
            id: _nanoid(),
            text,
            ts: now,
            uTs: now,
            del: false
        };
        data.domains[domain].pages[path].notes.unshift(note);
        await saveData(data);
        return note;
    }

    /**
     * 更新笔记
     */
    async function updateNote(domain, path, noteId, newText) {
        const data = await getData();
        const page = data.domains[domain]?.pages[path];
        if (!page) return null;
        const note = page.notes.find(n => n.id === noteId);
        if (!note) return null;
        note.text = newText;
        note.uTs = Date.now();
        await saveData(data);
        return note;
    }

    /**
     * 删除笔记（软删除）
     */
    async function deleteNote(domain, path, noteId) {
        const data = await getData();
        const page = data.domains[domain]?.pages[path];
        if (!page) return;
        const note = page.notes.find(n => n.id === noteId);
        if (note) {
            note.del = true;
            note.uTs = Date.now();
            await saveData(data);
        }
    }

    /**
     * 切换域名收藏状态
     */
    async function togglePin(domain) {
        const data = await getData();
        if (!data.domains[domain]) {
            data.domains[domain] = { pinned: false, pages: {} };
        }
        data.domains[domain].pinned = !data.domains[domain].pinned;
        await saveData(data);
        return data.domains[domain].pinned;
    }

    /**
     * 判断域名是否被收藏
     */
    async function isPinned(domain) {
        const data = await getData();
        return data.domains[domain]?.pinned || false;
    }

    /**
     * 获取所有域名列表（用于 Popup 展示）
     */
    async function getAllDomains() {
        const data = await getData();
        const domains = [];
        for (const [domain, domainData] of Object.entries(data.domains)) {
            let totalNotes = 0;
            let totalPages = 0;
            for (const pageData of Object.values(domainData.pages)) {
                const active = pageData.notes.filter(n => !n.del).length;
                if (active > 0) {
                    totalPages++;
                    totalNotes += active;
                }
            }
            if (totalNotes > 0) {
                domains.push({
                    domain,
                    pinned: domainData.pinned,
                    totalNotes,
                    totalPages
                });
            }
        }
        return domains;
    }

    /**
     * 导出所有数据为明文 JSON（用于飞书同步或导出）
     */
    async function exportPlainData() {
        return await getData();
    }

    /**
     * 导入数据并合并（笔记级，时间戳新者优先）
     */
    async function mergeData(remoteData) {
        const local = await getData();
        // 合并域名
        for (const [domain, remoteDomain] of Object.entries(remoteData.domains || {})) {
            if (!local.domains[domain]) {
                local.domains[domain] = remoteDomain;
                continue;
            }
            // 合并 pinned 状态
            if (remoteDomain.pinned !== undefined) {
                local.domains[domain].pinned = remoteDomain.pinned;
            }
            // 合并页面
            for (const [path, remotePage] of Object.entries(remoteDomain.pages || {})) {
                if (!local.domains[domain].pages[path]) {
                    local.domains[domain].pages[path] = remotePage;
                    continue;
                }
                // 合并笔记（按 id 对比）
                const localNotes = local.domains[domain].pages[path].notes;
                for (const remoteNote of remotePage.notes) {
                    const localNote = localNotes.find(n => n.id === remoteNote.id);
                    if (!localNote) {
                        // 远端有本地没有 → 新增
                        localNotes.push(remoteNote);
                    } else if (remoteNote.uTs > localNote.uTs) {
                        // 远端更新 → 覆盖
                        Object.assign(localNote, remoteNote);
                    }
                }
            }
        }
        await saveData(local);
        return local;
    }

    return {
        getDomain,
        getPath,
        getSettings,
        saveSettings,
        getData,
        saveData,
        getDomainData,
        getPageNotes,
        getPageTheme,
        setPageTheme,
        getPagePosition,
        setPagePosition,
        getOtherPagesInfo,
        addNote,
        updateNote,
        deleteNote,
        togglePin,
        isPinned,
        getAllDomains,
        exportPlainData,
        mergeData,
        DEFAULT_SETTINGS
    };
})();
