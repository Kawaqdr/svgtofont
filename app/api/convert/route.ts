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
      return new Response(JSON.stringify({ error: "No SVG files uploaded" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    // temp storage (Vercel allows /tmp)
    const root = path.join("/tmp", randomUUID());
    const iconsDir = path.join(root, "icons");
    await fs.mkdir(iconsDir, { recursive: true });

    // Save scaled SVGs
    for (const f of svgFiles) {
      const buf = Buffer.from(await f.arrayBuffer());
      const scaled = scaleSvg(buf.toString("utf8"), 24);

      const safeName = f.name.replace(/[^\w.-]/g, "_");
      await fs.writeFile(path.join(iconsDir, safeName), scaled, "utf8");
    }

    // Generate fonts
    const fontName = "custom-icons";

    const result = await webfont({
      files: path.join(iconsDir, "*.svg"),
      fontName,
      formats: ["ttf", "woff"]
    });

    if (!result.ttf || !result.woff) {
      throw new Error("Font generation failed (missing TTF/WOFF outputs)");
    }

    const glyphs = (result.glyphsData || []) as any[];

    const normalizeName = (name: string) =>
      name
        .toLowerCase()
        .replace(/\s+/g, "-")
        .replace(/[^a-z0-9_-]/g, "");

    // name -> codepoint map (only icons that actually have unicode)
    const codepoints: Record<string, number> = {};

    for (const glyph of glyphs) {
      let name: string | undefined = glyph.metadata?.name;

      // fallback to filename if no metadata name
      if (!name && glyph.srcPath) {
        const base = path.basename(glyph.srcPath, ".svg");
        name = base;
      }
      if (!name) continue;

      const clean = normalizeName(name);
      const unicodeChar: string | undefined = glyph.unicode?.[0];
      if (!unicodeChar) continue; // skip glyphs with no unicode

      codepoints[clean] = unicodeChar.charCodeAt(0);
    }

    const iconNames = Object.keys(codepoints);

    // Build CSS
    const cssParts: string[] = [];

    cssParts.push(`
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

    for (const name of iconNames) {
      const cp = codepoints[name]; // now guaranteed defined
      const hex = cp.toString(16).padStart(4, "0");
      cssParts.push(`.icon-${name}::before { content: "\\${hex}"; }`);
    }

    const cssContent = cssParts.join("\n\n");

    // HTML preview only for icons with valid codepoints
    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8"/>
  <title>${fontName} preview</title>
  <link rel="stylesheet" href="./${fontName}.css">
  <style>
    body { background:#020617; color:#e5e7eb; padding:20px; font-family:sans-serif; }
    .grid { display:flex; flex-wrap:wrap; gap:20px; }
    .card { width:120px; border:1px solid #1f2937; border-radius:8px; padding:10px; text-align:center; }
    .icon-sample { font-size:32px; margin-bottom:6px; }
  </style>
</head>
<body>
  <h1>${fontName} preview</h1>
  <div class="grid">
    ${iconNames
      .map(
        (n) => `
      <div class="card">
        <div class="icon icon-sample icon-${n}"></div>
        <div>${n}</div>
        <code>icon-${n}</code>
      </div>`
      )
      .join("")}
  </div>
</body>
</html>`;

    // Build ZIP
    const zip = new JSZip();
    const ttfBuffer = result.ttf as Buffer;
    const woffBuffer = result.woff as Buffer;

    zip.file(`${fontName}.ttf`, ttfBuffer);
    zip.file(`${fontName}.woff`, woffBuffer);
    zip.file(`${fontName}.css`, cssContent);
    zip.file(`${fontName}.html`, html);
    zip.file(`${fontName}.json`, JSON.stringify(codepoints, null, 2));

    const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });

    return new Response(new Uint8Array(zipBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${fontName}-font-kit.zip"`
      }
    });
  } catch (err: any) {
    console.error("convert API error:", err);
    return new Response(
      JSON.stringify({
        error: "Internal Server Error",
        details: err?.message
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
