/**
 * APIキー暗号化ユーティリティ
 * AES-GCM を使用してAPIキーを暗号化し、chrome.storage.session に保存する。
 * 暗号化キー自体もセッションストレージに保持するため、ブラウザセッション終了時に自動破棄される。
 */

const CRYPTO_KEY_STORAGE_KEY = "kindleToPdf_cryptoKey";

async function getOrCreateEncryptionKey() {
  const stored = await chrome.storage.session.get(CRYPTO_KEY_STORAGE_KEY);
  if (stored[CRYPTO_KEY_STORAGE_KEY]) {
    return await crypto.subtle.importKey(
      "jwk",
      stored[CRYPTO_KEY_STORAGE_KEY],
      { name: "AES-GCM", length: 256 },
      true,
      ["encrypt", "decrypt"]
    );
  }
  const key = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );
  const jwk = await crypto.subtle.exportKey("jwk", key);
  await chrome.storage.session.set({ [CRYPTO_KEY_STORAGE_KEY]: jwk });
  return key;
}

async function encryptApiKey(plaintext) {
  if (!plaintext) return "";
  const key = await getOrCreateEncryptionKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded);
  return JSON.stringify({
    iv: btoa(String.fromCharCode(...iv)),
    data: btoa(String.fromCharCode(...new Uint8Array(ciphertext))),
  });
}

async function decryptApiKey(encrypted) {
  if (!encrypted) return "";
  try {
    const { iv, data } = JSON.parse(encrypted);
    const key = await getOrCreateEncryptionKey();
    const ivBytes = Uint8Array.from(atob(iv), (c) => c.charCodeAt(0));
    const dataBytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: ivBytes },
      key,
      dataBytes
    );
    return new TextDecoder().decode(plaintext);
  } catch {
    return "";
  }
}
