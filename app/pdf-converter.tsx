"use client";

import { ChangeEvent, DragEvent, useMemo, useRef, useState } from "react";

type ConversionStatus = "idle" | "reading" | "done" | "error";
type InspectionStatus = "idle" | "inspecting";

type ConversionResult = {
  pagesText: string[];
  pages: number;
  fileName: string;
};

type PositionedTextItem = {
  str: string;
  transform: number[];
  width: number;
  height: number;
};

type TextCell = {
  x: number;
  text: string;
};

const printedStartPage = 1;

export function PdfConverter() {
  const [status, setStatus] = useState<ConversionStatus>("idle");
  const [result, setResult] = useState<ConversionResult | null>(null);
  const [error, setError] = useState("");
  const [inspectionStatus, setInspectionStatus] = useState<InspectionStatus>("idle");
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
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
    setSelectedFile(file);
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
        const text = extractPositionedText(content.items);

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

  async function inspectWithAi() {
    if (!selectedFile) {
      setStatus("error");
      setError("Importez un PDF avant de lancer l'inspection IA.");
      return;
    }

    setInspectionStatus("inspecting");
    setError("");

    try {
      const formData = new FormData();
      formData.append("file", selectedFile);
      formData.append("localText", formattedText);

      const response = await fetch("/api/inspect", {
        method: "POST",
        body: formData
      });
      const payload = parseInspectionResponse(await response.text());

      if (!response.ok || !payload.text) {
        throw new Error(payload.error ?? "Inspection IA impossible.");
      }

      setResult({
        pagesText: [normalizeAiText(payload.text).replace(/FIN DU DOCUMENT\.$/i, "").trim()],
        pages: 1,
        fileName: selectedFile.name
      });
      setStatus("done");
    } catch (inspectionError) {
      setStatus("error");
      setError(
        inspectionError instanceof Error
          ? inspectionError.message
          : "Impossible d'inspecter ce PDF avec l'IA."
      );
    } finally {
      setInspectionStatus("idle");
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
        <span>
          Local: texte sélectionnable. IA: texte sélectionnable et texte dans les images.
        </span>
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
            <button
              type="button"
              onClick={inspectWithAi}
              disabled={!selectedFile || inspectionStatus === "inspecting"}
            >
              <span aria-hidden="true">✦</span>
              {inspectionStatus === "inspecting" ? "Inspection..." : "IA"}
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
        {inspectionStatus === "inspecting" && (
          <p className="empty">
            Inspection IA en cours. Le PDF est restructuré et le texte dans les
            images est transcrit si présent.
          </p>
        )}
        {status === "error" && inspectionStatus !== "inspecting" && (
          <p className="error">{error}</p>
        )}
        {status === "done" && result && inspectionStatus !== "inspecting" && (
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
  if (pagesText.length === 1 && /^PAGE\s+\d+/im.test(pagesText[0])) {
    return `${pagesText[0].trim()}\nFIN DU DOCUMENT.`;
  }

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

function normalizeAiText(text: string) {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function parseInspectionResponse(responseText: string) {
  try {
    return JSON.parse(responseText) as { text?: string; error?: string };
  } catch {
    return {
      error:
        responseText.trim() ||
        "Le serveur a renvoyé une réponse invalide pendant l'inspection IA."
    };
  }
}

function extractPositionedText(items: unknown[]) {
  const textItems = items
    .filter(isPositionedTextItem)
    .filter((item) => item.str.trim())
    .filter((item) => !isLikelyPrintedPageNumber(item));

  if (!textItems.length) {
    return "";
  }

  const averageCharWidth =
    textItems.reduce((total, item) => {
      const normalizedLength = Math.max(item.str.trim().length, 1);
      return total + item.width / normalizedLength;
    }, 0) / textItems.length;
  const spaceWidth = Math.max(averageCharWidth, 3.8);
  const sortedItems = [...textItems].sort((first, second) => {
    const firstY = getY(first);
    const secondY = getY(second);

    if (Math.abs(firstY - secondY) > 4) {
      return secondY - firstY;
    }

    return getX(first) - getX(second);
  });

  const lines: PositionedTextItem[][] = [];

  for (const item of sortedItems) {
    const y = getY(item);
    const currentLine = lines[lines.length - 1];

    if (!currentLine || Math.abs(getLineY(currentLine) - y) > 5) {
      lines.push([item]);
    } else {
      currentLine.push(item);
    }
  }

  const rows = lines.map((line) => buildCellsFromPositionedRow(line, spaceWidth));

  return rowsToColumnBlocks(rows)
    .join("\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function buildCellsFromPositionedRow(line: PositionedTextItem[], spaceWidth: number) {
  const sortedLine = [...line].sort((first, second) => getX(first) - getX(second));
  const cells: TextCell[] = [];
  let cursor = sortedLine.length ? getX(sortedLine[0]) : 0;
  let text = "";
  let cellX = cursor;

  for (const item of sortedLine) {
    const x = getX(item);
    const gap = x - cursor;

    if (text && gap > spaceWidth * 3.5) {
      cells.push({ x: cellX, text: text.trim() });
      text = "";
      cellX = x;
    } else if (text && gap > spaceWidth * 0.9) {
      text += " ";
    }

    text += item.str;
    cursor = Math.max(cursor, x + item.width);
  }

  if (text.trim()) {
    cells.push({ x: cellX, text: text.trim() });
  }

  return cells;
}

function rowsToColumnBlocks(rows: TextCell[][]) {
  const output: string[] = [];
  let index = 0;

  while (index < rows.length) {
    const row = rows[index];

    if (row.length <= 1) {
      output.push(...row.map((cell) => cell.text));
      index += 1;
      continue;
    }

    const block: TextCell[][] = [];
    const anchors = row.map((cell) => cell.x).sort((a, b) => a - b);

    while (
      index < rows.length &&
      (rows[index].length > 1 || isOrphanTableCell(rows[index], anchors))
    ) {
      block.push(rows[index]);
      index += 1;
    }

    output.push(...tableBlockToSingleColumn(block));
  }

  return output;
}

function isOrphanTableCell(row: TextCell[], anchors: number[]) {
  if (row.length !== 1 || anchors.length < 2) {
    return false;
  }

  const x = row[0].x;
  const firstColumnWidth = anchors[1] - anchors[0];

  return x > anchors[0] + firstColumnWidth * 0.55 && x < anchors[anchors.length - 1] + 90;
}

function tableBlockToSingleColumn(block: TextCell[][]) {
  const anchors = [...block[0].map((cell) => cell.x)].sort((a, b) => a - b);
  const columns = anchors.map((): string[] => []);

  for (const row of block) {
    for (const cell of row) {
      const columnIndex = findNearestColumn(cell.x, anchors);
      columns[columnIndex].push(cell.text);
    }
  }

  return columns.flatMap((column) => column.filter(Boolean));
}

function findNearestColumn(x: number, anchors: number[]) {
  let nearestIndex = 0;
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (let index = 0; index < anchors.length; index += 1) {
    const distance = Math.abs(x - anchors[index]);

    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = index;
    }
  }

  return nearestIndex;
}

function isPositionedTextItem(item: unknown): item is PositionedTextItem {
  return (
    typeof item === "object" &&
    item !== null &&
    "str" in item &&
    "transform" in item &&
    "width" in item &&
    "height" in item &&
    typeof (item as PositionedTextItem).str === "string" &&
    Array.isArray((item as PositionedTextItem).transform)
  );
}

function isLikelyPrintedPageNumber(item: PositionedTextItem) {
  return /^\d+$/.test(item.str.trim()) && getY(item) < 55;
}

function getX(item: PositionedTextItem) {
  return item.transform[4] ?? 0;
}

function getY(item: PositionedTextItem) {
  return item.transform[5] ?? 0;
}

function getLineY(line: PositionedTextItem[]) {
  return line.reduce((total, item) => total + getY(item), 0) / line.length;
}
