# Deploying the public demo

The `Dockerfile` builds a **read-only demo**: it indexes one repo at image build time (Flask 3.1.0 by default) and
runs `codegraph serve --graph` on it. Visitors can browse that graph; they cannot make the server clone or parse
anything, so there is no untrusted input beyond URL paths. The container runs as a non-root user and listens on
`$PORT`, defaulting to 8080.

```bash
docker build -t codegraph-demo .
docker run -p 8080:8080 codegraph-demo        # http://localhost:8080
```

To show a different repo, pass build args:
`--build-arg DEMO_REPO=https://github.com/honojs/hono --build-arg DEMO_REF=v4.6.0`. `DEMO_REF` must be a branch or a
tag.

## Google Cloud Run (recommended)

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
