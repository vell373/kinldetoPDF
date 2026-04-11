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
   * 次ページボタンをクリック
   */
  async function handleNextPage() {
    const success = clickNextPageButton();
    if (!success) {
      throw new Error("次ページボタンが見つかりません");
    }

    // ページ遷移アニメーション待機
    await waitForPageTransition();
  }

  /**
   * 次ページボタンをクリック（複数セレクターのフォールバック）
   */
  function clickNextPageButton() {
    // Kindle Cloud Reader の次ページボタン（複数パターン）
    const selectors = [
      '[aria-label="次のページ"]',
      '[aria-label="Next page"]',
      '[aria-label="次ページ"]',
      '[data-action="next-page"]',
      '[data-action="nextPage"]',
      ".kp-notebook-library-each-book",
      "#kindleReader-next-page",
      ".page-btn.next",
      '[class*="next-page"]',
    ];

    for (const selector of selectors) {
      const btn = document.querySelector(selector);
      if (btn && isElementVisible(btn)) {
        try {
          btn.click();
          return true;
        } catch (e) {
          console.warn("Failed to click button:", selector, e);
        }
      }
    }

    // セレクターで見つからない場合：キーボードイベント（右矢印キー）
    try {
      const event = new KeyboardEvent("keydown", {
        key: "ArrowRight",
        code: "ArrowRight",
        keyCode: 39,
        bubbles: true,
        cancelable: true,
      });
      document.dispatchEvent(event);
      return true;
    } catch (e) {
      console.error("Failed to dispatch keyboard event:", e);
      return false;
    }
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
   * ページ遷移完了待機（MutationObserver使用）
   */
  async function waitForPageTransition() {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        observer.disconnect();
        resolve();
      }, 3000); // 最大3秒

      const observer = new MutationObserver((mutations) => {
        // ページコンテンツが大きく変更されたか確認
        const hasSignificantChange = mutations.some((mutation) => {
          return mutation.addedNodes.length > 0 || mutation.removedNodes.length > 0;
        });

        if (hasSignificantChange) {
          clearTimeout(timeout);
          observer.disconnect();
          // 追加で短い遅延を入れて確実にレンダリング完了を待つ
          setTimeout(resolve, 500);
        }
      });

      // 監視対象を特定（Kindleリーダーのコンテンツエリア）
      const contentArea =
        document.querySelector("#kindleReader-wrapper") ||
        document.querySelector(".book-content") ||
        document.querySelector("[class*='reader']") ||
        document.body;

      observer.observe(contentArea, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["style", "class"],
      });
    });
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
