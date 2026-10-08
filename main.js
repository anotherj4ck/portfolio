/* =====================================================================
   Portfolio anotherj4ck : graphe 3D vivant
   ---------------------------------------------------------------------
   - Le contenu vient de graph.json : on ajoute un projet sans toucher au code.
   - Le rendu utilise Three.js (r128, chargé en <script> dans index.html).
   - La mise en page des nœuds est une petite simulation physique maison :
       * répulsion entre tous les nœuds (ils ne se chevauchent pas),
       * ressorts sur les liens (les nœuds liés restent proches),
       * ancrage des deux sphères principales (elles reviennent en place).
   - Aucun contenu n'est injecté avec innerHTML : tout passe par
     textContent, pour qu'un texte du JSON ne puisse jamais devenir du code.
   ===================================================================== */
(() => {
  'use strict';

  const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $ = (sel) => document.querySelector(sel);

  /* ---------- Réglages ---------- */
  const COLORS = { dev: 0x5ccbe2, ecriture: 0xf1a94e, neutral: 0x93a4b4 };
  const RADIUS = { hub: 4.2, project: 1.7, skill: 0.85 };
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
    for (const n of nodes) {
      if (n.type !== 'skill') continue;
      const keys = new Set();
      for (const m of neighbors(n)) if (m.colorKey) keys.add(m.colorKey);
      const c = new THREE.Color(0, 0, 0);
      if (keys.size === 0) c.set(COLORS.neutral);
      else { for (const k of keys) c.add(new THREE.Color(COLORS[k])); c.multiplyScalar(1 / keys.size); }
      n.col = c.lerp(new THREE.Color(COLORS.neutral), 0.25);
    }

    /* ---------- Textes fixes ---------- */
    if (data.profile) {
      $('#who').textContent = data.profile.name || 'Portfolio';
      $('#role').textContent = data.profile.role || '';
      const gh = safeUrl(data.profile.github);
      if (gh) { $('#gh-link').href = gh; $('#gh-top').href = gh; }
      const li = safeUrl(data.profile.linkedin);
      if (li) { $('#li-foot').href = li; $('#li-link').href = li; }
    }
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
        map: glowTex, color: n.col.clone(), transparent: true, depthWrite: false,
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

      // Signature visuelle des deux sphères
      n.deco = [];
      if (n.type === 'hub' && n.colorKey === 'dev') {
        // Développement : un maillage, comme une topologie réseau
        const mesh = new THREE.Mesh(
          new THREE.IcosahedronGeometry(n.r * 1.85, 1),
          new THREE.MeshBasicMaterial({ color: n.col, wireframe: true, transparent: true, opacity: 0.35, depthWrite: false })
        );
        group.add(mesh);
        n.deco.push({ obj: mesh, spin: [0.05, 0.11, 0] });
      } else if (n.type === 'hub') {
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

    // Liens : un segment par lien, mis à jour à chaque image
    for (const l of links) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
      const colors = new Float32Array(6);
      l.a.col.toArray(colors, 0);
      l.b.col.toArray(colors, 3);
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
        map: glowTex, color: (fromA ? link.a : link.b).col, transparent: true,
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
        } else if (l.kind === 'hub-project') {
          addPacket(l, l.a.type === 'hub', Math.random(), 0.22, 1.6);
        } else {
          addPacket(l, l.a.type === 'project', Math.random(), 0.3, 1.1);
        }
      }
    }

    /* ---------- Étiquettes HTML (nettes et lisibles) ---------- */
    const labelLayer = $('#labels');
    for (const n of nodes) {
      const lbl = el('div', { class: 'lbl lbl-' + n.type + (n.colorKey ? ' c-' + n.colorKey : '') });
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
    function placeAnchors() {
      // Paysage : les deux sphères côte à côte. Portrait (téléphone) : l'une au-dessus de l'autre.
      const d = 29;
      hubs.forEach((h, i) => {
        const s = i === 0 ? -1 : 1;
        h.anchor = portrait ? new THREE.Vector3(0, -s * d, 0) : new THREE.Vector3(s * d, 0, 0);
      });
    }

    function initialLayout() {
      placeAnchors();
      for (const h of hubs) h.pos.copy(h.anchor);
      const rnd = (k) => (Math.random() - 0.5) * k;
      // Les projets partent en éventail autour de leur sphère, côté extérieur
      for (const h of hubs) {
        const ps = projectsOf(h);
        const out = h.anchor.clone().normalize();
        const side = portrait ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
        ps.forEach((p, i) => {
          const a = ((i + 0.5) / ps.length - 0.5) * Math.PI * 1.4;
          p.pos.copy(h.anchor)
            .addScaledVector(out, Math.cos(a) * 18)
            .addScaledVector(side, Math.sin(a) * 18)
            .add(new THREE.Vector3(rnd(4), rnd(4), rnd(4)));
        });
      }
      for (const n of nodes) {
        if (n.type !== 'skill') continue;
        const nb = neighbors(n);
        const c = new THREE.Vector3();
        for (const m of nb) c.add(m.pos);
        if (nb.length) c.multiplyScalar(1 / nb.length);
        n.pos.copy(c).add(new THREE.Vector3(rnd(16), rnd(16), rnd(16)));
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
        const rest = SPRING_LENGTH[l.kind] || 18;
        const f = K_SPRING * (d - rest);
        tmp.multiplyScalar(f / d);
        l.a.force.add(tmp);
        l.b.force.sub(tmp);
      }

      for (const n of nodes) {
        // 3. Ancrage des sphères, légère gravité vers le centre pour les autres
        if (n.anchor) n.force.add(tmp.subVectors(n.anchor, n.pos).multiplyScalar(K_ANCHOR * MASS.hub));
        else n.force.add(tmp.copy(n.pos).multiplyScalar(-0.005));

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

    function computeFit() {
      // Les deux sphères restent au centre de l'écran ; on recule assez pour tout voir
      cam.center.set(0, 0, 0);
      for (const h of hubs) cam.center.add(h.anchor);
      cam.center.multiplyScalar(1 / Math.max(hubs.length, 1));
      let halfX = 0, halfY = 0;
      for (const n of nodes) {
        halfX = Math.max(halfX, Math.abs(n.pos.x - cam.center.x) + n.r);
        halfY = Math.max(halfY, Math.abs(n.pos.y - cam.center.y) + n.r);
      }
      halfX += 6; halfY += 6;
      const t = Math.tan((camera.fov * Math.PI) / 360);
      // Plus de marge verticale : le titre est en haut, les boutons en bas
      const d = Math.max(halfX / (t * camera.aspect), (halfY * 1.3) / t) + 6;
      // Sur téléphone, on accepte que les bords du nuage dépassent un peu : c'est plus lisible
      return portrait ? d * 0.78 : d;
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
      const wasPortrait = portrait;
      portrait = camera.aspect < 0.85;
      if (portrait !== wasPortrait) placeAnchors();
    }
    window.addEventListener('resize', resize);
    portrait = window.innerWidth / window.innerHeight < 0.85;
    resize();
    initialLayout();
    cam.fit = computeFit();
    cam.radius = cam.fit;
    cam.target.copy(cam.center);

    /* ---------- Survol, sélection, mise en lumière ---------- */
    let hovered = null, selected = null, intro = null;

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
      const active = hovered || selected || intro;
      const lit = active ? litSet(active) : null;
      for (const n of nodes) n.target = !lit ? REST[n.type] : lit.has(n) ? 1 : DIMMED[n.type];
      for (const l of links) {
        if (!lit) l.target = l.kind === 'bridge' ? 0.6 : 0.14;
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
        n.labelTarget = o;
        if (n.sub) n.sub.hidden = !(active === n) || compact;
      }
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
      const head = el('div', null, el('h3', { text: p.title }), el('p', { text: p.short || '' }));
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
        const used = neighbors(n).filter((m) => m.type === 'project');
        if (used.length) {
          cardBody.append(el('p', { text: used.length > 1 ? 'Mise en pratique dans ces projets :' : 'Mise en pratique dans ce projet :' }));
          const ul = el('ul', { class: 'proj-list' });
          for (const p of used) ul.append(projectItem(p, select));
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
        g.append(el('h3', { class: 'group-title', text: hub.title }), el('p', { text: hub.short || '' }));
        const ul = el('ul', { class: 'proj-list' });
        for (const p of data.nodes.filter((n) => n.type === 'project' && n.hub === hub.id)) {
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
        if (n) select(n === selected && n.type !== 'hub' ? null : n);
        else select(null);
      }
      dragNode = null;
      gesture = null;
      canvas.classList.remove('is-dragging');
    }
    canvas.addEventListener('pointerup', endPointer);
    canvas.addEventListener('pointercancel', endPointer);
    canvas.addEventListener('pointerleave', (ev) => { if (ev.pointerType === 'mouse' && !gesture) setHover(null); });

    canvas.addEventListener('wheel', (ev) => {
      ev.preventDefault();
      lastInteraction = performance.now();
      cam.zoom = THREE.MathUtils.clamp(cam.zoom * Math.exp(ev.deltaY * 0.001), 0.45, 2.2);
    }, { passive: false });

    /* ---------- Boucle d'animation ---------- */
    const v = new THREE.Vector3(), v2 = new THREE.Vector3();
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

      const k = 1 - Math.exp(-dt * 6);
      const W = window.innerWidth, H = window.innerHeight;

      for (const n of nodes) {
        n.level += (n.target - n.level) * k;
        n.group.position.copy(n.pos);
        n.core.material.color.copy(n.col).multiplyScalar(0.2 + 0.5 * n.level);
        n.core.material.emissive.copy(n.col).multiplyScalar(0.1 + 0.45 * n.level);
        n.glow.material.opacity = 0.15 + 0.85 * n.level;
        const pulse = n.type === 'hub' && !REDUCED ? 1 + Math.sin(time * 1.4 + n.phase) * 0.05 : 1;
        n.glow.scale.setScalar(n.r * (n.type === 'hub' ? 7 : 6) * (0.7 + 0.3 * n.level) * pulse);
        for (const d of n.deco) {
          if (!REDUCED) {
            d.obj.rotation.x += d.spin[0] * dt;
            d.obj.rotation.y += d.spin[1] * dt;
            d.obj.rotation.z += d.spin[2] * dt;
          }
          d.obj.material.opacity = (n.colorKey === 'dev' ? 0.35 : 0.45) * (0.3 + 0.7 * n.level);
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
          // sous la sphère et son anneau ou maillage (≈ 1,9 × le rayon)
          const half = (n.lw || 0) / 2;
          const hx = Math.min(Math.max(x, half + 8), W - half - 8);
          n.label.style.transform = `translate(${hx}px, ${y + pr * 1.9 + 14}px) translate(-50%, 0)`;
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
