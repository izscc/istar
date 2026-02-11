/**
 * iStar 飞书多维表格同步模块
 * 明文存储，用户可在飞书中直接查看和搜索笔记
 */

const SyncFeishu = (() => {
    const API_BASE = 'https://open.feishu.cn/open-apis';

    /**
     * 获取飞书配置
     */
    async function _getConfig() {
        return new Promise((resolve) => {
            chrome.storage.sync.get(['_istar_settings'], (r) => {
                const settings = r._istar_settings || {};
                resolve(settings.feishuConfig || null);
            });
        });
    }

    /**
     * 获取飞书 Tenant Access Token
     */
    async function _getTenantToken(config) {
        const res = await fetch(`${API_BASE}/auth/v3/tenant_access_token/internal`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                app_id: config.appId,
                app_secret: config.appSecret
            })
        });
        const data = await res.json();
        return data.tenant_access_token;
    }

    /**
     * 推送明文数据到飞书多维表格
     * 每条笔记一行记录
     */
    async function push(plainData) {
        const config = await _getConfig();
        if (!config) throw new Error('飞书配置未设置');

        const token = await _getTenantToken(config);
        const { appToken, tableId } = config;

        // 先清除旧数据
        await _clearTable(token, appToken, tableId);

        // 逐条写入
        const records = [];
        for (const [domain, domainData] of Object.entries(plainData.domains || {})) {
            for (const [path, pageData] of Object.entries(domainData.pages || {})) {
                for (const note of pageData.notes) {
                    if (note.del) continue;
                    records.push({
                        fields: {
                            '域名': domain,
                            '页面路径': path,
                            '笔记内容': note.text,
                            '创建时间': note.ts,
                            '更新时间': note.uTs,
                            '笔记ID': note.id,
                            '已收藏': domainData.pinned ? '是' : '否'
                        }
                    });
                }
            }
        }

        // 分批次写入（飞书 API 限制每次 500 条）
        for (let i = 0; i < records.length; i += 500) {
            const batch = records.slice(i, i + 500);
            await fetch(
                `${API_BASE}/bitable/v1/apps/${appToken}/tables/${tableId}/records/batch_create`,
                {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ records: batch })
                }
            );
        }
    }

    /**
     * 从飞书多维表格拉取数据
     */
    async function pull() {
        try {
            const config = await _getConfig();
            if (!config) return null;

            const token = await _getTenantToken(config);
            const { appToken, tableId } = config;

            // 读取所有记录
            const allRecords = [];
            let pageToken = null;

            do {
                const url = new URL(`${API_BASE}/bitable/v1/apps/${appToken}/tables/${tableId}/records`);
                url.searchParams.set('page_size', '500');
                if (pageToken) url.searchParams.set('page_token', pageToken);

                const res = await fetch(url.toString(), {
                    headers: { Authorization: `Bearer ${token}` }
                });
                const data = await res.json();
                const items = data.data?.items || [];
                allRecords.push(...items);
                pageToken = data.data?.has_more ? data.data.page_token : null;
            } while (pageToken);

            // 将表格记录转为 iStar 数据模型
            const result = { v: 1, domains: {} };
            for (const record of allRecords) {
                const f = record.fields;
                const domain = f['域名'];
                const path = f['页面路径'];
                if (!domain || !path) continue;

                if (!result.domains[domain]) {
                    result.domains[domain] = { pinned: f['已收藏'] === '是', pages: {} };
                }
                if (!result.domains[domain].pages[path]) {
                    result.domains[domain].pages[path] = { notes: [] };
                }

                result.domains[domain].pages[path].notes.push({
                    id: f['笔记ID'] || _nanoid(),
                    text: f['笔记内容'] || '',
                    ts: f['创建时间'] || Date.now(),
                    uTs: f['更新时间'] || Date.now(),
                    del: false
                });
            }

            return result;
        } catch {
            return null;
        }
    }

    /**
     * 清除表格所有记录（全量覆盖前）
     */
    async function _clearTable(token, appToken, tableId) {
        try {
            // 获取所有 record_id
            const res = await fetch(
                `${API_BASE}/bitable/v1/apps/${appToken}/tables/${tableId}/records?page_size=500`,
                { headers: { Authorization: `Bearer ${token}` } }
            );
            const data = await res.json();
            const items = data.data?.items || [];
            if (items.length === 0) return;

            const recordIds = items.map(r => r.record_id);

            await fetch(
                `${API_BASE}/bitable/v1/apps/${appToken}/tables/${tableId}/records/batch_delete`,
                {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ records: recordIds })
                }
            );
        } catch {
            // 清除失败不影响写入
        }
    }

    function _nanoid() {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        let id = '';
        const values = crypto.getRandomValues(new Uint8Array(8));
        for (let i = 0; i < 8; i++) {
            id += chars[values[i] % chars.length];
        }
        return id;
    }

    return { push, pull };
})();
