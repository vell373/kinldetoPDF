// Content Script for Kindle Cloud Reader

// 多重ロード防止
if (window.__kindleToPdfLoaded) {
  // 既にロード済み
} else {
  window.__kindleToPdfLoaded = true;

  /**
   * バックグラウンドスクリプトからのメッセージ受信
   */
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    (async () => {
      try {
        switch (request.action) {
          case "nextPage":
            await handleNextPage();
            sendResponse({ status: "success" });
            break;

          case "waitForLoad":
            await handleWaitForLoad();
            sendResponse({ status: "loaded" });
            break;

          case "getBookInfo":
            const info = getBookInfo();
            sendResponse(info);
            break;

          default:
            sendResponse({ status: "unknown" });
        }
      } catch (error) {
        console.error("Content script error:", error);
        sendResponse({ status: "error", error: error.message });
      }
    })();

    // 非同期レスポンスを使うので true を返す
    return true;
  });

  /**
   * 次ページに進む
   * 表紙では右側クリックが効かないため、変化がなければ中央クリックでリトライする
   */
  async function handleNextPage() {
    // 方法1: 本文用（右側クリック + ArrowRight）
    clickForBookContent();
    const changed = await waitForPageTransitionWithResult(2000);

    if (!changed) {
      // ページ変化なし = 表紙など特殊なページ。中央クリック + Enter で再試行
      clickForCoverPage();
      await waitForPageTransitionWithResult(3000);
    }
  }

  /**
   * 本文ページ用の遷移：右側クリック + ArrowRight キーイベント
   */
  function clickForBookContent() {
    const x = window.innerWidth * 0.8;
    const y = window.innerHeight * 0.5;
    const el = document.elementFromPoint(x, y);
    if (el) {
      el.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          clientX: x,
          clientY: y,
          view: window,
        })
      );
    }

    const focusTarget =
      document.querySelector("#kindleReader") ||
      document.querySelector('[id*="Reader"]') ||
      document.querySelector('[class*="reader"]') ||
      document.body;

    if (typeof focusTarget.focus === "function") focusTarget.focus();

    const arrowRight = {
      key: "ArrowRight",
      code: "ArrowRight",
      keyCode: 39,
      bubbles: true,
      cancelable: true,
      view: window,
    };
    [focusTarget, document.documentElement, document].forEach((t) => {
      t.dispatchEvent(new KeyboardEvent("keydown", arrowRight));
      t.dispatchEvent(new KeyboardEvent("keyup", arrowRight));
    });
  }

  /**
   * 表紙用の遷移：中央クリック + Enter / Space キーイベント
   * 表紙では「右側クリック」が効かないため、中央付近のクリックで本文へ進む
   */
  function clickForCoverPage() {
    const x = window.innerWidth * 0.5;
    const y = window.innerHeight * 0.5;
    const el = document.elementFromPoint(x, y);
    if (el) {
      el.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          clientX: x,
          clientY: y,
          view: window,
        })
      );
    }

    // Enter と Space でも試みる（Kindleの表紙は Enter/Space で開く場合がある）
    [
      { key: "Enter", code: "Enter", keyCode: 13 },
      { key: " ", code: "Space", keyCode: 32 },
    ].forEach(({ key, code, keyCode }) => {
      ["keydown", "keyup"].forEach((type) => {
        document.dispatchEvent(
          new KeyboardEvent(type, {
            key,
            code,
            keyCode,
            bubbles: true,
            cancelable: true,
            view: window,
          })
        );
      });
    });
  }

  /**
   * ページ遷移を待機し、DOM変化があったか否かを返す
   * @param {number} timeoutMs - タイムアウト時間（ms）
   * @returns {Promise<boolean>} 変化があれば true、タイムアウトなら false
   */
  function waitForPageTransitionWithResult(timeoutMs) {
    return new Promise((resolve) => {
      const contentArea =
        document.querySelector("#kindleReader-wrapper") ||
        document.querySelector(".book-content") ||
        document.querySelector("[class*='reader']") ||
        document.body;

      let settled = false;

      const done = (changed) => {
        if (settled) return;
        settled = true;
        observer.disconnect();
        clearTimeout(timer);
        // 変化があった場合はレンダリング完了を少し待つ
        setTimeout(() => resolve(changed), changed ? 500 : 0);
      };

      const timer = setTimeout(() => done(false), timeoutMs);

      const observer = new MutationObserver((mutations) => {
        const hasChange = mutations.some(
          (m) => m.addedNodes.length > 0 || m.removedNodes.length > 0
        );
        if (hasChange) done(true);
      });

      observer.observe(contentArea, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["style", "class"],
      });
    });
  }

  /**
   * 要素が表示されているか確認
   */
  function isElementVisible(element) {
    if (!element) return false;
    const style = window.getComputedStyle(element);
    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      style.opacity !== "0"
    );
  }

  /**
   * ページロード完了待機
   */
  async function handleWaitForLoad() {
    await waitForKindlePageLoad();
  }

  async function waitForKindlePageLoad() {
    return new Promise((resolve) => {
      const checkLoaded = () => {
        const contentArea =
          document.querySelector("#kindleReader-wrapper") ||
          document.querySelector(".book-content") ||
          document.querySelector("[class*='reader']");

        if (contentArea && contentArea.children.length > 0) {
          // コンテンツが存在する
          setTimeout(resolve, 200); // さらに少し待機
          return;
        }

        // 再チェック
        setTimeout(checkLoaded, 200);
      };

      // 既にロード済みか確認
      checkLoaded();

      // タイムアウト（最大5秒）
      setTimeout(resolve, 5000);
    });
  }

  /**
   * 書籍情報を抽出
   */
  function getBookInfo() {
    return {
      title: document.title || "Kindle Book",
      author:
        document.querySelector('[class*="author"]')?.textContent?.trim() || "",
      currentPage: extractCurrentPageNumber(),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * 現在のページ番号を抽出
   */
  function extractCurrentPageNumber() {
    const pageEl =
      document.querySelector('[class*="page-number"]') ||
      document.querySelector('[class*="pageNumber"]') ||
      document.querySelector('[class*="page-info"]');

    if (pageEl) {
      const match = pageEl.textContent.match(/\d+/);
      return match ? parseInt(match[0]) : 0;
    }

    return 0;
  }

  // Console のデバッグメッセージ
  console.log("[Kindle to PDF] Content script loaded successfully");
}
