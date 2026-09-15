import OpenAI from "openai";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

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

    if (!(file instanceof File) || file.type !== "application/pdf") {
      return NextResponse.json({ error: "Fichier PDF invalide." }, { status: 400 });
    }

    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });
    const buffer = Buffer.from(await file.arrayBuffer());
    const base64 = buffer.toString("base64");

    const response = await client.responses.create({
      model: process.env.OPENAI_MODEL ?? "gpt-5",
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: prompt
            },
            {
              type: "input_file",
              filename: file.name,
              file_data: `data:application/pdf;base64,${base64}`
            }
          ]
        }
      ]
    });

    return NextResponse.json({
      text: response.output_text.trim()
    });
  } catch (error) {
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
