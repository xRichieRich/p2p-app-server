FROM node:20-slim

WORKDIR /app

# Instalace závislostí
COPY package*.json ./
RUN npm install --production

# Kopírování zdrojových kódů serveru
COPY . .

# Port 7860 pro Hugging Face Spaces a 3000 pro standardní Docker
EXPOSE 7860
EXPOSE 3000

ENV PORT=7860
ENV HOST=0.0.0.0

CMD ["node", "server.js"]
