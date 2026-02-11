/**
 * iStar 轻量 Markdown 解析器
 * 支持：标题、加粗、斜体、行内代码、代码块、无序列表、有序列表、链接、#标签
 */

const IStarMarkdown = (() => {
    /**
     * 将 Markdown 文本转为 HTML
     */
    function render(md) {
        if (!md) return '';

        // 转义 HTML 特殊字符
        let html = _escapeHtml(md);

        // 代码块（```...```）
        html = html.replace(/```([\s\S]*?)```/g, '<pre class="istar-code-block"><code>$1</code></pre>');

        // 按行处理
        const lines = html.split('\n');
        const result = [];
        let inList = false;
        let listType = '';

        for (let i = 0; i < lines.length; i++) {
            let line = lines[i];

            // 标题
            if (line.match(/^### (.+)/)) {
                if (inList) { result.push(`</${listType}>`); inList = false; }
                result.push(`<h4 class="istar-h4">${line.replace(/^### /, '')}</h4>`);
                continue;
            }
            if (line.match(/^## (.+)/)) {
                if (inList) { result.push(`</${listType}>`); inList = false; }
                result.push(`<h3 class="istar-h3">${line.replace(/^## /, '')}</h3>`);
                continue;
            }
            if (line.match(/^# (.+)/)) {
                if (inList) { result.push(`</${listType}>`); inList = false; }
                result.push(`<h2 class="istar-h2">${line.replace(/^# /, '')}</h2>`);
                continue;
            }

            // 无序列表
            if (line.match(/^[-*] (.+)/)) {
                if (!inList || listType !== 'ul') {
                    if (inList) result.push(`</${listType}>`);
                    result.push('<ul class="istar-list">');
                    inList = true;
                    listType = 'ul';
                }
                result.push(`<li>${_inlineFormat(line.replace(/^[-*] /, ''))}</li>`);
                continue;
            }

            // 有序列表
            if (line.match(/^\d+\. (.+)/)) {
                if (!inList || listType !== 'ol') {
                    if (inList) result.push(`</${listType}>`);
                    result.push('<ol class="istar-list">');
                    inList = true;
                    listType = 'ol';
                }
                result.push(`<li>${_inlineFormat(line.replace(/^\d+\. /, ''))}</li>`);
                continue;
            }

            // 普通行
            if (inList) { result.push(`</${listType}>`); inList = false; }
            if (line.trim()) {
                result.push(`<p class="istar-p">${_inlineFormat(line)}</p>`);
            }
        }

        if (inList) result.push(`</${listType}>`);
        return result.join('');
    }

    /**
     * 行内格式处理
     */
    function _inlineFormat(text) {
        // 行内代码
        text = text.replace(/`([^`]+)`/g, '<code class="istar-inline-code">$1</code>');
        // 加粗
        text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        // 斜体
        text = text.replace(/\*(.+?)\*/g, '<em>$1</em>');
        // 链接
        text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener" class="istar-link">$1</a>');
        // #标签
        text = text.replace(/#([^\s#]+)/g, '<span class="istar-tag">#$1</span>');
        return text;
    }

    /**
     * HTML 特殊字符转义
     */
    function _escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * 从文本中提取 #标签
     */
    function extractTags(text) {
        if (!text) return [];
        const matches = text.match(/#([^\s#]+)/g);
        return matches ? matches.map(t => t.slice(1)) : [];
    }

    return { render, extractTags };
})();
