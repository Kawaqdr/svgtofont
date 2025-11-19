// app/api/convert/route.ts
import { NextRequest } from "next/server";
import { randomUUID } from "crypto";
import path from "path";
import fs from "fs/promises";
import JSZip from "jszip";
import { scaleSvg } from "@/lib/scaleSvg";
import {
  generateFonts,
  FontAssetType,
  OtherAssetType
} from "fantasticon";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const files = formData.getAll("icons") as File[];

    if (!files.length) {
      return new Response(
        JSON.stringify({ error: "No SVG files uploaded" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" }
        }
      );
    }

    // temp dirs in serverless environment (Vercel)
    const root = path.join("/tmp", randomUUID());
    const iconsDir = path.join(root, "icons");
    const outDir = path.join(root, "dist");

    await fs.mkdir(iconsDir, { recursive: true });
    await fs.mkdir(outDir, { recursive: true });

    // 1) Save scaled SVGs into /tmp/.../icons
    for (const f of files) {
      if (typeof f === "string") continue;
      if (!f.name.toLowerCase().endsWith(".svg")) continue;

      const buf = Buffer.from(await f.arrayBuffer());
      const originalSvg = buf.toString("utf8");
      const scaledSvg = scaleSvg(originalSvg, 24); // normalize size here

      const safeName = f.name.replace(/[^\w.-]/g, "_");
      const targetPath = path.join(iconsDir, safeName);
      await fs.writeFile(targetPath, scaledSvg, "utf8");
    }

    // 2) Run Fantasticon to generate font + assets
    //    IMPORTANT: no WOFF2 here, so we don't need ttf2woff2.wasm
    await generateFonts({
      inputDir: iconsDir,
      outputDir: outDir,
      name: "custom-icons",
      fontTypes: [
        FontAssetType.TTF,
        FontAssetType.WOFF // <- WOFF only, no WOFF2
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

    // Wrap Buffer in Uint8Array so it matches the fetch Response BodyInit type
    const body = new Uint8Array(zipBuffer);

    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition":
          'attachment; filename="custom-icons-font-kit.zip"'
      }
    });
  } catch (err) {
    console.error("API /api/convert error:", err);
    return new Response(
      JSON.stringify({ error: "Internal Server Error" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" }
      }
    );
  }
}
