/**
 * iStar Service Worker (Background Script)
 * 负责：同步调度、右键菜单、快捷键、消息路由
 */

// 导入同步模块
importScripts(
    'lib/crypto.js',
    'lib/sync-chrome.js',
    'lib/sync-drive.js',
    'lib/sync-github.js',
    'lib/sync-feishu.js',
    'lib/sync-manager.js'
);

// ---- 安装/启动 ----

chrome.runtime.onInstalled.addListener(() => {
    // 创建右键菜单
    chrome.contextMenus.create({
        id: 'istar-save-selection',
        title: '保存到 iStar 网页便签',
        contexts: ['selection']
    });

    // 初始化默认设置
    chrome.storage.sync.get(['_istar_settings'], (result) => {
        if (!result._istar_settings) {
            chrome.storage.sync.set({
                _istar_settings: {
                    position: 'top-right',
                    displayMode: 'collapsed',
                    syncProvider: 'chrome',
                    githubToken: null,
                    feishuConfig: null,
                    driveEnabled: false
                }
            });
        }
    });
});

// 点击工具栏图标 → 打开侧边栏
chrome.action.onClicked.addListener((tab) => {
    chrome.sidePanel.open({ windowId: tab.windowId });
});

// 浏览器启动时拉取最新数据
chrome.runtime.onStartup.addListener(() => {
    SyncManager.pullFromRemote();
});

// ---- 右键菜单 ----

chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === 'istar-save-selection' && tab?.id) {
        chrome.tabs.sendMessage(tab.id, {
            type: 'SAVE_SELECTION',
            text: info.selectionText
        });
    }
});

// ---- 快捷键 ----

chrome.commands.onCommand.addListener((command, tab) => {
    if (command === 'toggle-panel' && tab?.id) {
        chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_PANEL' });
    }
});

// ---- 消息路由 ----

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    switch (msg.type) {
        case 'DATA_CHANGED':
            // 数据变更，触发防抖同步
            SyncManager.schedulePush();
            break;

        case 'OPEN_POPUP':
            // 打开侧边栏
            if (sender.tab) {
                chrome.sidePanel.open({ windowId: sender.tab.windowId });
            }
            break;

        case 'FORCE_SYNC':
            // 手动触发同步
            SyncManager.pushToRemote().then(() => {
                sendResponse({ ok: true });
            }).catch(err => {
                sendResponse({ ok: false, error: err.message });
            });
            return true; // 异步响应

        case 'PULL_SYNC':
            // 手动拉取
            SyncManager.pullFromRemote().then(() => {
                sendResponse({ ok: true });
            }).catch(err => {
                sendResponse({ ok: false, error: err.message });
            });
            return true;

        case 'EXPORT_DATA':
            // 导出数据
            _exportData().then(data => {
                sendResponse({ ok: true, data });
            });
            return true;
    }
});

// ---- 导出功能 ----

async function _exportData() {
    const encKey = await IStarCrypto.getOrCreateKey();
    return new Promise((resolve) => {
        chrome.storage.local.get(['_istar_data'], async (result) => {
            if (result._istar_data) {
                try {
                    const decrypted = await IStarCrypto.decrypt(result._istar_data, encKey);
                    const data = JSON.parse(decrypted);
                    // 转为 Markdown 格式
                    let md = '# iStar 网页便签导出\n\n';
                    md += `> 导出时间: ${new Date().toLocaleString()}\n\n`;

                    for (const [domain, domainData] of Object.entries(data.domains || {})) {
                        md += `## ${domain} ${domainData.pinned ? '⭐' : ''}\n\n`;
                        for (const [path, pageData] of Object.entries(domainData.pages || {})) {
                            const activeNotes = pageData.notes.filter(n => !n.del);
                            if (activeNotes.length === 0) continue;
                            md += `### ${path}\n\n`;
                            for (const note of activeNotes) {
                                const time = new Date(note.ts).toLocaleString();
                                md += `- ${note.text} _(${time})_\n`;
                            }
                            md += '\n';
                        }
                    }
                    resolve(md);
                } catch {
                    resolve('# 导出失败\n\n数据解密失败。');
                }
            } else {
                resolve('# 暂无数据');
            }
        });
    });
}
