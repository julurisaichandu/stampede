FROM node:24-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl unzip && rm -rf /var/lib/apt/lists/*
RUN curl -fsSL https://bun.sh/install | bash -s "bun-v1.4.4"
ENV PATH=/root/.bun/bin:$PATH
WORKDIR /app
COPY . .
RUN cd apps/api && npm ci
RUN cd apps/web && npm ci && npm run build
RUN cd services/actors && bun install --frozen-lockfile
EXPOSE 5173
CMD ["scripts/cloud.sh"]
