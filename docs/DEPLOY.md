# Deploying the public demo

Every option below publishes a **read-only demo**: the graph of one repo (Flask 3.1.0 by default), built ahead of
time. Visitors can browse that graph, but nothing they do makes anything clone or parse code. Vercel serves it as a
static site. For Cloud Run and AWS, the `Dockerfile` indexes the repo at image build time and runs
`codegraph serve --graph` on it, as a non-root user listening on `$PORT` (default 8080).

```bash
docker build -t codegraph-demo .
docker run -p 8080:8080 codegraph-demo        # http://localhost:8080
```

To show a different repo, pass build args:
`--build-arg DEMO_REPO=https://github.com/honojs/hono --build-arg DEMO_REF=v4.6.0`. `DEMO_REF` must be a branch or a
tag.

## Vercel (recommended: static, free)

The demo needs no server: `npm run build:demo` builds the UI and indexes the demo repo into a static `graph.json`,
and `packages/web/vercel.json` routes the UI's `/api/graph` request to it. (The root `vercel.json` does the same for
an import with Root Directory `.`, which Vercel's multi-service detection can get in the way of.)

1. Sign in at <https://vercel.com> with GitHub. The free Hobby plan is enough.
2. Click **Add New → Project** and import `harsharajkumar-273/CodeGraph`.
3. Vercel detects two apps (the `Dockerfile` and `packages/web`) and offers a multi-service import. Don't use it.
   Set **Root Directory** to `packages/web` instead, so it is imported as one Vite project. Its `vercel.json`
   supplies the install command, build command and output folder, so leave those alone, and click **Deploy**.
4. Vercel prints a `https://<project>.vercel.app` URL. Every push to `main` redeploys it.

To show a different repo, set `DEMO_REPO` (a git URL) and `DEMO_REF` (a branch or tag) under **Settings →
Environment Variables**, then redeploy. To try the static build locally, run `npm run build:demo` and serve
`packages/web/dist` with the same rewrite.

## Google Cloud Run

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

## AWS (alternative)

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
