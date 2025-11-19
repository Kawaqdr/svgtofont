// app/page.tsx
"use client";

import React, { useState } from "react";

export default function HomePage() {
  const [files, setFiles] = useState<FileList | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFiles(e.target.files);
    setError(null);
    setSuccess(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!files || !files.length) {
      setError("Please select at least one SVG file.");
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(false);

    try {
      const formData = new FormData();
      Array.from(files).forEach((file) => {
        formData.append("icons", file);
      });

      const res = await fetch("/api/convert", {
        method: "POST",
        body: formData
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Conversion failed");
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = url;
      a.download = "custom-icons-font-kit.zip";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      setSuccess(true);
    } catch (err: any) {
      setError(err.message || "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-100">
      <div className="max-w-xl w-full bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-lg">
        <h1 className="text-2xl font-semibold mb-4">
          SVG → Icon Font (Fantasticon)
        </h1>
        <p className="text-sm text-slate-400 mb-4">
          Upload multiple SVG icons. They’ll be normalized to the same size,
          converted into an icon font (WOFF/TTF), and downloaded as a ZIP
          (font + CSS + preview HTML).
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">
              SVG icons
            </label>
            <input
              type="file"
              accept=".svg"
              multiple
              onChange={handleChange}
              className="block w-full text-sm text-slate-200
                         file:mr-4 file:py-2 file:px-4
                         file:rounded-md file:border-0
                         file:text-sm file:font-semibold
                         file:bg-blue-600 file:text-white
                         hover:file:bg-blue-500"
            />
            <p className="text-xs text-slate-500 mt-1">
              Tip: keep file names kebab-case (e.g.{" "}
              <code>arrow-right.svg</code>) for nice CSS class names.
            </p>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2 rounded-md text-sm font-semibold
                       bg-blue-600 hover:bg-blue-500 disabled:opacity-50
                       disabled:cursor-not-allowed"
          >
            {loading ? "Converting…" : "Generate Font & Download ZIP"}
          </button>

          {error && (
            <p className="text-sm text-red-400 mt-2">
              Error: {error}
            </p>
          )}
          {success && (
            <p className="text-sm text-emerald-400 mt-2">
              Done! ZIP downloaded.
            </p>
          )}
        </form>
      </div>
    </main>
  );
}
