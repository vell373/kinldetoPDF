/**
 * Kindle to PDF - サイドパネルロジック
 * UI制御、ユーザー入力、バックグラウンドスクリプト通信
 */

// グローバル状態
let capturedImages = [];
let isCapturing = false;
let sidepanelPort = null;
let isRtl = false; // true = 右開き（漫画・縦書き）

// DOM要素キャッシュ
const elements = {
  startBtn: document.getElementById("startBtn"),
  stopBtn: document.getElementById("stopBtn"),
  startPage: document.getElementById("startPage"),
  endPage: document.getElementById("endPage"),
  filename: document.getElementById("filename"),
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
function initialize() {
  // バックグラウンドスクリプトとの接続確立
  connectToBackground();

  // イベントリスナー登録
  elements.startBtn.addEventListener("click", handleStartCapture);
  elements.stopBtn.addEventListener("click", handleStopCapture);
  initDirectionToggle();

  // 初期ログ
  addLog("サイドパネル起動完了", "info");
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
      console.warn("Background connection disconnected");
      sidepanelPort = null;
      if (isCapturing) {
        showStatus("背景スクリプトとの接続が切断されました", "error");
        resetUI();
      }
    });

    addLog("バックグラウンドスクリプトに接続", "debug");
  } catch (error) {
    console.error("Failed to connect to background:", error);
    showStatus(
      "バックグラウンドスクリプトとの接続に失敗しました",
      "error"
    );
  }
}

/**
 * スクリーンショット開始ボタンのハンドラー
 */
async function handleStartCapture() {
  try {
    // バリデーション
    const startPage = parseInt(elements.startPage.value, 10);
    // endPage が空欄の場合は自動検出モード（9999 = 事実上無制限）
    const endPageRaw = elements.endPage.value.trim();
    const isAutoDetect = endPageRaw === "";
    const endPage = isAutoDetect ? 9999 : parseInt(endPageRaw, 10);

    if (isNaN(startPage)) {
      showStatus("開始ページは数値で入力してください", "error");
      return;
    }

    if (!isAutoDetect && isNaN(endPage)) {
      showStatus("終了ページは数値で入力してください", "error");
      return;
    }

    if (startPage < 1) {
      showStatus("開始ページは1以上である必要があります", "error");
      return;
    }

    if (!isAutoDetect && endPage < 1) {
      showStatus("終了ページは1以上である必要があります", "error");
      return;
    }

    if (!isAutoDetect && startPage > endPage) {
      showStatus("開始ページは終了ページ以下である必要があります", "error");
      return;
    }

    if (!isAutoDetect && endPage - startPage + 1 > 500) {
      showStatus("一度に最大500ページまでキャプチャできます", "error");
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
    elements.startBtn.disabled = true;
    elements.stopBtn.disabled = false;
    elements.progressSection.classList.remove("hidden");
    elements.startPage.disabled = true;
    elements.endPage.disabled = true;
    elements.filename.disabled = true;

    showStatus("スクリーンショット開始...", "info");
    if (isAutoDetect) {
      addLog(`${startPage} ページから最終ページまで自動検出でキャプチャ開始`, "info");
    } else {
      addLog(`${startPage} ページから ${endPage} ページまでキャプチャ開始`, "info");
    }

    sidepanelPort.postMessage({
      action: "startCapture",
      tabId: tab.id,
      startPage: startPage,
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
 * スクリーンショット停止ボタンのハンドラー
 */
async function handleStopCapture() {
  try {
    isCapturing = false;
    addLog("ユーザーがキャプチャを停止", "warning");

    if (sidepanelPort) {
      sidepanelPort.postMessage({ action: "stopCapture" });
    }

    // キャプチャ済み画像があればプレビューを開く
    if (capturedImages.length > 0) {
      showStatus(
        `${capturedImages.length}ページをキャプチャ済み。プレビューを開いています...`,
        "info"
      );
      addLog(`停止時点で ${capturedImages.length} ページをキャプチャ済み`, "info");
      await openPreview();
    } else {
      showStatus("キャプチャを停止しました（キャプチャ画像なし）", "warning");
      resetUI();
    }
  } catch (error) {
    console.error("Stop capture error:", error);
    showStatus(`停止エラー: ${error.message}`, "error");
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
  elements.startBtn.disabled = false;
  elements.stopBtn.disabled = true;
  elements.progressSection.classList.add("hidden");
  elements.startPage.disabled = false;
  elements.endPage.disabled = false;
  elements.filename.disabled = false;
  elements.progressFill.style.width = "0%";
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
