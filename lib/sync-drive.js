/**
 * iStar Google Drive 同步模块
 * 使用 chrome.identity 一键 OAuth，存储为加密 JSON 文件
 */

const SyncDrive = (() => {
    const FILE_NAME = 'istar-memo.enc';
    const MIME_TYPE = 'application/json';

    /**
     * 获取 OAuth Token（一键授权弹窗）
     */
    async function _getToken() {
        return new Promise((resolve, reject) => {
            chrome.identity.getAuthToken({ interactive: true }, (token) => {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError);
                } else {
                    resolve(token);
                }
            });
        });
    }

    /**
     * 查找已有的同步文件 ID
     */
    async function _findFileId(token) {
        const query = encodeURIComponent(`name='${FILE_NAME}' and trashed=false`);
        const res = await fetch(
            `https://www.googleapis.com/drive/v3/files?q=${query}&spaces=appDataFolder`,
            { headers: { Authorization: `Bearer ${token}` } }
        );
        const data = await res.json();
        return data.files && data.files.length > 0 ? data.files[0].id : null;
    }

    /**
     * 推送加密数据到 Google Drive
     */
    async function push(encryptedData) {
        const token = await _getToken();
        const fileId = await _findFileId(token);

        const metadata = {
            name: FILE_NAME,
            mimeType: MIME_TYPE
        };

        const body = new Blob([encryptedData], { type: MIME_TYPE });

        if (fileId) {
            // 更新已有文件
            await fetch(
                `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`,
                {
                    method: 'PATCH',
                    headers: { Authorization: `Bearer ${token}` },
                    body
                }
            );
        } else {
            // 创建新文件（存入 appDataFolder，用户不可见但安全）
            metadata.parents = ['appDataFolder'];
            const form = new FormData();
            form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
            form.append('file', body);

            await fetch(
                'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
                {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${token}` },
                    body: form
                }
            );
        }
    }

    /**
     * 从 Google Drive 拉取加密数据
     */
    async function pull() {
        try {
            const token = await _getToken();
            const fileId = await _findFileId(token);
            if (!fileId) return null;

            const res = await fetch(
                `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
                { headers: { Authorization: `Bearer ${token}` } }
            );
            return await res.text();
        } catch {
            return null;
        }
    }

    return { push, pull };
})();
