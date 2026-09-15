import OpenAI from "openai";
import { NextResponse } from "next/server";
import type { ResponseInputContent } from "openai/resources/responses/responses";

export const runtime = "nodejs";
export const maxDuration = 120;

const maxPdfSize = 12 * 1024 * 1024;
const inspectionTimeoutMs = 110_000;
const defaultModel = "gpt-5-nano";

const prompt =
  "Transforme ce PDF en eText accessible, en gardant l'ordre logique de lecture et en supprimant les images. " +
  "Inspecte aussi les images, captures, dessins, tableaux visuels et encadrés. " +
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

const localTextPrompt =
  "Voici le texte déjà extrait automatiquement du PDF. Utilise-le comme base principale pour accélérer le travail. " +
  "Inspecte le PDF seulement pour corriger l'ordre logique, compléter le texte présent dans les images, et retirer les éléments visuels décoratifs.";

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

    if (!(file instanceof File) || file.type !== "application/pdf") {
      return NextResponse.json({ error: "Fichier PDF invalide." }, { status: 400 });
    }

    if (file.size > maxPdfSize) {
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
    const shouldAttachPdf = pageImages.length === 0;
    const base64 = shouldAttachPdf
      ? Buffer.from(await file.arrayBuffer()).toString("base64")
      : "";

    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), inspectionTimeoutMs);

    const content: ResponseInputContent[] = [
      {
        type: "input_text",
        text:
          typeof localText === "string" && localText.trim()
            ? `${prompt}\n\n${localTextPrompt}\n\n${localText.slice(0, 80_000)}`
            : prompt
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

    const response = await client.responses
      .create(
        {
          model: process.env.OPENAI_MODEL ?? defaultModel,
          reasoning: {
            effort: "minimal"
          },
          text: {
            verbosity: "low"
          },
          input: [
            {
              role: "user",
              content
            }
          ]
        },
        {
          signal: abortController.signal
        }
      )
      .finally(() => clearTimeout(timeout));

    return NextResponse.json({
      text: response.output_text.trim()
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
