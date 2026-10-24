import { Suspense } from "react";
import { connection } from "next/server";

type Article = {
  id: number;
  documentId: string;
  title: string;
  summary: string | null;
};

// URL interne au réseau Docker (nom du service), lue à l'exécution et non au build
async function getArticles(): Promise<Article[]> {
  await connection();
  const baseUrl = process.env.STRAPI_URL ?? "http://localhost:1337";
  const res = await fetch(`${baseUrl}/api/articles`, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Strapi a répondu ${res.status}`);
  }
  const json: { data: Article[] } = await res.json();
  return json.data;
}

async function Articles() {
  try {
    const articles = await getArticles();
    if (articles.length === 0) {
      return <p>Aucun article publié pour le moment.</p>;
    }
    return (
      <ul>
        {articles.map((article) => (
          <li key={article.documentId}>
            <h2>{article.title}</h2>
            {article.summary && <p>{article.summary}</p>}
          </li>
        ))}
      </ul>
    );
  } catch (error) {
    return <p className="error">Impossible de joindre Strapi : {String(error)}</p>;
  }
}

export default function Home() {
  return (
    <main>
      <h1>Next.js + Strapi + PostgreSQL</h1>
      <Suspense fallback={<p>Chargement des articles…</p>}>
        <Articles />
      </Suspense>
    </main>
  );
}
