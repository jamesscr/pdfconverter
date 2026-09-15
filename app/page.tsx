import { PdfConverter } from "./pdf-converter";
import { ServiceWorkerRegistration } from "./service-worker-registration";

export default function Home() {
  return (
    <main className="shell">
      <ServiceWorkerRegistration />
      <section className="workspace" aria-labelledby="page-title">
        <div className="intro">
          <div className="brand-mark" aria-hidden="true">
            <span>eT</span>
          </div>
          <p className="eyebrow">Convertisseur PWA</p>
          <h1 id="page-title">PDF vers eText</h1>
          <p>
            Importez un PDF et obtenez un texte électronique propre, lisible,
            copiable et téléchargeable. Le mode IA peut aussi transcrire le texte
            présent dans les images.
          </p>
        </div>
        <PdfConverter />
      </section>
    </main>
  );
}
