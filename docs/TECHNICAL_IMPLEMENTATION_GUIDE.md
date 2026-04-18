# Kindle to PDF Chrome Extension - 実装ガイド

## 目次

1. [クイックスタート](#クイックスタート)
2. [データフロー](#データフロー)
3. [API リファレンス](#apiリファレンス)
4. [実装チェックリスト](#実装チェックリスト)
5. [デバッグのコツ](#デバッグのコツ)
6. [トラブルシューティング](#トラブルシューティング)

---

## クイックスタート

### 1. 最小限の構成

以下のファイルが必須です：

```
kindle-to-pdf/
├── manifest.json
├── popup.html
├── popup.js
├── background.js
├── content.js
└── utils.js
```

### 2. manifest.json の基本構造

```json
{
  "manifest_version": 3,
  "name": "Kindle to PDF",
  "version": "1.0.0",
  "description": "Kindle Cloud Reader をスクリーンショットして PDF に変換",
  "permissions": ["tabs", "activeTab", "downloads", "scripting"],
  "host_permissions": [
    "https://read.amazon.com/*",
    "https://read.amazon.co.jp/*"
  ],
  "background": {
    "service_worker": "background.js"
  },
  "action": {
    "default_popup": "popup.html",
    "default_icon": {
      "16": "icons/icon_16.png",
      "48": "icons/icon_48.png",
      "128": "icons/icon_128.png"
    }
  }
}
```

**重要**: Manifest V3 では `background.service_worker` を使用（従来の `background_page` は非推奨）

---

## データフロー

### スクリーンショット→PDF 生成の流れ

```
ユーザー入力（popup.js）
    ↓
background.js へイベント送信
    ↓
content.js が Kindle ページ内容を取得
    ↓
スクリーンショット（chrome.tabs.captureVisibleTab）
    ↓
画像配列を保持（メモリ管理）
    ↓
ページめくり（content.js → 次ページボタンをクリック）
    ↓
ループ終了後、jsPDF + html2canvas で PDF 生成
    ↓
chrome.downloads.download() でダウンロード
```

---

## API リファレンス

### chrome.tabs.captureVisibleTab()

**用途**: アクティブなタブのスクリーンショットを PNG 形式で取得

**構文**:
```javascript
chrome.tabs.captureVisibleTab(
  tabId,
  { format: "png", quality: 90 },
  (screenshotUrl) => {
    // dataURL 形式（data:image/png;base64,...)
    console.log(screenshotUrl);
  }
);
```

**戻り値**: Base64 エンコード済みのデータURL

**制約**:
- Chrome 90 以上
- 権限: `activeTab` 必須
- クロスオリジン制限あり（同一オリジンのみ）

---

### chrome.tabs.sendMessage()

**用途**: コンテンツスクリプトへメッセージを送信

**構文**:
```javascript
chrome.tabs.sendMessage(
  tabId,
  { action: "nextPage", pageNumber: 5 },
  (response) => {
    console.log("Response:", response);
  }
);
```

**コンテンツスクリプト側**:
```javascript
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "nextPage") {
    // ページめくり処理
    sendResponse({ status: "success", pageLoaded: true });
  }
});
```

---

### chrome.downloads.download()

**用途**: ファイルをダウンロード（PDF等）

**構文**:
```javascript
const pdfBlob = new Blob([pdfData], { type: "application/pdf" });
const blobUrl = URL.createObjectURL(pdfBlob);

chrome.downloads.download({
  url: blobUrl,
  filename: "kindle_book.pdf",
  saveAs: true  // 保存先を選択させる
});
```

---

## 実装チェックリスト

### Phase 1: UI 実装

- [ ] manifest.json で `popup.html` を指定
- [ ] popup.html に入力フィールド（開始/終了ページ）を実装
- [ ] popup.js でボタンクリックイベント実装
- [ ] popup.css でレスポンシブレイアウト実装
- [ ] popup.js から background.js へメッセージ送信テスト済み

### Phase 2: スクリーンショット自動化

- [ ] background.js に基本的なスクリーンショット関数実装
- [ ] content.js で Kindle ページのDOM解析実装
- [ ] content.js でページめくりボタン検出・クリック実装
- [ ] chrome.tabs.sendMessage() で双方向通信テスト済み
- [ ] メモリ泄漏対策：画像配列のクリア機能実装

### Phase 3: PDF生成とダウンロード

- [ ] jsPDF ライブラリをpopup.html に読み込み
- [ ] utils.js で PDF生成関数実装
- [ ] 画像→PDF変換のテスト（複数ページ対応）
- [ ] メタデータ（タイトル、作者）の埋め込み実装
- [ ] chrome.downloads.download() でダウンロード確認
- [ ] 単位テスト・統合テスト実施

### テスト

- [ ] Chrome DevTools でエラーメッセージがない
- [ ] 5ページでのテスト実施（正常動作確認）
- [ ] 100ページでのテスト実施（パフォーマンス確認）
- [ ] PDF ファイルの再生確認（Adobe Reader等）

---

## デバッグのコツ

### popup.js のデバッグ

popup.js 内のコンソール出力は、**拡張機能マネージャー** からのみ確認できます：

1. Chrome で `chrome://extensions/` を開く
2. 対象拡張機能の「詳細」→「検査ビュー」をクリック
3. DevTools でコンソール出力を確認

```javascript
console.log("Debug:", data);  // ここの出力がポップアップには表示されない
```

### background.js のデバッグ

background.js（Service Worker）のデバッグ：

1. Chrome で `chrome://extensions/` を開く
2. 対象拡張機能の「詳細」→「Service Worker を検査」をクリック
3. DevTools でブレークポイント設定、ステップ実行可能

### content.js のデバッグ

content.js のデバッグは **ページのコンソール** で確認：

1. Kindle Cloud Reader ページで `F12` を開く
2. Console タブで出力を確認

```javascript
console.log("Content script running");
```

### メッセージの検証

background.js と content.js 間のメッセージをデバッグ：

```javascript
// background.js
chrome.tabs.sendMessage(tabId, { action: "test" }, (response) => {
  console.log("Background received:", response);
});

// content.js
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log("Content received:", request);
  sendResponse({ status: "ok" });
});
```

---

## トラブルシューティング

### 問題: 拡張機能がロードされない

**原因**: manifest.json の構文エラー

**解決方法**:
1. manifest.json を JSON バリデーター で検証
2. `chrome://extensions/` で詳細エラーを確認
3. Service Worker のエラーログを確認

### 問題: スクリーンショットが真っ黒

**原因**:
- ページのロードが完了していない
- 権限不足

**解決方法**:
```javascript
// ページロード完了を待つ
setTimeout(() => {
  chrome.tabs.captureVisibleTab(...);
}, 1000);  // 1秒待機
```

### 問題: ページめくりが動作しない

**原因**: Kindle UI の DOM 構造が変更

**デバッグ方法**:
```javascript
// content.js で DOM 構造を確認
console.log(document.body.innerHTML);  // ページ全体のHTML確認

// ボタンの検出確認
const nextButton = document.querySelector('[aria-label="Next page"]');
console.log("Next button found:", nextButton);
```

### 問題: PDF 生成が遅い

**原因**: メモリ不足、画像品質が高すぎる

**最適化方法**:
```javascript
// 画像品質を下げる
chrome.tabs.captureVisibleTab(tabId, { format: "jpeg", quality: 60 }, ...);

// 画像をBase64で保持せず、IndexedDB に一時保存
await db.images.put({ pageNum: i, data: screenshotUrl });
```

### 問題: ダウンロードが開始されない

**原因**: `downloads` 権限不足、または Blob URL の生成エラー

**解決方法**:
```javascript
// manifest.json で権限を確認
"permissions": ["downloads"]

// Blob URL が正しく生成されているか確認
const blob = new Blob([pdfData], { type: "application/pdf" });
console.log("Blob URL:", URL.createObjectURL(blob));
```

---

## 外部ライブラリの使用

### jsPDF（PDF生成）

**CDN リンク**:
```html
<script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script>
```

**基本的な使用方法**:
```javascript
const pdf = new jsPDF();
const imgData = "data:image/png;base64,...";  // Base64 image
pdf.addImage(imgData, "PNG", 10, 10, 190, 270);
pdf.save("document.pdf");
```

### html2canvas（DOM を画像化）

**CDN リンク**:
```html
<script src="https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"></script>
```

**使用方法**:
```javascript
html2canvas(document.body).then((canvas) => {
  const imgData = canvas.toDataURL("image/png");
  console.log(imgData);
});
```

---

## ファイルサイズとパフォーマンス

### PNG vs JPEG

| 形式 | ファイルサイズ | 品質 | 用途 |
|------|----------------|------|------|
| PNG | 大（非圧縮） | 無損失 | テキスト中心の書籍 |
| JPEG | 小（圧縮） | 有損失 | イラスト・漫画 |

**推奨**: JPEG（品質70〜80）で バランスの取れた品質とサイズ

### メモリ管理

100ページのスクリーンショット（各4MB相当）= 約400MB のメモリ消費

**対策**:
- IndexedDB での一時保存
- ストリーミング処理（batch処理）
- ガベージコレクション明示的呼び出し

```javascript
// 不要な参照を削除
images = [];
screenshotData = null;
```

---

## Chrome Web Store への公開

このガイドは個人用途の実装を想定しています。Web Store への公開には：

- プライバシーポリシーの記載
- 権限の正当性説明
- テストアカウントの提供
- スクリーンショット・説明文の提出

が必要となります。

詳細は [Chrome Web Store に関するドキュメント](https://developer.chrome.com/docs/webstore/) を参照してください。

---

## 参考リンク

- [Chrome Extensions Documentation](https://developer.chrome.com/docs/extensions/)
- [Manifest V3 Migration Guide](https://developer.chrome.com/docs/extensions/mv3/mv3-migration/)
- [jsPDF Documentation](https://github.com/parallax/jsPDF)
- [html2canvas Documentation](https://html2canvas.hertzen.com/)
- [Kindle Cloud Reader](https://read.amazon.com)

