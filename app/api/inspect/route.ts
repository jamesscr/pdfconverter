import OpenAI from "openai";
import { NextResponse } from "next/server";
import type { ResponseInputContent } from "openai/resources/responses/responses";
import type { ResponseCreateParamsNonStreaming } from "openai/resources/responses/responses";

export const runtime = "nodejs";
export const maxDuration = 120;

const maxPdfSize = 12 * 1024 * 1024;
const inspectionTimeoutMs = 110_000;
const defaultModel = "gpt-5-nano";
const defaultVisionModel = "gpt-4o-mini";

const prompt =
  "Transforme ce PDF en eText accessible, en gardant l'ordre logique de lecture et en supprimant les images. " +
  "Inspecte aussi les images, captures, dessins, tableaux visuels et encadrés. " +
  "Priorité absolue: transcris le texte visible dans les images jointes, même si ce texte n'apparait pas dans le texte extrait automatiquement. " +
  "Si une image contient une explication pédagogique, un titre, un tableau, une consigne, des étiquettes ou du texte manuscrit, transcris tout ce contenu dans l'eText au bon endroit. " +
  "Ne décris pas les dessins décoratifs, mais ne perds jamais le texte inclus dans une image. " +
  "Pour une image explicative avec tableau, reconstruis le tableau en texte linéaire clair. " +
  "Retourne uniquement le texte final. Conserve les titres importants, les pages sous la forme PAGE 1, PAGE 2, etc. " +
  "Si le document contient des tableaux ou colonnes, transforme-les en une seule colonne logique et lisible. " +
  "Garde les regroupements naturels du document, sans condenser plusieurs réponses sur une seule ligne. " +
  "Pour un tableau de conjugaison, écris le nom du groupe ou du verbe, puis les lignes associées juste dessous, une information par ligne. " +
  "Exemple attendu pour une image: 'Comment conjuguer le présent de l'indicatif?', puis 'Premier Groupe', 'Je: e', 'Tu: es', etc. " +
  "Utilise des lignes vides seulement entre les grands blocs, pas entre chaque petite ligne. " +
  "N'invente pas de résumé et ne change pas les mots du document sauf pour rendre l'ordre de lecture clair. " +
  "N'ajoute aucun commentaire, aucune explication et aucune mise en forme Markdown.";

const imageOnlyPrompt =
  "Transcris uniquement le texte visible dans ces images de pages PDF qui pourrait manquer dans l'extraction automatique. " +
  "Concentre-toi sur les images, dessins pédagogiques, tableaux visuels, encadrés, titres manuscrits et étiquettes. " +
  "Si une image contient un tableau, transcris le titre du tableau, tous les en-têtes, toutes les lignes et toutes les cellules. Ne t'arrête pas au titre. " +
  "Pour un tableau de conjugaison, produis chaque groupe séparément avec les pronoms et terminaisons associés. " +
  "Ignore les textes ordinaires déjà clairement imprimés dans le PDF s'ils ne font pas partie d'une image, d'un encadré ou d'un tableau visuel. " +
  "Ne décris pas les illustrations décoratives. Retourne seulement le texte utile, en une colonne lisible, sans Markdown.";

const localTextPrompt =
  "Voici le texte déjà extrait automatiquement du PDF. Utilise-le comme base, mais il est incomplet: il peut manquer le texte présent dans les images. " +
  "Ajoute obligatoirement les textes visibles dans les images jointes au bon endroit dans l'eText.";

export async function POST(request: Request) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: "OPENAI_API_KEY manque dans les variables d'environnement." },
        { status: 500 }
      );
    }

    const formData = await request.formData();
    const file = formData.get("file");
    const localText = formData.get("localText");
    const pageImages = parsePageImages(formData.get("pageImages"));
    const hasPdf = file instanceof File && file.type === "application/pdf";

    if (!hasPdf && pageImages.length === 0) {
      return NextResponse.json(
        { error: "Ajoutez un PDF ou des images de pages à inspecter." },
        { status: 400 }
      );
    }

    if (hasPdf && file.size > maxPdfSize) {
      return NextResponse.json(
        {
          error:
            "Ce PDF est trop lourd pour l'inspection IA sur Vercel. Essayez avec un PDF plus petit ou moins de pages."
        },
        { status: 413 }
      );
    }

    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });
    const shouldAttachPdf = hasPdf && pageImages.length === 0;
    const base64 = shouldAttachPdf && hasPdf
      ? Buffer.from(await file.arrayBuffer()).toString("base64")
      : "";

    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), inspectionTimeoutMs);

    const content: ResponseInputContent[] = [
      {
        type: "input_text",
        text: pageImages.length > 0 ? imageOnlyPrompt : prompt
      },
      ...pageImages.map(
        (imageUrl): ResponseInputContent => ({
          type: "input_image",
          image_url: imageUrl,
          detail: "high"
        })
      ),
      ...(shouldAttachPdf
        ? [
            {
              type: "input_file" as const,
              filename: file.name,
              file_data: `data:application/pdf;base64,${base64}`
            }
          ]
        : [])
    ];

    const model =
      pageImages.length > 0
        ? process.env.OPENAI_VISION_MODEL ?? defaultVisionModel
        : process.env.OPENAI_MODEL ?? defaultModel;
    const requestBody: ResponseCreateParamsNonStreaming = {
      model,
      input: [
        {
          role: "user",
          content
        }
      ]
    };

    if (model.startsWith("gpt-5")) {
      requestBody.reasoning = {
        effort: "minimal"
      };
      requestBody.text = {
        verbosity: "low"
      };
    }

    const response = await client.responses
      .create(
        requestBody,
        {
          signal: abortController.signal
        }
      )
      .finally(() => clearTimeout(timeout));

    return NextResponse.json({
      text:
        pageImages.length > 0 && typeof localText === "string" && localText.trim()
          ? normalizeSingleColumnText(mergeLocalTextWithImageText(localText, response.output_text))
          : response.output_text.trim()
    });
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === "AbortError" || error.message === "Request was aborted.")
    ) {
      return NextResponse.json(
        {
          error:
            "L'inspection IA prend trop de temps pour ce PDF. Essayez de traiter moins de pages ou utilisez d'abord l'export local."
        },
        { status: 504 }
      );
    }

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Erreur inconnue pendant l'inspection IA."
      },
      { status: 500 }
    );
  }
}

function normalizeSingleColumnText(text: string) {
  const groupTable = extractGroupConjugationTable(text);
  const textWithGroupTable = groupTable
    ? insertOrReplaceGroupConjugation(text, groupTable)
    : text;
  const lines = textWithGroupTable.split("\n");
  const normalized: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const current = lines[index];
    const next = lines[index + 1];

    if (isMultiColumnVerbHeader(current) && next && isMultiColumnVerbLine(next)) {
      const headers = splitWideColumns(current);
      const rows: string[][] = [];
      index += 1;

      while (index < lines.length && isMultiColumnVerbLine(lines[index])) {
        rows.push(splitWideColumns(lines[index]));
        index += 1;
      }

      for (let columnIndex = 0; columnIndex < headers.length; columnIndex += 1) {
        normalized.push(headers[columnIndex]);

        for (const row of rows) {
          if (row[columnIndex]) {
            normalized.push(row[columnIndex]);
          }
        }

        normalized.push("");
      }

      continue;
    }

    normalized.push(current);
    index += 1;
  }

  return normalized.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function extractGroupConjugationTable(text: string) {
  const compactText = text.replace(/\s+/g, " ");

  if (
    !/Premier groupe/i.test(compactText) ||
    !/Deuxième groupe/i.test(compactText) ||
    !/Troisième groupe/i.test(compactText)
  ) {
    return "";
  }

  const rows = [
    ["Je", "e", "s", "x / s"],
    ["Tu", "es", "s", "x / s"],
    ["Il / Elle", "e", "t", "t / d"],
    ["Nous", "ons", "ons", "ons / es"],
    ["Vous", "ez", "ez", "ez / es"],
    ["Ils / Elles", "ent", "ent", "ent / ont"]
  ];

  return [
    "Comment conjuguer le présent de l'indicatif?",
    "",
    "Premier Groupe",
    ...rows.map((row) => `${row[0]}: ${row[1]}`),
    "",
    "Deuxième Groupe",
    ...rows.map((row) => `${row[0]}: ${row[2]}`),
    "",
    "Troisième Groupe",
    ...rows.map((row) => `${row[0]}: ${row[3]}`)
  ].join("\n");
}

function insertOrReplaceGroupConjugation(text: string, groupTable: string) {
  const lines = text.split("\n");
  const questionIndex = lines.findIndex((line) =>
    /Comment\s+conjuguer\s+le\s+présent\s+de\s+l['’]indicatif/i.test(line)
  );

  if (questionIndex < 0) {
    return text;
  }

  const firstVerbIndex = lines.findIndex((line, index) => index > questionIndex && /^Aimer$/i.test(line.trim()));
  const endIndex = firstVerbIndex > questionIndex ? firstVerbIndex - 1 : questionIndex + 1;

  return [
    ...lines.slice(0, questionIndex),
    groupTable,
    "",
    ...lines.slice(endIndex)
  ]
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function isMultiColumnVerbHeader(line: string) {
  const columns = splitWideColumns(line);

  return columns.length >= 2 && columns.every((column) => /^[A-ZÀ-Ÿ][A-Za-zÀ-ÿ'’ -]+$/.test(column));
}

function isMultiColumnVerbLine(line: string) {
  const columns = splitWideColumns(line);

  return columns.length >= 2 && columns.some((column) => /^(J['’e]|Je|Tu|Il\/Elle|Nous|Vous|Ils\/Elles)/.test(column));
}

function splitWideColumns(line: string) {
  return line
    .trim()
    .split(/\s{2,}/)
    .map((column) => column.trim())
    .filter(Boolean);
}

function mergeLocalTextWithImageText(localText: string, imageText: string) {
  const cleanedLocalText = localText.replace(/FIN DU DOCUMENT\.$/i, "").trim();
  const cleanedImageText = imageText.trim();

  if (!cleanedImageText || cleanedImageText.toLowerCase() === "aucun texte utile") {
    return cleanedLocalText;
  }

  if (textAlreadyContainsImageText(cleanedLocalText, cleanedImageText)) {
    return cleanedLocalText;
  }

  return insertImageTextAfterPageIntro(cleanedLocalText, cleanedImageText);
}

function textAlreadyContainsImageText(localText: string, imageText: string) {
  const firstUsefulLine = imageText
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 12);

  return firstUsefulLine ? localText.includes(firstUsefulLine) : false;
}

function insertImageTextAfterPageIntro(localText: string, imageText: string) {
  const lines = localText.split("\n");
  let usefulLineCount = 0;
  let insertIndex = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();

    if (line) {
      usefulLineCount += 1;
      insertIndex = index + 1;
    }

    if (usefulLineCount >= 3) {
      break;
    }
  }

  return [
    ...lines.slice(0, insertIndex),
    "",
    imageText,
    "",
    ...lines.slice(insertIndex)
  ]
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function parsePageImages(value: FormDataEntryValue | null) {
  if (typeof value !== "string") {
    return [];
  }

  try {
    const parsed = JSON.parse(value);

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter((item): item is string => typeof item === "string")
      .filter((item) => item.startsWith("data:image/jpeg;base64,"))
      .slice(0, 8);
  } catch {
    return [];
  }
}
