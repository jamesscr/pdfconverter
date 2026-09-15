# PDF vers eText

Application Next.js 16 et PWA pour convertir un PDF en texte électronique, puis exporter le résultat en `.txt` ou `.docx`.

Le convertisseur local conserve uniquement le texte sélectionnable du PDF. Le mode `IA` peut aussi transcrire le texte présent dans les images, tout en retirant les images elles-mêmes des exports.

## Développement

```bash
yarn install
yarn dev
```

## Production

```bash
yarn build
yarn start
```

## Déploiement Vercel

Vercel détecte automatiquement Next.js. Les commandes attendues sont :

- Install Command: `yarn install`
- Build Command: `yarn build`
- Output Directory: `.next`

Le fichier `vercel.json` ajoute les headers utiles pour le service worker, le manifeste et les icônes PWA.

## Inspection IA

Le bouton `IA` envoie le PDF à la route serveur `/api/inspect`, qui utilise OpenAI pour restructurer le PDF en eText accessible et transcrire le texte présent dans les images.

Variables d'environnement à ajouter dans Vercel :

- `OPENAI_API_KEY`
- `OPENAI_MODEL` optionnel, par défaut `gpt-5-nano`
- `OPENAI_VISION_MODEL` optionnel, par défaut `gpt-4o-mini` pour transcrire le texte visible dans les images
