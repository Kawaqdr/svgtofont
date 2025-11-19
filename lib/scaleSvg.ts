// lib/scaleSvg.ts
import SvgPath from "svgpath";

export function scaleSvg(content: string, newSize = 24): string {
  let minX = 0;
  let minY = 0;
  let oldWidth: number | null = null;
  let oldHeight: number | null = null;

  // 1) Try to read from viewBox
  const vbMatch = content.match(/viewBox="([^"]+)"/i);
  if (vbMatch) {
    const parts = vbMatch[1]
      .trim()
      .split(/\s+/)
      .map(Number);
    if (parts.length === 4 && parts.every((n) => !isNaN(n))) {
      [minX, minY, oldWidth, oldHeight] = parts;
    }
  }

  // 2) Fallback: width/height attributes
  if (oldWidth == null || oldHeight == null) {
    const wMatch = content.match(/\swidth="([\d.]+)(px)?"/i);
    const hMatch = content.match(/\sheight="([\d.]+)(px)?"/i);
    if (wMatch && hMatch) {
      oldWidth = parseFloat(wMatch[1]);
      oldHeight = parseFloat(hMatch[1]);
      minX = 0;
      minY = 0;
    }
  }

  // If still unknown, just return original
  if (!oldWidth || !oldHeight) {
    return content;
  }

  const scaleX = newSize / oldWidth;
  const scaleY = newSize / oldHeight;

  // 3) Transform all <path d="..."> attributes
  content = content.replace(
    /<path([^>]*)d="([^"]+)"([^>]*)>/gi,
    (match, pre, d, post) => {
      let p = new SvgPath(d);

      // normalize origin if viewBox starts at non-zero
      if (minX !== 0 || minY !== 0) {
        p = p.translate(-minX, -minY);
      }

      // scale into the new coordinate system
      p = p.scale(scaleX, scaleY);

      const newD = p.toString();
      return `<path${pre}d="${newD}"${post}>`;
    }
  );

  // 4) Normalize the <svg> tag: remove old width/height/viewBox and set new ones
  content = content.replace(/\s(width|height|viewBox)="[^"]*"/gi, "");
  content = content.replace(
    /<svg([^>]*)>/i,
    `<svg$1 width="${newSize}" height="${newSize}" viewBox="0 0 ${newSize} ${newSize}">`
  );

  return content;
}
