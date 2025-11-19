// app/api/convert/route.ts
import { NextRequest } from "next/server";
import { randomUUID } from "crypto";
import path from "path";
import fs from "fs/promises";
import JSZip from "jszip";
import webfont from "webfont";
import { scaleSvg } from "@/lib/scaleSvg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Simple GET to confirm the route is alive
export async function GET() {
  return new Response(
    JSON.stringify({ status: "ok", message: "convert API ready" }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" }
    }
  );
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const files = formData.getAll("icons") as (File | string)[];

    const svgFiles = files.filter(
      (f) => f instanceof File && f.name.toLowerCase().endsWith(".svg")
    ) as File[];

    if (!svgFiles.length) {
      return new Response(
        JSON.stringify({ error: "No SVG files uploaded" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" }
        }
      );
    }

    // temp dir in serverless environment (Vercel)
    const root = path.join("/tmp", randomUUID());
    const iconsDir = path.join(root, "icons");

    await fs.mkdir(iconsDir, { recursive: true });

    // 1) Save *scaled* SVGs into /tmp/.../icons
    for (const f of svgFiles) {
      const buf = Buffer.from(await f.arrayBuffer());
      const originalSvg = buf.toString("utf8");
      const scaledSvg = scaleSvg(originalSvg, 24); // normalize size to 24x24

      const safeName = f.name.replace(/[^\w.-]/g, "_");
      const targetPath = path.join(iconsDir, safeName);
      await fs.writeFile(targetPath, scaledSvg, "utf8");
    }

    // 2) Use webfont to generate TTF + WOFF in memory
    const fontName = "custom-icons";

    const result = await webfont({
      files: path.join(iconsDir, "*.svg"),
      fontName,
      formats: ["ttf", "woff"] // no woff2 => no WASM headaches
    });

    if (!result.ttf || !result.woff) {
      throw new Error("Font generation failed (missing TTF/WOFF outputs)");
    }

    // Cast glyphsData to any[] to keep TS happy
    const glyphs = (result.glyphsData || []) as any[];

    // Helper to get a clean icon name from glyph data
    const getGlyphName = (glyph: any): string | null => {
      const metaName: string | undefined = glyph.metadata?.name;
      if (metaName && metaName.trim()) return metaName.trim();

      // fallback: derive from source path if available
      const srcPath: string | undefined = glyph.srcPath;
      if (srcPath) {
        const base = path.basename(srcPath, path.extname(srcPath));
        if (base) return base;
      }
      return null;
    };

    // 3) Build JSON codepoints map (name -> unicode codepoint)
    const codepoints: Record<string, number> = {};
    for (const glyph of glyphs) {
      const name = getGlyphName(glyph);
      const unicodeChar: string | undefined = glyph.unicode?.[0];
      if (name && unicodeChar) {
        codepoints[name] = unicodeChar.charCodeAt(0);
      }
    }

    // 4) Build CSS manually, one rule per icon name
    const cssLines: string[] = [];

    cssLines.push(`
@font-face {
  font-family: '${fontName}';
  src: url('./${fontName}.woff') format('woff'),
       url('./${fontName}.ttf') format('truetype');
  font-weight: normal;
  font-style: normal;
  font-display: block;
}

.icon {
  font-family: '${fontName}';
  font-style: normal;
  font-weight: normal;
  speak: none;
  display: inline-block;
  text-decoration: none;
  text-align: center;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
`.trim());

    for (const [name, code] of Object.entries(codepoints)) {
      const hex = code.toString(16).padStart(4, "0");
      cssLines.push(
        `.icon-${name}::before { content: "\\${hex}"; }`
      );
    }

    const cssContent = cssLines.join("\n\n");

    // 5) Build a simple HTML preview
    const cssFileName = `${fontName}.css`;
    const htmlPreview = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${fontName} preview</title>
  <link rel="stylesheet" href="./${cssFileName}" />
  <style>
    body { font-family: system-ui, sans-serif; padding: 16px; background:#020617; color:#e5e7eb; }
    .icon-grid { display:flex; flex-wrap:wrap; gap:16px; }
    .icon-item { width:120px; border:1px solid #1f2937; border-radius:8px; padding:8px; text-align:center; background:#020617; }
    .icon-sample { font-size:32px; margin-bottom:4px; }
    code { font-size:12px; word-break:break-all; }
  </style>
</head>
<body>
  <h1>${fontName} icons</h1>
  <p>Use <code>.icon</code> plus <code>.icon-*</code> classes.</p>
  <div class="icon-grid">
    ${
      glyphs.length
        ? glyphs
            .map((glyph) => {
              const name = getGlyphName(glyph);
              if (!name) return "";
              const className = `icon-${name}`;
              return `<div class="icon-item">
  <div class="icon icon-sample ${className}"></div>
  <div>${name}</div>
  <code>${className}</code>
</div>`;
            })
            .join("\n")
        : "<p>No glyphs found.</p>"
    }
  </div>
</body>
</html>`;

    // 6) Create ZIP with font + CSS + HTML + JSON
    const zip = new JSZip();

    zip.file(`${fontName}.ttf`, result.ttf);
    zip.file(`${fontName}.woff`, result.woff);
    zip.file(cssFileName, cssContent);
    zip.file(`${fontName}.html`, htmlPreview);
    zip.file(`${fontName}.json`, JSON.stringify(codepoints, null, 2));

    const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });
    const body = new Uint8Array(zipBuffer);

    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${fontName}-font-kit.zip"`
      }
    });
  } catch (err: any) {
    console.error("API /api/convert error:", err);
    return new Response(
      JSON.stringify({
        error: "Internal Server Error",
        details: err?.message || String(err)
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" }
      }
    );
  }
}
