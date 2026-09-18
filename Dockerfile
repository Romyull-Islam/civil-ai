# Civil AI — production image (any VPS / Railway / Fly). Build: docker build -t civil-ai . ; Run: docker run -p 3000:3000 --env-file .env.local civil-ai
FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build && cp -r public .next/standalone/ && cp -r .next/static .next/standalone/.next/

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000 CIVIL_AI_MODE=saas CIVIL_AI_LOCAL_AI=0
COPY --from=build /app/.next/standalone ./
EXPOSE 3000
CMD ["node", "server.js"]
