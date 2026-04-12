/**
 * Kindle to PDF - プレビューページロジック
 * キャプチャ画像の一覧表示とPDFダウンロード
 */

const STORAGE_KEY = "kindleToPdf_preview";

let previewData = null;
let currentModalIndex = -1;

const elements = {
  filename: document.getElementById("filename"),
  downloadBtn: document.getElementById("downloadBtn"),
  imageGrid: document.getElementById("imageGrid"),
  statusBar: document.getElementById("statusBar"),
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

  images.forEach((img) => {
    const item = document.createElement("div");
    item.className = "image-item";

    const imgEl = document.createElement("img");
    imgEl.src = img.dataUrl;
    imgEl.alt = `ページ ${img.pageNumber}`;
    imgEl.loading = "lazy";

    const label = document.createElement("div");
    label.className = "image-label";
    label.textContent = `ページ ${img.pageNumber}`;

    item.appendChild(imgEl);
    item.appendChild(label);

    // クリックで拡大表示（index を渡してナビゲーション対応）
    const capturedIndex = images.indexOf(img);
    item.addEventListener("click", () => openModal(capturedIndex));

    elements.imageGrid.appendChild(item);
  });
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

/* ======== 初期化 ======== */

elements.downloadBtn.addEventListener("click", handleDownload);
loadPreviewData();
