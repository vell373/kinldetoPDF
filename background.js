// Service Worker for Kindle to PDF Extension

// グローバル状態管理
let captureState = {
  isCapturing: false,
  currentPage: 0,
  totalPages: 0,
  tabId: null,
  windowId: null,
  startPage: 1,
  endPage: 10,
  rtl: false, // true = 右開き（漫画・縦書き）
  autoDetect: false, // true = 終了ページ省略・重複検知で自動終了
  previousDataUrl: null, // 重複検知用：直前のスクリーンショット
  isPaused: false, // 一時停止中フラグ
  pauseRequested: false, // 現ページ完了後に一時停止を要求するフラグ
};

// sidepanel とのポート接続を保持
let sidepanelPort = null;

/**
 * サイドパネルを開く
 */
chrome.action.onClicked.addListener(async (tab) => {
  try {
    await chrome.sidePanel.open({ tabId: tab.id });
  } catch (error) {
    console.error("Failed to open side panel:", error);
  }
});

/**
 * sidepanel との接続管理
 */
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === "sidepanel") {
    sidepanelPort = port;

    port.onMessage.addListener(async (request) => {
      handleSidepanelMessage(request, port);
    });

    port.onDisconnect.addListener(() => {
      sidepanelPort = null;
      // キャプチャ中に切断された場合は停止
      if (captureState.isCapturing) {
        captureState.isCapturing = false;
      }
    });
  }
});

/**
 * sidepanel からのメッセージハンドリング
 */
async function handleSidepanelMessage(request, port) {
  try {
    switch (request.action) {
      case "getActiveTab":
        await handleGetActiveTab(port);
        break;

      case "startCapture":
        await handleStartCapture(request);
        break;

      case "pauseCapture":
        handlePauseCapture();
        break;

      case "resumeCapture":
        handleResumeCapture();
        break;

      case "finishCapture":
        handleFinishCapture();
        break;

      default:
        console.warn("Unknown action:", request.action);
    }
  } catch (error) {
    console.error("Error handling message:", error);
    if (port && port.postMessage) {
      port.postMessage({
        action: "captureError",
        error: error.message || "Unknown error",
      });
    }
  }
}

/**
 * アクティブタブ情報取得
 */
async function handleGetActiveTab(port) {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });

  if (port) {
    port.postMessage({
      action: "activeTabInfo",
      tab: tab,
    });
  }
}

/**
 * キャプチャ開始処理
 */
async function handleStartCapture(request) {
  const { tabId, startPage, endPage } = request;

  if (captureState.isCapturing) {
    throw new Error("キャプチャが既に実行中です");
  }

  // 状態初期化
  captureState.isCapturing = true;
  captureState.currentPage = startPage;
  captureState.totalPages = endPage;
  captureState.tabId = tabId;
  captureState.startPage = startPage;
  captureState.endPage = endPage;
  captureState.rtl = request.rtl || false;
  // endPage が 9999 は自動検出モード（sidepanel.js 側で設定）
  captureState.autoDetect = endPage >= 9999;
  captureState.previousDataUrl = null;
  captureState.isPaused = false;
  captureState.pauseRequested = false;

  // tab情報取得（windowId が必要）
  const tab = await chrome.tabs.get(tabId);
  if (!tab) {
    throw new Error("タブが見つかりません");
  }

  captureState.windowId = tab.windowId;

  // Kindleページ確認
  if (!tab.url.includes("read.amazon")) {
    throw new Error("Kindle Cloud Reader ページを開いてください");
  }

  // 拡張機能リロード後にcontent scriptが未注入の場合があるため動的に注入
  // content.js は多重ロード防止済み（window.__kindleToPdfLoaded）なので安全
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: ["content.js"],
    });
  } catch (e) {
    // 既に注入済みの場合などは無視
    console.warn("Content script injection skipped:", e.message);
  }

  // キャプチャループ開始
  await captureLoop();
}

/**
 * 一時停止要求：現在ページのスクショ完了後に停止
 */
function handlePauseCapture() {
  captureState.pauseRequested = true;
}

/**
 * 再開処理
 */
function handleResumeCapture() {
  captureState.isPaused = false;
  // captureLoop 内の waitIfPaused ポーリングが自動的に解除される
}

/**
 * 終了処理（プレビューへ遷移するための停止通知）
 */
function handleFinishCapture() {
  captureState.isCapturing = false;
  captureState.isPaused = false; // 一時停止中でも即終了できるよう解除
  captureState.pauseRequested = false;
  if (sidepanelPort) {
    sidepanelPort.postMessage({ action: "captureStopped" });
  }
}

// ページ遷移後の待機時間（ms）
// Kindleのレンダリング完了まで余裕を持たせる
const PAGE_TRANSITION_WAIT_MS = 2500;

/**
 * メインキャプチャループ
 */
async function captureLoop() {
  // 最初のページが表示されるまで待機
  await waitForPageLoad();

  try {
    while (
      captureState.isCapturing &&
      captureState.currentPage <= captureState.endPage
    ) {
      // 進捗更新
      if (sidepanelPort) {
        sidepanelPort.postMessage({
          action: "progressUpdate",
          current: captureState.currentPage,
          total: captureState.totalPages,
          autoDetect: captureState.autoDetect,
        });
      }

      // スクリーンショット取得（現在表示中のページを撮影）
      const dataUrl = await captureScreenshot();

      // 重複検知：前のページと同じ画像なら最終ページに到達したと判断
      if (captureState.previousDataUrl !== null && dataUrl === captureState.previousDataUrl) {
        if (sidepanelPort) {
          sidepanelPort.postMessage({
            action: "lastPageDetected",
            pageNumber: captureState.currentPage,
          });
        }
        break;
      }
      captureState.previousDataUrl = dataUrl;

      // sidepanel に送信
      if (sidepanelPort) {
        sidepanelPort.postMessage({
          action: "screenshotCaptured",
          pageNumber: captureState.currentPage,
          dataUrl: dataUrl,
        });
      }

      // スクリーンショット完了後に一時停止要求があれば一時停止
      if (captureState.pauseRequested) {
        captureState.isPaused = true;
        captureState.pauseRequested = false;
        if (sidepanelPort) {
          sidepanelPort.postMessage({
            action: "capturePaused",
            pageNumber: captureState.currentPage,
          });
        }
        // 再開 or 終了まで待機
        await waitIfPaused();
        if (!captureState.isCapturing) break;
        if (sidepanelPort) {
          sidepanelPort.postMessage({ action: "captureResumed" });
        }
      }

      // 最後のページでなければ次ページへ遷移して待機
      if (captureState.currentPage < captureState.endPage) {
        await turnPage();
        // content.js の MutationObserver による遷移検知に加えて
        // Kindleのレンダリング完了を確実に待つ
        await new Promise((resolve) =>
          setTimeout(resolve, PAGE_TRANSITION_WAIT_MS)
        );
      }

      captureState.currentPage++;
    }

    // 完了通知
    if (sidepanelPort && captureState.isCapturing) {
      sidepanelPort.postMessage({ action: "captureComplete" });
    }
  } catch (error) {
    console.error("Capture loop error:", error);
    if (sidepanelPort) {
      sidepanelPort.postMessage({
        action: "captureError",
        error: error.message || "キャプチャエラー",
      });
    }
  } finally {
    captureState.isCapturing = false;
  }
}

/**
 * 一時停止中は再開または終了まで待機する
 */
function waitIfPaused() {
  return new Promise((resolve) => {
    if (!captureState.isPaused) {
      resolve();
      return;
    }
    const check = setInterval(() => {
      if (!captureState.isPaused || !captureState.isCapturing) {
        clearInterval(check);
        resolve();
      }
    }, 100);
  });
}

/**
 * スクリーンショット取得
 * captureVisibleTab は指定ウィンドウの「アクティブタブ」を撮影するため、
 * キャプチャ前に Kindle タブを確実にアクティブにしてから撮影する
 */
async function captureScreenshot() {
  // Kindleタブをアクティブにする（ページ遷移中などに非アクティブになった場合の保険）
  await chrome.tabs.update(captureState.tabId, { active: true });

  return new Promise((resolve, reject) => {
    // captureVisibleTab の第1引数はwindowId（tabIdではない）
    chrome.tabs.captureVisibleTab(
      captureState.windowId,
      { format: "jpeg", quality: 80 },
      (dataUrl) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else if (dataUrl) {
          resolve(dataUrl);
        } else {
          reject(new Error("スクリーンショット取得失敗"));
        }
      }
    );
  });
}

/**
 * ページめくり（次ページボタンクリック）
 */
async function turnPage() {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(
      captureState.tabId,
      { action: "nextPage", rtl: captureState.rtl },
      (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else if (response && response.status === "success") {
          resolve();
        } else {
          reject(new Error("ページめくり失敗"));
        }
      }
    );
  });
}

/**
 * ページロード完了待機
 */
async function waitForPageLoad() {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(
      captureState.tabId,
      { action: "waitForLoad" },
      (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else if (response && response.status === "loaded") {
          resolve();
        } else {
          reject(new Error("ページロード待機失敗"));
        }
      }
    );
  });
}
