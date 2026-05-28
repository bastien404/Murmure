# Murmure — image de production
FROM node:20-alpine

# Sécurité : tini pour la gestion des signaux (arrêt propre)
RUN apk add --no-cache tini

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=2704

# Installe les dépendances en premier (cache de couche)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copie le code applicatif
COPY server.js ./
COPY public ./public

# Dossier de données persistant (vapid, abonnements, salons, secret)
RUN mkdir -p /app/data && chown -R node:node /app

USER node

EXPOSE 2704

# Vérifie que le serveur répond
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||2704)+'/',r=>process.exit(r.statusCode<500?0:1)).on('error',()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.js"]
