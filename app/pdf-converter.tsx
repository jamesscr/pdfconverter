"use client";

import { ChangeEvent, DragEvent, useMemo, useRef, useState } from "react";

type ConversionStatus = "idle" | "reading" | "done" | "error";

type ConversionResult = {
  pagesText: string[];
  pages: number;
  fileName: string;
};

const printedStartPage = 1;

export function PdfConverter() {
  const [status, setStatus] = useState<ConversionStatus>("idle");
  const [result, setResult] = useState<ConversionResult | null>(null);
  const [error, setError] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const formattedText = useMemo(() => {
    if (!result) {
      return "";
    }

    return buildEText(result.pagesText);
  }, [result]);

  const wordCount = useMemo(() => {
    if (!formattedText.trim()) {
      return 0;
    }

    return formattedText.trim().split(/\s+/).length;
  }, [formattedText]);

  async function convertFile(file: File) {
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      setStatus("error");
      setError("Sélectionnez un fichier PDF valide.");
      return;
    }

    setStatus("reading");
    setError("");
    setResult(null);

    try {
      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/build/pdf.worker.min.mjs",
        import.meta.url
      ).toString();

      const data = await file.arrayBuffer();
      const pdf = await pdfjs.getDocument({ data }).promise;
      const pagesText: string[] = [];

      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        const page = await pdf.getPage(pageNumber);
        const content = await page.getTextContent();
        const text = content.items
          .map((item) => ("str" in item ? item.str : ""))
          .join(" ")
          .replace(/[ \t]+/g, " ")
          .trim();

        if (text) {
          pagesText.push(text);
        } else {
          pagesText.push("");
        }
      }

      setResult({
        pagesText,
        pages: pdf.numPages,
        fileName: file.name
      });
      setStatus("done");
    } catch {
      setStatus("error");
      setError(
        "Impossible de convertir ce PDF. S'il s'agit d'un scan, il faudra ajouter une étape OCR."
      );
    }
  }

  function handleInputChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) {
      void convertFile(file);
    }
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setIsDragging(false);

    const file = event.dataTransfer.files[0];
    if (file) {
      void convertFile(file);
    }
  }

  function downloadText() {
    if (!result) {
      return;
    }

    const blob = new Blob([formattedText], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${result.fileName.replace(/\.pdf$/i, "")}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function downloadDocx() {
    if (!result) {
      return;
    }

    const { Document, Packer, Paragraph, TextRun } = await import("docx");
    const doc = new Document({
      sections: [
        {
          properties: {
            page: {
              margin: {
                top: 1440,
                right: 1440,
                bottom: 1440,
                left: 1440
              }
            }
          },
          children: formattedText.split("\n").map(
            (line) =>
              new Paragraph({
                spacing: {
                  after: line.trim() ? 160 : 240,
                  line: 360
                },
                children: [
                  new TextRun({
                    text: line,
                    font: "Courier New",
                    size: 36
                  })
                ]
              })
          )
        }
      ]
    });
    const blob = await Packer.toBlob(doc);
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${result.fileName.replace(/\.pdf$/i, "")}.docx`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function copyText() {
    if (result) {
      await navigator.clipboard.writeText(formattedText);
    }
  }

  return (
    <div className="converter">
      <label
        className={`dropzone ${isDragging ? "is-dragging" : ""}`}
        onDragOver={(event) => {
          event.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
      >
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          onChange={handleInputChange}
        />
        <span className="drop-icon" aria-hidden="true">
          PDF
        </span>
        <strong>Deposer un PDF ici</strong>
        <span>Seul le texte sera conservé, les images seront retirées.</span>
      </label>

      <div className="panel" aria-live="polite">
        <div className="panel-header">
          <div>
            <p className="eyebrow">eText</p>
            <h2>Texte extrait</h2>
          </div>
          <div className="actions">
            <button type="button" onClick={copyText} disabled={!result}>
              <span aria-hidden="true">⧉</span>
              Copier
            </button>
            <button type="button" onClick={downloadText} disabled={!result}>
              <span aria-hidden="true">↓</span>
              .txt
            </button>
            <button type="button" onClick={downloadDocx} disabled={!result}>
              <span aria-hidden="true">↓</span>
              .docx
            </button>
          </div>
        </div>

        {status === "idle" && (
          <p className="empty">Le texte converti apparaîtra ici après import.</p>
        )}
        {status === "reading" && <p className="empty">Conversion en cours...</p>}
        {status === "error" && <p className="error">{error}</p>}
        {status === "done" && result && (
          <>
            <div className="stats">
              <span>{result.pages} page(s)</span>
              <span>{wordCount} mot(s)</span>
              <span>{result.fileName}</span>
            </div>
            <textarea value={formattedText} readOnly spellCheck={false} />
          </>
        )}
      </div>
    </div>
  );
}

function buildEText(pagesText: string[]) {
  const body = pagesText
    .map((pageText, index) => {
      const printedPage = printedStartPage + index;
      const text =
        pageText.trim() || "Aucun texte sélectionnable n'a été trouvé sur cette page.";
      return `PAGE ${printedPage}\n${text}`;
    })
    .join("\n\n");

  return `${body}\nFIN DU DOCUMENT.`;
}
