# Deploying the web app

The web app is a static site. Visitors paste a GitHub repository or pick a folder, and the analysis runs **in their own
browser** (the parser is WebAssembly, in a Web Worker), so hosting it needs no server, no secrets and no per-visit cost.
Their code is never sent to your host; for GitHub repositories the browser downloads the files straight from
`api.github.com` and `raw.githubusercontent.com`.

```bash
npm install
npm run build:web          # writes packages/web/dist
npx serve packages/web/dist   # or any static file server
```

## Vercel (recommended: free)

1. Sign in at <https://vercel.com> with GitHub. The free Hobby plan is enough.
2. Click **Add New → Project** and import `harsharajkumar-273/CodeGraph`.
3. Vercel detects two apps (the `Dockerfile` and `packages/web`) and offers a multi-service import. Don't use it.
   Set **Root Directory** to `packages/web` instead, so it is imported as one Vite project. Its `vercel.json`
   supplies the install command, build command and output folder, so leave those alone, and click **Deploy**.
4. Vercel prints a `https://<project>.vercel.app` URL. Every push to `main` redeploys it.

Share a ready-made analysis with a link such as `https://<project>.vercel.app/?repo=pallets/flask`. `?repo=` takes
`owner/repo`, `owner/repo@branch` or a `github.com` URL.

**Limits to know about**
- GitHub allows 60 anonymous API requests per hour per visitor IP. One analysis uses 2 (1 when the branch is given),
  so a visitor can run about 30 analyses an hour. The page explains it when a visitor hits the limit.
- Only public repositories can be read from GitHub by a browser. For a private one, download it (or clone it) and drop the folder or the .zip onto the page, or use the CLI.
- Very large repositories are trimmed to 3,000 source files (tests and examples first), and files over 1 MB are
  skipped; the page says when it does this.

## Google Cloud Run, AWS: serve one fixed graph

These two host a container that runs `codegraph serve --graph` on a graph built when the image is built (Flask 3.1.0
by default; `--build-arg DEMO_REPO=https://github.com/honojs/hono --build-arg DEMO_REF=v4.6.0` for another). The same
web app is served, opening straight onto that graph, and visitors can still use "Analyze another". Prefer Vercel unless
you need to host it yourself on those platforms.

```bash
docker build -t codegraph-demo .
docker run -p 8080:8080 codegraph-demo        # http://localhost:8080
```

### Google Cloud Run

Cloud Run scales to zero, so an idle demo costs nothing, and its free tier covers a low-traffic demo. You still need
a billing account attached to the project.

1. Create a project at <https://console.cloud.google.com> and attach billing.
2. Open **Cloud Shell** (the `>_` icon, top right). It already has `gcloud`, `git` and Docker, and is already logged
   in.
3. Run:

```bash
git clone https://github.com/harsharajkumar-273/CodeGraph && cd CodeGraph
gcloud config set project YOUR_PROJECT_ID
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com
gcloud run deploy codegraph-demo --source . --region us-central1 \
  --allow-unauthenticated --memory 512Mi --max-instances 2 --min-instances 0
```

The last command builds the `Dockerfile` with Cloud Build and prints the public `https://codegraph-demo-….run.app`
URL. `--max-instances 2` caps what a traffic spike can cost. To redeploy after a change, `git pull` and rerun the
same `gcloud run deploy` command.

### AWS (Lightsail)

The simplest AWS route is **Lightsail container service**. It has a fixed monthly price, starting with the Nano
size, and does not scale to zero.

```bash
docker build -t codegraph-demo .
aws lightsail create-container-service --service-name codegraph-demo --power nano --scale 1
aws lightsail push-container-image --service-name codegraph-demo --label demo --image codegraph-demo
# then deploy the pushed image (":codegraph-demo.demo.N") with container port 8080 open, public endpoint on 8080:
aws lightsail create-container-service-deployment --service-name codegraph-demo \
  --containers '{"app":{"image":":codegraph-demo.demo.1","ports":{"8080":"HTTP"}}}' \
  --public-endpoint '{"containerName":"app","containerPort":8080,"healthCheck":{"path":"/"}}'
```

`push-container-image` needs the `lightsailctl` plugin. ECS Fargate behind a load balancer also works, but it is more
setup and more fixed cost for a single demo container.
