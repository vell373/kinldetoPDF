/**
 * Kindle to PDF - サイドパネルロジック
 * UI制御、ユーザー入力、バックグラウンドスクリプト通信
 */

// グローバル状態
let capturedImages = [];
let isCapturing = false;
let isPaused = false;
let sidepanelPort = null;
let isRtl = false; // true = 右開き（漫画・縦書き）
let selectedProvider = "claude";

// プロバイダー設定
const PROVIDER_STORAGE_KEY = "kindleToPdf_provider";
const PROVIDER_CONFIG = {
  claude: {
    label: "Claude API キー",
    placeholder: "sk-ant-...",
    storageKey: "kindleToPdf_claudeKey",
    defaultModel: "claude-haiku-4-5-20251001",
    modelStorageKey: "kindleToPdf_claudeModel",
    modelPlaceholder: "claude-haiku-4-5-20251001",
  },
  openai: {
    label: "OpenAI API キー",
    placeholder: "sk-...",
    storageKey: "kindleToPdf_openaiKey",
    defaultModel: "gpt-4o-mini",
    modelStorageKey: "kindleToPdf_openaiModel",
    modelPlaceholder: "gpt-4o-mini",
  },
  gemini: {
    label: "Gemini API キー",
    placeholder: "AIzaSy...",
    storageKey: "kindleToPdf_geminiKey",
    defaultModel: "gemini-3.1-flash-lite-preview",
    modelStorageKey: "kindleToPdf_geminiModel",
    modelPlaceholder: "gemini-3.1-flash-lite-preview",
  },
};

// DOM要素キャッシュ
const elements = {
  startBtn: document.getElementById("startBtn"),
  stopBtn: document.getElementById("stopBtn"),
  finishBtn: document.getElementById("finishBtn"),
  endPage: document.getElementById("endPage"),
  filename: document.getElementById("filename"),
  apiKey: document.getElementById("apiKey"),
  apiKeyLabelText: document.getElementById("apiKeyLabelText"),
  modelName: document.getElementById("modelName"),
  modelNameLabelText: document.getElementById("modelNameLabelText"),
  progressSection: document.getElementById("progress"),
  progressText: document.getElementById("progressText"),
  progressFill: document.getElementById("progressFill"),
  statusMessage: document.getElementById("statusMessage"),
  logContainer: document.getElementById("logContainer"),
  dirLtr: document.getElementById("dirLtr"),
  dirRtl: document.getElementById("dirRtl"),
};

/**
 * 開き方向トグルの初期化
 */
function initDirectionToggle() {
  elements.dirLtr.addEventListener("click", () => setDirection(false));
  elements.dirRtl.addEventListener("click", () => setDirection(true));
}

function setDirection(rtl) {
  isRtl = rtl;
  elements.dirLtr.classList.toggle("active", !rtl);
  elements.dirRtl.classList.toggle("active", rtl);
}

/**
 * 初期化
 */
async function initialize() {
  // バックグラウンドスクリプトとの接続確立
  connectToBackground();

  // イベントリスナー登録
  elements.startBtn.addEventListener("click", handleStartCapture);
  elements.stopBtn.addEventListener("click", handlePauseResume);
  elements.finishBtn.addEventListener("click", handleFinishCapture);
  initDirectionToggle();
  initProviderToggle();

  // 保存済みプロバイダー・APIキー・モデル名を復元
  await loadApiKey();
  elements.apiKey.addEventListener("change", saveApiKey);
  elements.modelName.addEventListener("change", saveApiKey);

  // 初期ログ
  addLog("サイドパネル起動完了", "info");
}

/**
 * プロバイダートグルの初期化
 */
function initProviderToggle() {
  document.querySelectorAll(".provider-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (btn.dataset.provider === selectedProvider) return;
      await saveApiKey();
      selectedProvider = btn.dataset.provider;
      document.querySelectorAll(".provider-btn").forEach((b) =>
        b.classList.toggle("active", b.dataset.provider === selectedProvider)
      );
      await chrome.storage.local.set({ [PROVIDER_STORAGE_KEY]: selectedProvider });
      updateApiKeyField();
      // 切り替え先のキーとモデルを読み込む
      const config = PROVIDER_CONFIG[selectedProvider];
      const stored = await chrome.storage.local.get([config.storageKey, config.modelStorageKey]);
      elements.apiKey.value = stored[config.storageKey] || "";
      elements.modelName.value = stored[config.modelStorageKey] || "";
    });
  });
}

/**
 * APIキーフィールドのラベル・プレースホルダーを現在のプロバイダーに合わせて更新
 */
function updateApiKeyField() {
  const config = PROVIDER_CONFIG[selectedProvider];
  elements.apiKeyLabelText.textContent = config.label;
  elements.apiKey.placeholder = config.placeholder;
  elements.modelName.placeholder = config.modelPlaceholder;
}

/**
 * プロバイダー・APIキーをストレージから読み込む
 */
async function loadApiKey() {
  const stored = await chrome.storage.local.get([
    PROVIDER_STORAGE_KEY,
    "kindleToPdf_claudeKey",
    "kindleToPdf_openaiKey",
    "kindleToPdf_geminiKey",
    "kindleToPdf_claudeModel",
    "kindleToPdf_openaiModel",
    "kindleToPdf_geminiModel",
    "kindleToPdf_apiKey", // 旧バージョンとの互換性
  ]);

  if (stored[PROVIDER_STORAGE_KEY]) {
    selectedProvider = stored[PROVIDER_STORAGE_KEY];
    document.querySelectorAll(".provider-btn").forEach((btn) =>
      btn.classList.toggle("active", btn.dataset.provider === selectedProvider)
    );
  }
  updateApiKeyField();

  // 現在のプロバイダーのキーを読み込む（Claudeは旧キーにもフォールバック）
  const config = PROVIDER_CONFIG[selectedProvider];
  const key = stored[config.storageKey] ||
    (selectedProvider === "claude" ? stored.kindleToPdf_apiKey || "" : "");
  elements.apiKey.value = key;

  // 現在のプロバイダーのモデル名を読み込む
  const model = stored[config.modelStorageKey] || "";
  elements.modelName.value = model;
}

/**
 * 現在のプロバイダーのAPIキーとモデル名をストレージに保存する
 */
async function saveApiKey() {
  const config = PROVIDER_CONFIG[selectedProvider];
  await chrome.storage.local.set({
    [config.storageKey]: elements.apiKey.value.trim(),
    [config.modelStorageKey]: elements.modelName.value.trim(),
  });
}

/**
 * バックグラウンドスクリプトとのlong-lived connection確立
 */
function connectToBackground() {
  try {
    sidepanelPort = chrome.runtime.connect({ name: "sidepanel" });

    sidepanelPort.onMessage.addListener((message) => {
      handleBackgroundMessage(message);
    });

    sidepanelPort.onDisconnect.addListener(() => {
      sidepanelPort = null;
      if (isCapturing) {
        // キャプチャ中の切断は異常 → エラー表示してリセット
        showStatus("背景スクリプトとの接続が切断されました", "error");
        resetUI();
      } else {
        // MV3 Service Worker の休止による切断は正常。自動再接続する
        setTimeout(() => {
          if (!sidepanelPort) connectToBackground();
        }, 1000);
      }
    });

    addLog("バックグラウンドスクリプトに接続", "debug");
  } catch (error) {
    console.error("Failed to connect to background:", error);
    showStatus(
      "バックグラウンドスクリプトとの接続に失敗しました",
      "error"
    );
    // 接続失敗時もリトライ
    setTimeout(() => {
      if (!sidepanelPort) connectToBackground();
    }, 2000);
  }
}

/**
 * スクリーンショット開始ボタンのハンドラー
 */
async function handleStartCapture() {
  try {
    // バリデーション
    // endPage が空欄の場合は自動検出モード（9999 = 事実上無制限）
    const endPageRaw = elements.endPage.value.trim();
    const isAutoDetect = endPageRaw === "";
    const endPage = isAutoDetect ? 9999 : parseInt(endPageRaw, 10);

    if (!isAutoDetect && isNaN(endPage)) {
      showStatus("終了ページは数値で入力してください", "error");
      return;
    }

    if (!isAutoDetect && endPage < 1) {
      showStatus("終了ページは1以上である必要があります", "error");
      return;
    }

    // バックグラウンドスクリプトに開始指示
    if (!sidepanelPort) {
      connectToBackground();
    }

    // バックグラウンドスクリプトからアクティブタブ情報を取得
    const tab = await getActiveTabFromBackground();

    if (!tab) {
      showStatus("アクティブなタブが見つかりません", "error");
      return;
    }

    // Kindleページ確認
    if (!tab.url.includes("read.amazon")) {
      showStatus(
        "Kindle Cloud Reader のページ (read.amazon.com) を開いてください",
        "error"
      );
      return;
    }

    // UI更新
    capturedImages = [];
    isCapturing = true;
    isPaused = false;
    elements.startBtn.disabled = true;
    elements.stopBtn.disabled = false;
    elements.stopBtn.textContent = "一時停止";
    elements.stopBtn.classList.remove("btn-resume");
    elements.finishBtn.disabled = false;
    elements.progressSection.classList.remove("hidden");
    elements.endPage.disabled = true;
    elements.filename.disabled = true;

    showStatus("スクリーンショット開始...", "info");
    if (isAutoDetect) {
      addLog("最終ページまで自動検出でキャプチャ開始", "info");
    } else {
      addLog(`${endPage} ページまでキャプチャ開始`, "info");
    }

    sidepanelPort.postMessage({
      action: "startCapture",
      tabId: tab.id,
      startPage: 1,
      endPage: endPage,
      rtl: isRtl,
    });
  } catch (error) {
    console.error("Start capture error:", error);
    showStatus(`エラー: ${error.message}`, "error");
    resetUI();
  }
}

/**
 * 一時停止 / 再開トグルハンドラー
 */
function handlePauseResume() {
  if (isPaused) {
    // 再開
    isPaused = false;
    addLog("キャプチャを再開", "info");
    elements.stopBtn.textContent = "一時停止";
    elements.stopBtn.classList.remove("btn-resume");
    showStatus("キャプチャを再開しています...", "info");
    if (sidepanelPort) {
      sidepanelPort.postMessage({ action: "resumeCapture" });
    }
  } else {
    // 一時停止要求（現在ページのスクショ完了後に停止）
    addLog("現在ページ完了後に一時停止します", "warning");
    elements.stopBtn.disabled = true; // 停止確定まで連打防止
    showStatus("現在のページ完了後に一時停止します...", "warning");
    if (sidepanelPort) {
      sidepanelPort.postMessage({ action: "pauseCapture" });
    }
  }
}

/**
 * 終了ボタンのハンドラー（プレビューへ遷移）
 */
async function handleFinishCapture() {
  try {
    isCapturing = false;
    isPaused = false;
    addLog("ユーザーがキャプチャを終了", "warning");

    if (sidepanelPort) {
      sidepanelPort.postMessage({ action: "finishCapture" });
    }

    // キャプチャ済み画像があればプレビューを開く
    if (capturedImages.length > 0) {
      showStatus(
        `${capturedImages.length}ページをキャプチャ済み。プレビューを開いています...`,
        "info"
      );
      addLog(`終了時点で ${capturedImages.length} ページをキャプチャ済み`, "info");
      await openPreview();
    } else {
      showStatus("キャプチャを終了しました（キャプチャ画像なし）", "warning");
      resetUI();
    }
  } catch (error) {
    console.error("Finish capture error:", error);
    showStatus(`終了エラー: ${error.message}`, "error");
    resetUI();
  }
}

// アクティブタブ情報リクエスト用グローバル変数
let activeTabResolve = null;

/**
 * バックグラウンドスクリプトからアクティブタブ情報を取得（Promise版）
 */
function getActiveTabFromBackground() {
  return new Promise((resolve) => {
    activeTabResolve = resolve;
    sidepanelPort.postMessage({ action: "getActiveTab" });
  });
}

/**
 * バックグラウンドスクリプトからのメッセージハンドリング
 */
async function handleBackgroundMessage(message) {
  try {
    switch (message.action) {
      case "activeTabInfo":
        if (activeTabResolve) {
          activeTabResolve(message.tab);
          activeTabResolve = null;
        }
        break;

      case "screenshotCaptured":
        handleScreenshotCaptured(message);
        break;

      case "progressUpdate":
        handleProgressUpdate(message);
        break;

      case "lastPageDetected":
        addLog(`ページ ${message.pageNumber} で最終ページを検知（重複画像）`, "info");
        break;

      case "capturePaused":
        handleCapturePaused(message);
        break;

      case "captureResumed":
        handleCaptureResumed();
        break;

      case "captureComplete":
        await handleCaptureComplete();
        break;

      case "captureError":
        handleCaptureError(message);
        break;

      case "captureStopped":
        // 停止時のプレビュー処理はhandleStopCapture側で実施済み
        // UIが未リセットの場合（接続切れ等）に備えてフォールバックのみ
        if (isCapturing) resetUI();
        break;

      default:
        console.warn("Unknown message action:", message.action);
    }
  } catch (error) {
    console.error("Error handling background message:", error);
    showStatus(`メッセージ処理エラー: ${error.message}`, "error");
  }
}

/**
 * 一時停止完了（バックグラウンドからの通知）
 */
function handleCapturePaused(message) {
  isPaused = true;
  const page = message.pageNumber;
  addLog(`ページ ${page} 完了後に一時停止`, "warning");
  showStatus(`ページ ${page} で一時停止中。「再開」で続きから再開できます`, "warning");
  elements.stopBtn.textContent = "再開";
  elements.stopBtn.classList.add("btn-resume");
  elements.stopBtn.disabled = false;
}

/**
 * 再開完了（バックグラウンドからの通知）
 */
function handleCaptureResumed() {
  addLog("キャプチャを再開しました", "info");
  showStatus("キャプチャを再開しています...", "info");
}

/**
 * スクリーンショット受信
 */
function handleScreenshotCaptured(message) {
  const { pageNumber, dataUrl } = message;
  capturedImages.push({
    pageNumber: pageNumber,
    dataUrl: dataUrl,
  });

  addLog(`ページ ${pageNumber} をキャプチャ`, "debug");
}

/**
 * 進捗更新
 */
function handleProgressUpdate(message) {
  const { current, total, autoDetect } = message;

  if (autoDetect) {
    // 自動検出モードは終了ページ不明なので件数のみ表示、プログレスバーはアニメーション
    elements.progressText.textContent = `スクリーンショット中... (${current} ページ取得済み)`;
    elements.progressFill.style.width = "100%";
    elements.progressFill.classList.add("indeterminate");
  } else {
    const percent = Math.round((current / total) * 100);
    elements.progressText.textContent = `スクリーンショット中... (${current}/${total})`;
    elements.progressFill.style.width = `${percent}%`;
    elements.progressFill.classList.remove("indeterminate");
  }
}

/**
 * キャプチャ完了
 */
async function handleCaptureComplete() {
  try {
    addLog(`合計 ${capturedImages.length} ページをキャプチャ`, "info");
    showStatus("キャプチャ完了。プレビューを開いています...", "info");
    await openPreview();
  } catch (error) {
    console.error("Capture complete error:", error);
    showStatus(`完了エラー: ${error.message}`, "error");
    resetUI();
  }
}

/**
 * キャプチャエラー
 */
function handleCaptureError(message) {
  const { error } = message;
  showStatus(`キャプチャエラー: ${error}`, "error");
  addLog(`エラー: ${error}`, "error");
  resetUI();
}

/**
 * キャプチャ画像を chrome.storage.local に保存してプレビュータブを開く
 */
async function openPreview() {
  if (capturedImages.length === 0) {
    throw new Error("キャプチャ画像がありません");
  }

  capturedImages.sort((a, b) => a.pageNumber - b.pageNumber);

  const filename = sanitizeFilename(
    elements.filename.value.trim() || "kindle_book"
  );

  // ストレージに保存（preview.js が読み取る）
  await chrome.storage.local.set({
    kindleToPdf_preview: { images: capturedImages, filename },
  });

  // プレビュータブを開く
  const previewUrl = chrome.runtime.getURL("preview.html");
  await chrome.tabs.create({ url: previewUrl });

  showStatus("プレビュータブを開きました", "success");
  addLog("プレビュータブを開きました", "info");
  resetUI();
}

/**
 * ステータスメッセージ表示
 */
function showStatus(message, type = "info") {
  const { statusMessage } = elements;
  statusMessage.textContent = message;

  // 既存のクラスを削除
  statusMessage.className = "status-message show";

  // 種類に応じてクラス追加
  statusMessage.classList.add(`status-${type}`);
}

/**
 * UI リセット
 */
function resetUI() {
  isCapturing = false;
  isPaused = false;
  elements.startBtn.disabled = false;
  elements.stopBtn.disabled = true;
  elements.stopBtn.textContent = "一時停止";
  elements.stopBtn.classList.remove("btn-resume");
  elements.finishBtn.disabled = true;
  elements.progressSection.classList.add("hidden");
  elements.endPage.disabled = false;
  elements.filename.disabled = false;
  elements.progressFill.style.width = "0%";
  elements.progressFill.classList.remove("indeterminate");
  elements.progressText.textContent = "準備中...";
}


/**
 * ログに エントリを追加
 */
function addLog(message, level = "info") {
  const time = new Date().toLocaleTimeString("ja-JP");
  const entry = document.createElement("div");
  entry.className = `log-entry log-${level}`;
  entry.innerHTML = `<span class="log-timestamp">[${time}]</span> ${escapeHtml(message)}`;

  elements.logContainer.appendChild(entry);

  // ログを最新に保つ（スクロール）
  elements.logContainer.scrollTop = elements.logContainer.scrollHeight;

  // ログ数制限（最新100件）
  const logEntries = elements.logContainer.querySelectorAll(".log-entry");
  if (logEntries.length > 100) {
    logEntries[0].remove();
  }
}

/**
 * HTML エスケープ
 */
function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

/**
 * DOMContentLoaded イベント
 */
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initialize);
} else {
  initialize();
}

// ページアンロード時にポート切断
window.addEventListener("beforeunload", () => {
  if (sidepanelPort) {
    sidepanelPort.disconnect();
  }
});
