# Murmure · Chat chiffré

Messagerie web **chiffrée de bout en bout** pour deux personnes. Un code secret partagé sert de clé : le serveur ne déchiffre rien, ne stocke que du ciphertext, et l'historique est purgé en 6h.

🌐 Démo : https://chat.bastienbrousse.pro

---

## Fonctionnalités

- 🔐 **E2E AES-256-GCM** — clé dérivée du code via PBKDF2-SHA256 (250 000 itérations), faite côté navigateur (WebCrypto)
- 🆔 **Empreinte cryptographique** affichée des deux côtés pour vérification
- 💬 **Messages texte** + édition, *réponses*, accusés de lecture (✓✓)
- 🖼️ **Images** chiffrées (compression WebP, GIF natif préservé)
- 🎞️ **GIFs** via Giphy (recherche en français)
- 🔗 **Aperçus de liens** Open Graph (fetch côté serveur → protège ton IP)
- 😀 **Réactions emoji illimitées** (multiples par utilisateur, recherche dans ~280 emojis)
- 📞 **Notifications push d'appel** (Web Push / VAPID, fonctionne onglet fermé)
- 🛡️ **Captcha Cloudflare Turnstile** + rate-limit IP côté serveur
- 📱 **PWA installable**, responsive, dark theme
- 🚫 **Aucun compte, aucune publicité, aucun tracking**

---

## Stack

| Couche | Tech |
|--------|------|
| Backend | Node.js ≥18, Express, Socket.io, web-push |
| Crypto | WebCrypto API (navigateur) — AES-256-GCM, PBKDF2-SHA256 |
| Front | Vanilla JS, CSS (sans framework) |
| Captcha | Cloudflare Turnstile |
| GIFs | Giphy API |

---

## Installation locale

```bash
git clone https://github.com/<ton-user>/murmure.git
cd murmure
npm install
cp .env.example .env
# édite .env (cf section Configuration)
npm start
```

Puis ouvre http://localhost:2704

---

## Configuration

Toutes les options vivent dans `.env` (voir `.env.example`).

### `PORT`
Port d'écoute. Défaut `2704`.

### `VAPID_CONTACT`
Adresse de contact requise par les services Push (format `mailto:` ou `https://`). Les clés VAPID sont générées automatiquement au premier démarrage dans `data/vapid.json`.

### `GIPHY_API_KEY` *(optionnel)*
Sans cette clé, le bouton GIF affiche une erreur — le reste fonctionne normalement.

1. https://developers.giphy.com/dashboard/ → *Create an App* → type **API** (gratuit)
2. Copie la clé dans `.env`

### `TURNSTILE_SITE_KEY` + `TURNSTILE_SECRET_KEY` *(optionnel)*
Captcha anti-robot vérifié serveur. Sans ces deux clés, le captcha est **bypass** (warning au démarrage) ; le rate-limit reste actif.

1. https://dash.cloudflare.com → **Turnstile** → *Add site*
2. Type : **Managed**. Récupère **Site Key** + **Secret Key**.
3. Remplis `.env`, redémarre.

---

## Sécurité — modèle de menace

✅ **Protège contre**
- FAI, hébergeur, voisins réseau curieux
- Lecture du disque serveur (tout est ciphertext)
- Brute-force du code (PBKDF2 250k it. + entropie élevée via générateur 4 mots + 5 chiffres)
- Spam de connexions (rate-limit IP : 10 verify/min, 20 join/min)

⚠️ **Ne protège PAS contre**
- **Serveur compromis** : il sert le JS de la page — un attaquant peut servir un client modifié qui exfiltre la clé. Limite intrinsèque du E2E web.
- **Code trop faible** : `"123456"` reste cassable même avec 250k itérations PBKDF2.
- **Canal de partage compromis** : si tu envoies le code par SMS/email non chiffré, c'est game over.
- **Pas de Forward Secrecy** : clé statique → si le code fuit un jour, tout l'historique passé devient déchiffrable. Renouvelle le code régulièrement.
- **Métadonnées** : timestamps, taille messages, IPs côté logs nginx — non chiffrées.
- **Tiers (Giphy, sites linkés, YouTube embeds)** : voient ton IP au chargement des médias.

**Bonnes pratiques**
- Utilise le **générateur de code** (4 mots + 5 chiffres ≈ 50 bits d'entropie)
- Partage le code **en personne** ou via Signal
- **Vérifie l'empreinte** à voix haute la première fois
- Renouvelle le code régulièrement

---

## Déploiement production

### Reverse-proxy TLS (nginx)

```nginx
server {
  server_name chat.example.com;
  listen 443 ssl http2;

  ssl_certificate     /etc/letsencrypt/live/chat.example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/chat.example.com/privkey.pem;

  location / {
    proxy_pass http://127.0.0.1:2704;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Real-IP $remote_addr;
  }
}
```

`app.set('trust proxy', true)` est déjà activé côté Express pour respecter `X-Forwarded-For` (utilisé par le rate-limit et la signature IP du pass captcha).

### systemd (exemple)

```ini
[Unit]
Description=Murmure
After=network.target

[Service]
WorkingDirectory=/var/www/murmure
ExecStart=/usr/bin/node server.js
Restart=on-failure
EnvironmentFile=/var/www/murmure/.env
User=www-data

[Install]
WantedBy=multi-user.target
```

---

## Architecture

```
public/
├── index.html       Landing (form join + captcha + SEO)
├── chat.html        Salon (noindex)
├── landing.js       Génération code, Turnstile, validation pass
├── chat.js          WebCrypto, Socket.io client, UI, push subscribe
├── style.css        Tout le style (sans framework)
├── sw.js            Service Worker (push notifications)
└── ...icônes, manifest, robots, sitemap

server.js            Express + Socket.io
├── /api/vapid              clé publique push
├── /api/subscribe          enregistre abonnement push
├── /api/turnstile/config   site key publique
├── /api/captcha-verify     valide token Turnstile → renvoie pass HMAC
├── /api/preview            fetch Open Graph (anti-SSRF)
├── /api/gifs/search        proxy Giphy
└── socket.io
    ├── join                exige code + pass valide
    ├── msg                 relay {iv, ct}, persiste 6h chiffré
    ├── typing
    └── call                ping realtime + push notif

data/   (gitignored — ne pas committer)
├── vapid.json              clés VAPID (générées au 1er run)
├── pass-secret             HMAC secret pour pass captcha (32 bytes)
├── subscriptions.json      abonnements push
└── rooms/<hash>.json       historique chiffré par salon (6h TTL)
```

---

## Roadmap / idées

- [ ] Perfect Forward Secrecy (clés éphémères dérivées par message)
- [ ] Vérification d'empreinte par QR code
- [ ] Mode multi-device avec re-sync
- [ ] Self-destruct timer par message
- [ ] Export chiffré de l'historique

---

## Licence

[MIT](LICENSE) © Bastien Brousse

---

## Crédits

Développé par [Bastien Brousse](https://os.bastienbrousse.pro). Powered by [Cloudflare Turnstile](https://www.cloudflare.com/products/turnstile/), [Giphy](https://giphy.com), [Socket.io](https://socket.io), [Express](https://expressjs.com).
