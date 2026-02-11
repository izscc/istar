/**
 * iStar Chrome 原生同步模块
 * 使用 chrome.storage.sync 实现零配置多设备同步
 * 限制：总容量 100KB，单 key 最大 8KB
 */

const SyncChrome = (() => {
    const SYNC_DATA_PREFIX = '_istar_sync_';
    const CHUNK_SIZE = 7000; // 单个 key 留余量（8KB 限制）

    /**
     * 将加密数据推送到 chrome.storage.sync
     * 数据较大时自动分 chunk 存储
     */
    async function push(encryptedData) {
        // 先清除旧的分片
        await _clearSyncChunks();

        if (encryptedData.length <= CHUNK_SIZE) {
            // 数据量小，单 key 存储
            return new Promise((resolve, reject) => {
                chrome.storage.sync.set({
                    [`${SYNC_DATA_PREFIX}0`]: encryptedData,
                    [`${SYNC_DATA_PREFIX}meta`]: { chunks: 1, ts: Date.now() }
                }, () => {
                    if (chrome.runtime.lastError) {
                        reject(chrome.runtime.lastError);
                    } else {
                        resolve();
                    }
                });
            });
        }

        // 数据量大，分 chunk 存储
        const chunks = [];
        for (let i = 0; i < encryptedData.length; i += CHUNK_SIZE) {
            chunks.push(encryptedData.slice(i, i + CHUNK_SIZE));
        }

        // 检查是否超过 sync 总容量
        const totalSize = chunks.reduce((sum, c) => sum + c.length, 0);
        if (totalSize > 90000) { // 预留 10KB 给设置和密钥
            throw new Error('QUOTA_EXCEEDED');
        }

        const data = {};
        chunks.forEach((chunk, i) => {
            data[`${SYNC_DATA_PREFIX}${i}`] = chunk;
        });
        data[`${SYNC_DATA_PREFIX}meta`] = { chunks: chunks.length, ts: Date.now() };

        return new Promise((resolve, reject) => {
            chrome.storage.sync.set(data, () => {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError);
                } else {
                    resolve();
                }
            });
        });
    }

    /**
     * 从 chrome.storage.sync 拉取加密数据
     */
    async function pull() {
        return new Promise((resolve) => {
            chrome.storage.sync.get(null, (all) => {
                const meta = all[`${SYNC_DATA_PREFIX}meta`];
                if (!meta) {
                    resolve(null);
                    return;
                }

                let data = '';
                for (let i = 0; i < meta.chunks; i++) {
                    const chunk = all[`${SYNC_DATA_PREFIX}${i}`];
                    if (chunk) data += chunk;
                }

                resolve(data || null);
            });
        });
    }

    /**
     * 获取同步元信息（最后同步时间等）
     */
    async function getMeta() {
        return new Promise((resolve) => {
            chrome.storage.sync.get([`${SYNC_DATA_PREFIX}meta`], (result) => {
                resolve(result[`${SYNC_DATA_PREFIX}meta`] || null);
            });
        });
    }

    /**
     * 清除所有同步分片
     */
    async function _clearSyncChunks() {
        return new Promise((resolve) => {
            chrome.storage.sync.get(null, (all) => {
                const keysToRemove = Object.keys(all).filter(k => k.startsWith(SYNC_DATA_PREFIX));
                if (keysToRemove.length === 0) {
                    resolve();
                    return;
                }
                chrome.storage.sync.remove(keysToRemove, resolve);
            });
        });
    }

    return { push, pull, getMeta };
})();
