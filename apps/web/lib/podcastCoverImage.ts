/**
 * 小宇宙 / Apple Podcast 单集封面常见要求：方形、边长建议 ≥1400px、JPEG/PNG。
 * 上传前在浏览器内居中裁剪为正方形并缩放，减少后台拒收与客户端模糊。
 */
export const PODCAST_EPISODE_COVER_SIDE_PX = 1400;

function loadImageFromUrl(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("图片无法解码，请换一张 JPEG/PNG/WebP。"));
    img.crossOrigin = "anonymous";
    img.src = url;
  });
}

/**
 * 居中裁剪 cover 缩放至 side×side，输出 JPEG。
 */
export async function cropSquareToPodcastCoverJpeg(file: File, side = PODCAST_EPISODE_COVER_SIDE_PX): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImageFromUrl(url);
    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;
    if (iw < 1 || ih < 1) throw new Error("图片尺寸无效。");

    const canvas = document.createElement("canvas");
    canvas.width = side;
    canvas.height = side;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("浏览器不支持画布处理。");

    const scale = Math.max(side / iw, side / ih);
    const sw = side / scale;
    const sh = side / scale;
    const sx = (iw - sw) / 2;
    const sy = (ih - sh) / 2;
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, side, side);

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => {
          if (b) resolve(b);
          else reject(new Error("导出 JPEG 失败。"));
        },
        "image/jpeg",
        0.88
      );
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function blobToDataUrlBase64(blob: Blob): Promise<{ dataUrl: string; base64: string }> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ""));
    r.onerror = () => reject(new Error("read_failed"));
    r.readAsDataURL(blob);
  });
  const comma = dataUrl.indexOf(",");
  const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  return { dataUrl, base64 };
}
