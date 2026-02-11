/**
 * iStar GitHub Gist 同步模块
 * 使用 Personal Access Token，加密数据存入 Private Gist
 */

const SyncGitHub = (() => {
    const GIST_FILENAME = 'istar-memo.enc';
    const API_BASE = 'https://api.github.com';

    /**
     * 获取 GitHub Token
     */
    async function _getToken() {
        const settings = await _getSettings();
        if (!settings.githubToken) throw new Error('GitHub Token 未配置');
        return settings.githubToken;
    }

    async function _getSettings() {
        return new Promise((resolve) => {
            chrome.storage.sync.get(['_istar_settings'], (r) => {
                resolve(r._istar_settings || {});
            });
        });
    }

    async function _saveGistId(gistId) {
        return new Promise((resolve) => {
            chrome.storage.sync.get(['_istar_settings'], (r) => {
                const settings = r._istar_settings || {};
                settings._githubGistId = gistId;
                chrome.storage.sync.set({ _istar_settings: settings }, resolve);
            });
        });
    }

    async function _getGistId() {
        const settings = await _getSettings();
        return settings._githubGistId || null;
    }

    /**
     * 查找已有的 iStar Gist
     */
    async function _findGist(token) {
        // 先检查缓存的 gist id
        const cachedId = await _getGistId();
        if (cachedId) {
            try {
                const res = await fetch(`${API_BASE}/gists/${cachedId}`, {
                    headers: { Authorization: `Bearer ${token}` }
                });
                if (res.ok) return cachedId;
            } catch { /* 继续搜索 */ }
        }

        // 遍历用户的 gist 查找
        const res = await fetch(`${API_BASE}/gists?per_page=100`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        const gists = await res.json();
        for (const gist of gists) {
            if (gist.files && gist.files[GIST_FILENAME]) {
                await _saveGistId(gist.id);
                return gist.id;
            }
        }
        return null;
    }

    /**
     * 推送加密数据到 Gist
     */
    async function push(encryptedData) {
        const token = await _getToken();
        const gistId = await _findGist(token);

        const payload = {
            description: 'iStar 船仓网页便签数据（加密）',
            public: false,
            files: {
                [GIST_FILENAME]: { content: encryptedData }
            }
        };

        if (gistId) {
            // 更新
            await fetch(`${API_BASE}/gists/${gistId}`, {
                method: 'PATCH',
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });
        } else {
            // 创建
            const res = await fetch(`${API_BASE}/gists`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });
            const data = await res.json();
            await _saveGistId(data.id);
        }
    }

    /**
     * 从 Gist 拉取加密数据
     */
    async function pull() {
        try {
            const token = await _getToken();
            const gistId = await _findGist(token);
            if (!gistId) return null;

            const res = await fetch(`${API_BASE}/gists/${gistId}`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            const gist = await res.json();
            const file = gist.files?.[GIST_FILENAME];
            return file ? file.content : null;
        } catch {
            return null;
        }
    }

    return { push, pull };
})();
