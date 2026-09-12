/**
 * 修改时间：2026-09-12 | 文件说明：VaultAgent PDF 物理页到 PNG 的受限视觉渲染器 | edit by：Sliye
 */

import { createCanvas } from "@napi-rs/canvas";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

/** 单张 PDF 渲染图的最大像素数。 */
const MAX_RENDER_PIXELS = 2_000_000;
/** 单张 PDF 渲染图长边上限。 */
const MAX_RENDER_EDGE = 2_048;
/** PDF 页渲染默认倍率。 */
const DEFAULT_RENDER_SCALE = 1.5;

/** PDF 页面视觉分析前生成的受限 PNG。 */
export type RenderedPdfPage = {
  png: Uint8Array;
  width: number;
  height: number;
};

/**
 * 在有界分辨率内将一个 PDF 物理页渲染为 PNG。
 *
 * @param pdfBytes PDF 原始字节。
 * @param pageNumber 从 1 开始计数的物理页码。
 */
export async function renderPdfPage(
  pdfBytes: Uint8Array,
  pageNumber: number,
): Promise<RenderedPdfPage> {
  // PDF.js 会取得 TypedArray 所有权，因此传入副本避免影响调用方的原始字节。
  // https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib.html
  const loadingTask = getDocument({
    data: new Uint8Array(pdfBytes),
    useSystemFonts: true,
  });

  try {
    const document = await loadingTask.promise;
    if (
      !Number.isInteger(pageNumber) ||
      pageNumber < 1 ||
      pageNumber > document.numPages
    ) {
      throw new Error(`PDF page number ${pageNumber} is outside the document range.`);
    }

    const page = await document.getPage(pageNumber);
    const baseViewport = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({
      scale: getRenderScale(baseViewport.width, baseViewport.height),
    });
    const canvas = createCanvas(
      Math.ceil(viewport.width),
      Math.ceil(viewport.height),
    );

    // @napi-rs/canvas 与 PDF.js Node 渲染运行时兼容，但 PDF.js 类型仅声明浏览器 Canvas。
    await page.render({
      canvas: canvas as unknown as HTMLCanvasElement,
      viewport,
    }).promise;

    return {
      png: new Uint8Array(canvas.toBuffer("image/png")),
      width: canvas.width,
      height: canvas.height,
    };
  } finally {
    await loadingTask.destroy();
  }
}

/** 根据像素总量与最长边限制计算渲染倍率。 */
function getRenderScale(width: number, height: number) {
  const pixelScale = Math.sqrt(MAX_RENDER_PIXELS / (width * height));
  const edgeScale = MAX_RENDER_EDGE / Math.max(width, height);
  return Math.min(DEFAULT_RENDER_SCALE, pixelScale, edgeScale);
}
