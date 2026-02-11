/**
 * iStar 加密模块
 * 使用 Web Crypto API 实现 AES-GCM 256 对称加密
 * 密钥自动生成并存于 chrome.storage.sync，随 Chrome 账号同步到所有设备
 */

const IStarCrypto = (() => {
  const ALGORITHM = 'AES-GCM';
  const KEY_LENGTH = 256;
  const IV_LENGTH = 12; // 96 bits，GCM 推荐值

  /**
   * 生成随机加密密钥并导出为 Base64
   */
  async function generateKey() {
    const key = await crypto.subtle.generateKey(
      { name: ALGORITHM, length: KEY_LENGTH },
      true, // 可导出
      ['encrypt', 'decrypt']
    );
    const exported = await crypto.subtle.exportKey('raw', key);
    return _arrayBufferToBase64(exported);
  }

  /**
   * 从 Base64 字符串导入密钥
   */
  async function _importKey(base64Key) {
    const raw = _base64ToArrayBuffer(base64Key);
    return crypto.subtle.importKey(
      'raw', raw,
      { name: ALGORITHM, length: KEY_LENGTH },
      false,
      ['encrypt', 'decrypt']
    );
  }

  /**
   * 加密明文字符串 → 返回 Base64 密文（iv + ciphertext）
   */
  async function encrypt(plaintext, base64Key) {
    if (!plaintext) return '';
    const key = await _importKey(base64Key);
    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
    const encoded = new TextEncoder().encode(plaintext);

    const ciphertext = await crypto.subtle.encrypt(
      { name: ALGORITHM, iv },
      key,
      encoded
    );

    // 将 iv 和密文拼接后转 Base64
    const combined = new Uint8Array(iv.length + ciphertext.byteLength);
    combined.set(iv);
    combined.set(new Uint8Array(ciphertext), iv.length);
    return _arrayBufferToBase64(combined.buffer);
  }

  /**
   * 解密 Base64 密文 → 返回明文字符串
   */
  async function decrypt(base64Cipher, base64Key) {
    if (!base64Cipher) return '';
    const key = await _importKey(base64Key);
    const combined = new Uint8Array(_base64ToArrayBuffer(base64Cipher));

    // 拆分 iv 和密文
    const iv = combined.slice(0, IV_LENGTH);
    const ciphertext = combined.slice(IV_LENGTH);

    const decrypted = await crypto.subtle.decrypt(
      { name: ALGORITHM, iv },
      key,
      ciphertext
    );

    return new TextDecoder().decode(decrypted);
  }

  /**
   * 获取或初始化加密密钥
   * 优先从 chrome.storage.sync 读取，不存在则自动生成
   */
  async function getOrCreateKey() {
    return new Promise((resolve) => {
      chrome.storage.sync.get(['_istar_enc_key'], async (result) => {
        if (result._istar_enc_key) {
          resolve(result._istar_enc_key);
        } else {
          const newKey = await generateKey();
          chrome.storage.sync.set({ _istar_enc_key: newKey }, () => {
            resolve(newKey);
          });
        }
      });
    });
  }

  // ---- 工具函数 ----

  function _arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  function _base64ToArrayBuffer(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }

  return {
    generateKey,
    encrypt,
    decrypt,
    getOrCreateKey
  };
})();
