/* =====================================================================
   Portfolio anotherj4ck : graphe 3D vivant
   ---------------------------------------------------------------------
   - Le contenu vient de graph.json : on ajoute un projet sans toucher au code.
   - Le rendu utilise Three.js (r128, chargé en <script> dans index.html).
   - La mise en page des nœuds est une petite simulation physique maison :
       * répulsion entre tous les nœuds (ils ne se chevauchent pas),
       * ressorts sur les liens (les nœuds liés restent proches),
       * ancrage des sphères principales (elles reviennent en place).
   - La sphère Ego (effect "glitch") est une membrane vivante parcourue de
     circuits ; elle lance des arcs électriques au survol et « prend le
     contrôle » de l'interface au clic, avant d'ouvrir son site.
   - L'emprise d'Ego (purement visuelle) : un fil rouge presque invisible le
     relie à chaque nœud, et chaque nœud porte un implant qui bat avec son cœur.
   - Aucun contenu n'est injecté avec innerHTML : tout passe par
     textContent, pour qu'un texte du JSON ne puisse jamais devenir du code.
   ===================================================================== */
(() => {
  'use strict';

  const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $ = (sel) => document.querySelector(sel);

  /* ---------- Réglages ---------- */
  const COLORS = { dev: 0x5ccbe2, ecriture: 0xf1a94e, ego: 0x9b0f12, neutral: 0x93a4b4 };
  const HALO = { ego: 0xd01a1f };  // halo plus vif que la sphère (sinon, la couleur de la sphère)
  // Position des sphères principales, dans l'ordre de graph.json (Développement, Écriture, Ego).
  // Paysage : un triangle large et plat, Ego au sommet, les deux mondes aux coins du bas,
  // et leurs nuages sur les côtés extérieurs : le graphe prend la largeur de l'écran.
  // Portrait : Ego en haut, puis les deux mondes légèrement décalés en hauteur,
  // pour que leurs étiquettes ne se chevauchent pas sur un écran étroit.
  const ANCHORS = {
    landscape: [[-58, 0], [58, 0], [0, 22]],
    portrait: [[-11, -4], [11, -12], [0, 24]],
  };
  // Point d'attache doux des nuages, par rapport à leur sphère : « out » vers l'extérieur
  // du triangle, « down » vers le bas ; « shared » : profondeur des compétences communes
  // aux deux mondes, rangées au milieu, sous le niveau des sphères.
  // « floor » : plancher sous les sphères ; « wall » : mur extérieur, au-delà de la sphère ; « lane » : couloir central réservé aux compétences
  // communes, en fraction de l'écart entre Ego et une sphère ; « k » : force du rappel [x, y, z] ;
  // « own » (paysage) : angle sous l'horizontale où se rangent les compétences d'Ego seul.
  // Paysage : rappel fort en hauteur (le graphe reste plat et large). Portrait : l'inverse.
  const NEST = {
    landscape: { out: 6, down: 13, shared: 16, floor: 27, wall: Infinity, lane: 0.35, k: [0.008, 0.012, 0.05], own: 0.08 },
    portrait: { out: 4, down: 30, shared: 30, floor: 80, wall: 20, lane: 0.3, k: [0.012, 0.006, 0.04] },
  };
  const NEST_OWN = [0.04, 0.04, 0.04]; // compétences d'Ego seul : tenues fermement près de lui
  // Sphères principales 25 % plus grosses qu'avant (4,2), petits nœuds inchangés
  const RADIUS = { hub: 5.25, project: 1.7, skill: 0.85 };
  // Ego n'a ni maillage ni anneaux : sans ce coup de pouce, il paraît deux fois plus petit
  const EGO_SCALE = 1.4;
  const EGO_CLEAR = 3;     // zone dégagée autour d'Ego, en rayons d'Ego
  const ARC_LENGTH = 1.5;  // longueur des arcs (1 = réglage d'origine)
  // Emprise d'Ego : fils latents vers chaque nœud et implants (purement visuels)
  const GRIP = {
    rest: 0.04,      // luminosité d'un fil au repos (presque invisible)
    hot: 0.26,       // luminosité d'un fil quand Ego est survolé
    subdiv: 16,      // segments par fil : la vague et l'impulsion avancent le long du fil
    waveTime: 0.4,   // secondes pour que la vague atteigne le nœud le plus lointain
    implant: 0.18,   // rayon d'un implant, en fraction du rayon de son nœud
    pulseMin: 4, pulseMax: 7, pulseTravel: 0.8, // impulsion au hasard hors survol (secondes)
  };
  const CHARGE = { hub: 3.2, project: 1.5, skill: 0.8 };
  const MASS   = { hub: 3, project: 1.2, skill: 0.8 };
  const REST   = { hub: 1, project: 0.45, skill: 0.22 };   // luminosité au repos
  const DIMMED = { hub: 0.38, project: 0.14, skill: 0.08 }; // hors sélection
  const SPRING_LENGTH = { bridge: 58, 'hub-project': 24, 'hub-skill': 22, 'project-skill': 16, 'skill-skill': 16, 'project-project': 18 };
  const K_REPULSION = 140;
  const K_SPRING = 0.035;
  const K_ANCHOR = 0.06;
  const DAMPING = 0.86;

  /* ---------- Chargement des données ---------- */
  async function loadData() {
    // Version tout-en-un (aperçu) : les données sont déjà dans la page.
    const inline = document.getElementById('graph-data');
    if (inline) return JSON.parse(inline.textContent);
    const res = await fetch('graph.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error('graph.json introuvable (HTTP ' + res.status + ')');
    return res.json();
  }

  // N'accepte que des liens https:// (évite un « javascript: » glissé dans le JSON).
  function safeUrl(url) {
    return typeof url === 'string' && /^https:\/\//i.test(url) ? url : null;
  }

  function showNotice(text) {
    const n = $('#notice');
    n.textContent = text;
    n.hidden = false;
  }

  /* ---------- Petits utilitaires DOM ---------- */
  function el(tag, attrs, ...children) {
    const e = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v == null || v === false) continue;
        if (k === 'class') e.className = v;
        else if (k === 'text') e.textContent = v;
        else e.setAttribute(k, v);
      }
    }
    for (const c of children) if (c) e.append(c);
    return e;
  }

  function linkButton(label, href, primary) {
    const url = safeUrl(href);
    if (!url) return null;
    return el('a', { class: primary ? 'act primary' : 'act', href: url, target: '_blank', rel: 'noopener', text: label });
  }

  /* ---------- Hasard reproductible et bruit (pour la matière d'Ego) ---------- */
  // Générateur pseudo-aléatoire à graine fixe (mulberry32) : même graine, mêmes tirages,
  // donc le même dessin de circuits à chaque visite.
  function mulberry32(seed) {
    return () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Bruit simplex 3D (d'après Stefan Gustavson, domaine public) : l'espace est découpé en
  // tétraèdres, chaque sommet reçoit une pente au hasard, et on mélange en douceur les pentes
  // des 4 sommets voisins. Résultat continu entre -1 et 1 : des bosses lisses, jamais de pic.
  const GRAD3 = new Int8Array([1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0, 1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1, 0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1]);
  const PERM = new Uint8Array(512);
  {
    const rng = mulberry32(1993), p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); const t = p[i]; p[i] = p[j]; p[j] = t; }
    for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];
  }
  function corner(x, y, z, h) {
    let t = 0.6 - x * x - y * y - z * z;
    if (t < 0) return 0;
    const g = (h % 12) * 3;
    t *= t;
    return t * t * (GRAD3[g] * x + GRAD3[g + 1] * y + GRAD3[g + 2] * z);
  }
  function noise3(x, y, z) {
    const F3 = 1 / 3, G3 = 1 / 6;
    const s = (x + y + z) * F3;
    const i = Math.floor(x + s), j = Math.floor(y + s), k = Math.floor(z + s);
    const t = (i + j + k) * G3;
    const x0 = x - i + t, y0 = y - j + t, z0 = z - k + t;
    // Dans quel tétraèdre du cube se trouve le point ?
    let i1, j1, k1, i2, j2, k2;
    if (x0 >= y0) {
      if (y0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
      else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1; }
      else { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1; }
    } else if (y0 < z0) { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1; }
    else if (x0 < z0) { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1; }
    else { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
    const ii = i & 255, jj = j & 255, kk = k & 255;
    return 32 * (
      corner(x0, y0, z0, PERM[ii + PERM[jj + PERM[kk]]]) +
      corner(x0 - i1 + G3, y0 - j1 + G3, z0 - k1 + G3, PERM[ii + i1 + PERM[jj + j1 + PERM[kk + k1]]]) +
      corner(x0 - i2 + 2 * G3, y0 - j2 + 2 * G3, z0 - k2 + 2 * G3, PERM[ii + i2 + PERM[jj + j2 + PERM[kk + k2]]]) +
      corner(x0 - 1 + 3 * G3, y0 - 1 + 3 * G3, z0 - 1 + 3 * G3, PERM[ii + 1 + PERM[jj + 1 + PERM[kk + 1]]]));
  }

  /* =====================================================================
     Démarrage
     ===================================================================== */
  loadData().then(start).catch((err) => {
    console.error(err);
    if (location.protocol === 'file:') {
      showNotice("Le navigateur bloque la lecture de graph.json quand on ouvre la page en double-cliquant. Lance un petit serveur local dans le dossier du site (par exemple « python3 -m http.server ») puis ouvre http://localhost:8000.");
    } else {
      showNotice('Impossible de charger les projets : ' + err.message);
    }
  });

  function start(data) {
    /* ---------- Modèle : nœuds et liens ---------- */
    const byId = new Map();
    const nodes = data.nodes.map((raw) => {
      const n = {
        ...raw,
        r: RADIUS[raw.type] || 1,
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        force: new THREE.Vector3(),
        anchor: null,
        level: 0,        // luminosité affichée (animée)
        target: 0,       // luminosité visée
        power: 1,        // 0 = sphère éteinte (prise de contrôle d'Ego)
        off: false,
        phase: Math.random() * Math.PI * 2,
        links: [],
      };
      byId.set(n.id, n);
      return n;
    });

    const links = [];
    for (const l of data.links) {
      const a = byId.get(l.source), b = byId.get(l.target);
      if (!a || !b) { console.warn('Lien ignoré, nœud inconnu :', l); continue; }
      const kind = l.kind === 'bridge' ? 'bridge' : [a.type, b.type].sort().join('-');
      const link = { a, b, kind, level: 0, target: 0 };
      links.push(link);
      a.links.push(link);
      b.links.push(link);
    }
    const neighbors = (n) => n.links.map((l) => (l.a === n ? l.b : l.a));

    const hubs = nodes.filter((n) => n.type === 'hub');
    const projectsOf = (hub) => nodes.filter((n) => n.type === 'project' && n.hub === hub.id);

    // Couleur : un hub a la sienne, un projet prend celle de son hub,
    // une compétence mélange les couleurs des mondes qu'elle touche.
    for (const n of nodes) if (n.type === 'hub') n.colorKey = n.color;
    for (const n of nodes) if (n.type === 'project') n.colorKey = (byId.get(n.hub) || {}).colorKey;
    for (const n of nodes) {
      if (n.type === 'hub') n.col = new THREE.Color(COLORS[n.colorKey] || COLORS.neutral);
      else if (n.type === 'project') n.col = new THREE.Color(COLORS[n.colorKey] || COLORS.neutral);
    }
    // La sphère à effets (Ego) : arcs au survol, prise de contrôle au clic
    const ego = nodes.find((n) => n.type === 'hub' && n.effect === 'glitch') || null;
    // Tout ce qui dépend du rayon suit : membrane, veines, arcs, halo, zone de clic, étiquette
    if (ego) ego.r = RADIUS.hub * EGO_SCALE;

    for (const n of nodes) {
      if (n.type !== 'skill') continue;
      // Le lien d'Ego ne teinte pas une compétence qui appartient déjà à un monde :
      // sa marque à lui, ce sont les fils rouges. Seules ses compétences propres sont rouges.
      const keys = new Set();
      for (const m of neighbors(n)) if (m.colorKey && m !== ego) keys.add(m.colorKey);
      if (!keys.size && ego && neighbors(n).includes(ego)) keys.add(ego.colorKey);
      const c = new THREE.Color(0, 0, 0);
      if (keys.size === 0) c.set(COLORS.neutral);
      else { for (const k of keys) c.add(new THREE.Color(COLORS[k])); c.multiplyScalar(1 / keys.size); }
      n.col = c.lerp(new THREE.Color(COLORS.neutral), 0.25);
    }
    // Couleur du halo, des liens et des paquets : la même, sauf pour Ego (plus vive)
    for (const n of nodes) n.halo = HALO[n.colorKey] ? new THREE.Color(HALO[n.colorKey]) : n.col;

    // Monde de chaque nœud, pour savoir où le ranger : sa sphère (un seul monde),
    // « shared » (compétence prouvée dans les deux mondes), ou Ego (compétence d'Ego seul)
    for (const n of nodes) {
      if (n.type === 'hub') continue;
      if (n.type === 'project') { n.world = byId.get(n.hub) || null; continue; }
      const set = new Set();
      for (const m of neighbors(n)) {
        const w = m.type === 'project' ? byId.get(m.hub) : m.type === 'hub' ? m : null;
        if (w && w !== ego) set.add(w);
      }
      if (set.size === 1) n.world = [...set][0];
      else if (set.size > 1) n.world = 'shared';
      else n.world = ego && neighbors(n).includes(ego) ? ego : null;
    }

    /* ---------- Textes fixes ---------- */
    if (data.profile) {
      $('#who').textContent = data.profile.name || 'Portfolio';
      $('#role').textContent = data.profile.role || '';
      $('#role').dataset.glitch = data.profile.role || '';
      const gh = safeUrl(data.profile.github);
      if (gh) { $('#gh-link').href = gh; $('#gh-top').href = gh; }
      const li = safeUrl(data.profile.linkedin);
      if (li) { $('#li-foot').href = li; $('#li-link').href = li; }
    }
    // Copie du texte dans data-glitch : le CSS la découpe en tranches pendant l'effet d'Ego
    $('#hint').dataset.glitch = $('#hint').textContent;
    const whoText = $('#who').textContent, pageTitle = document.title;
    buildList();

    /* ---------- Vue liste : ouverture / fermeture ---------- */
    const list = $('#list'), btnList = $('#btn-list');
    function openList() {
      list.hidden = false;
      btnList.setAttribute('aria-expanded', 'true');
      $('#list-close').focus();
    }
    function closeList() {
      list.hidden = true;
      btnList.setAttribute('aria-expanded', 'false');
      btnList.focus();
    }
    btnList.addEventListener('click', () => (list.hidden ? openList() : closeList()));
    $('#list-close').addEventListener('click', closeList);
    document.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Escape') return;
      if (!list.hidden) closeList();
      else if (selected) select(null);
    });


    /* ---------- Three.js : rendu ---------- */
    const canvas = $('#gl');
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    } catch (e) {
      console.error(e);
      openList();
      showNotice("La vue 3D n'a pas pu démarrer sur cet appareil. Tous les projets sont dans la vue liste.");
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x0a1119, 1);

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x0a1119, 0.0032);
    const camera = new THREE.PerspectiveCamera(45, 1, 0.5, 2000);
    // Un peu de lumière pour que les sphères aient du volume
    scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const keyLight = new THREE.DirectionalLight(0xffffff, 0.7);
    keyLight.position.set(-0.6, 1, 0.8);
    scene.add(keyLight);

    // Texture de halo : un dégradé radial dessiné une fois dans un canvas.
    const glowTex = (() => {
      const c = document.createElement('canvas');
      c.width = c.height = 128;
      const g = c.getContext('2d');
      const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
      grd.addColorStop(0, 'rgba(255,255,255,1)');
      grd.addColorStop(0.18, 'rgba(255,255,255,.55)');
      grd.addColorStop(0.45, 'rgba(255,255,255,.12)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd;
      g.fillRect(0, 0, 128, 128);
      const t = new THREE.CanvasTexture(c);
      return t;
    })();

    // Ciel étoilé discret
    {
      const N = 700, pos = new Float32Array(N * 3);
      for (let i = 0; i < N; i++) {
        const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2;
        const rad = 380 + Math.random() * 400, s = Math.sqrt(1 - u * u);
        pos.set([rad * s * Math.cos(th), rad * u, rad * s * Math.sin(th)], i * 3);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const stars = new THREE.Points(geo, new THREE.PointsMaterial({
        size: 3.2, map: glowTex, color: 0x6d8399, transparent: true, opacity: 0.55,
        depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      }));
      scene.add(stars);
    }

    const sphereGeo = new THREE.SphereGeometry(1, 32, 20);
    const hitGeo = new THREE.SphereGeometry(1, 10, 8);
    const hitMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
    const hitMeshes = [];

    for (const n of nodes) {
      const group = new THREE.Group();

      const core = new THREE.Mesh(sphereGeo, new THREE.MeshLambertMaterial({ color: n.col.clone(), emissive: n.col.clone() }));
      core.scale.setScalar(n.r);
      group.add(core);

      const glow = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTex, color: n.halo.clone(), transparent: true, depthWrite: false,
        blending: THREE.AdditiveBlending,
      }));
      glow.scale.setScalar(n.r * (n.type === 'hub' ? 7 : 6));
      group.add(glow);

      // Zone de clic plus large que la sphère, surtout pour les petits nœuds (doigts !)
      const hit = new THREE.Mesh(hitGeo, hitMat);
      hit.scale.setScalar(Math.max(n.r * 1.6, 2.6));
      hit.userData.node = n;
      group.add(hit);
      hitMeshes.push(hit);

      // Signature visuelle des sphères (celle d'Ego, ce sont ses arcs : voir plus bas)
      n.deco = [];
      if (n.type === 'hub' && n.colorKey === 'dev') {
        // Développement : un maillage, comme une topologie réseau
        const mesh = new THREE.Mesh(
          new THREE.IcosahedronGeometry(n.r * 1.85, 1),
          new THREE.MeshBasicMaterial({ color: n.col, wireframe: true, transparent: true, opacity: 0.35, depthWrite: false })
        );
        group.add(mesh);
        n.deco.push({ obj: mesh, spin: [0.05, 0.11, 0] });
      } else if (n.type === 'hub' && n !== ego) {
        // Écriture : des anneaux qui tournent, comme des lignes autour d'une idée
        const tilts = [[1.2, 0.2], [0.4, 1.0], [-0.7, 0.5]];
        tilts.forEach(([x, z], i) => {
          const ring = new THREE.Mesh(
            new THREE.TorusGeometry(n.r * (1.55 + i * 0.28), 0.05, 6, 120),
            new THREE.MeshBasicMaterial({ color: n.col, transparent: true, opacity: 0.45, depthWrite: false })
          );
          ring.rotation.set(x, 0, z);
          group.add(ring);
          n.deco.push({ obj: ring, spin: [0, 0.09 + i * 0.05, 0.02 * (i - 1)] });
        });
      }

      n.group = group; n.core = core; n.glow = glow;
      scene.add(group);
    }

    /* ---------- Ego : la chair et les veines-circuits ---------- */
    // Membrane : une sphère d'environ 1 500 sommets uniques, déformée sur le CPU par un bruit
    // 3D qui dérive lentement. Le calcul se fait en JavaScript plutôt que dans un shader :
    // la même fonction fleshHeight() sert à la membrane, aux circuits et au départ des arcs,
    // donc tout reste collé. Tableaux créés une seule fois, simplement réécrits à chaque image.
    let fleshT = 0, fleshAmp = 1, fleshSwell = 0;
    function fleshHeight(x, y, z) {
      // Deux couches de bruit qui glissent dans des directions différentes : un mouvement irrégulier
      const t = fleshT;
      return fleshAmp * (0.06 * noise3(x * 1.1 + t * 0.11, y * 1.1 - t * 0.07, z * 1.1 + t * 0.05) +
        0.018 * noise3(x * 2.2 - t * 0.19, y * 2.2 + t * 0.13, z * 2.2 + t * 0.17)) + fleshSwell;
    }

    const flesh = {};
    if (ego) {
      // Les sommets de la couture et des pôles sont en double dans SphereGeometry :
      // on les « soude » (même position = même sommet unique) pour éviter une fente d'éclairage.
      const geo = new THREE.SphereGeometry(1, 48, 32);
      // Pôles du maillage sur les côtés : leurs triangles étroits ne tombent plus face à la caméra
      geo.rotateZ(Math.PI / 2);
      const pos = geo.attributes.position.array, vCount = pos.length / 3;
      const weld = new Uint16Array(vCount), seen = new Map(), dirs = [];
      for (let v = 0; v < vCount; v++) {
        const key = Math.round(pos[v * 3] * 1e4) + ',' + Math.round(pos[v * 3 + 1] * 1e4) + ',' + Math.round(pos[v * 3 + 2] * 1e4);
        if (!seen.has(key)) { seen.set(key, dirs.length / 3); dirs.push(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]); }
        weld[v] = seen.get(key);
      }
      geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(vCount * 3), 3));
      Object.assign(flesh, {
        geo, weld, vCount, index: geo.index.array,
        dir: new Float32Array(dirs), uCount: dirs.length / 3,
        uPos: new Float32Array(dirs.length), uNrm: new Float32Array(dirs.length), uH: new Float32Array(dirs.length / 3),
      });
      ego.core.geometry = geo;
      ego.core.material.dispose();
      // Phong plutôt que Lambert : un reflet spéculaire, comme une surface humide
      ego.core.material = new THREE.MeshPhongMaterial({
        color: ego.col.clone(), emissive: ego.col.clone(), vertexColors: true, specular: 0x4a201c, shininess: 40,
      });

      // Circuits : des pistes qui suivent méridiens et parallèles, tracées une fois avec une graine fixe
      const rng = mulberry32(20261013), DEG = Math.PI / 180;
      const pts = [], sv = [], cv = [], segs = [], padIdx = [];
      const nCirc = 10 + Math.floor(rng() * 7);
      const addPoint = (lat, lon, s, c) => {
        pts.push(Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon));
        sv.push(s); cv.push(c);
        return sv.length - 1;
      };
      const addPad = (p) => padIdx.push(p); // une soudure = un point de piste (départ, bout, bout de branche)
      // axis 0 : le long d'un méridien (la latitude change) ; axis 1 : le long d'un parallèle
      function walk(c, lat, lon, s, prev, legs, axis, canBranch) {
        for (let leg = 0; leg < legs; leg++) {
          const len = (2 + Math.floor(rng() * 4)) * 7.5 * DEG;
          const sign = rng() < 0.5 ? -1 : 1;
          let lat2 = lat, lon2 = lon;
          if (axis === 0) { lat2 = lat + sign * len; if (Math.abs(lat2) > 68 * DEG) lat2 = lat - sign * len; }
          else lon2 = lon + (sign * len) / Math.cos(lat);
          const legLen = axis === 0 ? Math.abs(lat2 - lat) : Math.abs(lon2 - lon) * Math.cos(lat);
          const steps = Math.max(1, Math.ceil(legLen / (5 * DEG)));  // un point tous les 5° au plus
          for (let k = 1; k <= steps; k++) {
            s += legLen / steps;
            const p = addPoint(lat + ((lat2 - lat) * k) / steps, lon + ((lon2 - lon) * k) / steps, s, c);
            segs.push(prev, p);
            prev = p;
          }
          lat = lat2; lon = lon2;
          // Embranchement occasionnel : la piste tourne, la branche continue tout droit (un T)
          if (canBranch && leg < legs - 1 && rng() < 0.3) walk(c, lat, lon, s, prev, 1 + Math.floor(rng() * 2), axis, false);
          axis = 1 - axis; // virage à angle droit
        }
        addPad(prev); // soudure au bout de la piste
      }
      for (let c = 0; c < nCirc; c++) {
        // Départs répartis en bandes autour de la face tournée vers la caméra (+z),
        // en alternant haut et bas, loin des pôles où les méridiens se resserrent
        const lon = (90 + ((c + rng()) / nCirc - 0.5) * 220) * DEG;
        const lat = (c % 2 ? 1 : -1) * (5 + rng() * 45) * DEG;
        const first = sv.length;
        const p0 = addPoint(lat, lon, 0, c);
        addPad(p0);
        walk(c, lat, lon, 0, p0, 3 + Math.floor(rng() * 4), rng() < 0.5 ? 0 : 1, true);
        // Abscisse ramenée entre 0 (départ) et 1 (bout le plus lointain) pour chaque circuit
        let sMax = 0;
        for (let i = first; i < sv.length; i++) sMax = Math.max(sMax, sv[i]);
        for (let i = first; i < sv.length; i++) sv[i] /= sMax;
      }
      const pads = [], padS = [], padC = [];
      for (const p of padIdx) { pads.push(pts[p * 3], pts[p * 3 + 1], pts[p * 3 + 2]); padS.push(sv[p]); padC.push(cv[p]); }

      const cGeo = new THREE.BufferGeometry();
      cGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts.length), 3));
      cGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(pts.length), 3));
      cGeo.setIndex(segs);
      const glowMat = (extra) => Object.assign({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }, extra);
      const circuits = new THREE.LineSegments(cGeo, new THREE.LineBasicMaterial(glowMat({})));
      const pGeo = new THREE.BufferGeometry();
      pGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pads.length), 3));
      pGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(pads.length), 3));
      const padPoints = new THREE.Points(pGeo, new THREE.PointsMaterial(glowMat({ size: ego.r * 0.29, map: glowTex })));
      circuits.frustumCulled = padPoints.frustumCulled = false; // les points bougent avec la membrane
      ego.core.add(circuits, padPoints); // enfants de la sphère : même échelle qu'elle
      const delay = new Float32Array(nCirc);
      for (let c = 0; c < nCirc; c++) delay[c] = rng() * 0.25; // léger décalage d'un circuit à l'autre
      Object.assign(flesh, {
        cGeo, pGeo, cDir: new Float32Array(pts), cS: new Float32Array(sv), cC: new Uint8Array(cv),
        pDir: new Float32Array(pads), pS: new Float32Array(padS), pC: new Uint8Array(padC),
        pPos: new Float32Array(pads.length), padCount: pads.length / 3, delay,
      });
    }

    // Lumière d'une impulsion à l'abscisse s (0 à 1) : front net, traîne plus longue derrière
    function veinGlow(s, c, gain) {
      if (REDUCED) return 0.3; // animations réduites : allumé en continu, faiblement
      const d = s - ((beatU - flesh.delay[c]) * 1.35 - 0.1);
      return gain * (d > 0 ? Math.exp(-((d / 0.05) ** 2)) : Math.exp(-((d / 0.22) ** 2)));
    }
    // Rouge sombre au repos, rouge vif dans l'impulsion, presque blanc à son sommet
    function veinColor(attr, i, b, base) {
      const w = b * b * b * b;
      attr.setXYZ(i, base * 0.22 + b * 0.9 + w * 0.5, base * 0.03 + b * 0.12 + w * 0.75, base * 0.035 + b * 0.12 + w * 0.7);
    }

    function updateFlesh(dt, beat, heat) {
      // Au survol, la membrane s'agite un peu plus et dérive plus vite
      fleshT += dt * (1 + 1.2 * heat);
      fleshAmp = 1 + 0.35 * heat;
      fleshSwell = 0.035 * beat - 0.012; // dilatation à chaque battement, légère contraction entre deux
      const { dir, uPos, uNrm, uH, uCount, weld, index, vCount, geo } = flesh;

      for (let u = 0; u < uCount; u++) {
        const x = dir[u * 3], y = dir[u * 3 + 1], z = dir[u * 3 + 2];
        const h = fleshHeight(x, y, z);
        uH[u] = h - fleshSwell; // relief seul, pour la couleur des creux et des bosses
        uPos[u * 3] = x * (1 + h); uPos[u * 3 + 1] = y * (1 + h); uPos[u * 3 + 2] = z * (1 + h);
      }
      // Normales recalculées : somme des normales des triangles autour de chaque sommet
      uNrm.fill(0);
      for (let f = 0; f < index.length; f += 3) {
        const a = weld[index[f]] * 3, b = weld[index[f + 1]] * 3, c = weld[index[f + 2]] * 3;
        const abx = uPos[b] - uPos[a], aby = uPos[b + 1] - uPos[a + 1], abz = uPos[b + 2] - uPos[a + 2];
        const acx = uPos[c] - uPos[a], acy = uPos[c + 1] - uPos[a + 1], acz = uPos[c + 2] - uPos[a + 2];
        const nx = aby * acz - abz * acy, ny = abz * acx - abx * acz, nz = abx * acy - aby * acx;
        uNrm[a] += nx; uNrm[a + 1] += ny; uNrm[a + 2] += nz;
        uNrm[b] += nx; uNrm[b + 1] += ny; uNrm[b + 2] += nz;
        uNrm[c] += nx; uNrm[c + 1] += ny; uNrm[c + 2] += nz;
      }
      const P = geo.attributes.position, N = geo.attributes.normal, C = geo.attributes.color;
      for (let v = 0; v < vCount; v++) {
        const u = weld[v] * 3;
        const l = Math.sqrt(uNrm[u] * uNrm[u] + uNrm[u + 1] * uNrm[u + 1] + uNrm[u + 2] * uNrm[u + 2]) || 1;
        P.setXYZ(v, uPos[u], uPos[u + 1], uPos[u + 2]);
        N.setXYZ(v, uNrm[u] / l, uNrm[u + 1] / l, uNrm[u + 2] / l);
        // Presque noir dans les creux, plus vif sur les reliefs
        const t = Math.min(1, Math.max(0, (uH[weld[v]] + 0.07) / 0.14));
        const g = 0.06 + 1.1 * t * t * (3 - 2 * t);
        C.setXYZ(v, g, g * 0.9, g * 0.9);
      }
      P.needsUpdate = N.needsUpdate = C.needsUpdate = true;

      // Circuits et soudures : même déplacement, posés un peu au-dessus de la peau
      const gain = 1 + 0.6 * heat, base = 1 + 0.3 * heat;
      const cP = flesh.cGeo.attributes.position, cCol = flesh.cGeo.attributes.color, cDir = flesh.cDir;
      for (let i = 0; i < flesh.cS.length; i++) {
        const x = cDir[i * 3], y = cDir[i * 3 + 1], z = cDir[i * 3 + 2];
        const k = 1 + fleshHeight(x, y, z) + 0.018;
        cP.setXYZ(i, x * k, y * k, z * k);
        veinColor(cCol, i, veinGlow(flesh.cS[i], flesh.cC[i], gain), base);
      }
      const pP = flesh.pGeo.attributes.position, pCol = flesh.pGeo.attributes.color, pDir = flesh.pDir, pPos = flesh.pPos;
      for (let i = 0; i < flesh.padCount; i++) {
        const x = pDir[i * 3], y = pDir[i * 3 + 1], z = pDir[i * 3 + 2];
        const k = 1 + fleshHeight(x, y, z) + 0.022;
        pPos[i * 3] = x * k; pPos[i * 3 + 1] = y * k; pPos[i * 3 + 2] = z * k;
        pP.setXYZ(i, pPos[i * 3], pPos[i * 3 + 1], pPos[i * 3 + 2]);
        veinColor(pCol, i, veinGlow(flesh.pS[i], flesh.pC[i], gain), base * 1.6);
      }
      cP.needsUpdate = cCol.needsUpdate = pP.needsUpdate = pCol.needsUpdate = true;
    }

    /* ---------- Ego : arcs électriques ---------- */
    // Un petit stock d'éclairs créé une seule fois : à chaque image, on ne fait
    // que réécrire les points des géométries existantes (rien n'est recréé).
    // Chaque éclair = 3 lignes sur la même géométrie : un cœur blanc-rouge
    // et deux bords rouges décalés d'un pixel, ce qui lui donne de l'épaisseur.
    const ARC_POOL = 12, ARC_SEG_MAX = 12;
    const arcs = [];
    const arcPts = Array.from({ length: ARC_SEG_MAX + 1 }, () => new THREE.Vector3());
    const arcDir = new THREE.Vector3(), arcView = new THREE.Vector3(), arcOff = new THREE.Vector3();
    const arcGroup = new THREE.Group();
    arcGroup.visible = false;
    if (ego) {
      ego.group.add(arcGroup);
      for (let i = 0; i < ARC_POOL; i++) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((ARC_SEG_MAX + 1) * 3), 3));
        geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array((ARC_SEG_MAX + 1) * 3), 3));
        const mat = (color) => new THREE.LineBasicMaterial({
          color, vertexColors: true, transparent: true, depthWrite: false,
          blending: THREE.AdditiveBlending, fog: false,
        });
        const coreMat = mat(0xffffff), edgeMat = mat(HALO.ego);
        const lines = [new THREE.Line(geo, coreMat), new THREE.Line(geo, edgeMat), new THREE.Line(geo, edgeMat)];
        for (const line of lines) {
          line.frustumCulled = false; // les points bougent : pas de boîte englobante fiable
          arcGroup.add(line);
        }
        arcs.push({ geo, coreMat, edgeMat, lines, age: 0, life: 0, flicker: 1, on: false });
      }
    }

    // Nouvel éclair par déplacement du point milieu : on part d'un segment droit,
    // on coupe le plus long en deux et on décale son milieu au hasard,
    // perpendiculairement, d'autant moins que le segment est court.
    function strike(b, i, strong) {
      b.age = 0;
      b.life = 80 + Math.random() * 120;
      b.on = strong || i < 4 || (i < 6 && Math.random() < 0.5); // 4 à 6 éclairs, les 12 quand ils redoublent
      for (const line of b.lines) line.visible = b.on;
      if (!b.on) return;
      b.flicker = 0.85 + Math.random() * 0.15;

      // L'éclair part d'une soudure au bout d'un circuit, de préférence tournée vers la caméra
      camera.getWorldDirection(arcView);
      const { pDir, pPos, padCount } = flesh;
      let pad = 0;
      for (let tries = 0; tries < 8; tries++) {
        pad = Math.floor(Math.random() * padCount);
        if (pDir[pad * 3] * arcView.x + pDir[pad * 3 + 1] * arcView.y + pDir[pad * 3 + 2] * arcView.z < 0.2) break;
      }
      // Il jaillit vers l'extérieur, ramené vers le plan de l'écran (sinon il part vers nous et paraît minuscule)
      arcDir.set(pDir[pad * 3], pDir[pad * 3 + 1], pDir[pad * 3 + 2]);
      arcDir.addScaledVector(arcView, -0.8 * arcDir.dot(arcView)).normalize();
      const len = ego.r * ARC_LENGTH * (strong ? 1.4 + Math.random() * 1.6 : 0.7 + Math.random() * 1.1);
      arcPts[0].set(pPos[pad * 3], pPos[pad * 3 + 1], pPos[pad * 3 + 2]).multiplyScalar(ego.r);
      arcPts[1].copy(arcPts[0]).addScaledVector(arcDir, len);

      const nSeg = 8 + Math.floor(Math.random() * 5);
      let count = 2;
      while (count - 1 < nSeg) {
        let best = 0, bestLen = 0;
        for (let k = 0; k < count - 1; k++) {
          const d = arcPts[k].distanceToSquared(arcPts[k + 1]);
          if (d > bestLen) { bestLen = d; best = k; }
        }
        const segLen = Math.sqrt(bestLen);
        arcView.subVectors(arcPts[best + 1], arcPts[best]).normalize();       // axe du segment
        arcOff.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5);
        arcOff.addScaledVector(arcView, -arcOff.dot(arcView));                 // garde la partie perpendiculaire
        arcOff.setLength(segLen * (Math.random() - 0.5) * 0.9);
        // On décale la fin du tableau d'une case pour insérer le nouveau point
        for (let k = count; k > best + 1; k--) arcPts[k].copy(arcPts[k - 1]);
        arcPts[best + 1].addVectors(arcPts[best], arcPts[best + 2]).multiplyScalar(0.5).add(arcOff);
        count++;
      }

      const pos = b.geo.attributes.position, col = b.geo.attributes.color;
      for (let k = 0; k < count; k++) {
        pos.setXYZ(k, arcPts[k].x, arcPts[k].y, arcPts[k].z);
        // Presque blanc à la racine, rouge sombre à la pointe
        const t = k / (count - 1), fade = 1 - 0.45 * t;
        col.setXYZ(k, (1 - 0.15 * t) * fade, (0.85 - 0.75 * t) * fade, (0.8 - 0.68 * t) * fade);
      }
      pos.needsUpdate = col.needsUpdate = true;
      b.geo.setDrawRange(0, count);

      // Bords : la même ligne, décalée d'environ un pixel de chaque côté
      camera.getWorldDirection(arcView);
      const px = (2 * camera.position.distanceTo(ego.pos) * Math.tan((camera.fov * Math.PI) / 360)) / window.innerHeight;
      arcOff.crossVectors(arcDir, arcView).setLength(px * 1.2);
      b.lines[1].position.copy(arcOff);
      b.lines[2].position.copy(arcOff).negate();
    }

    function updateArcs(ms, strong) {
      for (let i = 0; i < arcs.length; i++) {
        const b = arcs[i];
        b.age += ms;
        if (b.age >= b.life) strike(b, i, strong);
        // Légère variation d'opacité pendant la courte vie de l'éclair
        const op = b.flicker * (1 - 0.25 * (b.age / b.life));
        b.coreMat.opacity = op;
        b.edgeMat.opacity = op * 0.95;
      }
    }

    // Battement de cœur d'Ego : un coup fort, un plus faible, et un rythme qui change à chaque battement
    let beatU = 0, beatPeriod = 1.5;
    function heartbeat(dt) {
      beatU += dt / beatPeriod;
      if (beatU >= 1) { beatU -= 1; beatPeriod = 1.2 + Math.random() * 0.8; }
      return Math.exp(-(((beatU - 0.08) / 0.05) ** 2)) + 0.55 * Math.exp(-(((beatU - 0.3) / 0.06) ** 2));
    }
    // Forme de départ de la membrane (et forme définitive si les animations sont réduites)
    if (ego) updateFlesh(0, 0, 0);

    // Liens : un segment par lien, mis à jour à chaque image
    for (const l of links) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
      const colors = new Float32Array(6);
      // Les liens d'Ego vers ses compétences sont rouges d'un bout à l'autre
      const egoLink = ego && l.kind !== 'bridge' && (l.a === ego || l.b === ego);
      (egoLink ? ego : l.a).halo.toArray(colors, 0);
      (egoLink ? ego : l.b).halo.toArray(colors, 3);
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      l.line = new THREE.Line(geo, new THREE.LineBasicMaterial({
        vertexColors: true, transparent: true, opacity: 0.1, depthWrite: false,
      }));
      scene.add(l.line);
    }

    // « Paquets » qui circulent sur les liens : le clin d'œil réseau
    const packets = [];
    function addPacket(link, fromA, offset, speed, size) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTex, color: (fromA ? link.a : link.b).halo, transparent: true,
        depthWrite: false, blending: THREE.AdditiveBlending,
      }));
      s.scale.setScalar(size);
      scene.add(s);
      packets.push({ link, fromA, u: offset, speed, sprite: s });
    }
    if (!REDUCED) {
      for (const l of links) {
        if (l.kind === 'bridge') {
          for (let i = 0; i < 6; i++) addPacket(l, i % 2 === 0, i / 6, 0.11, 2.6);
        } else if (ego && (l.a === ego || l.b === ego)) {
          // Les paquets partent d'Ego (et prennent sa couleur)
          addPacket(l, l.a === ego, Math.random(), 0.16, 1.4);
        } else if (l.kind === 'hub-project') {
          addPacket(l, l.a.type === 'hub', Math.random(), 0.22, 1.6);
        } else {
          addPacket(l, l.a.type === 'project', Math.random(), 0.3, 1.1);
        }
      }
    }

    /* ---------- L'emprise d'Ego : fils latents et implants ---------- */
    // Purement visuel : rien de tout ça n'entre dans la simulation physique.
    // Deux objets seulement, créés une fois : un LineSegments pour tous les fils et un Points
    // pour tous les implants. À chaque image, on réécrit leurs tableaux sur place.
    // Chaque fil est découpé en GRIP.subdiv segments : sa couleur peut changer le long du fil,
    // ce qui permet à la vague et à l'impulsion d'avancer d'Ego vers le nœud.
    const thralls = ego ? nodes.filter((n) => n !== ego) : [];
    const SUB = GRIP.subdiv, TH = thralls.length;
    const grip = {
      level: 0,           // 0 = repos, 1 = Ego survolé
      wave: 0,            // distance déjà parcourue par la vague depuis Ego (unités de la scène)
      reach: 60,          // longueur du fil le plus long (mesurée à chaque image)
      wasOn: false,
      next: GRIP.pulseMin + Math.random() * (GRIP.pulseMax - GRIP.pulseMin), // prochaine impulsion
      pulse: -1, pulseT: 0, // fil de l'impulsion en cours (-1 : aucune) et temps écoulé
      blink: new Float32Array(TH), // clignotement de chaque implant (temps restant, en secondes)
      len: new Float32Array(TH),   // longueur de chaque fil
    };
    const GRIP_RED = new THREE.Color(0xff2a2e);
    const gripGeo = new THREE.BufferGeometry();
    gripGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TH * SUB * 6), 3).setUsage(THREE.DynamicDrawUsage));
    gripGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(TH * SUB * 6), 3).setUsage(THREE.DynamicDrawUsage));
    // Mélange additif : sur le fond sombre, la luminosité de la couleur joue le rôle de l'opacité
    const gripLines = new THREE.LineSegments(gripGeo, new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    }));

    // Implants : taille propre à chaque point (attribut « size »), donc un petit shader maison ;
    // PointsMaterial n'a qu'une taille pour tous les points.
    const implantGeo = new THREE.BufferGeometry();
    implantGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TH * 3), 3).setUsage(THREE.DynamicDrawUsage));
    implantGeo.setAttribute('size', new THREE.BufferAttribute(new Float32Array(TH), 1).setUsage(THREE.DynamicDrawUsage));
    implantGeo.setAttribute('alpha', new THREE.BufferAttribute(new Float32Array(TH), 1).setUsage(THREE.DynamicDrawUsage));
    // « lift » : rayon du nœud porteur (fixe), voir le shader
    implantGeo.setAttribute('lift', new THREE.BufferAttribute(new Float32Array(thralls.map((n) => n.r)), 1));
    const implantMat = new THREE.ShaderMaterial({
      uniforms: { color: { value: GRIP_RED.clone() }, scale: { value: 1 }, minPx: { value: 2.5 } },
      vertexShader: `
        attribute float size; attribute float alpha; attribute float lift;
        uniform float scale; uniform float minPx;
        varying float vAlpha;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          // Diamètre en unités de la scène, converti en pixels selon la distance
          gl_PointSize = max(size * scale / -mv.z, minPx);
          vAlpha = alpha;
          // Le point est un carré face à l'écran : posé sur une sphère, sa moitié s'enfoncerait
          // dans la surface. On l'avance donc vers la caméra, le long du rayon de vue (il ne bouge
          // pas à l'écran), d'un rayon de son nœud : il passe devant sa sphère, pas devant les autres.
          mv.xyz *= max(0.0, 1.0 - lift / length(mv.xyz));
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform vec3 color; varying float vAlpha;
        void main() {
          float d = length(gl_PointCoord - 0.5) * 2.0;   // 0 au centre, 1 au bord
          float a = 1.0 - smoothstep(0.5, 1.0, d);        // disque aux bords adoucis
          gl_FragColor = vec4(color * (1.0 + 0.5 * vAlpha * (1.0 - d)), a * vAlpha);
        }`,
      transparent: true, depthWrite: false,
    });
    const implants = new THREE.Points(implantGeo, implantMat);
    // Tête de l'impulsion : un seul halo, réutilisé à chaque impulsion
    const pulseHead = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex, color: GRIP_RED, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    pulseHead.scale.setScalar(2.2);
    gripLines.frustumCulled = implants.frustumCulled = false; // les points bougent : pas de boîte englobante fiable
    implants.renderOrder = 2; // après les halos, sinon ils l'effacent
    if (TH) scene.add(gripLines, implants, pulseHead);

    const gE = new THREE.Vector3(), gC = new THREE.Vector3(), gA = new THREE.Vector3(), gB = new THREE.Vector3();
    // Luminosité d'un point du fil i situé à la distance s d'Ego
    function gripAt(i, s) {
      if (REDUCED) return GRIP.rest;
      let b = GRIP.rest;
      if (grip.level > 0.001) {
        const ahead = grip.wave - s; // > 0 : la vague est déjà passée ici
        const lit = Math.min(1, Math.max(0, ahead / 6));
        b += grip.level * (lit * (GRIP.hot - GRIP.rest) + 0.45 * Math.exp(-((ahead / 4) ** 2)));
      }
      if (i === grip.pulse) {
        const t = grip.pulseT, T = GRIP.pulseTravel;
        // Le fil s'allume un peu le temps de l'impulsion, avec un fondu à l'entrée et à la sortie
        const env = Math.min(1, t / 0.15) * (1 - Math.min(1, Math.max(0, (t - T) / 0.6)));
        b += env * 0.12 + (t < T ? 0.7 * Math.exp(-(((s - (t / T) * grip.len[i]) / 3) ** 2)) : 0);
      }
      return b * thralls[i].power;
    }

    function updateGrip(dt, beat) {
      if (!TH) return;
      const on = !REDUCED && (hovered === ego || armed === ego);
      if (!REDUCED) {
        // Début du survol : la vague repart d'Ego (sauf si les fils sont encore allumés)
        if (on && !grip.wasOn && grip.level < 0.1) grip.wave = 0;
        grip.wasOn = on;
        // (bornée : une fois tout atteint, la crête lumineuse a quitté les fils)
        if (on) grip.wave = Math.min(grip.wave + dt * (grip.reach / GRIP.waveTime), grip.reach + 30);
        // Montée rapide (la vague fait le spectacle), retour au repos plus lent
        grip.level += ((on ? 1 : 0) - grip.level) * (1 - Math.exp(-dt * (on ? 10 : 2.2)));

        // Hors survol : de temps en temps, une impulsion court vers un nœud au hasard
        if (grip.pulse >= 0) {
          grip.pulseT += dt;
          if (grip.pulseT >= GRIP.pulseTravel && grip.pulseT - dt < GRIP.pulseTravel) grip.blink[grip.pulse] = 0.7;
          if (grip.pulseT > GRIP.pulseTravel + 0.6) grip.pulse = -1;
        } else if (grip.level < 0.02 && !fx.on && (grip.next -= dt) <= 0) {
          grip.pulse = Math.floor(Math.random() * TH);
          grip.pulseT = 0;
          grip.next = GRIP.pulseMin + Math.random() * (GRIP.pulseMax - GRIP.pulseMin);
        }
      }

      const P = gripGeo.attributes.position, C = gripGeo.attributes.color;
      const IP = implantGeo.attributes.position, IS = implantGeo.attributes.size, IA = implantGeo.attributes.alpha;
      let reach = 1;
      for (let i = 0; i < TH; i++) {
        const n = thralls[i];
        // Implant : collé à la surface du nœud, côté Ego, légèrement tourné vers la caméra
        // pour ne pas disparaître derrière le bord de la sphère
        gE.subVectors(ego.pos, n.pos).normalize();
        gC.subVectors(camera.position, n.pos).normalize();
        gB.copy(gE).addScaledVector(gC, 0.6).normalize().multiplyScalar(n.r).add(n.pos);
        gA.copy(gE).multiplyScalar(-ego.r).add(ego.pos); // départ du fil : la surface d'Ego
        const len = gA.distanceTo(gB);
        grip.len[i] = len;
        if (len > reach) reach = len;

        // Fil : SUB segments de gA à gB, la couleur calculée à chaque point de découpe
        let px = gA.x, py = gA.y, pz = gA.z, pb = gripAt(i, 0);
        for (let k = 1; k <= SUB; k++) {
          const t = k / SUB;
          const x = gA.x + (gB.x - gA.x) * t, y = gA.y + (gB.y - gA.y) * t, z = gA.z + (gB.z - gA.z) * t;
          const b = gripAt(i, len * t);
          const v0 = (i * SUB + k - 1) * 2;
          P.setXYZ(v0, px, py, pz); P.setXYZ(v0 + 1, x, y, z);
          C.setXYZ(v0, GRIP_RED.r * pb, GRIP_RED.g * pb, GRIP_RED.b * pb);
          C.setXYZ(v0 + 1, GRIP_RED.r * b, GRIP_RED.g * b, GRIP_RED.b * b);
          px = x; py = y; pz = z; pb = b;
        }

        // Implant : bat avec le cœur d'Ego, s'avive quand la vague l'atteint, clignote après une impulsion
        let a = 0.45, size = 1;
        if (!REDUCED) {
          const reached = Math.min(1, Math.max(0, (grip.wave - len) / 6)) * grip.level;
          let blink = 0;
          if (grip.blink[i] > 0) {
            grip.blink[i] = Math.max(0, grip.blink[i] - dt);
            blink = Math.sin(Math.PI * (1 - grip.blink[i] / 0.7)); // monte puis redescend, sans flash
          }
          a = 0.3 + 0.35 * beat + 0.5 * reached + 0.55 * blink;
          size = 1 + 0.25 * beat + 0.35 * reached + 0.3 * blink;
        }
        IP.setXYZ(i, gB.x, gB.y, gB.z);
        IS.setX(i, n.r * GRIP.implant * 2 * size);
        IA.setX(i, Math.min(1, a) * n.power);
      }
      grip.reach = reach;
      P.needsUpdate = C.needsUpdate = IP.needsUpdate = IS.needsUpdate = IA.needsUpdate = true;

      // Tête de l'impulsion
      if (grip.pulse >= 0 && grip.pulseT < GRIP.pulseTravel) {
        // Elle glisse du premier au dernier point du fil (déjà calculés ci-dessus)
        const i = grip.pulse, t = grip.pulseT / GRIP.pulseTravel, n = thralls[i];
        gA.fromBufferAttribute(P, i * SUB * 2);
        gB.fromBufferAttribute(P, (i * SUB + SUB - 1) * 2 + 1);
        pulseHead.position.lerpVectors(gA, gB, t);
        pulseHead.material.opacity = 0.9 * Math.min(1, grip.pulseT / 0.15) * Math.min(1, (1 - t) * 6) * n.power;
      } else pulseHead.material.opacity = 0;
    }

    /* ---------- Étiquettes HTML (nettes et lisibles) ---------- */
    const labelLayer = $('#labels');
    for (const n of nodes) {
      const lbl = el('div', { class: 'lbl lbl-' + n.type + (n.colorKey ? ' c-' + n.colorKey : ''), 'data-glitch': n.title });
      lbl.append(document.createTextNode(n.title));
      if (n.type === 'project') {
        n.sub = el('small', { text: n.short || '' });
        lbl.append(n.sub);
      }
      lbl.style.opacity = 0;
      labelLayer.append(lbl);
      n.label = lbl;
    }

    /* ---------- Placement initial et ancrages ---------- */
    let portrait = false;
    // Triangle des trois sphères, à garder dégagé : un bord = un point et sa normale vers l'extérieur
    const triangle = [];
    function placeAnchors() {
      // Paysage : un triangle, Ego au sommet. Portrait (téléphone) : Ego en haut, les deux mondes dessous (voir ANCHORS).
      const table = portrait ? ANCHORS.portrait : ANCHORS.landscape;
      hubs.forEach((h, i) => {
        const [x, y] = table[i] || [0, 0];
        h.anchor = new THREE.Vector3(x, y, 0);
      });

      // Chaque petit nœud reçoit un nid : le point où il revient doucement.
      // Un monde range ses nœuds à l'extérieur et sous sa sphère ; les compétences communes
      // aux deux mondes vont au milieu, plus bas ; celles d'Ego seul, de part et d'autre d'Ego
      // (en paysage) ou au bout de la colonne du milieu (en portrait, faute de place à côté de lui).
      const nest = portrait ? NEST.portrait : NEST.landscape;
      const worlds = hubs.filter((h) => h !== ego);
      const midX = ego ? ego.anchor.x : 0;
      const lowY = worlds.length ? Math.min(...worlds.map((h) => h.anchor.y)) : 0;
      let side = -1, shared = 0;
      for (const n of nodes) {
        if (n.type === 'hub') continue;
        const w = n.world;
        n.floor = lowY - nest.floor;
        n.ceil = Infinity;
        n.side = 0;
        if (w && w !== 'shared' && w !== ego) {
          const s = Math.sign(w.anchor.x - midX) || 1;
          n.home = new THREE.Vector3(w.anchor.x + s * nest.out, w.anchor.y - nest.down, 0);
          n.side = s;
          n.lane = midX + s * Math.abs(w.anchor.x - midX) * nest.lane;
          n.wall = w.anchor.x + s * nest.wall;
          n.ceil = w.anchor.y + 2; // pas plus haut que sa sphère
        } else if (w === ego && !portrait) {
          // À côté d'Ego, juste hors de sa zone dégagée, en alternant gauche et droite
          const d = ego.r * EGO_CLEAR + 3;
          n.home = new THREE.Vector3(ego.anchor.x + side * d * Math.cos(nest.own), ego.anchor.y - d * Math.sin(nest.own), 0);
          side = -side;
        } else {
          // En portrait, la colonne du milieu est étroite : les compétences communes s'y rangent
          // en escalier, pour que leurs étiquettes ne se recouvrent pas
          const step = portrait ? shared++ : 0, dx = portrait ? (step % 2 ? 5 : -5) : 0;
          n.home = new THREE.Vector3(midX + dx, lowY - nest.shared - step * 10, 0);
        }
      }

      // Les liens d'Ego vers ses compétences sont des ressorts comme les autres, mais leur
      // longueur au repos est la distance entre Ego et le nid du nœud : à l'équilibre ils ne
      // tirent pas, et les nuages restent à leur place au lieu de remonter vers Ego.
      for (const l of links) {
        if (!ego || l.kind === 'bridge' || (l.a !== ego && l.b !== ego)) continue;
        const o = l.a === ego ? l.b : l.a;
        l.rest = o.home ? Math.hypot(o.home.x - ego.anchor.x, o.home.y - ego.anchor.y) : null;
      }

      // Bords du triangle, normales tournées vers l'extérieur
      triangle.length = 0;
      if (hubs.length === 3) {
        const c = new THREE.Vector3();
        for (const h of hubs) c.add(h.anchor);
        c.multiplyScalar(1 / 3);
        for (let i = 0; i < 3; i++) {
          const a = hubs[i].anchor, b = hubs[(i + 1) % 3].anchor;
          let nx = b.y - a.y, ny = a.x - b.x;
          const l = Math.hypot(nx, ny) || 1;
          nx /= l; ny /= l;
          if ((c.x - a.x) * nx + (c.y - a.y) * ny > 0) { nx = -nx; ny = -ny; }
          triangle.push({ x: a.x, y: a.y, nx, ny });
        }
      }
    }

    function initialLayout() {
      placeAnchors();
      for (const h of hubs) h.pos.copy(h.anchor);
      const rnd = (k) => (Math.random() - 0.5) * k;
      // Chaque nœud part de son nid, avec un peu de hasard ; la physique fait le reste
      for (const n of nodes) {
        if (n.type === 'hub') continue;
        n.pos.copy(n.home).add(new THREE.Vector3(rnd(14), rnd(10), rnd(10)));
      }
      for (let i = 0; i < 400; i++) physicsStep(0, false);
    }

    /* ---------- Simulation physique ---------- */
    const tmp = new THREE.Vector3();
    let dragNode = null;

    function physicsStep(time, drift) {
      for (const n of nodes) n.force.set(0, 0, 0);

      // 1. Répulsion (loi en 1/d²) entre chaque paire de nœuds
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j];
          tmp.subVectors(a.pos, b.pos);
          const d2 = Math.max(tmp.lengthSq(), 9);
          const f = (K_REPULSION * CHARGE[a.type] * CHARGE[b.type]) / d2;
          tmp.normalize().multiplyScalar(f);
          a.force.add(tmp);
          b.force.sub(tmp);
        }
      }

      // 2. Ressorts sur les liens (loi de Hooke)
      for (const l of links) {
        tmp.subVectors(l.b.pos, l.a.pos);
        const d = Math.max(tmp.length(), 0.01);
        // Entre deux sphères ancrées, le ressort garde la distance des ancrages (sinon ils se contredisent)
        // (les liens d'Ego ont leur propre longueur, calculée dans placeAnchors)
        const rest = l.a.anchor && l.b.anchor ? l.a.anchor.distanceTo(l.b.anchor) : l.rest || SPRING_LENGTH[l.kind] || 18;
        const f = K_SPRING * (d - rest);
        tmp.multiplyScalar(f / d);
        l.a.force.add(tmp);
        l.b.force.sub(tmp);
      }

      for (const n of nodes) {
        // 3. Ancrage des sphères ; les autres nœuds sont rappelés doucement vers leur nid.
        // En paysage, le rappel est plus faible en largeur : les nuages s'étalent sur les côtés.
        // Les compétences d'Ego seul sont tenues plus fermement, pour rester près de lui.
        if (n.anchor) n.force.add(tmp.subVectors(n.anchor, n.pos).multiplyScalar(K_ANCHOR * MASS.hub));
        else if (n.home) {
          const own = ego && n.world === ego;
          const [kx, ky, kz] = own ? NEST_OWN : portrait ? NEST.portrait.k : NEST.landscape.k;
          tmp.subVectors(n.home, n.pos);
          n.force.x += tmp.x * kx;
          n.force.y += tmp.y * ky;
          n.force.z += tmp.z * kz;
          if (!own) {
            // Plancher : les nuages ne descendent pas trop, le graphe reste plus large que haut
            if (n.pos.y < n.floor) n.force.y += (n.floor - n.pos.y) * 0.08;
            // Plafond (paysage) : les nuages s'étalent à côté et sous leur sphère, pas au-dessus
            if (!portrait && n.pos.y > n.ceil) n.force.y -= (n.pos.y - n.ceil) * 0.08;
            // Couloir : un nœud d'un seul monde reste de son côté, le milieu est aux compétences communes
            const into = n.side * (n.lane - n.pos.x);
            if (n.side && into > 0) n.force.x += n.side * into * 0.06;
            // Mur extérieur (portrait) : sur un écran étroit, les nuages ne sortent pas par les côtés
            const out = n.side * (n.pos.x - n.wall);
            if (n.side && out > 0) n.force.x -= n.side * out * 0.06;
          }
        }

        // 3 bis. Centre du triangle dégagé : un nœud qui entre dans le triangle (agrandi d'une
        // marge) est poussé vers le bord le plus proche. Seuls les fils le traversent.
        if (!n.anchor && triangle.length === 3) {
          let depth = Infinity, best = null;
          for (const e of triangle) {
            const d = 4 - ((n.pos.x - e.x) * e.nx + (n.pos.y - e.y) * e.ny); // > 0 : du côté intérieur
            if (d < depth) { depth = d; best = e; }
          }
          if (depth > 0) {
            n.force.x += best.nx * depth * 0.15;
            n.force.y += best.ny * depth * 0.15;
          }
        }

        // 3 ter. Zone dégagée autour d'Ego : un nœud qui y entre est repoussé. La distance est
        // mesurée dans le plan de l'écran (x, y), donc aucun nœud ne peut non plus passer devant lui.
        if (ego && !n.anchor) {
          const dx = n.pos.x - ego.pos.x, dy = n.pos.y - ego.pos.y;
          const d = Math.sqrt(dx * dx + dy * dy) || 0.01, clear = ego.r * EGO_CLEAR;
          if (d < clear) {
            const f = ((clear - d) * 0.08) / d;
            n.force.x += dx * f;
            n.force.y += dy * f;
          }
        }

        // 4. Respiration : une petite dérive pour que la scène reste vivante
        if (drift) {
          n.force.x += Math.sin(time * 0.6 + n.phase) * 0.012;
          n.force.y += Math.cos(time * 0.5 + n.phase * 1.3) * 0.012;
          n.force.z += Math.sin(time * 0.4 + n.phase * 0.7) * 0.012;
        }

        if (n === dragNode) { n.vel.set(0, 0, 0); continue; }
        n.vel.add(n.force.multiplyScalar(1 / MASS[n.type])).multiplyScalar(DAMPING);
        n.pos.add(n.vel);
      }
    }

    /* ---------- Caméra ---------- */
    const cam = {
      target: new THREE.Vector3(), wantTarget: new THREE.Vector3(), center: new THREE.Vector3(),
      theta: 0, phi: Math.PI / 2 - 0.18, radius: 100,
      zoom: 1, focusZoom: 1, fit: 100,
      shiftX: 0, shiftY: 0, wantShiftX: 0, wantShiftY: 0, // décalage écran quand la carte est ouverte
      focused: false,
    };

    // Place prise par l'en-tête (en haut) et par les boutons (en bas), en pixels.
    // Mesurée au chargement et au redimensionnement seulement, pas à chaque image.
    let headerPx = 0;
    const FOOTER_PX = 64;
    function measureHeader() { headerPx = $('.ident').getBoundingClientRect().bottom + 16; }

    function computeFit() {
      // Boîte qui contient tous les nœuds (Ego compte avec son halo)
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const n of nodes) {
        const r = n === ego ? n.r * 1.8 : n.r;
        minX = Math.min(minX, n.pos.x - r); maxX = Math.max(maxX, n.pos.x + r);
        minY = Math.min(minY, n.pos.y - r); maxY = Math.max(maxY, n.pos.y + r);
      }
      // En paysage, Ego reste au centre de l'écran : la boîte est rendue symétrique autour de lui
      if (ego && !portrait) {
        const half = Math.max(ego.pos.x - minX, maxX - ego.pos.x);
        minX = ego.pos.x - half; maxX = ego.pos.x + half;
      }
      minX -= 6; maxX += 6; minY -= 6; maxY += 6;
      const H = window.innerHeight;
      const top = Math.min(headerPx / H, 0.45), bottom = FOOTER_PX / H;
      const t = Math.tan((camera.fov * Math.PI) / 360);
      // Recul nécessaire : la largeur doit tenir dans l'écran, la hauteur dans la bande libre
      // entre l'en-tête et les boutons (sinon Ego, tout en haut, passerait sous le titre)
      const dX = (maxX - minX) / (2 * t * camera.aspect);
      const dY = (maxY - minY) / (2 * t * (1 - top - bottom));
      // Sur téléphone, on accepte que les bords du nuage dépassent un peu sur les côtés : c'est plus lisible
      const d = Math.max(portrait ? dX * 0.78 : dX, dY) + 6;
      // Le contenu est centré dans cette bande libre, pas dans tout l'écran
      const viewH = 2 * d * t;
      cam.center.set((minX + maxX) / 2, (minY + maxY) / 2 + ((top - bottom) / 2) * viewH, 0);
      return d;
    }

    const right = new THREE.Vector3(), look = new THREE.Vector3();
    function updateCamera(dt) {
      const k = 1 - Math.exp(-dt * 3);
      cam.fit += (computeFit() - cam.fit) * k;
      cam.target.lerp(cam.focused ? cam.wantTarget : cam.center, k);
      cam.shiftX += (cam.wantShiftX - cam.shiftX) * k;
      cam.shiftY += (cam.wantShiftY - cam.shiftY) * k;
      const want = cam.fit * cam.zoom * cam.focusZoom;
      cam.radius += (want - cam.radius) * k;

      // Décalage latéral / vertical (en fraction de l'écran) pour laisser la place à la carte
      const viewH = 2 * cam.radius * Math.tan((camera.fov * Math.PI) / 360);
      right.set(Math.cos(cam.theta), 0, -Math.sin(cam.theta));
      look.copy(cam.target)
        .addScaledVector(right, cam.shiftX * viewH * camera.aspect)
        .addScaledVector(camera.up, -cam.shiftY * viewH);

      const sp = Math.sin(cam.phi);
      camera.position.set(
        look.x + cam.radius * sp * Math.sin(cam.theta),
        look.y + cam.radius * Math.cos(cam.phi),
        look.z + cam.radius * sp * Math.cos(cam.theta)
      );
      camera.lookAt(look);
    }

    function resize() {
      const w = window.innerWidth, h = window.innerHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      // Taille des implants : pixels de l'écran (réels) par unité de la scène, à distance 1
      const dpr = renderer.getPixelRatio();
      implantMat.uniforms.scale.value = (h * dpr) / (2 * Math.tan((camera.fov * Math.PI) / 360));
      implantMat.uniforms.minPx.value = 2.5 * dpr;
      const wasPortrait = portrait;
      portrait = camera.aspect < 0.85;
      if (portrait !== wasPortrait) placeAnchors();
      measureHeader();
    }
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(measureHeader);
    window.addEventListener('resize', resize);
    portrait = window.innerWidth / window.innerHeight < 0.85;
    resize();
    initialLayout();
    cam.fit = computeFit();
    cam.radius = cam.fit;
    cam.target.copy(cam.center);

    /* ---------- Survol, sélection, mise en lumière ---------- */
    let hovered = null, selected = null, intro = null;
    let armed = null; // tactile : Ego touché une fois, le second tap déclenche l'effet

    function litSet(active) {
      const set = new Set([active]);
      if (active.type === 'hub') {
        for (const p of projectsOf(active)) {
          set.add(p);
          for (const m of neighbors(p)) if (m.type === 'skill') set.add(m);
        }
        for (const m of neighbors(active)) if (m.type === 'skill') set.add(m);
      } else {
        for (const m of neighbors(active)) set.add(m);
      }
      return set;
    }

    function updateTargets() {
      const active = hovered || armed || selected || intro;
      const lit = active ? litSet(active) : null;
      // Une sphère sans projets (Ego) n'a que ses liens à montrer : ils s'allument avec elle
      const lone = active && active.type === 'hub' && projectsOf(active).length === 0;
      for (const n of nodes) n.target = !lit ? REST[n.type] : lit.has(n) ? 1 : DIMMED[n.type];
      for (const l of links) {
        if (!lit) l.target = l.kind === 'bridge' ? 0.6 : 0.14;
        else if (lone && (l.a === active || l.b === active)) l.target = 0.75;
        else if (lit.has(l.a) && lit.has(l.b) && (l.a === active || l.b === active || active.type === 'hub' || l.kind === 'bridge')) l.target = 0.75;
        else l.target = 0.04;
      }
      for (const n of nodes) {
        let o;
        if (n.type === 'hub') o = !lit || lit.has(n) ? 1 : 0.45;
        else o = lit && lit.has(n) ? 1 : 0;
        // Sur téléphone, la carte prend déjà la place : on n'étiquette que le nœud choisi
        const compact = window.innerWidth <= 640 && selected && !hovered;
        if (compact && n.type !== 'hub' && n !== active) o = 0;
        n.labelTarget = n.off ? 0 : o;
        if (n.sub) n.sub.hidden = !(active === n) || compact;
      }
      // Pendant la prise de contrôle d'Ego, les liens des sphères éteintes s'éteignent aussi
      for (const l of links) if (l.a.off || l.b.off) l.target = 0;
      measureLabels();
    }

    function measureLabels() {
      for (const n of nodes) n.lw = n.label.offsetWidth;
    }
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(measureLabels);
    updateTargets();

    // Moment d'ouverture : chaque sphère montre brièvement ses projets
    if (!REDUCED) {
      const seq = hubs.slice();
      let i = 0;
      const next = () => {
        if (hovered || selected) { intro = null; updateTargets(); return; }
        intro = seq[i++] || null;
        updateTargets();
        if (intro) setTimeout(next, 1700);
      };
      setTimeout(next, 700);
    }

    function select(n) {
      intro = null;
      selected = n;
      const narrow = window.innerWidth <= 640;
      if (n) {
        cam.focused = true;
        cam.wantTarget.copy(n.pos);
        cam.focusZoom = n.type === 'hub' ? 0.85 : 0.7;
        // La carte occupe la droite (bureau) ou le bas (téléphone) : on décale la vue
        cam.wantShiftX = narrow ? 0 : 0.14;
        cam.wantShiftY = narrow ? 0.24 : 0;
        openCard(n);
      } else {
        cam.focused = false;
        cam.focusZoom = 1;
        cam.wantShiftX = cam.wantShiftY = 0;
        closeCard();
      }
      updateTargets();
    }

    function setHover(n) {
      if (n === hovered) return;
      hovered = n;
      if (n) intro = null;
      canvas.classList.toggle('is-pointing', !!n);
      updateTargets();
    }

    /* ---------- Carte d'information ---------- */
    const card = $('#card'), cardBody = $('#card-body');

    function projectActions(p) {
      return el('div', { class: 'actions' },
        linkButton('Voir le site', p.site, true),
        linkButton('Voir le code', p.repo, false));
    }

    function projectItem(p, onOpen) {
      const head = el('div', null, el('h3', { text: p.title }), p.short ? el('p', { text: p.short }) : null);
      let top = head;
      if (onOpen) {
        top = el('button', { class: 'proj-open', type: 'button', 'aria-label': 'Ouvrir ' + p.title });
        top.append(head);
        top.addEventListener('click', () => onOpen(p));
      }
      const li = el('li', { class: 'proj c-' + (p.colorKey || 'dev') }, top);
      if (p.status) li.append(el('span', { class: 'status', text: p.status }));
      const act = projectActions(p);
      if (act.childElementCount) li.append(act);
      return li;
    }

    function openCard(n) {
      cardBody.replaceChildren();
      card.className = 'card c-' + (n.colorKey || 'dev');

      if (n.type === 'hub') {
        cardBody.append(
          el('h2', { id: 'card-title', text: n.title }),
          el('p', { text: n.short || '' }));
        const ul = el('ul', { class: 'proj-list' });
        for (const p of projectsOf(n)) ul.append(projectItem(p, select));
        cardBody.append(ul);
      } else if (n.type === 'project') {
        const hub = byId.get(n.hub);
        cardBody.append(
          el('p', { class: 'kicker', text: hub ? hub.title : '' }),
          el('h2', { id: 'card-title', text: n.title }));
        if (n.status) cardBody.append(el('span', { class: 'status', text: n.status }));
        cardBody.append(el('p', { text: n.description || n.short || '' }));
        if (n.tech && n.tech.length) {
          const ul = el('ul', { class: 'chips', 'aria-label': 'Technologies' });
          for (const t of n.tech) ul.append(el('li', { text: t }));
          cardBody.append(ul);
        }
        const act = projectActions(n);
        if (act.childElementCount) cardBody.append(act);
        const repo = safeUrl(n.repo);
        if (repo) cardBody.append(el('code', { class: 'repo-path', text: repo.replace(/^https:\/\//, '') }));
      } else {
        card.className = 'card c-' + (neighbors(n).find((m) => m.colorKey) || {}).colorKey;
        cardBody.append(
          el('p', { class: 'kicker', text: 'Compétence' }),
          el('h2', { id: 'card-title', text: n.title }));
        // Ego compte comme un projet ; sans bouton d'ouverture, car sa sphère n'a pas de fiche
        const used = neighbors(n).filter((m) => m.type === 'project' || m === ego);
        if (used.length) {
          cardBody.append(el('p', { text: used.length > 1 ? 'Mise en pratique dans ces projets :' : 'Mise en pratique dans ce projet :' }));
          const ul = el('ul', { class: 'proj-list' });
          for (const p of used) ul.append(projectItem(p, p === ego ? null : select));
          cardBody.append(ul);
        }
      }
      card.hidden = false;
    }

    function closeCard() { card.hidden = true; }
    $('#card-close').addEventListener('click', () => select(null));

    /* ---------- Vue liste (accessible, sans 3D) ---------- */
    function buildList() {
      const body = $('#list-body');
      body.replaceChildren();
      for (const hub of data.nodes.filter((n) => n.type === 'hub')) {
        const g = el('section', { class: 'group c-' + hub.color });
        g.append(el('h3', { class: 'group-title', text: hub.title }));
        if (hub.short) g.append(el('p', { text: hub.short }));
        const projects = data.nodes.filter((n) => n.type === 'project' && n.hub === hub.id);
        if (!projects.length) {
          // Sphère sans projets (Ego) : ses compétences (tirées des liens), puis un simple lien
          // vers son site, sans effet
          const skills = data.links
            .map((l) => (l.source === hub.id ? l.target : l.target === hub.id ? l.source : null))
            .map((id) => data.nodes.find((m) => m.id === id))
            .filter((m) => m && m.type === 'skill');
          if (skills.length) {
            const chips = el('ul', { class: 'chips', 'aria-label': 'Compétences' });
            for (const s of skills) chips.append(el('li', { text: s.title }));
            g.append(chips);
          }
          const act = el('div', { class: 'actions' }, linkButton('Parler à ' + hub.title, hub.site, false));
          if (act.childElementCount) g.append(act);
          body.append(g);
          continue;
        }
        const ul = el('ul', { class: 'proj-list' });
        for (const p of projects) {
          const li = el('li', { class: 'proj c-' + hub.color },
            el('h3', { text: p.title }),
            el('p', { text: p.description || p.short || '' }));
          if (p.status) li.append(el('span', { class: 'status', text: p.status }));
          if (p.tech && p.tech.length) {
            const chips = el('ul', { class: 'chips', 'aria-label': 'Technologies' });
            for (const t of p.tech) chips.append(el('li', { text: t }));
            li.append(chips);
          }
          const act = el('div', { class: 'actions' }, linkButton('Voir le site', p.site, true), linkButton('Voir le code', p.repo, false));
          if (act.childElementCount) li.append(act);
          ul.append(li);
        }
        g.append(ul);
        body.append(g);
      }
    }

    /* ---------- Ego : prise de contrôle de l'interface ---------- */
    // Déclenchée seulement par un clic du visiteur : 1,1 s de glitch, puis l'écran noir où la
    // réplique d'Ego s'écrit, puis le site d'Ego s'ouvre dans le même onglet. Accessibilité :
    // aucun flash, que des décalages, du brouillage de texte et des fondus
    // (critère WCAG 2.3.1 : 3 flashs par seconde au plus).
    const fx = { on: false, timers: [], arcUntil: 0, strongUntil: 0, shakeUntil: 0, skip: null, left: false };
    const later = (ms, fn) => fx.timers.push(setTimeout(fn, ms));
    let egoHeat = 0;

    function egoTap(isMouse) {
      if (isMouse || armed === ego) { egoTakeover(); return; }
      // Tactile : pas de survol possible, alors le premier tap montre les arcs, le second déclenche
      armed = ego;
      fx.arcUntil = performance.now() + 600;
      select(null);
    }

    // Le titre se brouille en caractères au hasard, puis devient le texte final
    function scramble(target, finalText, steps) {
      const from = target.textContent, glyphs = '#%&*+=<>/\\|_~^ΞΔΨ01';
      for (let i = 1; i <= steps; i++) {
        later(i * 60, () => {
          if (i === steps) { target.textContent = finalText; return; }
          const len = Math.round(from.length + (finalText.length - from.length) * (i / steps));
          let s = '';
          for (let k = 0; k < len; k++) s += glyphs[Math.floor(Math.random() * glyphs.length)];
          target.textContent = s;
        });
      }
    }

    // Une sphère s'éteint, avec ses projets
    function switchOff(hub) {
      hub.off = true;
      for (const p of projectsOf(hub)) p.off = true;
      updateTargets();
    }

    function egoTakeover() {
      const url = safeUrl(ego.site);
      if (fx.on || !url) return; // un seul effet, même si on clique plusieurs fois
      fx.on = true;
      armed = null;
      if (selected) select(null);
      const body = document.body;

      if (REDUCED) {
        // Animations réduites : pas de glitch, juste le fondu au noir (400 ms) et la réplique
        egoEnding(url);
        return;
      }

      const t0 = performance.now();
      fx.strongUntil = t0 + 300;   // 0 à 0,3 s : les arcs redoublent, la caméra tremble
      fx.shakeUntil = t0 + 300;
      fx.arcUntil = t0 + 1100;
      later(300, () => {           // 0,3 à 1,1 s : l'interface se corrompt
        body.classList.add('ego-glitch');
        document.title = 'EGO';
        scramble($('#who'), 'EGO', 9);
      });
      const others = hubs.filter((h) => h !== ego);
      others.forEach((h, i) => later(500 + i * 250, () => switchOff(h)));
      later(500 + others.length * 250, () => {
        for (const n of nodes) if (n.type === 'skill') n.off = true;
        updateTargets();
      });
      later(1100, () => egoEnding(url)); // à 1,1 s : écran noir et réplique
    }

    // Fin de l'effet : écran noir, « EGO », puis la réplique s'écrit comme une frappe en direct.
    // Un clic, un tap ou une touche affiche la phrase en entier ; le suivant ouvre le site.
    function egoEnding(url) {
      const body = document.body, typed = $('#ego-typed'), rest = $('#ego-rest');
      const chars = Array.from(ego.replique || ''); // Array.from : un caractère = une lettre, même accentuée
      body.classList.add('ego-black');
      // Même onglet : un nouvel onglet ouvert après un délai serait bloqué comme une pop-up
      const go = () => {
        if (fx.left) return; // une seule navigation
        fx.left = true;
        location.href = url;
      };
      if (!chars.length) {
        // Pas de réplique : on laisse « EGO » à l'écran un instant
        fx.skip = go;
        later(800, go);
        return;
      }
      body.classList.add('ego-has-line');
      let shown = 0, done = false;
      const finish = () => {
        if (done) return;
        done = true;
        typed.textContent = chars.join('');
        rest.textContent = '';
        body.classList.remove('ego-typing');
        fx.skip = go;
        later(REDUCED ? 2500 : 1500, go); // le temps de lire, puis le site
      };
      fx.skip = finish;
      if (REDUCED) { finish(); return; } // pas de frappe lettre par lettre

      typed.textContent = '';
      rest.textContent = chars.join('');
      body.classList.add('ego-typing');
      const type = () => {
        if (done) return; // déjà affichée en entier par un clic
        shown++;
        typed.textContent = chars.slice(0, shown).join('');
        rest.textContent = chars.slice(shown).join('');
        if (shown >= chars.length) { finish(); return; }
        // 35 à 45 ms par caractère, un temps de plus après une ponctuation ou un tiret de dialogue
        const c = chars[shown - 1], next = chars[shown];
        const pause = /[.,…—–]/.test(c) || (c === '-' && next === ' ') ? 150 : 0;
        later(35 + Math.random() * 10 + pause, type);
      };
      later(350, type); // on laisse d'abord « EGO » apparaître
    }
    // Pendant l'écran noir : clic, tap ou touche pour avancer. On écoute l'appui (pointerdown)
    // et pas « click » : sur écran tactile, le click du tap qui a lancé l'effet arrive après
    // l'apparition du voile, et passerait la réplique sans qu'on ait pu la lire.
    $('.ego-veil').addEventListener('pointerdown', () => { if (fx.skip) fx.skip(); });
    document.addEventListener('keydown', (ev) => {
      if (fx.skip && !ev.repeat && !ev.ctrlKey && !ev.metaKey && !ev.altKey) fx.skip();
    });

    // Retour arrière : la page peut être restaurée depuis le cache dans son état « corrompu »
    function resetTakeover() {
      for (const id of fx.timers) clearTimeout(id);
      fx.timers = [];
      fx.on = fx.left = false;
      fx.skip = null;
      fx.arcUntil = fx.strongUntil = fx.shakeUntil = 0;
      document.body.classList.remove('ego-glitch', 'ego-black', 'ego-has-line', 'ego-typing');
      $('#ego-typed').textContent = $('#ego-rest').textContent = '';
      $('#who').textContent = whoText;
      document.title = pageTitle;
      for (const n of nodes) { n.off = false; n.power = 1; }
      hovered = armed = null;
      canvas.classList.remove('is-pointing', 'is-dragging');
      pointers.clear();
      gesture = null;
      dragNode = null;
      updateTargets();
    }
    window.addEventListener('pageshow', (ev) => { if (ev.persisted || fx.on) resetTakeover(); });

    /* ---------- Entrées : souris, tactile, clavier ---------- */
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const pointers = new Map();
    let gesture = null; // { kind: 'node'|'orbit'|'pinch', ... }

    function pick(ev) {
      const r = canvas.getBoundingClientRect();
      ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      const hits = raycaster.intersectObjects(hitMeshes, false);
      return hits.length ? hits[0].object.userData.node : null;
    }

    function pointerOnPlane(ev, through, out) {
      const r = canvas.getBoundingClientRect();
      ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      const normal = camera.getWorldDirection(new THREE.Vector3());
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, through);
      return raycaster.ray.intersectPlane(plane, out);
    }

    let lastInteraction = -1e9;

    canvas.addEventListener('pointerdown', (ev) => {
      if (fx.on) return; // pendant l'effet d'Ego, la scène ne répond plus
      canvas.setPointerCapture(ev.pointerId);
      pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      lastInteraction = performance.now();
      intro = null;
      if (pointers.size === 2) {
        const [p1, p2] = [...pointers.values()];
        if (dragNode) dragNode = null;
        gesture = { kind: 'pinch', d0: Math.hypot(p1.x - p2.x, p1.y - p2.y), z0: cam.zoom, moved: true };
        return;
      }
      const n = pick(ev);
      gesture = { kind: n ? 'node' : 'orbit', node: n, x0: ev.clientX, y0: ev.clientY, moved: false };
    });

    canvas.addEventListener('pointermove', (ev) => {
      if (fx.on) return;
      const p = pointers.get(ev.pointerId);
      if (!gesture) {
        if (ev.pointerType === 'mouse') setHover(pick(ev));
        return;
      }
      if (!p) return;
      const dx = ev.clientX - p.x, dy = ev.clientY - p.y;
      p.x = ev.clientX; p.y = ev.clientY;
      lastInteraction = performance.now();

      if (gesture.kind === 'pinch' && pointers.size === 2) {
        const [p1, p2] = [...pointers.values()];
        const d = Math.hypot(p1.x - p2.x, p1.y - p2.y);
        cam.zoom = THREE.MathUtils.clamp(gesture.z0 * (gesture.d0 / Math.max(d, 1)), 0.45, 2.2);
        return;
      }
      if (!gesture.moved && Math.hypot(ev.clientX - gesture.x0, ev.clientY - gesture.y0) > 6) {
        gesture.moved = true;
        if (gesture.kind === 'node') { dragNode = gesture.node; canvas.classList.add('is-dragging'); }
        else canvas.classList.add('is-dragging');
      }
      if (!gesture.moved) return;
      if (gesture.kind === 'node' && dragNode) {
        pointerOnPlane(ev, dragNode.pos, tmp) && dragNode.pos.copy(tmp);
      } else if (gesture.kind === 'orbit') {
        cam.theta -= dx * 0.005;
        cam.phi = THREE.MathUtils.clamp(cam.phi - dy * 0.005, 0.35, Math.PI - 0.35);
      }
    });

    function endPointer(ev) {
      pointers.delete(ev.pointerId);
      if (!gesture) return;
      if (gesture.kind === 'pinch') { if (pointers.size === 0) gesture = null; return; }
      if (!gesture.moved && ev.type === 'pointerup') {
        // Un clic ou un tap
        const n = pick(ev);
        if (n && n === ego) egoTap(ev.pointerType === 'mouse');
        else {
          armed = null;
          if (n) select(n === selected && n.type !== 'hub' ? null : n);
          else select(null);
        }
      }
      dragNode = null;
      gesture = null;
      canvas.classList.remove('is-dragging');
    }
    canvas.addEventListener('pointerup', endPointer);
    canvas.addEventListener('pointercancel', endPointer);
    canvas.addEventListener('pointerleave', (ev) => { if (ev.pointerType === 'mouse' && !gesture && !fx.on) setHover(null); });

    canvas.addEventListener('wheel', (ev) => {
      ev.preventDefault();
      lastInteraction = performance.now();
      cam.zoom = THREE.MathUtils.clamp(cam.zoom * Math.exp(ev.deltaY * 0.001), 0.45, 2.2);
    }, { passive: false });

    /* ---------- Boucle d'animation ---------- */
    const v = new THREE.Vector3(), v2 = new THREE.Vector3(), tmpColor = new THREE.Color();
    let last = performance.now(), time = 0, baseTheta = 0;

    function frame(now) {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      time += dt;

      physicsStep(time, !REDUCED);

      // Balancement lent de la caméra quand personne ne touche à rien
      if (!REDUCED && now - lastInteraction > 4000 && !selected) baseTheta += dt * 0.12;
      const sway = REDUCED ? 0 : Math.sin(baseTheta) * 0.32;
      const theta = cam.theta;
      cam.theta = theta + sway;
      updateCamera(dt);
      cam.theta = theta;
      // Prise de contrôle d'Ego : la caméra tremble un court instant (oscillation douce, pas d'à-coups)
      if (now < fx.shakeUntil) {
        const a = cam.radius * 0.006;
        camera.position.x += Math.sin(now * 0.09) * a;
        camera.position.y += Math.sin(now * 0.071 + 1) * a;
      }

      const k = 1 - Math.exp(-dt * 6);
      const W = window.innerWidth, H = window.innerHeight;

      // Arcs d'Ego : calculés seulement pendant le survol, la décharge tactile ou l'effet
      let beat = 0;
      if (ego) {
        const arcsOn = !REDUCED && (hovered === ego || now < fx.arcUntil);
        egoHeat += ((arcsOn ? 1 : 0) - egoHeat) * k;
        arcGroup.visible = arcsOn;
        if (arcsOn) updateArcs(dt * 1000, now < fx.strongUntil);
        if (!REDUCED) {
          // Au survol, le cœur s'emballe (1,5 fois plus vite au plus) : les impulsions accélèrent avec lui
          beat = heartbeat(dt * (1 + 0.5 * egoHeat));
          updateFlesh(dt, beat, egoHeat);
        }
      }

      for (const n of nodes) {
        n.level += (n.target - n.level) * k;
        n.power += ((n.off ? 0 : 1) - n.power) * k;
        n.group.position.copy(n.pos);
        n.core.material.color.copy(n.col).multiplyScalar((0.2 + 0.5 * n.level) * n.power);
        n.core.material.emissive.copy(n.col).multiplyScalar((0.1 + 0.45 * n.level) * n.power);
        n.glow.material.opacity = (0.15 + 0.85 * n.level) * n.power;
        let pulse = n.type === 'hub' && !REDUCED ? 1 + Math.sin(time * 1.4 + n.phase) * 0.05 : 1;
        if (n === ego) {
          // Ego : la chair prend la lumière (couleur × relief) ; son émission reste basse
          // et le halo plus discret, pour que les circuits portent le battement
          n.core.material.color.copy(n.col).multiplyScalar((0.3 + 0.25 * n.level) * n.power);
          n.core.material.emissive.copy(n.col).multiplyScalar(0.06 * n.power)
            .add(tmpColor.copy(n.halo).multiplyScalar(beat * 0.06 + egoHeat * 0.1));
          pulse = 1 + beat * 0.09 + egoHeat * 0.12;
          n.glow.material.opacity *= 0.55 + 0.25 * Math.max(egoHeat, beat * 0.6);
        }
        n.glow.scale.setScalar(n.r * (n.type === 'hub' ? 7 : 6) * (0.7 + 0.3 * n.level) * pulse);
        for (const d of n.deco) {
          if (!REDUCED) {
            d.obj.rotation.x += d.spin[0] * dt;
            d.obj.rotation.y += d.spin[1] * dt;
            d.obj.rotation.z += d.spin[2] * dt;
          }
          d.obj.material.opacity = (n.colorKey === 'dev' ? 0.35 : 0.45) * (0.3 + 0.7 * n.level) * n.power;
        }

        // Étiquette : on projette la position 3D sur l'écran
        n.labelLevel = (n.labelLevel || 0) + ((n.labelTarget || 0) - (n.labelLevel || 0)) * k;
        v.copy(n.pos).project(camera);
        if (v.z > 1 || n.labelLevel < 0.02) { n.label.style.opacity = 0; continue; }
        const x = (v.x * 0.5 + 0.5) * W, y = (-v.y * 0.5 + 0.5) * H;
        // Taille apparente de la sphère, pour décaler l'étiquette juste à côté
        v2.copy(n.pos).addScaledVector(camera.up, n.r).project(camera);
        const pr = Math.abs((-v2.y * 0.5 + 0.5) * H - y);
        if (n.type === 'hub') {
          // Sous la sphère et son anneau ou maillage (≈ 1,9 × le rayon) ; Ego n'en a pas :
          // sous sa membrane (≈ 1,1 × le rayon), au même écart visuel
          const half = (n.lw || 0) / 2;
          const hx = Math.min(Math.max(x, half + 8), W - half - 8);
          const below = n.deco.length ? 1.9 : 1.15;
          n.label.style.transform = `translate(${hx}px, ${y + pr * below + 14}px) translate(-50%, 0)`;
        } else {
          // À droite du nœud, ou à gauche s'il n'y a pas la place
          let lx = x + pr + 8;
          if (lx + (n.lw || 0) > W - 8) lx = x - pr - 8 - (n.lw || 0);
          lx = Math.max(8, lx);
          n.label.style.transform = `translate(${lx}px, ${y}px) translate(0, -50%)`;
        }
        n.label.style.opacity = n.labelLevel.toFixed(3);
      }

      for (const l of links) {
        l.level += (l.target - l.level) * k;
        const a = l.line.geometry.attributes.position;
        a.setXYZ(0, l.a.pos.x, l.a.pos.y, l.a.pos.z);
        a.setXYZ(1, l.b.pos.x, l.b.pos.y, l.b.pos.z);
        a.needsUpdate = true;
        l.line.geometry.computeBoundingSphere();
        l.line.material.opacity = l.level;
      }

      // Emprise d'Ego : fils latents et implants, au rythme du même battement de cœur
      if (ego) updateGrip(dt, beat);

      for (const p of packets) {
        p.u = (p.u + dt * p.speed) % 1;
        const from = p.fromA ? p.link.a.pos : p.link.b.pos;
        const to = p.fromA ? p.link.b.pos : p.link.a.pos;
        p.sprite.position.lerpVectors(from, to, p.u);
        // Les paquets apparaissent et disparaissent en douceur aux extrémités
        const edge = Math.sin(Math.PI * p.u);
        p.sprite.material.opacity = Math.min(1, p.link.level * 1.6) * edge;
      }

      renderer.render(scene, camera);
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }
})();
