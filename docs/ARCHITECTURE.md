# Kindle to PDF Chrome Extension - アーキテクチャ

## プロジェクト概要

Kindle to PDFは、Kindle Cloud Reader からスクリーンショットを取得してPDFファイルに変換するChrome拡張機能です。

Manifest v3対応のモダンなChrome拡張機能として実装されています。

---

## ディレクトリ構成

```
kinldetoPDF/
├── src/                              # ソースコード
│   ├── background.js                 # Service Worker（バックグラウンド処理）
│   ├── content.js                    # Content Script（Kindleページ上で実行）
│   ├── sidepanel.js                  # サイドパネルの処理
│   ├── sidepanel.html                # サイドパネルUI
│   ├── sidepanel.css                 # サイドパネルスタイル
│   ├── preview.js                    # プレビュー画面の処理
│   ├── preview.html                  # プレビュー画面UI
│   ├── preview.css                   # プレビュー画面スタイル
│   └── utils.js                      # ユーティリティ関数
├── public/                           # 設定・リソース
│   ├── manifest.json                 # 拡張機能のマニフェスト
│   ├── icons/                        # 拡張機能のアイコン
│   │   ├── icon_16.png
│   │   ├── icon_48.png
│   │   └── icon_128.png
│   └── lib/                          # 外部ライブラリ
│       └── jspdf.umd.min.js          # PDF生成ライブラリ
├── docs/                             # ドキュメント
│   ├── ARCHITECTURE.md               # このファイル
│   ├── Kindle_to_PDF_Chrome_Extension_SPEC.md
│   └── TECHNICAL_IMPLEMENTATION_GUIDE.md
├── .gitignore
├── LICENSE                           # MITライセンス
└── README.md
```

---

## アーキテクチャ構成

### 1. Service Worker（background.js）

Chrome拡張機能のバックグラウンドで動作する永続的なワーカー。

**主な責務：**
- Content Script と Side Panel 間のメッセージ仲介
- キャプチャ処理の状態管理（isCapturing, currentPage, totalPages など）
- タブの切り替え、ウィンドウ管理
- 一時停止・再開機能の制御

**通信相手：**
- Content Script → メッセージでキャプチャイベント受信
- Side Panel → ポート接続でリアルタイム通信

### 2. Content Script（content.js）

Kindle Cloud Reader（https://read.amazon.com, https://read.amazon.co.jp）で実行されるスクリプト。

**主な責務：**
- ページ要素のスクリーンショット取得（html2canvas など）
- Kindle固有のDOM操作
- Service Worker へのメッセージ送信（キャプチャ完了時など）

### 3. Side Panel UI（sidepanel.html / sidepanel.js / sidepanel.css）

Chrome拡張機能のサイドパネルで表示されるUI。

**主な責務：**
- キャプチャ開始・停止・一時停止ボタンの操作
- ページ数指定（開始ページ・終了ページ）
- オプション設定（RTL対応、自動検知など）
- キャプチャ進捗の表示
- プレビュー画面への遷移

**通信：**
- Service Worker とポート接続で状態同期

### 4. Preview Window（preview.html / preview.js / preview.css）

キャプチャ結果を表示するウィンドウ。

**主な責務：**
- 取得したスクリーンショットのプレビュー
- 画像の並び替え・削除機能
- ドラッグアンドドロップ対応
- PDF変換処理の実行

**通信：**
- Service Worker 経由でデータ取得

### 5. ユーティリティ（utils.js）

共通処理を集約したモジュール。

**主な責務：**
- 画像データの変換・圧縮
- PDF生成ロジック（jsPDF を利用）
- DOM操作のヘルパー関数

---

## データフロー

### キャプチャ処理のフロー

```
User clicks extension icon
  ↓
[Service Worker]
  - chrome.sidePanel.open() で Side Panel を表示
  ↓
[Side Panel]
  - 設定項目入力（ページ数、RTL対応など）
  - 「キャプチャ開始」ボタンクリック
  ↓
[Service Worker] ← Side Panel がメッセージ送信
  - captureState を更新
  - Content Script へ実行指示
  ↓
[Content Script] ← Service Worker がメッセージ送信
  - Kindle ページをスクリーンショット（html2canvas）
  - キャプチャ完了 → Service Worker へ通知
  ↓
[Service Worker]
  - captureState を進行状況に応じて更新
  - Side Panel へメッセージで進捗通知
  - 全ページ完了まで繰り返し
  ↓
[Side Panel]
  - 進捗バーを更新
  - 完了時に Preview Window へ移動（chrome.runtime.getURL）
  ↓
[Preview Window]
  - キャプチャ画像を表示
  - 並び替え・削除可能
  - PDF変換（jsPDF）
  - ダウンロード
```

### メッセージプロトコル

#### Service Worker ↔ Content Script

**Content Script → Service Worker：**
- `captureScreenshot`: スクリーンショット取得完了を通知

**Service Worker → Content Script：**
- `captureImage`: キャプチャ実行指示
- `stopCapture`: キャプチャ中止指示

#### Service Worker ↔ Side Panel

**ポート接続：**
- name: `"sidepanel"`

**Side Panel → Service Worker：**
- `startCapture`: キャプチャ開始
- `stopCapture`: キャプチャ停止
- `pauseCapture`: 一時停止
- `resumeCapture`: 再開

**Service Worker → Side Panel：**
- `statusUpdate`: 進捗情報（currentPage, totalPages など）

---

## 主要な機能

### 1. ページキャプチャ

複数ページのスクリーンショットを連続取得。

**オプション：**
- **開始ページ・終了ページ**: 指定範囲のみキャプチャ
- **RTL対応**: 右開き（漫画・縦書き）の反転対応
- **自動検知**: 最終ページを自動検出（重複スクリーンショット判定）

### 2. 一時停止・再開

キャプチャ中に一時停止し、後で再開可能。

**実装：**
- `isPaused`: 一時停止フラグ
- `pauseRequested`: 次ページ完了後に一時停止を要求するフラグ

### 3. PDF生成

jsPDF ライブラリを使用。

**処理：**
- 各スクリーンショットをA4サイズで配置
- 縦向き・横向き自動判定
- メタデータ（タイトル、著者）設定可能

### 4. 画像編集（Preview）

ドラッグアンドドロップで並び替え、削除機能。

---

## 技術的な制約

- **Manifest v3**: Chrome 88 以上対応
- **Service Worker**: Manifest v3で Content Script と通信するには、メッセージパッシングが必須（同期処理不可）
- **外部スクリプト**: Content Script はインラインで実行（CSPルール）
- **Cross-Origin**: 許可ドメイン（read.amazon.com, read.amazon.co.jp）のみターゲット

---

## 拡張・カスタマイズポイント

1. **対応言語・リージョン追加**: `manifest.json` の `content_scripts.matches` を編集
2. **レイアウト変更**: `sidepanel.css`, `preview.css` を変更
3. **PDF属性カスタマイズ**: `utils.js` の jsPDF 設定を編集
4. **新機能追加**: 状態管理（captureState）の拡張、メッセージプロトコルの追加

---

## 参考ドキュメント

- [Chrome Extension Documentation](https://developer.chrome.com/docs/extensions/)
- [Manifest V3 Migration Guide](https://developer.chrome.com/docs/extensions/mv3/mv2-migration/)
- [jsPDF Documentation](https://github.com/parallax/jsPDF)
