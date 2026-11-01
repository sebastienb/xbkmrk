FROM node:20-alpine
WORKDIR /app
# Codex CLI (optional LLM_PROVIDER=codex backend; static musl binary, runs on alpine)
RUN npm install -g @openai/codex
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY tsconfig.json ./
COPY src ./src
CMD ["npm", "start"]
