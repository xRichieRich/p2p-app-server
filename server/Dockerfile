FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
EXPOSE 10000
EXPOSE 7860
EXPOSE 3000
ENV HOST=0.0.0.0
CMD ["node", "server.js"]
