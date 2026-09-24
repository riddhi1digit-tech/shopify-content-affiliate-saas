FROM node:22-alpine
RUN apk add --no-cache openssl
RUN npm install --global pnpm@11.13.1

EXPOSE 3000

WORKDIR /app

ENV NODE_ENV=production

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./

RUN pnpm install --frozen-lockfile

COPY . .

RUN pnpm run build

CMD ["pnpm", "run", "docker-start"]
