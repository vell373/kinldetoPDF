/**
 * Kindle to PDF - ユーティリティ関数
 * PDF生成やデータ処理の共通ロジック
 */

/**
 * 画像配列をPDF に変換してダウンロード
 * @param {Array<{pageNumber: number, dataUrl: string}>} images - 画像データ配列
 * @param {string} filename - ダウンロードするファイル名（拡張子なし）
 */
async function generatePDF(images, filename) {
  if (!images || images.length === 0) {
    throw new Error("画像がありません");
  }

  if (typeof jsPDF === "undefined") {
    throw new Error("jsPDF がロードされていません");
  }

  // ファイル名の整合性チェック
  const safeFilename = filename.replace(/[^\w\s-]/g, "").trim() || "kindle_book";

  try {
    // 最初の画像からアスペクト比を計算
    const firstImgDimensions = await getImageDimensions(images[0].dataUrl);
    const aspectRatio =
      firstImgDimensions.width / firstImgDimensions.height;

    // PDFページサイズ計算
    // A4 基準（210mm x 297mm）だが、画像のアスペクト比に合わせる
    const pdfWidth = 210; // A4幅(mm)
    const pdfHeight = pdfWidth / aspectRatio;

    const orientation = aspectRatio > 1 ? "landscape" : "portrait";
    const pageSize = [pdfWidth, pdfHeight];

    // jsPDF インスタンス生成（UMD版を使用）
    const { jsPDF: JsPdfConstructor } = window;
    const pdf = new JsPdfConstructor({
      orientation: orientation,
      unit: "mm",
      format: pageSize,
    });

    // 各ページを追加
    for (let i = 0; i < images.length; i++) {
      if (i > 0) {
        pdf.addPage(pageSize, orientation);
      }

      const imgData = images[i].dataUrl;
      pdf.addImage(
        imgData,
        "JPEG",
        0, // x
        0, // y
        pdfWidth,
        pdfHeight,
        undefined, // alias
        "FAST" // compression
      );

      // UIスレッドを定期的に解放（大量ページ処理時）
      if (i % 10 === 0) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }

    // PDF保存
    pdf.save(`${safeFilename}.pdf`);

    return {
      success: true,
      message: `${images.length} ページの PDF を生成しました`,
      filename: `${safeFilename}.pdf`,
      pageCount: images.length,
    };
  } catch (error) {
    throw new Error(`PDF生成エラー: ${error.message}`);
  }
}

/**
 * 画像の寸法を取得
 * @param {string} dataUrl - Base64 エンコード済みのデータURI
 * @returns {Promise<{width: number, height: number}>}
 */
function getImageDimensions(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.width, height: img.height });
    };
    img.onerror = () => {
      reject(new Error("画像ロードエラー"));
    };
    img.src = dataUrl;
  });
}

/**
 * ユーティリティ：ページ範囲のバリデーション
 */
function validatePageRange(startPage, endPage, maxPage = 9999) {
  const start = parseInt(startPage, 10);
  const end = parseInt(endPage, 10);

  if (isNaN(start) || isNaN(end)) {
    throw new Error("ページ番号は数値で入力してください");
  }

  if (start < 1 || end < 1) {
    throw new Error("ページ番号は1以上である必要があります");
  }

  if (start > end) {
    throw new Error("開始ページは終了ページ以下である必要があります");
  }

  if (end - start + 1 > 500) {
    throw new Error("一度に最大500ページまでキャプチャできます");
  }

  return { start, end };
}

/**
 * ユーティリティ：ファイル名のサニタイズ
 */
function sanitizeFilename(filename) {
  return filename
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "_") || "kindle_book";
}

/**
 * ユーティリティ：ログメッセージ生成
 */
function createLogEntry(message, level = "info", timestamp = true) {
  const time = timestamp ? new Date().toLocaleTimeString("ja-JP") : "";
  return {
    timestamp: time,
    level: level, // debug, info, warning, error
    message: message,
  };
}

/**
 * ユーティリティ：バイトをMB表記に変換
 */
function formatBytes(bytes) {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}
