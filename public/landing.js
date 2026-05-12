// Background particles
(() => {
  const c = document.getElementById('bg');
  const ctx = c.getContext('2d');
  let w, h, pts;
  function resize() {
    w = c.width = innerWidth * devicePixelRatio;
    h = c.height = innerHeight * devicePixelRatio;
    c.style.width = innerWidth + 'px';
    c.style.height = innerHeight + 'px';
    const n = Math.min(80, Math.floor((innerWidth * innerHeight) / 18000));
    pts = Array.from({ length: n }, () => ({
      x: Math.random() * w, y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.3 * devicePixelRatio,
      vy: (Math.random() - 0.5) * 0.3 * devicePixelRatio,
      r: (Math.random() * 1.5 + 0.5) * devicePixelRatio
    }));
  }
  function frame() {
    ctx.clearRect(0, 0, w, h);
    for (const p of pts) {
      p.x += p.vx; p.y += p.vy;
      if (p.x < 0 || p.x > w) p.vx *= -1;
      if (p.y < 0 || p.y > h) p.vy *= -1;
      ctx.beginPath();
      ctx.fillStyle = 'rgba(180,170,255,0.6)';
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const a = pts[i], b = pts[j];
        const dx = a.x - b.x, dy = a.y - b.y;
        const d2 = dx * dx + dy * dy;
        const lim = (120 * devicePixelRatio) ** 2;
        if (d2 < lim) {
          ctx.strokeStyle = `rgba(124,92,255,${0.18 * (1 - d2 / lim)})`;
          ctx.lineWidth = devicePixelRatio * 0.6;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }
    }
    requestAnimationFrame(frame);
  }
  addEventListener('resize', resize);
  resize(); frame();
})();

// Form
const form = document.getElementById('join');
const codeIn = document.getElementById('code');
const err = document.getElementById('err');
const reveal = document.getElementById('reveal');
const generate = document.getElementById('generate');

reveal.addEventListener('click', () => {
  codeIn.type = codeIn.type === 'password' ? 'text' : 'password';
});

const WORDS = [
  // Nature
  'orage','soleil','lune','vague','foret','etoile','feu','vent','pluie','neige','brume','rosee','givre','grele','tempete',
  'rivage','mont','aube','crepuscule','nuage','arbre','buisson','racine','branche','feuille','ecorce','sentier','clairiere',
  'colline','vallon','plateau','falaise','grotte','caverne','source','ruisseau','torrent','riviere','fleuve','cascade','lac',
  'etang','marais','lagune','ocean','recif','dune','desert','oasis','prairie','steppe','toundra','glacier','iceberg','volcan',
  'cratere','geyser','seisme','tornade','typhon','mousson','horizon','zenith','meridien','equateur','tropique','arctique',
  // Animaux
  'renard','loup','aigle','dauphin','ours','lynx','cerf','biche','sanglier','hibou','chouette','corbeau','heron','faucon',
  'hirondelle','rossignol','colombe','cygne','flamant','pelican','toucan','perroquet','colibri','mesange','rouge-gorge',
  'lievre','ecureuil','blaireau','belette','hermine','marmotte','castor','loutre','phoque','morse','baleine','orque',
  'requin','raie','meduse','poulpe','calmar','seiche','homard','crabe','tortue','serpent','lezard','salamandre','grenouille',
  'libellule','papillon','luciole','abeille','fourmi','araignee','scorpion','panthere','tigre','lion','jaguar','leopard',
  // Pierres et minéraux
  'rubis','jade','ambre','onyx','perle','saphir','opaline','opale','topaze','emeraude','diamant','quartz','cristal','agate',
  'turquoise','lapis','malachite','obsidienne','granit','marbre','ardoise','silex','basalte','geode','meteorite','platine',
  'argent','cuivre','etain','plomb','mercure','zinc','nickel','fer','acier','bronze','laiton','titane',
  // Fleurs et plantes
  'iris','pivoine','myrte','rose','tulipe','lys','jasmin','lavande','romarin','thym','sauge','menthe','basilic','aneth',
  'cerisier','olivier','figuier','chataignier','noisetier','peuplier','saule','bouleau','chene','hetre','erable','cypres',
  'sequoia','baobab','palmier','bambou','fougere','mousse','lierre','glycine','clematite','liseron','coquelicot','marguerite',
  'tournesol','jonquille','crocus','muguet','violette','primevere','anemone','dahlia','orchidee','magnolia','camelia','azalee',
  // Nourriture
  'pain','baguette','brioche','croissant','gateau','tarte','crepe','gaufre','biscuit','madeleine','meringue','praline',
  'chocolat','vanille','caramel','miel','confiture','marmelade','fromage','beurre','creme','yaourt','pomme','poire','peche',
  'abricot','prune','cerise','fraise','framboise','myrtille','mure','groseille','melon','pasteque','raisin','figue','datte',
  'amande','noisette','noix','pistache','cajou','marron','olive','citron','orange','mandarine','pamplemousse','ananas',
  'mangue','papaye','goyave','litchi','kiwi','grenade','coing','rhubarbe','potiron','courge','aubergine','artichaut',
  // Émotions / abstractions
  'amour','passion','tendresse','douceur','calme','serenite','quietude','silence','murmure','souffle','echo','reflet','mirage',
  'reve','songe','illusion','espoir','foi','courage','audace','vaillance','sagesse','prudence','patience','joie','sourire',
  'rire','bonheur','plaisir','delice','extase','euphorie','liberte','justice','verite','beaute','grace','elegance','charme',
  // Mythologie / fantastique
  'phoenix','dragon','licorne','sphinx','centaure','sirene','nymphe','dryade','faune','satyre','elfe','fee','farfadet','korrigan',
  'troll','golem','chimere','hydre','pegase','minotaure','gorgone','cyclope','titan','olympe','asgard','avalon','atlantide',
  'eldorado','shangri-la','camelot','excalibur','graal','talisman','amulette','grimoire','rune','sortilege','arcane','oracle',
  // Couleurs et nuances
  'azur','indigo','cobalt','outremer','turquoise','cyan','emeraude','olive','citrin','safran','ocre','sienne','rouille',
  'cuivre','vermillon','carmin','pourpre','magenta','fuchsia','mauve','lilas','prune','ivoire','perle','nacre','ebene',
  // Objets / artisanat
  'lanterne','chandelle','flambeau','torche','foyer','atre','cheminee','fournaise','clef','serrure','coffre','ecrin','bijou',
  'medaillon','pendentif','bracelet','bague','couronne','sceptre','epee','lame','dague','arbalete','arc','fleche','bouclier',
  'armure','casque','heaume','jouet','toupie','marionnette','cerf-volant','balancoire','toboggan','manege','carrousel',
  // Cosmos
  'planete','etoile','galaxie','nebuleuse','comete','astre','satellite','quasar','pulsar','meteore','aurore','equinoxe','solstice',
  // Lieux / architecture
  'tour','donjon','chateau','citadelle','palais','temple','sanctuaire','abbaye','cloitre','cathedrale','beffroi','phare',
  'pont','arche','viaduc','aqueduc','jetee','quai','port','marina','place','plaza','agora','forum','jardin','verger','potager',
  // Musique / arts
  'lyre','harpe','flute','luth','tambour','cymbale','clavecin','violon','alto','violoncelle','contrebasse','trompette','cor',
  'sonate','symphonie','concerto','ballade','romance','sonnet','poeme','ode','elegie','epopee','fresque','mosaique','vitrail',
  // Temps / saisons
  'printemps','ete','automne','hiver','matin','midi','vespre','minuit','seconde','minute','heure','jour','semaine','mois','annee',
  'siecle','epoque','ere','jadis','antan','futur','demain',
  // Jeux / divers
  'jeux','enigme','enquete','quete','aventure','voyage','periple','expedition','odyssee','exode','exil','retour','depart',
  'rencontre','adieu','promesse','serment','pacte','accord','traite','alliance','union','duo','trio','quatuor',
  // Vêtements / tissus
  'soie','velours','satin','dentelle','tulle','lin','laine','coton','cachemire','mohair','tweed','jean','manteau','cape',
  'manteau-rouge','echarpe','foulard','beret','chapeau','tunique','robe','jupe','blouse','gilet','etole'
];
function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
generate.addEventListener('click', () => {
  // 4 mots + nombre 5 chiffres → entropie >> short code, plus dur à brute-force
  const code = `${pick(WORDS)}-${pick(WORDS)}-${pick(WORDS)}-${pick(WORDS)}-${Math.floor(Math.random() * 90000 + 10000)}`;
  codeIn.value = code;
  codeIn.type = 'text';
  codeIn.focus();
  codeIn.select();
});

// ----- Turnstile (Cloudflare) + pass token signé serveur -----
const captchaStatus = document.getElementById('captcha-status');
const turnstileContainer = document.getElementById('turnstile-container');
let turnstileToken = null;
let turnstileWidgetId = null;
let captchaConfig = null;

async function loadCaptchaConfig() {
  try {
    const r = await fetch('/api/turnstile/config');
    captchaConfig = await r.json();
  } catch { captchaConfig = { enabled: false }; }

  if (!captchaConfig.enabled || !captchaConfig.siteKey) {
    // Mode dev / non configuré → on tente quand même le verify (bypass côté serveur)
    captchaStatus.textContent = 'Captcha non configuré côté serveur (mode dev). Une protection rate-limit reste active.';
    captchaStatus.classList.add('warn');
    turnstileContainer.style.display = 'none';
    await preFetchBypassPass();
    return;
  }

  captchaStatus.textContent = 'Validation requise pour continuer.';
  waitForTurnstileAndRender();
}

function waitForTurnstileAndRender() {
  if (window.turnstile && typeof window.turnstile.render === 'function') {
    renderTurnstile();
  } else {
    setTimeout(waitForTurnstileAndRender, 200);
  }
}

function renderTurnstile() {
  turnstileWidgetId = window.turnstile.render(turnstileContainer, {
    sitekey: captchaConfig.siteKey,
    theme: 'dark',
    callback: async (token) => {
      turnstileToken = token;
      captchaStatus.textContent = 'Vérification…';
      captchaStatus.classList.remove('warn', 'err-text');
      const pass = await exchangeForPass(token);
      if (pass) {
        sessionStorage.setItem('murmure:pass', pass.pass);
        sessionStorage.setItem('murmure:pass-exp', String(Date.now() + pass.ttlMs - 5000));
        captchaStatus.textContent = '✓ Vérifié — tu peux entrer.';
        captchaStatus.classList.add('ok');
      } else {
        captchaStatus.textContent = 'Vérification refusée par le serveur. Réessaie.';
        captchaStatus.classList.add('err-text');
        sessionStorage.removeItem('murmure:pass');
      }
    },
    'expired-callback': () => {
      turnstileToken = null;
      sessionStorage.removeItem('murmure:pass');
      captchaStatus.textContent = 'Captcha expiré — recommence.';
      captchaStatus.classList.add('warn');
    },
    'error-callback': () => {
      captchaStatus.textContent = 'Erreur captcha. Recharge la page.';
      captchaStatus.classList.add('err-text');
    }
  });
}

async function exchangeForPass(token) {
  try {
    const r = await fetch('/api/captcha-verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token })
    });
    if (!r.ok) return null;
    const data = await r.json();
    return data && data.ok ? data : null;
  } catch { return null; }
}

async function preFetchBypassPass() {
  // Serveur configuré sans Turnstile → il accepte un verify "vide" et renvoie un pass
  const pass = await exchangeForPass('');
  if (pass) {
    sessionStorage.setItem('murmure:pass', pass.pass);
    sessionStorage.setItem('murmure:pass-exp', String(Date.now() + pass.ttlMs - 5000));
  }
}

loadCaptchaConfig();

const pseudoIn = document.getElementById('pseudo');
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const code = codeIn.value.trim();
  if (code.length < 4) {
    err.textContent = 'Le code doit faire au moins 4 caractères.';
    return;
  }
  const pass = sessionStorage.getItem('murmure:pass');
  const exp = Number(sessionStorage.getItem('murmure:pass-exp') || '0');
  if (!pass || !exp || exp < Date.now()) {
    err.textContent = 'Termine la vérification anti-robot avant d\'entrer.';
    return;
  }
  const pseudo = (pseudoIn.value || '').trim().slice(0, 32) || 'Anonyme';
  sessionStorage.setItem('murmure:code', code);
  sessionStorage.setItem('murmure:pseudo', pseudo);
  location.href = 'chat.html';
});
