# PDF vers eText

Application Next.js 16 et PWA pour convertir un PDF en texte électronique, puis exporter le résultat en `.txt` ou `.docx`.

Le convertisseur conserve uniquement le texte sélectionnable du PDF. Les images ne sont pas incluses dans les exports.

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
