// app/api/convert/route.ts
import { NextRequest } from "next/server";
import { randomUUID } from "crypto";
import path from "path";
import fs from "fs/promises";
import JSZip from "jszip";
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

    // 👉 Lazy-load fantasticon ONLY inside POST so that:
    // - Build doesn't try to execute its WASM-stuff
    // - GET /api/convert stays simple and safe
    const fantasticon = await import("fantasticon");
    const { generateFonts, FontAssetType, OtherAssetType } = fantasticon;

    // temp dirs in serverless environment (Vercel)
    const root = path.join("/tmp", randomUUID());
    const iconsDir = path.join(root, "icons");
    const outDir = path.join(root, "dist");

    await fs.mkdir(iconsDir, { recursive: true });
    await fs.mkdir(outDir, { recursive: true });

    // 1) Save scaled SVGs into /tmp/.../icons
    for (const f of svgFiles) {
      const buf = Buffer.from(await f.arrayBuffer());
      const originalSvg = buf.toString("utf8");
      const scaledSvg = scaleSvg(originalSvg, 24); // normalize size to 24x24

      const safeName = f.name.replace(/[^\w.-]/g, "_");
      const targetPath = path.join(iconsDir, safeName);
      await fs.writeFile(targetPath, scaledSvg, "utf8");
    }

    // 2) Run Fantasticon to generate font + assets
    // ⚠️ IMPORTANT: we DO NOT use WOFF2 here, to avoid ttf2woff2.wasm issues on Vercel
    await generateFonts({
      inputDir: iconsDir,
      outputDir: outDir,
      name: "custom-icons",
      fontTypes: [
        FontAssetType.TTF,
        FontAssetType.WOFF // no WOFF2
      ],
      assetTypes: [
        OtherAssetType.CSS,
        OtherAssetType.HTML,
        OtherAssetType.JSON
      ],
      normalize: true,
      prefix: "icon",
      tag: "i"
    });

    // 3) Zip all generated files and send to client
    const zip = new JSZip();

    async function addDirToZip(dirPath: string, zipFolder: JSZip) {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
          const folder = zipFolder.folder(entry.name);
          if (!folder) continue;
          await addDirToZip(fullPath, folder);
        } else {
          const fileData = await fs.readFile(fullPath);
          zipFolder.file(entry.name, fileData);
        }
      }
    }

    await addDirToZip(outDir, zip.folder("font-kit")!);

    const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });

    // Wrap Buffer in Uint8Array so it matches the Response BodyInit type
    const body = new Uint8Array(zipBuffer);

    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition":
          'attachment; filename="custom-icons-font-kit.zip"'
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
