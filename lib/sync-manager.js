/**
 * iStar 同步管理器
 * 路由同步请求到不同 Provider，处理冲突合并
 */

const SyncManager = (() => {
    let _debounceTimer = null;
    const DEBOUNCE_MS = 5000; // 5 秒防抖

    /**
     * 触发同步（防抖 5 秒）
     */
    function schedulePush() {
        clearTimeout(_debounceTimer);
        _debounceTimer = setTimeout(() => {
            pushToRemote();
        }, DEBOUNCE_MS);
    }

    /**
     * 推送数据到远端
     */
    async function pushToRemote() {
        try {
            const settings = await _getSettings();
            const provider = settings.syncProvider || 'chrome';

            if (provider === 'none') return;

            const encKey = await IStarCrypto.getOrCreateKey();
            const data = await _getLocalData();
            const plainJson = JSON.stringify(data);
            const encrypted = await IStarCrypto.encrypt(plainJson, encKey);

            // 根据 provider 推送
            if (provider === 'chrome' || provider === 'all') {
                try {
                    await SyncChrome.push(encrypted);
                } catch (e) {
                    if (e.message === 'QUOTA_EXCEEDED') {
                        // 容量超限，通知用户升级
                        _notifyQuotaExceeded();
                    }
                }
            }

            if (provider === 'drive' || provider === 'all') {
                await SyncDrive.push(encrypted);
            }

            if (provider === 'github' || provider === 'all') {
                await SyncGitHub.push(encrypted);
            }

            if (provider === 'feishu' || provider === 'all') {
                // 飞书用明文推送
                await SyncFeishu.push(data);
            }

            // 通知所有标签页同步完成
            _broadcastMessage({ type: 'SYNC_COMPLETE' });
        } catch (err) {
            console.error('[iStar] 同步推送失败:', err);
        }
    }

    /**
     * 拉取远端数据并合并
     */
    async function pullFromRemote() {
        try {
            const settings = await _getSettings();
            const provider = settings.syncProvider || 'chrome';

            if (provider === 'none') return;

            const encKey = await IStarCrypto.getOrCreateKey();
            let remoteData = null;

            // 优先从主 provider 拉取
            if (provider === 'chrome' || provider === 'all') {
                const encrypted = await SyncChrome.pull();
                if (encrypted) {
                    try {
                        const decrypted = await IStarCrypto.decrypt(encrypted, encKey);
                        remoteData = JSON.parse(decrypted);
                    } catch { /* 解密失败 */ }
                }
            }

            if (!remoteData && (provider === 'drive' || provider === 'all')) {
                const encrypted = await SyncDrive.pull();
                if (encrypted) {
                    try {
                        const decrypted = await IStarCrypto.decrypt(encrypted, encKey);
                        remoteData = JSON.parse(decrypted);
                    } catch { /* 解密失败 */ }
                }
            }

            if (!remoteData && (provider === 'github' || provider === 'all')) {
                const encrypted = await SyncGitHub.pull();
                if (encrypted) {
                    try {
                        const decrypted = await IStarCrypto.decrypt(encrypted, encKey);
                        remoteData = JSON.parse(decrypted);
                    } catch { /* 解密失败 */ }
                }
            }

            if (!remoteData && (provider === 'feishu' || provider === 'all')) {
                remoteData = await SyncFeishu.pull();
            }

            // 合并数据
            if (remoteData) {
                await _mergeAndSave(remoteData);
                _broadcastMessage({ type: 'SYNC_COMPLETE' });
            }
        } catch (err) {
            console.error('[iStar] 同步拉取失败:', err);
        }
    }

    /**
     * 笔记级合并：远端数据 + 本地数据
     */
    async function _mergeAndSave(remoteData) {
        const local = await _getLocalData();

        for (const [domain, remoteDomain] of Object.entries(remoteData.domains || {})) {
            if (!local.domains[domain]) {
                local.domains[domain] = remoteDomain;
                continue;
            }

            // 合并 pinned
            // 不覆盖，保持两端 OR 逻辑
            if (remoteDomain.pinned) {
                local.domains[domain].pinned = true;
            }

            for (const [path, remotePage] of Object.entries(remoteDomain.pages || {})) {
                if (!local.domains[domain].pages[path]) {
                    local.domains[domain].pages[path] = remotePage;
                    continue;
                }

                const localNotes = local.domains[domain].pages[path].notes;
                for (const remoteNote of remotePage.notes) {
                    const localNote = localNotes.find(n => n.id === remoteNote.id);
                    if (!localNote) {
                        localNotes.push(remoteNote);
                    } else if (remoteNote.uTs > localNote.uTs) {
                        Object.assign(localNote, remoteNote);
                    }
                }
            }
        }

        // 保存合并后的数据（不触发新的同步推送）
        const encKey = await IStarCrypto.getOrCreateKey();
        const encrypted = await IStarCrypto.encrypt(JSON.stringify(local), encKey);
        await new Promise((resolve) => {
            chrome.storage.local.set({ '_istar_data': encrypted }, resolve);
        });
    }

    /**
     * 通知所有标签页
     */
    function _broadcastMessage(msg) {
        chrome.tabs.query({}, (tabs) => {
            for (const tab of tabs) {
                chrome.tabs.sendMessage(tab.id, msg).catch(() => { });
            }
        });
    }

    /**
     * 容量超限通知
     */
    function _notifyQuotaExceeded() {
        chrome.notifications?.create('istar-quota', {
            type: 'basic',
            iconUrl: chrome.runtime.getURL('icons/icon128.png'),
            title: 'iStar 存储提醒',
            message: '本地同步容量即将用完，建议升级到 Google Drive 同步方案。'
        });
    }

    async function _getSettings() {
        return new Promise((resolve) => {
            chrome.storage.sync.get(['_istar_settings'], (r) => {
                resolve(r._istar_settings || {});
            });
        });
    }

    async function _getLocalData() {
        const encKey = await IStarCrypto.getOrCreateKey();
        return new Promise((resolve) => {
            chrome.storage.local.get(['_istar_data'], async (result) => {
                if (result._istar_data) {
                    try {
                        const decrypted = await IStarCrypto.decrypt(result._istar_data, encKey);
                        resolve(JSON.parse(decrypted));
                    } catch {
                        resolve({ v: 1, domains: {} });
                    }
                } else {
                    resolve({ v: 1, domains: {} });
                }
            });
        });
    }

    return { schedulePush, pushToRemote, pullFromRemote };
})();
