/**
 * Kindle to PDF - プレビューページロジック
 * キャプチャ画像の一覧表示とPDFダウンロード
 */

const STORAGE_KEY = "kindleToPdf_preview";
const API_KEY_STORAGE_KEY = "kindleToPdf_apiKey"; // 旧バージョンとの互換性
const PROVIDER_STORAGE_KEY = "kindleToPdf_provider";

// プロバイダー設定（モデルストレージキー）
const PROVIDER_MODEL_KEYS = {
  claude: "kindleToPdf_claudeModel",
  openai: "kindleToPdf_openaiModel",
  gemini: "kindleToPdf_geminiModel",
};

const TRANSCRIPTION_PROMPT_PATHS = [
  "transcription_prompt.txt",
  "src/transcription_prompt.txt",
];
let transcriptionPrompt = "";

let previewData = null;
let currentModalIndex = -1;
let dragSourceIndex = null;
// 文字起こし結果（ページ番号 → テキストのMap）
let transcriptionResults = new Map();
let isTranscribing = false;

/**
 * 文字起こし用プロンプトをテキストファイルから読み込む
 */
async function loadTranscriptionPrompt() {
  for (const path of TRANSCRIPTION_PROMPT_PATHS) {
    try {
      const response = await fetch(chrome.runtime.getURL(path));
      if (!response.ok) {
        continue;
      }
      transcriptionPrompt = (await response.text()).trim();
      if (transcriptionPrompt) {
        return;
      }
    } catch (error) {
      // 次の候補パスを試す
    }
  }
  throw new Error("文字起こしプロンプトの読み込みに失敗しました");
}

const elements = {
  filename: document.getElementById("filename"),
  downloadBtn: document.getElementById("downloadBtn"),
  imageGrid: document.getElementById("imageGrid"),
  statusBar: document.getElementById("statusBar"),
  toolbarImages: document.getElementById("toolbarImages"),
  toolbarTranscription: document.getElementById("toolbarTranscription"),
  transcribeBtn: document.getElementById("transcribeBtn"),
  downloadMdBtn: document.getElementById("downloadMdBtn"),
  transcriptionProgress: document.getElementById("transcriptionProgress"),
  transcriptionProgressFill: document.getElementById("transcriptionProgressFill"),
  transcriptionProgressText: document.getElementById("transcriptionProgressText"),
  transcriptionResult: document.getElementById("transcriptionResult"),
};

/**
 * ステータスバーの更新
 */
function setStatus(message, type = "") {
  elements.statusBar.textContent = message;
  elements.statusBar.className = "status-bar" + (type ? ` ${type}` : "");
}

/**
 * chrome.storage.local からプレビューデータを読み込む
 */
async function loadPreviewData() {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    const data = result[STORAGE_KEY];

    if (!data || !data.images || data.images.length === 0) {
      setStatus("プレビューデータが見つかりません。サイドパネルからキャプチャしてください。", "error");
      return;
    }

    previewData = data;
    elements.filename.value = data.filename || "kindle_book";
    elements.downloadBtn.disabled = false;
    elements.transcribeBtn.disabled = false;

    renderImageGrid(data.images);
    setStatus(`${data.images.length} ページ — 画像をクリックで拡大`);
  } catch (error) {
    console.error("Failed to load preview data:", error);
    setStatus(`読み込みエラー: ${error.message}`, "error");
  }
}

/**
 * 画像グリッドのレンダリング
 */
function renderImageGrid(images) {
  elements.imageGrid.innerHTML = "";

  images.forEach((img, index) => {
    const item = document.createElement("div");
    item.className = "image-item";
    item.draggable = true;

    // ×削除ボタン
    const deleteBtn = document.createElement("button");
    deleteBtn.className = "delete-btn";
    deleteBtn.innerHTML = "&times;";
    deleteBtn.title = "このページを削除";
    deleteBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      deleteImage(index);
    });

    const imgEl = document.createElement("img");
    imgEl.src = img.dataUrl;
    imgEl.alt = `ページ ${img.pageNumber}`;
    imgEl.loading = "lazy";

    const label = document.createElement("div");
    label.className = "image-label";
    label.textContent = `ページ ${img.pageNumber}`;

    item.appendChild(deleteBtn);
    item.appendChild(imgEl);
    item.appendChild(label);

    // クリックで拡大表示
    item.addEventListener("click", () => openModal(index));

    // ドラッグ開始
    item.addEventListener("dragstart", (e) => {
      dragSourceIndex = index;
      item.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
    });

    // ドラッグ終了（どこにドロップされても後始末）
    item.addEventListener("dragend", () => {
      item.classList.remove("dragging");
      document.querySelectorAll(".image-item").forEach((el) =>
        el.classList.remove("drag-over")
      );
    });

    // ドロップ受け入れ許可
    item.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      item.classList.add("drag-over");
    });

    // 子要素へのイベントを除外してハイライトを除去
    item.addEventListener("dragleave", (e) => {
      if (!item.contains(e.relatedTarget)) {
        item.classList.remove("drag-over");
      }
    });

    // ドロップ：配列を並び替えて再描画
    item.addEventListener("drop", (e) => {
      e.preventDefault();
      item.classList.remove("drag-over");
      if (dragSourceIndex === null || dragSourceIndex === index) return;

      const [moved] = previewData.images.splice(dragSourceIndex, 1);
      previewData.images.splice(index, 0, moved);
      dragSourceIndex = null;

      renderImageGrid(previewData.images);
      setStatus(`${previewData.images.length} ページ — 画像をクリックで拡大`);
    });

    elements.imageGrid.appendChild(item);
  });
}

/**
 * 指定インデックスの画像を削除
 */
function deleteImage(index) {
  previewData.images.splice(index, 1);
  renderImageGrid(previewData.images);

  if (previewData.images.length === 0) {
    elements.downloadBtn.disabled = true;
    setStatus("画像がありません", "error");
  } else {
    setStatus(`${previewData.images.length} ページ — 画像をクリックで拡大`);
  }
}

/**
 * PDFダウンロード処理
 */
async function handleDownload() {
  if (!previewData) return;

  const filename = sanitizeFilename(
    elements.filename.value.trim() || "kindle_book"
  );

  elements.downloadBtn.disabled = true;
  elements.downloadBtn.textContent = "PDF 生成中...";
  elements.downloadBtn.classList.add("generating");
  setStatus("PDF を生成しています...");

  try {
    const result = await generatePDF(previewData.images, filename);
    setStatus(`ダウンロード完了: ${result.filename}`, "success");
    elements.downloadBtn.textContent = "ダウンロード完了";

    // 使用済みデータをクリア
    await chrome.storage.local.remove(STORAGE_KEY);
  } catch (error) {
    console.error("PDF generation error:", error);
    setStatus(`PDF生成エラー: ${error.message}`, "error");
    elements.downloadBtn.textContent = "PDF をダウンロード";
    elements.downloadBtn.disabled = false;
    elements.downloadBtn.classList.remove("generating");
  }
}

/* ======== 拡大モーダル ======== */

const modal = document.createElement("div");
modal.className = "modal-overlay";
modal.innerHTML = `
  <button class="modal-close" aria-label="閉じる">&times;</button>
  <button class="modal-nav modal-prev" aria-label="前のページ">&#8592;</button>
  <img class="modal-img" src="" alt="">
  <button class="modal-nav modal-next" aria-label="次のページ">&#8594;</button>
  <div class="modal-page-label"></div>
`;
document.body.appendChild(modal);

const modalImg = modal.querySelector(".modal-img");
const modalClose = modal.querySelector(".modal-close");
const modalPrev = modal.querySelector(".modal-prev");
const modalNext = modal.querySelector(".modal-next");
const modalPageLabel = modal.querySelector(".modal-page-label");

function openModal(index) {
  const images = previewData.images;
  currentModalIndex = index;
  const img = images[index];
  modalImg.src = img.dataUrl;
  modalImg.alt = `ページ ${img.pageNumber}`;
  modalPageLabel.textContent = `${index + 1} / ${images.length}`;
  updateModalNavButtons();
  modal.classList.add("open");
}

function closeModal() {
  modal.classList.remove("open");
  modalImg.src = "";
  currentModalIndex = -1;
}

function navigateModal(delta) {
  if (!previewData) return;
  const newIndex = currentModalIndex + delta;
  if (newIndex >= 0 && newIndex < previewData.images.length) {
    openModal(newIndex);
  }
}

function updateModalNavButtons() {
  const total = previewData ? previewData.images.length : 0;
  modalPrev.disabled = currentModalIndex <= 0;
  modalNext.disabled = currentModalIndex >= total - 1;
}

modalClose.addEventListener("click", closeModal);
modalPrev.addEventListener("click", (e) => { e.stopPropagation(); navigateModal(-1); });
modalNext.addEventListener("click", (e) => { e.stopPropagation(); navigateModal(1); });
modal.addEventListener("click", (e) => {
  if (e.target === modal) closeModal();
});
document.addEventListener("keydown", (e) => {
  if (!modal.classList.contains("open")) return;
  if (e.key === "Escape") closeModal();
  if (e.key === "ArrowLeft") navigateModal(-1);
  if (e.key === "ArrowRight") navigateModal(1);
});

/* ======== タブ切り替え ======== */

document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const tab = btn.dataset.tab;

    // タブボタンのアクティブ状態を切り替え
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");

    // タブコンテンツの表示を切り替え
    document.querySelectorAll(".tab-content").forEach((el) => el.classList.add("hidden"));
    document.getElementById(`tab-${tab}`).classList.remove("hidden");

    // ヘッダーのツールバーを切り替え
    if (tab === "images") {
      elements.toolbarImages.classList.remove("hidden");
      elements.toolbarTranscription.classList.add("hidden");
    } else {
      elements.toolbarImages.classList.add("hidden");
      elements.toolbarTranscription.classList.remove("hidden");
    }
  });
});

/* ======== 文字起こし処理 ======== */

/**
 * Claude Vision API で1ページ分のテキストを取得
 */
async function transcribeWithClaude(apiKey, model, base64Data, pageNumber) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model,
      max_tokens: 2048,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: base64Data } },
          { type: "text", text: transcriptionPrompt },
        ],
      }],
    }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(`Claude API エラー (ページ ${pageNumber}): ${err.error?.message || `HTTP ${response.status}`}`);
  }
  const data = await response.json();
  return data.content?.[0]?.text || "";
}

/**
 * OpenAI Vision API で1ページ分のテキストを取得
 */
async function transcribeWithOpenAI(apiKey, model, base64Data, pageNumber) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 2048,
      messages: [{
        role: "user",
        content: [
          { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64Data}` } },
          { type: "text", text: transcriptionPrompt },
        ],
      }],
    }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(`OpenAI API エラー (ページ ${pageNumber}): ${err.error?.message || `HTTP ${response.status}`}`);
  }
  const data = await response.json();
  return data.choices?.[0]?.message?.content || "";
}

/**
 * Gemini Vision API で1ページ分のテキストを取得
 */
async function transcribeWithGemini(apiKey, model, base64Data, pageNumber) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          parts: [
            { inlineData: { mimeType: "image/jpeg", data: base64Data } },
            { text: transcriptionPrompt },
          ],
        }],
      }),
    }
  );
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(`Gemini API エラー (ページ ${pageNumber}): ${err.error?.message || `HTTP ${response.status}`}`);
  }
  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

/**
 * 選択中のプロバイダーで1ページ分のテキストを取得
 */
async function transcribePage(provider, apiKey, model, dataUrl, pageNumber) {
  const base64Data = dataUrl.replace(/^data:image\/\w+;base64,/, "");
  switch (provider) {
    case "openai": return transcribeWithOpenAI(apiKey, model, base64Data, pageNumber);
    case "gemini": return transcribeWithGemini(apiKey, model, base64Data, pageNumber);
    default: return transcribeWithClaude(apiKey, model, base64Data, pageNumber);
  }
}

/**
 * 文字起こし開始ボタンのハンドラー
 */
async function handleTranscribe() {
  if (!previewData || isTranscribing) return;

  const stored = await chrome.storage.local.get([
    PROVIDER_STORAGE_KEY,
    "kindleToPdf_claudeKey",
    "kindleToPdf_openaiKey",
    "kindleToPdf_geminiKey",
    "kindleToPdf_claudeModel",
    "kindleToPdf_openaiModel",
    "kindleToPdf_geminiModel",
    API_KEY_STORAGE_KEY,
  ]);
  const provider = stored[PROVIDER_STORAGE_KEY] || "claude";
  const apiKey = stored[`kindleToPdf_${provider}Key`] ||
    (provider === "claude" ? stored[API_KEY_STORAGE_KEY] || "" : "");
  const model = stored[`kindleToPdf_${provider}Model`] || "";

  if (!apiKey) {
    setStatus("サイドパネルで API キーを設定してください", "error");
    return;
  }

  if (!model) {
    setStatus("サイドパネルでモデル名を設定してください", "error");
    return;
  }

  isTranscribing = true;
  transcriptionResults.clear();
  elements.transcribeBtn.disabled = true;
  elements.transcribeBtn.textContent = "処理中...";
  elements.transcribeBtn.classList.add("processing");
  elements.downloadMdBtn.disabled = true;
  elements.transcriptionProgress.classList.remove("hidden");
  elements.transcriptionResult.innerHTML = "";

  const images = previewData.images;
  const total = images.length;

  try {
    for (let i = 0; i < total; i++) {
      const img = images[i];
      const percent = Math.round(((i) / total) * 100);
      elements.transcriptionProgressFill.style.width = `${percent}%`;
      elements.transcriptionProgressText.textContent =
        `処理中... ${i + 1} / ${total} ページ`;
      setStatus(`ページ ${i + 1} / ${total} を文字起こし中...`);

      const text = await transcribePage(provider, apiKey, model, img.dataUrl, img.pageNumber);
      transcriptionResults.set(img.pageNumber, text);

      // 結果を随時追記表示
      renderTranscriptionResult();
    }

    elements.transcriptionProgressFill.style.width = "100%";
    elements.transcriptionProgressText.textContent = `完了: ${total} ページ`;
    setStatus(`文字起こし完了 (${total} ページ)`, "success");
    elements.downloadMdBtn.disabled = false;
  } catch (error) {
    console.error("Transcription error:", error);
    setStatus(`文字起こしエラー: ${error.message}`, "error");
  } finally {
    isTranscribing = false;
    elements.transcribeBtn.disabled = false;
    elements.transcribeBtn.textContent = "文字起こし開始";
    elements.transcribeBtn.classList.remove("processing");
  }
}

/**
 * 文字起こし結果をページ順に表示
 */
function renderTranscriptionResult() {
  if (!previewData) return;

  const lines = [];
  for (const img of previewData.images) {
    const text = transcriptionResults.get(img.pageNumber);
    if (text !== undefined) {
      lines.push(`--- ページ ${img.pageNumber} ---\n\n${text}`);
    }
  }

  elements.transcriptionResult.textContent = lines.join("\n\n");
}

/**
 * Markdown ファイルとしてダウンロード
 */
function handleDownloadMd() {
  if (transcriptionResults.size === 0) return;

  const filename = sanitizeFilename(
    elements.filename.value.trim() || "kindle_book"
  );

  const lines = [];
  for (const img of previewData.images) {
    const text = transcriptionResults.get(img.pageNumber);
    if (text !== undefined) {
      lines.push(text);
    }
  }

  const content = lines.join("\n\n---\n\n");
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = `${filename}.md`;
  a.click();
  URL.revokeObjectURL(url);

  setStatus(`Markdown をダウンロードしました: ${filename}.md`, "success");
}

/* ======== 初期化 ======== */

elements.downloadBtn.addEventListener("click", handleDownload);
elements.transcribeBtn.addEventListener("click", handleTranscribe);
elements.downloadMdBtn.addEventListener("click", handleDownloadMd);

// APIキーとモデル名の設定確認
chrome.storage.local.get([
  PROVIDER_STORAGE_KEY,
  "kindleToPdf_claudeKey",
  "kindleToPdf_openaiKey",
  "kindleToPdf_geminiKey",
  "kindleToPdf_claudeModel",
  "kindleToPdf_openaiModel",
  "kindleToPdf_geminiModel",
  API_KEY_STORAGE_KEY,
], (stored) => {
  const provider = stored[PROVIDER_STORAGE_KEY] || "claude";
  const apiKey = stored[`kindleToPdf_${provider}Key`] ||
    (provider === "claude" ? stored[API_KEY_STORAGE_KEY] || "" : "");
  const model = stored[`kindleToPdf_${provider}Model`] || "";

  // APIキーまたはモデル名がない場合はボタンを無効化
  if (!apiKey || !model) {
    elements.transcribeBtn.disabled = true;
    elements.transcribeBtn.title = "サイドパネルで API キーとモデル名を設定してください";
  }
});

async function initialize() {
  try {
    await loadTranscriptionPrompt();
    await loadPreviewData();
  } catch (error) {
    setStatus(error.message, "error");
  }
}

initialize();