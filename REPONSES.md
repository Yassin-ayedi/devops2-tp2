# Réponses TP2 — Docker Compose

Module DevOps 2 (ECUE733) · Fork : https://github.com/Yassin-ayedi/devops2-tp2

> Les réponses marquées **(à vérifier)** dépendent d'une observation sur la machine : contrôlez-les avec vos propres commandes et corrigez si le résultat diffère.

---

## Partie 1 — Les deux applications

### Q1. Variables attendues par Strapi pour PostgreSQL

`backend/config/database.js` lit ses paramètres dans les variables d'environnement :

- `DATABASE_CLIENT` (ici `postgres`)
- `DATABASE_HOST`
- `DATABASE_PORT` (5432)
- `DATABASE_NAME`
- `DATABASE_USERNAME`
- `DATABASE_PASSWORD`
- (facultatives) `DATABASE_SSL`, `DATABASE_SCHEMA`, `DATABASE_URL`

`DATABASE_HOST` doit valoir **`postgres`**, le nom du service dans `docker-compose.yml`. Docker fournit un DNS interne qui traduit ce nom en l'adresse IP du conteneur PostgreSQL sur le réseau partagé.

On ne met pas `localhost` car, dans un conteneur, `localhost` désigne **le conteneur lui-même**. Le conteneur Strapi n'a pas de PostgreSQL en local : la connexion échouerait.

### Q2. Rôle de `.env.example` et pourquoi ne pas commiter `.env`

`.env.example` est un **modèle** : il liste toutes les variables nécessaires avec des valeurs d'exemple. Il est commité pour que n'importe qui puisse faire `cp .env.example .env` et savoir quoi renseigner.

Le vrai `.env` contient les **secrets réels** (mots de passe, clés JWT, `APP_KEYS`…). Le commiter les exposerait à toute personne ayant accès au dépôt. Même supprimé ensuite, le secret resterait dans l'historique Git et devrait être considéré comme compromis. C'est pourquoi `.env` est dans `.gitignore`.

---

## Partie 2 — PostgreSQL

### Q3. `docker compose down` et `docker compose down -v`

- `docker compose down` arrête et **supprime les conteneurs et les réseaux** du projet. Les **volumes nommés sont conservés** : la base (`pgdata`) et ses données survivent au prochain `up`.
- `docker compose down -v` fait la même chose et **supprime aussi les volumes** (`pgdata`, `pgadmin-data`, `strapi-uploads`). Toutes les données sont perdues et la base repart de zéro.

Test effectué : après `docker compose down` puis `up -d`, `curl http://localhost:1337/api/articles` renvoie toujours « article 1 » et « article 2 », car les volumes (`tp2_pgdata`, `tp2_pgadmin-data`, `tp2_strapi-uploads`) apparaissent toujours dans `docker volume ls`. Après `docker compose down -v`, Docker affiche `Volume tp2_pgdata Removed` (idem pour `tp2_pgadmin-data` et `tp2_strapi-uploads`), `docker volume ls` ne liste plus aucun volume `tp2_*`, et au `up -d` suivant les volumes sont recréés vides : `curl http://localhost:1337/api/articles` renvoie `403 Forbidden`, car les articles et les permissions du rôle Public, stockés dans la base, ont été perdus.

### Q4. Pourquoi `$${POSTGRES_USER}` avec deux `$`

Docker Compose remplace lui-même les `${VAR}` au moment de lire le fichier, avec les valeurs du `.env` de la machine hôte. Avec `$$`, Compose n'interprète pas la variable et la transmet sous la forme `$` littéral. C'est donc le shell **à l'intérieur du conteneur** (`CMD-SHELL`) qui développe `${POSTGRES_USER}`, à partir des variables d'environnement du conteneur PostgreSQL.

---

## Partie 3 — pgAdmin

### Q5. `"Host": "postgres"`, `:ro` et `${PGADMIN_PORT:-5050}`

- `"Host": "postgres"` : c'est le nom du service PostgreSQL. pgAdmin tourne dans un conteneur sur le même réseau (`backend`), et le DNS de Docker résout ce nom. `localhost` désignerait le conteneur pgAdmin lui-même.
- `:ro` (read-only) : le fichier `servers.json` est monté **en lecture seule** dans le conteneur. pgAdmin peut le lire mais pas le modifier, ce qui protège le fichier de l'hôte.
- `${PGADMIN_PORT:-5050}` : utilise la valeur de `PGADMIN_PORT` si elle est définie et non vide, sinon la **valeur par défaut 5050**.

---

## Partie 4 — Strapi

### Q6. Pourquoi copier `package*.json` et lancer `npm ci` avant le reste

Docker construit l'image par **couches mises en cache**. Une couche est reconstruite seulement si son contenu ou ses entrées ont changé, et toutes les couches suivantes sont alors rejouées. Les dépendances changent rarement, le code souvent. En copiant d'abord `package.json` et `package-lock.json`, la couche `npm ci` (longue) reste en cache tant que les dépendances ne changent pas.

Si on modifie un fichier de `backend/config/` : les étapes jusqu'à `RUN npm ci` sont en cache (`CACHED`). Sont rejouées `COPY . .` (le contenu a changé), puis `RUN npm run build` et, dans l'étape finale, le `COPY --from=build`. **(à vérifier avec `docker build -t tp2/strapi ./backend`)**

### Q7. `USER node` et `--chown=node:node`

- `USER node` : le processus s'exécute avec l'utilisateur non privilégié `node` au lieu de `root`. Si l'application est compromise, l'attaquant a moins de droits dans le conteneur (principe du moindre privilège).
- `--chown=node:node` : par défaut, `COPY` crée les fichiers appartenant à `root`. Cette option les donne à `node`, afin que l'application puisse écrire dans ses dossiers (cache, `.tmp`, uploads) sans être root.

### Q8. `depends_on: condition: service_healthy`

Compose attend que le healthcheck du service dépendant soit **`healthy`** avant de démarrer le service. Ici, Strapi ne démarre que lorsque PostgreSQL accepte réellement les connexions (`pg_isready`).

Sans cette condition, Compose attend seulement que le conteneur PostgreSQL soit *démarré* (pas prêt). Strapi pourrait alors essayer de se connecter trop tôt, échouer avec une erreur de connexion refusée, puis planter ou redémarrer en boucle.

### Q9. Lignes de la table `articles` pour un article publié

Un article publié apparaît sur **2 lignes** dans la table `articles` : une version brouillon (`published_at` vide) et une version publiée (`published_at` renseigné), qui partagent le même `document_id`. C'est le fonctionnement de Draft & Publish dans Strapi 5.

Observé : avec 2 articles publiés, `SELECT count(*) FROM articles;` renvoie **4** lignes (ids 1 et 2 pour « article 1 », ids 3 et 4 pour « article 2 »). Seules les lignes publiées (ids 2 et 4) sont renvoyées par l'API publique.

---

## Partie 5 — Next.js

### Q10. Pourquoi `STRAPI_URL=http://localhost:1337` ne marche pas dans le conteneur

Le code de `page.tsx` s'exécute **côté serveur, dans le conteneur `frontend`**. Là, `localhost` désigne le conteneur frontend lui-même, où rien n'écoute sur le port 1337. Il faut utiliser le nom du service, `http://strapi:1337`, résolu par le DNS Docker sur le réseau `frontend`.

### Q11. Étapes du Dockerfile frontend, image finale et `standalone`

- Le Dockerfile a **3 étapes** (`FROM`) : `deps`, `builder`, `runner`.
- L'image finale est celle de `runner` : Node 22 Alpine, le dossier `public`, le serveur minimal `.next/standalone` (avec seulement les `node_modules` nécessaires) et `.next/static`. Elle ne contient ni les sources, ni les dépendances de développement, ni le cache de build.
- Sans `output: "standalone"`, Next.js ne génère pas `.next/standalone`. Le build échoue à l'étape `runner 4/5` : `COPY --from=builder --chown=node:node /app/.next/standalone ./` renvoie `"/app/.next/standalone": not found`. Pour faire tourner l'application sans `standalone`, il faudrait copier tout `node_modules` et `.next` dans l'image finale, ce qui la rendrait beaucoup plus lourde.
- Taille de l'image finale avec `standalone` : **333 Mo** (`docker images tp2/frontend`).

---

## Partie 6 — Réseaux et sécurité

### Q12. `strapi` dans les deux réseaux, et aucun port pour `postgres`

- `strapi` fait le **pont** entre les deux réseaux : il doit joindre `postgres` (réseau `backend`) et être joignable par `frontend` (réseau `frontend`). Le frontend n'a ainsi aucun accès direct à la base.
- Ne publier aucun port pour `postgres` le rend **injoignable depuis la machine hôte et depuis l'extérieur**. Seuls les conteneurs du réseau `backend` (Strapi, pgAdmin) peuvent l'atteindre. Cela réduit la surface d'attaque.

### Q13. Deux mesures de durcissement pour la production

1. **Régénérer tous les secrets** (`openssl rand -base64 16`) et ne plus utiliser les valeurs d'exemple. Les stocker dans un gestionnaire de secrets (Docker secrets, Vault) plutôt que dans un `.env`.
2. **Ne pas exposer pgAdmin ni Strapi directement** : retirer ou restreindre le port de pgAdmin, et placer un reverse proxy (Nginx, Traefik) avec HTTPS devant le frontend et l'API.

Autres mesures possibles : fixer les versions exactes des images (pas de `latest`), limiter les ressources (CPU, mémoire), système de fichiers en lecture seule, scan des images, sauvegardes automatiques de la base.

---

## Partie 7 — Cycle de vie

### Q14. `restart: unless-stopped`

Cette politique redémarre automatiquement le conteneur **s'il s'arrête** (crash, erreur, redémarrage du démon Docker ou de la machine), **sauf si on l'a arrêté nous-mêmes**.

Avec `docker compose stop strapi` (ou `kill`), l'arrêt est volontaire : Docker mémorise que le conteneur a été arrêté manuellement et ne le relance pas. Il ne redémarrera pas non plus au reboot de la machine tant qu'on ne l'a pas relancé (`docker compose start strapi`).

Docker le redémarre automatiquement quand le processus se termine tout seul (plantage ou code de sortie anormal) ou quand le démon Docker redémarre alors que le conteneur n'avait pas été arrêté à la main.
