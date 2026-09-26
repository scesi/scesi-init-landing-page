/* ============================================================
   SCESI init · Mapa de nodos de la comunidad
   Canvas 2D · simulación de fuerzas propia · sin dependencias

   Estructura del mapa:
     SCESI (centro)
       ├─ Áreas de interés → anillo, salen de las respuestas del formulario
       ├─ Comunidades      → las que se cargan a mano en la hoja
       └─ Inscritos        → cuelgan de su área (o del centro si no declararon),
                             con la carrera escrita bajo el nombre
   ============================================================ */
(function () {
  'use strict';

  // ---------- Configuración ----------------------------------
  var DATA_URL = window.SCESI_GRAPH_DATA_URL || '';
  var REFRESH_MS = 10000;
  var MAX_PEOPLE = 400;   // techo absoluto; por encima se muestran los últimos

  /**
   * Cuántos inscritos tiene sentido dibujar en el panel disponible.
   * En el panel angosto se dibujan todos (hasta el techo): la nube queda
   * densa, pero el zoom táctil deja acercarse a leerla.
   */
  function topeVisible() {
    if (!W || !H || compacto) return MAX_PEOPLE;
    return Math.max(28, Math.min(MAX_PEOPLE, Math.round(W * H / 2400)));
  }

  var canvas = document.getElementById('graph-canvas');
  if (!canvas) return;
  var stage = document.getElementById('graph-stage');
  var ctx = canvas.getContext('2d');

  var reduceMotion = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------- Definición del grafo semilla -------------------
  // El único nodo fijo es el evento. Las áreas y las comunidades salen de la
  // hoja; la carrera no es un nodo, se lee debajo del nombre de cada persona.
  var SEED_NODES = [
    { id: 'scesi', label: 'SCESI init', group: 'core', sub: '', color: '#ffe24c', ring: 0 }
  ];
  var SEED_LINKS = [];

  // Las tres opciones del formulario, cada una con su color.
  var CARRERAS = {
    sistemas:    { etiqueta: 'Sistemas',    color: '#d0bcff' },
    informatica: { etiqueta: 'Informática', color: '#7ee0c4' },
    otra:        { etiqueta: 'Otra',        color: '#e2c62d' }
  };

  // Las opciones de "Área de interés" tal como están en el formulario.
  // Sirven de esqueleto mientras no haya inscritos y fijan la grafía correcta
  // cuando la hoja trae la misma área escrita distinto.
  var AREAS_POR_DEFECTO = [
    'Asesoría académica',
    'Blockchain',
    'Cloud computing',
    'Cyber seguridad',
    'Inteligencia artificial',
    'Programación competitiva'
  ];

  var COLOR_AREA = '#9a86e8';

  // Colores de las comunidades, repartidos por orden de aparición en la hoja.
  // Ningún nombre está escrito en el código: la primera comunidad que llega se
  // lleva el rojo, la segunda el azul, y así. Ninguno coincide con los tres
  // colores de carrera, para no confundir una comunidad con una persona.
  var PALETA_COMUNIDAD = [
    '#ff4d5e',  // rojo
    '#6ea8ff',  // azul
    '#ffb26b',  // naranja
    '#a3e635',  // lima
    '#e879f9',  // fucsia
    '#67e8f9'   // celeste
  ];

  var LINK_SPEC = {
    core:      { rest: 165, k: 0.030 },
    eje:       { rest: 250, k: 0.022 },
    aliada:    { rest: 190, k: 0.026 },
    persona:   { rest: 215, k: 0.010 },
    interes:   { rest: 108, k: 0.026 },
    comunidad: { rest: 96,  k: 0.032 },
    par:       { rest: 50,  k: 0.030 }
  };

  // ---------- Estado -----------------------------------------
  var nodes = [], links = [], byId = Object.create(null), adjacency = Object.create(null);
  var W = 0, H = 0;
  var view = { k: 1, x: 0, y: 0 };
  // Zoom del usuario (pinch, botones, ctrl+rueda), aplicado encima del
  // encuadre automático: `view` sigue acomodando el grafo al panel y `zoom`
  // es la lupa que el visitante mueve sobre esa imagen.
  var zoom = { k: 1, x: 0, y: 0 };
  var ZOOM_MAX = 5;
  var vistaLista = false;   // ya se encuadró al menos una vez
  var alpha = 1, fitPending = true;
  var primerCarga = true;   // la carga inicial no cuenta como "nace": nadie destella al abrir la página
  var NACE_MS = 900;   // cuánto dura el estallido de un nodo recién llegado
  var cajaLibre = null;        // caja del grafo antes de recortarlo contra el panel
  var ultimosRegistros = null; // últimos datos leídos, para rearmar al redimensionar
  var topeUsado = 0;
  var ultimaFirma = null;      // huella de la última hoja leída
  var compacto = false;   // panel angosto: se recorta lo que no se llega a leer
  var hovered = null, dragging = null, candidato = null;
  var porArea = Object.create(null), porCarrera = Object.create(null), porComunidad = Object.create(null);
  var relacion = Object.create(null);   // id de nodo → tipos de relación con el nodo apuntado
  var pointer = { x: 0, y: 0, inside: false };

  // ---------- Normalización ----------------------------------
  /** El Form ofrece tres opciones; se busca "inform" antes que "sistema"
      para que "Ingeniería Informática y de Sistemas" no caiga en la otra. */
  function slugCarrera(raw) {
    var t = plano(raw);
    if (t.indexOf('inform') !== -1) return 'informatica';
    if (t.indexOf('sistema') !== -1) return 'sistemas';
    return 'otra';
  }

  /** Sin acentos y en minúsculas, para comparar encabezados y valores. */
  function plano(txt) {
    return String(txt == null ? '' : txt)
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .trim().toLowerCase();
  }

  /**
   * "Franco Prieto Ayala" → "Franco P."
   * El mapa es público e indexable: sale el nombre de pila y la inicial.
   */
  function abreviar(nombre) {
    var partes = String(nombre).trim().split(/\s+/).filter(Boolean);
    if (!partes.length) return '';
    if (partes.length === 1) return partes[0];
    return partes[0] + ' ' + partes[1].charAt(0).toUpperCase() + '.';
  }

  /** CSV segun RFC 4180: comillas, comas adentro y saltos de linea escapados. */
  function parseCSV(texto) {
    var filas = [], fila = [], campo = '', dentro = false;
    var util = function (f) { return f.some(function (x) { return x.trim() !== ''; }); };

    for (var i = 0; i < texto.length; i++) {
      var c = texto.charAt(i);

      if (dentro) {
        if (c === '"') {
          if (texto.charAt(i + 1) === '"') { campo += '"'; i++; }
          else dentro = false;
        } else campo += c;
        continue;
      }

      if (c === '"') dentro = true;
      else if (c === ',') { fila.push(campo); campo = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && texto.charAt(i + 1) === '\n') i++;
        fila.push(campo); campo = '';
        if (util(fila)) filas.push(fila);
        fila = [];
      } else campo += c;
    }
    fila.push(campo);
    if (util(fila)) filas.push(fila);
    return filas;
  }

  /** Índice de columna: primero coincidencia exacta, después por contenido. */
  function columna(cab, claves) {
    var i, j;
    for (i = 0; i < cab.length; i++)
      for (j = 0; j < claves.length; j++)
        if (cab[i] === claves[j]) return i;
    for (i = 0; i < cab.length; i++)
      for (j = 0; j < claves.length; j++)
        if (cab[i].indexOf(claves[j]) !== -1) return i;
    return -1;
  }

  /** Filas de la hoja de respuestas → registros del mapa. */
  function desdeCSV(texto) {
    var filas = parseCSV(texto);
    if (filas.length < 2) return [];

    var cab = filas.shift().map(plano);
    var iNombre  = columna(cab, ['nombre completo', 'nombre', 'nombres']);
    var iCarrera = columna(cab, ['carrera', 'programa']);
    var iArea    = columna(cab, ['area de interes', 'area', 'interes']);
    var iSem     = columna(cab, ['semestre', 'nivel']);
    var iCom     = columna(cab, ['comunidad', 'colectivo']);

    if (iNombre === -1) {
      console.warn('[mapa] falta la columna del nombre. Encabezados:', cab.join(' | '));
      return [];
    }

    var vistos = Object.create(null), salida = [];
    var celda = function (f, i) { return i === -1 ? '' : (f[i] || '').trim(); };

    filas.forEach(function (f) {
      var nombre = celda(f, iNombre);
      if (!nombre) return;

      var clave = plano(nombre);
      if (vistos[clave]) return;      // el Form permite reenviar la respuesta
      vistos[clave] = true;

      salida.push({
        nombre: nombre,
        carrera: celda(f, iCarrera),
        area: celda(f, iArea),
        semestre: celda(f, iSem),
        comunidad: celda(f, iCom)
      });
    });

    return salida;
  }

  // ---------- Construcción -----------------------------------
  function buildGraph(records) {
    ultimosRegistros = records;
    topeUsado = topeVisible();
    // Áreas y comunidades salen de TODOS los inscritos: son pocas y no pesan
    // en el dibujo, recortarlas junto con la gente dejaría comunidades sin
    // nodo solo porque quien la declaró no está entre los últimos N visibles.
    var todosLosRegistros = records;
    if (records.length > topeUsado) records = recortar(records, topeUsado);

    var prev = byId;
    var nextNodes = [], rawLinks = [], map = Object.create(null);

    function addNode(n, seedX, seedY) {
      var old = prev[n.id];
      n.x = old ? old.x : seedX;
      n.y = old ? old.y : seedY;
      n.vx = 0; n.vy = 0; n.deg = 0;
      n.phase = old ? old.phase : Math.random() * Math.PI * 2;
      n.drift = old ? old.drift : 0.4 + Math.random() * 0.8;
      // En la primera carga el nodo ya "nació" hace rato: entra completo, sin
      // estallido. Sólo brilla el que se suma en una carga posterior.
      n.born = old ? old.born : (primerCarga ? -1e6 : performance.now());
      nextNodes.push(n);
      map[n.id] = n;
      return n;
    }

    // --- núcleo
    SEED_NODES.forEach(function (sn) {
      addNode({ id: sn.id, label: sn.label, group: sn.group, sub: sn.sub, color: sn.color, ring: sn.ring }, 0, 0);
    });
    SEED_LINKS.forEach(function (l) { rawLinks.push(l); });

    // --- áreas de interés y comunidades: salen de los datos, no están fijas
    var areas = [], comunidades = [];

    // "Inteligencia Artificial" y "Inteligencia artificial" son la misma área:
    // se agrupan por su forma plana y se muestra la grafía del formulario.
    var canon = Object.create(null);
    AREAS_POR_DEFECTO.forEach(function (a) { canon[plano(a)] = a; });

    var vistasArea = Object.create(null);
    var vistasCom = Object.create(null);

    todosLosRegistros.forEach(function (rec) {
      if (rec.area) {
        var k = plano(rec.area);
        if (!vistasArea[k]) {
          vistasArea[k] = true;
          areas.push(canon[k] || rec.area);
        }
      }
      if (rec.comunidad) {
        var kc = plano(rec.comunidad);
        if (!vistasCom[kc]) { vistasCom[kc] = true; comunidades.push(rec.comunidad); }
      }
    });
    if (!areas.length) areas = AREAS_POR_DEFECTO.slice();

    var idArea = Object.create(null);
    areas.forEach(function (nombre, j) {
      var id = 'a:' + plano(nombre);
      idArea[plano(nombre)] = id;
      var b = (j / areas.length) * Math.PI * 2 - Math.PI / 2 + Math.PI / areas.length;
      addNode({
        id: id, label: nombre, group: 'tema', sub: 'Área de interés',
        color: COLOR_AREA, ring: 2
      }, Math.cos(b) * 235, Math.sin(b) * 235);
      rawLinks.push(['scesi', id, 'eje']);
    });

    var idCom = Object.create(null);
    comunidades.forEach(function (nombre, j) {
      var id = 'k:' + plano(nombre);
      idCom[plano(nombre)] = id;
      var b = (j / Math.max(comunidades.length, 1)) * Math.PI * 2 + Math.PI / 4;
      addNode({
        id: id, label: nombre, group: 'comunidad', sub: 'Comunidad',
        color: PALETA_COMUNIDAD[j % PALETA_COMUNIDAD.length], ring: 2
      }, Math.cos(b) * 200, Math.sin(b) * 200);
      rawLinks.push(['scesi', id, 'aliada']);
    });

    // --- inscritos
    var nucleo = map['scesi'];

    records.forEach(function (rec, i) {
      var clave = slugCarrera(rec.carrera);
      var carrera = CARRERAS[clave] || CARRERAS.otra;

      // Nacen junto a su área de interés; sin área, alrededor del núcleo.
      var ancla = (rec.area && map[idArea[plano(rec.area)]]) || nucleo;
      var ang = Math.random() * Math.PI * 2;
      var rad = 45 + Math.random() * 55;
      var id = 'p:' + i + ':' + rec.nombre;

      // Resumen que se lee en el tooltip: semestre, interés y comunidad.
      var detalle = [rec.semestre, rec.area, rec.comunidad].filter(Boolean).join(' · ');

      addNode({
        id: id,
        label: abreviar(rec.nombre),
        carrera: carrera.etiqueta,     // se dibuja bajo el nombre
        group: 'persona',
        sub: detalle || 'Inscrito',
        color: carrera.color,
        ring: 3,
        semestre: nivelSemestre(rec.semestre),
        areaLabel: rec.area ? (canon[plano(rec.area)] || rec.area) : '',
        comunidadLabel: rec.comunidad || '',
        // Claves con las que se decide quién se relaciona con quién
        kArea: rec.area ? plano(rec.area) : '',
        kCarrera: clave,
        kComunidad: rec.comunidad ? plano(rec.comunidad) : '' 
      }, ancla.x + Math.cos(ang) * rad, ancla.y + Math.sin(ang) * rad);

      // Todo el mundo cuelga del evento: pertenecer a una comunidad o declarar
      // un área no quita estar inscrito. El resorte al centro es flojo para que
      // no aplaste el resto de la estructura.
      rawLinks.push([id, 'scesi', 'persona']);

      if (rec.area && idArea[plano(rec.area)]) rawLinks.push([id, idArea[plano(rec.area)], 'interes']);

      if (rec.comunidad && idCom[plano(rec.comunidad)]) {
        rawLinks.push([id, idCom[plano(rec.comunidad)], 'comunidad']);
      }

    });

    // --- aristas y grados
    var adj = Object.create(null), clean = [], hechas = Object.create(null);

    rawLinks.forEach(function (l) {
      var a = map[l[0]], b = map[l[1]];
      if (!a || !b || a === b) return;

      var firma = a.id < b.id ? a.id + '|' + b.id : b.id + '|' + a.id;
      if (hechas[firma]) return;
      hechas[firma] = true;

      var spec = LINK_SPEC[l[2]] || LINK_SPEC.persona;
      a.deg++; b.deg++;
      (adj[a.id] || (adj[a.id] = Object.create(null)))[b.id] = true;
      (adj[b.id] || (adj[b.id] = Object.create(null)))[a.id] = true;
      clean.push({ a: a, b: b, rest: spec.rest, k: spec.k, tipo: l[2] });
    });

    nextNodes.forEach(function (n) {
      var base = n.group === 'core' ? 13
        : (n.group === 'tema' || n.group === 'comunidad' ? 7 : 4.2);
      // Los de semestres más altos pesan un poco más en el dibujo
      if (n.group === 'persona') base += (n.semestre || 0) * 0.55;
      n.r = base + Math.sqrt(n.deg) * (n.group === 'persona' ? 0.6 : 1.0);
    });

    // Índices para responder "quién comparte esto conmigo" sin recorrer todo
    // el grafo en cada frame.
    porArea = Object.create(null);
    porCarrera = Object.create(null);
    porComunidad = Object.create(null);

    nextNodes.forEach(function (n) {
      if (n.group !== 'persona') return;
      if (n.kArea) (porArea[n.kArea] || (porArea[n.kArea] = [])).push(n);
      if (n.kCarrera) (porCarrera[n.kCarrera] || (porCarrera[n.kCarrera] = [])).push(n);
      if (n.kComunidad) (porComunidad[n.kComunidad] || (porComunidad[n.kComunidad] = [])).push(n);
    });

    nodes = nextNodes; links = clean; byId = map; adjacency = adj;
    alpha = 1;
    primerCarga = false;

    ajustarGravedad();   // el estiramiento depende de cuántos nodos hay

    // Se encuadra de entrada, no recién cuando la simulación se calma.
    if (!vistaLista) { fitView(); vistaLista = true; }
    fitPending = true;
  }

  /**
   * Elige a quién dibujar cuando no entran todos. Quien declaró comunidad
   * siempre queda: son pocos y, si se recortaran, al tocar la comunidad no se
   * iluminaría nadie. El resto del cupo va para los inscritos más recientes.
   * Se respeta el orden de la hoja.
   */
  function recortar(records, tope) {
    var conComunidad = records.filter(function (r) { return r.comunidad; }).length;
    var cupo = Math.max(0, tope - conComunidad);
    var sinComunidadVistos = records.length - conComunidad;
    return records.filter(function (r) {
      if (r.comunidad) return true;
      return sinComunidadVistos-- <= cupo;
    });
  }

  /** "3-4 semestre" → 2, "7mo semestre o mas" → 4. Define el tamaño del nodo. */
  function nivelSemestre(txt) {
    var m = /(\d+)/.exec(String(txt || ''));
    if (!m) return 0;
    var n = parseInt(m[1], 10);
    return n <= 2 ? 1 : (n <= 4 ? 2 : (n <= 6 ? 3 : 4));
  }

  // ---------- Física -----------------------------------------
  var REPEL = 2400, GRAVITY = 0.017, DAMP = 0.87, CELL = 130;
  var DRIFT = reduceMotion ? 0 : 0.07;
  var IDLE_ALPHA = reduceMotion ? 0 : 0.13;
  var POINTER_RADIUS = 125;   // alcance del campo del cursor, en px de pantalla
  var CANDIDATE_R = 150;      // radio donde un nodo pasa a ser 'el que vas a agarrar'
  var DEAD_ZONE = 58;         // radio donde el cursor NO empuja: zona de agarre
  var POINTER_FORCE = reduceMotion ? 0 : 2.2;

  // Factores de gravedad por eje, recalculados cuando cambia el tamaño del stage.
  var gravX = 1, gravY = 1;
  function ajustarGravedad() {
    if (!W || !H) return;
    var ratio = Math.max(0.45, Math.min(2.4, W / H));

    // El estiramiento sólo tiene sentido cuando hay masa que repartir. Con
    // pocos nodos la figura es un anillo fino: estirarlo lo deja chato y
    // desperdicia el alto del panel.
    var densidad = Math.min(1, 60 / Math.max(nodes.length, 1));
    var exp = 0.5 + 0.9 * (1 - densidad);

    gravX = Math.pow(ratio, -exp);
    gravY = Math.pow(ratio, exp);
  }

  function tick(now) {
    var i, n, m;
    var s = Math.max(alpha, 0.35);
    var t = now / 1000;

    // Con muchos nodos cada uno recibe empujones de muchos más vecinos: si las
    // constantes no bajan, el sistema entra en resonancia y todo tiembla.
    var densidad = Math.min(1, 60 / Math.max(nodes.length, 1));
    var derivaN = DRIFT * (0.35 + 0.65 * densidad);
    var frenoN = DAMP - (1 - densidad) * 0.06;
    var topeVel = 2.2 + 5 * densidad;      // px por frame

    var grid = Object.create(null);
    for (i = 0; i < nodes.length; i++) {
      n = nodes[i];
      var key = Math.floor(n.x / CELL) + '|' + Math.floor(n.y / CELL);
      (grid[key] || (grid[key] = [])).push(n);
    }

    for (i = 0; i < nodes.length; i++) {
      n = nodes[i];
      var cx = Math.floor(n.x / CELL), cy = Math.floor(n.y / CELL);
      for (var gx = -1; gx <= 1; gx++) {
        for (var gy = -1; gy <= 1; gy++) {
          var bucket = grid[(cx + gx) + '|' + (cy + gy)];
          if (!bucket) continue;
          for (var b = 0; b < bucket.length; b++) {
            m = bucket[b];
            if (m === n) continue;
            var dx = n.x - m.x, dy = n.y - m.y, d2 = dx * dx + dy * dy;
            if (d2 === 0) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d2 = 0.25; }
            if (d2 > CELL * CELL) continue;
            var d = Math.sqrt(d2);
            // los nodos grandes empujan más fuerte: mantiene despejado el centro
            var peso = 1 + (n.r + m.r) / 22;
            var f = Math.min(REPEL * peso / d2, 70) * s;
            n.vx += (dx / d) * f; n.vy += (dy / d) * f;
          }
        }
      }
    }

    for (i = 0; i < links.length; i++) {
      var link = links[i], la = link.a, lb = link.b;
      var lx = lb.x - la.x, ly = lb.y - la.y;
      var ld = Math.sqrt(lx * lx + ly * ly) || 0.01;
      var force = (ld - link.rest) * link.k * s;
      var ux = (lx / ld) * force, uy = (ly / ld) * force;
      la.vx += ux; la.vy += uy; lb.vx -= ux; lb.vy -= uy;
    }

    var pw = null, pr = 0;
    if (pointer.inside && POINTER_FORCE > 0) {
      pw = toWorld(pointer.x, pointer.y);
      pr = POINTER_RADIUS / (view.k * zoom.k);
    }

    // El nodo más cercano al cursor es el que estás por agarrar: queda fuera
    // del campo de empuje. La multitud se abre, tu objetivo se queda quieto.
    candidato = null;
    if (pw) {
      var mejor = CANDIDATE_R * CANDIDATE_R;
      for (i = 0; i < nodes.length; i++) {
        n = nodes[i];
        var sp = toScreen(n);
        var sdx = sp.x - pointer.x, sdy = sp.y - pointer.y;
        var sd2 = sdx * sdx + sdy * sdy;
        if (sd2 < mejor) { mejor = sd2; candidato = n; }
      }
    }

    for (i = 0; i < nodes.length; i++) {
      n = nodes[i];
      if (n === dragging) { n.vx = 0; n.vy = 0; continue; }

      if (DRIFT > 0) {
        var amp = n.group === 'persona' ? derivaN : derivaN * 0.45; // el esqueleto se mueve menos
        if (n === hovered || n === candidato) amp *= 0.08;       // el apuntado se aquieta para poder agarrarlo
        n.vx += Math.cos(t * n.drift + n.phase) * amp;
        n.vy += Math.sin(t * n.drift * 0.87 + n.phase * 1.7) * amp;
      }

      // El campo del cursor no empuja al nodo apuntado ni al candidato.
      if (pw && n !== hovered && n !== candidato) {
        var px = n.x - pw.x, py = n.y - pw.y;
        var pd = Math.sqrt(px * px + py * py);
        var zonaMuerta = DEAD_ZONE / (view.k * zoom.k);
        if (pd < pr && pd > zonaMuerta) {
          var falloff = (pd - zonaMuerta) / (pr - zonaMuerta);
          falloff = 1 - falloff;
          var masa = n.group === 'persona' ? 1 : 0.45;
          var pf = falloff * falloff * POINTER_FORCE * masa;
          n.vx += (px / pd) * pf; n.vy += (py / pd) * pf;
        }
      }

      // el centro queda anclado, todo lo demás gravita hacia él.
      // La gravedad es elíptica: más floja en el eje largo del panel, así la
      // nube se estira para ocupar el espacio en vez de quedar redonda.
      if (n.group !== 'core') {
        n.vx -= n.x * GRAVITY * gravX * s;
        n.vy -= n.y * GRAVITY * gravY * s;
      } else {
        n.vx -= n.x * 0.08; n.vy -= n.y * 0.08;
      }

      var freno = (n === hovered || n === candidato) ? frenoN * 0.72 : frenoN;
      n.vx *= freno; n.vy *= freno;

      // Tope de velocidad: un empujón fuerte no puede disparar un nodo a
      // través del mapa.
      var vel = Math.sqrt(n.vx * n.vx + n.vy * n.vy);
      if (vel > topeVel) {
        n.vx = n.vx / vel * topeVel;
        n.vy = n.vy / vel * topeVel;
      }

      n.x += n.vx; n.y += n.vy;
    }

    // La caja se mide ANTES de recortar: si se mide después, el recorte
    // esconde el desborde y el encuadre cree que todo entra.
    cajaLibre = bbox();
    contener();

    var reposo = IDLE_ALPHA * (0.4 + 0.6 * densidad);
    if (alpha > reposo) {
      alpha *= 0.985;
      if (alpha <= reposo) {
        alpha = reposo;
        if (fitPending) { fitView(); fitPending = false; }
      }
    }
  }

  var BORDE = 16;   // aire mínimo entre el aura de un nodo y el borde del panel

  /**
   * Recorta la posición de cada nodo para que ni su aura ni su etiqueta
   * salgan del panel. Es un tope duro y no una fuerza: una fuerza pierde
   * contra la repulsión de los vecinos cuando un nodo queda aplastado al borde.
   */
  function contener() {
    if (!W || !H) return;

    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      var p = baseScreen(n);

      var r = Math.min(radioVisual(n) + BORDE, W / 2, H / 2);
      // Abajo se reserva además el alto de la etiqueta, que va bajo el nodo.
      var abajo = Math.min(r + (n.group === 'persona' ? 0 : 22), H / 2);

      var cx = Math.max(r, Math.min(W - r, p.x));
      var cy = Math.max(r, Math.min(H - abajo, p.y));
      if (cx === p.x && cy === p.y) continue;

      n.x = (cx - view.x) / view.k;
      n.y = (cy - view.y) / view.k;

      // Se mata la velocidad del eje topado y se devuelve un empujón hacia
      // adentro: sin esto el nodo se queda pegado a la pared indefinidamente.
      if (cx !== p.x) n.vx = (cx < W / 2 ? 1 : -1) * 0.35;
      if (cy !== p.y) n.vy = (cy < H / 2 ? 1 : -1) * 0.35;
    }
  }

  /** Radio de lo que realmente se pinta: el círculo más su halo. */
  function radioVisual(n) {
    var factor = n === hovered ? 3.6 : (n.group === 'persona' ? 2.1 : 2.8);
    return n.r * view.k * factor;
  }

  // ---------- Vista ------------------------------------------
  /** Caja que contiene todos los nodos, en coordenadas del mundo. */
  function bbox() {
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      // se mide con el halo incluido, que es lo que se ve
      var r = n.r * (n.group === 'persona' ? 2.1 : 2.8);
      if (n.x - r < minX) minX = n.x - r;
      if (n.y - r < minY) minY = n.y - r;
      if (n.x + r > maxX) maxX = n.x + r;
      if (n.y + r > maxY) maxY = n.y + r;
    }
    return { minX: minX, minY: minY, maxX: maxX, maxY: maxY };
  }

  /**
   * Corrección suave de encuadre en cada frame: el mapa nunca se va al borde
   * aunque los nodos deriven o entren inscritos nuevos.
   */
  function recenter() {
    if (!nodes.length || !W || dragging) return;
    var b = cajaLibre || bbox();
    var ancho = b.maxX - b.minX || 1, alto = b.maxY - b.minY || 1;
    // Cuanta más gente, más aire: con el grafo lleno al ras, los nodos de los
    // extremos quedan rozando el borde del panel.
    var pad = margen();

    var kDeseado = Math.min((W - pad * 2) / ancho, (H - pad * 2) / alto);
    kDeseado = Math.max(0.15, Math.min(2.6, kDeseado));
    // sólo corrige si el desvío pasa el 3%: evita el zoom nervioso
    if (Math.abs(kDeseado - view.k) / view.k > 0.03) {
      // encoger es más urgente que agrandar: si no entra, se ve recortado
      view.k += (kDeseado - view.k) * (kDeseado < view.k ? 0.09 : 0.04);
    }

    // El borde inferior reserva sitio para las etiquetas, así que el centro
    // útil del panel no es H/2: sin esto el mapa queda corrido hacia abajo.
    var cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
    view.x += (W / 2 - cx * view.k - view.x) * 0.06;
    view.y += ((H - 22) / 2 - cy * view.k - view.y) * 0.06;
  }

  /** Aire alrededor del grafo: un porcentaje del panel, con topes. */
  function margen() {
    return Math.max(16, Math.min(Math.min(W, H) * 0.055, 44));
  }

  function fitView() {
    if (!nodes.length || !W) return;
    var b = bbox();
    var pad = margen();
    var k = Math.min((W - pad * 2) / (b.maxX - b.minX || 1), (H - pad * 2) / (b.maxY - b.minY || 1));
    view.k = Math.max(0.3, Math.min(2.6, k));
    view.x = W / 2 - ((b.minX + b.maxX) / 2) * view.k;
    view.y = H / 2 - ((b.minY + b.maxY) / 2) * view.k;
  }

  /** Posición en el panel sin el zoom del usuario: la que usa el encuadre. */
  function baseScreen(n) { return { x: n.x * view.k + view.x, y: n.y * view.k + view.y }; }
  /** Posición en pantalla con el zoom del usuario aplicado: la que se ve. */
  function toScreen(n) {
    return {
      x: (n.x * view.k + view.x) * zoom.k + zoom.x,
      y: (n.y * view.k + view.y) * zoom.k + zoom.y
    };
  }
  function toWorld(px, py) {
    var bx = (px - zoom.x) / zoom.k, by = (py - zoom.y) / zoom.k;
    return { x: (bx - view.x) / view.k, y: (by - view.y) / view.k };
  }
  /**
   * Escala de los radios en pantalla. Crece con la raíz del zoom, no con el
   * zoom entero: al acercarse los nodos se separan más de lo que engordan,
   * que es justamente lo que hace falta para encontrarlos con el dedo.
   */
  function escalaR() { return view.k * Math.sqrt(zoom.k); }

  /** Acerca o aleja manteniendo fijo el punto (fx, fy) del panel. */
  function zoomEn(k, fx, fy) {
    k = Math.max(1, Math.min(ZOOM_MAX, k));
    var bx = (fx - zoom.x) / zoom.k, by = (fy - zoom.y) / zoom.k;
    zoom.k = k;
    zoom.x = fx - bx * k;
    zoom.y = fy - by * k;
    limitarZoom();
  }

  /** El desplazamiento no deja ver fuera del panel: con zoom 1 todo vuelve a su lugar. */
  function limitarZoom() {
    zoom.x = Math.min(0, Math.max(W - W * zoom.k, zoom.x));
    zoom.y = Math.min(0, Math.max(H - H * zoom.k, zoom.y));
    // Con zoom, un dedo sobre el fondo mueve el mapa; sin zoom, desplaza la página.
    canvas.style.touchAction = zoom.k > 1.01 ? 'none' : 'pan-y';
    if (zoomReset) zoomReset.disabled = zoom.k <= 1.01;
  }
  function isNeighbor(id) { return hovered && adjacency[hovered.id] && adjacency[hovered.id][id]; }

  /** El color de la línea es el de aquello que se comparte. */
  function colorRelacion(tipo) {
    if (!hovered) return COLOR_AREA;
    if (tipo === 'area') return COLOR_AREA;
    if (tipo === 'carrera') return hovered.group === 'persona' ? hovered.color : '#d0bcff';
    if (tipo === 'comunidad') {
      if (hovered.group === 'comunidad') return hovered.color;
      var nodo = hovered.kComunidad && byId['k:' + hovered.kComunidad];
      return nodo ? nodo.color : COLOR_AREA;
    }
    return COLOR_AREA;
  }

  /**
   * Arma el conjunto de nodos que comparten algo con el apuntado.
   * Se recalcula sólo al cambiar de nodo, no en cada frame.
   */
  function calcularRelacion() {
    relacion = Object.create(null);
    if (!hovered) return;

    function marcar(lista, tipo) {
      if (!lista) return;
      for (var i = 0; i < lista.length; i++) {
        var m = lista[i];
        if (m === hovered) continue;
        (relacion[m.id] || (relacion[m.id] = [])).push(tipo);
      }
    }

    if (hovered.group === 'persona') {
      // En el teléfono, con todos los inscritos en pantalla, la carrera
      // ilumina a medio mapa: sólo se marca lo que la persona eligió.
      if (!compacto) marcar(porCarrera[hovered.kCarrera], 'carrera');
      if (hovered.kArea) marcar(porArea[hovered.kArea], 'area');
      if (hovered.kComunidad) marcar(porComunidad[hovered.kComunidad], 'comunidad');
    } else if (hovered.group === 'tema') {
      // Un área ilumina a todos los que la eligieron.
      marcar(porArea[plano(hovered.label)], 'area');
    } else if (hovered.group === 'comunidad') {
      marcar(porComunidad[plano(hovered.label)], 'comunidad');
    }
  }

  /**
   * Halo de cada color, dibujado una sola vez en un canvas aparte y estampado
   * con drawImage: crear un degradado por nodo y por frame no escala.
   */
  var halos = Object.create(null);
  function spriteHalo(color) {
    if (halos[color]) return halos[color];

    var lado = 128, c = document.createElement('canvas');
    c.width = c.height = lado;
    var g2 = c.getContext('2d');
    var medio = lado / 2;

    var grad = g2.createRadialGradient(medio, medio, lado * 0.08, medio, medio, medio);
    grad.addColorStop(0, hexA(color, 1));
    grad.addColorStop(1, hexA(color, 0));
    g2.fillStyle = grad;
    g2.fillRect(0, 0, lado, lado);

    halos[color] = c;
    return c;
  }

  function hexA(hex, a) {
    var v = parseInt(hex.slice(1), 16);
    return 'rgba(' + ((v >> 16) & 255) + ',' + ((v >> 8) & 255) + ',' + (v & 255) + ',' + a + ')';
  }

  /**
   * Nacimiento de un nodo nuevo: un resplandor que se retrae hacia el punto
   * más ocho puntas que se achican, como una estrella condensándose. `t` va
   * de 0 (recién llegado) a 1 (ya es un nodo más); `rFinal` es su radio en
   * pantalla ya en reposo.
   */
  function drawEstallido(p, n, rFinal, t, dim) {
    var apagar = Math.pow(1 - t, 1.4);   // baja rápido al principio, se demora en desaparecer
    if (apagar <= 0.01) return;

    // Resplandor: arranca grande y blanco-caliente, se retrae y tiñe del
    // color del nodo a medida que se apaga.
    var bloomR = rFinal * (1 + (1 - t) * 5.5);
    ctx.globalAlpha = apagar * 0.85 * dim;
    ctx.drawImage(spriteHalo(t < 0.4 ? '#ffffff' : n.color), p.x - bloomR, p.y - bloomR, bloomR * 2, bloomR * 2);

    // Puntas: ocho rayos que se acortan hacia el centro, con las cuatro
    // "cardinales" más largas que las diagonales, como el brillo de una
    // estrella.
    var puntas = 8, giro = t * 0.5;
    var largoBase = rFinal * (1 + (1 - t) * 9);
    ctx.fillStyle = t < 0.3 ? '#fff8e0' : n.color;
    ctx.globalAlpha = apagar * 0.9 * dim;

    for (var i = 0; i < puntas; i++) {
      var ang = giro + i * (Math.PI / 4);
      var largo = largoBase * (i % 2 === 0 ? 1 : 0.55);
      var ancho = rFinal * 0.16 * apagar + 0.4;
      var dx = Math.cos(ang), dy = Math.sin(ang);
      var px = -dy * ancho, py = dx * ancho;

      ctx.beginPath();
      ctx.moveTo(p.x + px, p.y + py);
      ctx.lineTo(p.x + dx * largo, p.y + dy * largo);
      ctx.lineTo(p.x - px, p.y - py);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // ---------- Render -----------------------------------------
  var nacido = 0;
  function draw(now) {
    ctx.clearRect(0, 0, W, H);
    if (!nacido) nacido = now;

    // Medio segundo de desvanecido al abrir: el primer encuadre se corrige
    // en los primeros frames y sin esto se nota el reacomodo.
    var entrada = Math.min(1, (now - nacido) / 500);
    ctx.globalAlpha = entrada;
    ctx.lineCap = 'round';

    // --- aristas, agrupadas por estilo: un solo trazo por grupo.
    var grupos = Object.create(null);

    for (var i = 0; i < links.length; i++) {
      var link = links[i], a = link.a, c = link.b;
      var pa = toScreen(a), pb = toScreen(c);
      var tocada = hovered && (a === hovered || c === hovered);
      var base = link.tipo === 'persona' ? 0.13 : 0.22;
      var op = hovered ? (tocada ? 0.65 : 0.04) : base;
      if (op < 0.02) continue;

      var mx = (pa.x + pb.x) / 2, my = (pa.y + pb.y) / 2;
      var dx = pb.x - pa.x, dy = pb.y - pa.y;
      var curva = 0.07;
      var qx = mx - dy * curva, qy = my + dx * curva;

      var ancho = tocada ? 1.7 : (link.tipo === 'core' ? 1.2 : 0.85);
      var color = tocada ? hexA(hovered.color, op) : 'rgba(190,175,235,' + op + ')';
      var clave = color + '|' + ancho;

      var g = grupos[clave] || (grupos[clave] = { color: color, ancho: ancho, seg: [] });
      g.seg.push(pa.x, pa.y, qx, qy, pb.x, pb.y);

    }

    ctx.lineCap = 'round';
    for (var clave in grupos) {
      var g = grupos[clave];
      ctx.beginPath();
      for (var k = 0; k < g.seg.length; k += 6) {
        ctx.moveTo(g.seg[k], g.seg[k + 1]);
        ctx.quadraticCurveTo(g.seg[k + 2], g.seg[k + 3], g.seg[k + 4], g.seg[k + 5]);
      }
      ctx.strokeStyle = g.color;
      ctx.lineWidth = g.ancho;
      ctx.stroke();
    }

    // --- líneas de relación: se dibujan sólo mientras el cursor está encima.
    // No son aristas del grafo, son la respuesta a "¿qué tengo en común?".
    if (hovered) {
      var origen = toScreen(hovered);
      var ids = Object.keys(relacion);

      // Con mucha gente, las líneas tapan el mapa: sólo brilla el nodo.
      if (ids.length <= 28) {
        ctx.setLineDash([3, 4]);

        for (var r = 0; r < ids.length; r++) {
          var otro = byId[ids[r]];
          if (!otro) continue;

          var colorRel = colorRelacion(relacion[ids[r]][0]);
          var destino = toScreen(otro);

          ctx.beginPath();
          ctx.moveTo(origen.x, origen.y);
          ctx.lineTo(destino.x, destino.y);
          ctx.strokeStyle = hexA(colorRel, 0.42);
          ctx.lineWidth = 1;
          ctx.stroke();

        }
        ctx.setLineDash([]);
      }
    }

    // --- nodos. Los cuerpos se agrupan por color: un solo relleno por color.
    var orden = nodes.slice().sort(function (p, q) { return p.r - q.r; });
    var cuerpos = Object.create(null);
    var conEtiqueta = [];

    for (var j = 0; j < orden.length; j++) {
      var n = orden[j];
      var p = toScreen(n);
      var enfoque = !hovered || n === hovered || !!relacion[n.id] || isNeighbor(n.id);

      var edad = Math.min(1, (now - n.born) / NACE_MS);
      var ease = 1 - Math.pow(1 - edad, 3);
      var pulso = n.group === 'core' ? 1 + Math.sin(now / 1000) * 0.05 : 1;
      var r = Math.max(n.r * escalaR() * ease * pulso, ease > 0.9 ? 2.4 : 0);
      if (r <= 0.2) continue;
      if (p.x < -60 || p.y < -60 || p.x > W + 60 || p.y > H + 60) continue;

      var dim = enfoque ? 1 : 0.16;

      // El halo queda reservado para el centro y para el nodo apuntado: si
      // todos brillan, el brillo deja de señalar nada.
      if (n.group === 'core' || n === hovered) {
        var haloR = r * (n === hovered ? 3.2 : 3);
        ctx.globalAlpha = (n === hovered ? 0.34 : 0.45) * dim * ease * entrada;
        ctx.drawImage(spriteHalo(n.color), p.x - haloR, p.y - haloR, haloR * 2, haloR * 2);
        ctx.globalAlpha = 1;
      }

      // Nacimiento: al recién llegado (no a los que ya estaban al cargar la
      // página) se lo marca con un estallido tipo estrella — un resplandor
      // que se retrae y ocho puntas que se achican hacia el nodo, mientras
      // el cuerpo (arriba, `ease`) crece de 0 al tamaño final.
      if (edad < 1) drawEstallido(p, n, n.r * escalaR(), edad, dim * entrada);

      if (n === hovered) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fillStyle = n.color;
        ctx.fill();
        ctx.lineWidth = 1.8;
        ctx.strokeStyle = 'rgba(255,255,255,0.92)';
        ctx.stroke();
      } else {
        var clave = n.color + '|' + (dim * ease).toFixed(2);
        var lote = cuerpos[clave] || (cuerpos[clave] = { color: n.color, alfa: dim * ease, c: [] });
        lote.c.push(p.x, p.y, r);
      }

      // Centro, áreas y comunidades siempre llevan nombre: en el teléfono no
      // hay hover para descubrirlos. Los inscritos se leen al acercarse.
      var mostrar = n === hovered || !!relacion[n.id] || isNeighbor(n.id) ||
        n.group !== 'persona' || zoom.k >= 2.2;
      if (mostrar && ease > 0.55) conEtiqueta.push([n, p, r, enfoque, ease]);
    }

    for (var clave in cuerpos) {
      var lote = cuerpos[clave];
      ctx.globalAlpha = lote.alfa * entrada;
      ctx.fillStyle = lote.color;
      ctx.beginPath();
      for (var k = 0; k < lote.c.length; k += 3) {
        ctx.moveTo(lote.c[k] + lote.c[k + 2], lote.c[k + 1]);
        ctx.arc(lote.c[k], lote.c[k + 1], lote.c[k + 2], 0, Math.PI * 2);
      }
      ctx.fill();
    }
    // --- etiquetas
    ctx.globalAlpha = entrada;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (var e = 0; e < conEtiqueta.length; e++) {
      var n = conEtiqueta[e][0], p = conEtiqueta[e][1], r = conEtiqueta[e][2];
      var enfoque = conEtiqueta[e][3], ease = conEtiqueta[e][4];
      var la = (n === hovered ? 1 : (enfoque ? (n.group === 'core' ? 0.95 : 0.7) : 0.1)) * ease;
      var y = p.y + r + 6;

      var cuerpo = n.group === 'core' ? (compacto ? 'bold 11px' : 'bold 13px')
        : (n.group === 'persona' ? '10px' : (compacto ? '600 10px' : '600 11px'));
      ctx.font = cuerpo + ' "IBM Plex Mono", ui-monospace, monospace';
      ctx.fillStyle = 'rgba(231,223,240,' + la + ')';
      ctx.fillText(n.label, p.x, y);

      if (n.carrera) {
        ctx.font = '9px "IBM Plex Mono", ui-monospace, monospace';
        ctx.fillStyle = hexA(n.color, la * 0.75);
        ctx.fillText(n.carrera, p.x, y + 12);
      }
    }
  }

  function frame(now) {
    tick(now);
    recenter();
    draw(now);
    if (hovered) placeTooltip(hovered);
    requestAnimationFrame(frame);
  }

  // ---------- Interacción ------------------------------------
  function resize() {
    var rect = stage.getBoundingClientRect();
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = rect.width; H = rect.height;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    compacto = W < 560;

    // El centro del mundo pasa a estar en el centro del panel desde el
    // arranque, antes de pintar nada.
    if (!vistaLista) { view.x = W / 2; view.y = H / 2; }
    ajustarGravedad();

    // Si el panel cambió de tamaño lo bastante como para admitir otra cantidad
    // de nodos, se rearma el grafo con el tope nuevo.
    if (ultimosRegistros && Math.abs(topeVisible() - topeUsado) > topeUsado * 0.25) {
      buildGraph(ultimosRegistros);
    }

    fitView();
    limitarZoom();
  }

  function localPos(e) {
    var rect = canvas.getBoundingClientRect();
    var src = e.touches && e.touches.length ? e.touches[0] : e;
    return { x: src.clientX - rect.left, y: src.clientY - rect.top };
  }

  /**
   * Devuelve el nodo bajo el cursor midiendo en píxeles de pantalla, no en
   * coordenadas del mundo: así el área de agarre no se achica con el zoom.
   * `margen` extra para el nodo ya apuntado, para que no se pierda por temblor.
   */
  function nodeAt(px, py) {
    var best = null, bestD = Infinity;
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      var p = toScreen(n);
      var dx = p.x - px, dy = p.y - py;
      var d = Math.sqrt(dx * dx + dy * dy);
      var rPx = n.r * escalaR();
      var hit = Math.max(rPx + 16, 24) + (n === hovered ? 10 : 0);
      if (d < hit && d - rPx < bestD) { bestD = d - rPx; best = n; }
    }
    return best;
  }

  canvas.addEventListener('mousemove', function (e) {
    var p = localPos(e);
    pointer.x = p.x; pointer.y = p.y; pointer.inside = true;
    if (dragging) {
      var w = toWorld(p.x, p.y);
      dragging.x = w.x; dragging.y = w.y;
      return;
    }
    var hit = nodeAt(p.x, p.y);
    if (hit !== hovered) {
      hovered = hit;
      calcularRelacion();
      canvas.style.cursor = hit ? 'grab' : 'default';
      toggleTooltip(hit);
    }
  });

  canvas.addEventListener('mouseleave', function () {
    pointer.inside = false; hovered = null; dragging = null;
    calcularRelacion();
    toggleTooltip(null);
  });

  canvas.addEventListener('mousedown', function (e) {
    var p = localPos(e);
    var hit = nodeAt(p.x, p.y);
    if (hit) { dragging = hit; canvas.style.cursor = 'grabbing'; }
  });

  window.addEventListener('mouseup', function () {
    if (dragging) alpha = Math.max(alpha, 0.3);
    dragging = null;
    canvas.style.cursor = hovered ? 'grab' : 'default';
  });

  // Táctil: un dedo sobre un nodo lo arrastra; un toque lo deja
  // seleccionado (el celular no tiene hover); dos dedos acercan y mueven el
  // mapa; con zoom, un dedo sobre el fondo lo desplaza.
  var pinch = null, paneo = null, toque = null;

  function distancia(t) {
    var dx = t[0].clientX - t[1].clientX, dy = t[0].clientY - t[1].clientY;
    return Math.sqrt(dx * dx + dy * dy) || 1;
  }
  function puntoMedio(t) {
    var rect = canvas.getBoundingClientRect();
    return {
      x: (t[0].clientX + t[1].clientX) / 2 - rect.left,
      y: (t[0].clientY + t[1].clientY) / 2 - rect.top
    };
  }

  function seleccionar(n) {
    if (n === hovered) return;
    hovered = n;
    calcularRelacion();
    toggleTooltip(n);
  }

  canvas.addEventListener('touchstart', function (e) {
    if (e.touches.length >= 2) {
      // Empieza un pellizco: se suelta lo que se estuviera arrastrando.
      e.preventDefault();
      dragging = null; paneo = null; toque = null; pointer.inside = false;
      var m = puntoMedio(e.touches);
      pinch = { d: distancia(e.touches), k: zoom.k, bx: (m.x - zoom.x) / zoom.k, by: (m.y - zoom.y) / zoom.k };
      return;
    }

    var p = localPos(e);
    var hit = nodeAt(p.x, p.y);
    toque = { x: p.x, y: p.y, nodo: hit };
    if (hit) {
      pointer.x = p.x; pointer.y = p.y; pointer.inside = true;
      dragging = hit;
      seleccionar(hit);
    } else if (zoom.k > 1.01) {
      paneo = { x: p.x, y: p.y, zx: zoom.x, zy: zoom.y };
    }
  }, { passive: false });

  canvas.addEventListener('touchmove', function (e) {
    if (pinch && e.touches.length >= 2) {
      e.preventDefault();
      var m = puntoMedio(e.touches);
      zoom.k = Math.max(1, Math.min(ZOOM_MAX, pinch.k * distancia(e.touches) / pinch.d));
      // El punto del mapa que estaba entre los dedos sigue entre los dedos.
      zoom.x = m.x - pinch.bx * zoom.k;
      zoom.y = m.y - pinch.by * zoom.k;
      limitarZoom();
      return;
    }

    var p = localPos(e);
    if (toque && Math.abs(p.x - toque.x) + Math.abs(p.y - toque.y) > 8) toque = null;

    if (dragging) {
      e.preventDefault();
      pointer.x = p.x; pointer.y = p.y;
      var w = toWorld(p.x, p.y);
      dragging.x = w.x; dragging.y = w.y;
    } else if (paneo) {
      e.preventDefault();
      zoom.x = paneo.zx + (p.x - paneo.x);
      zoom.y = paneo.zy + (p.y - paneo.y);
      limitarZoom();
    }
  }, { passive: false });

  canvas.addEventListener('touchend', function (e) {
    if (e.touches.length) {
      // Queda un dedo tras el pellizco: no se convierte en arrastre.
      if (pinch) { pinch = null; toque = null; }
      return;
    }
    if (dragging) alpha = Math.max(alpha, 0.3);
    // Un toque en el fondo, sin arrastrar, deselecciona.
    if (toque && !toque.nodo) seleccionar(null);
    dragging = null; paneo = null; pinch = null; toque = null;
    pointer.inside = false;
  });

  canvas.addEventListener('touchcancel', function () {
    dragging = null; paneo = null; pinch = null; toque = null;
    pointer.inside = false;
  });

  // Escritorio: el pellizco del trackpad (y ctrl+rueda) acerca el mapa. La
  // rueda sola sigue desplazando la página.
  canvas.addEventListener('wheel', function (e) {
    if (!e.ctrlKey) return;
    e.preventDefault();
    var p = localPos(e);
    zoomEn(zoom.k * Math.exp(-e.deltaY * 0.01), p.x, p.y);
  }, { passive: false });

  // Botones + / − / encuadrar
  var zoomReset = document.getElementById('graph-zoom-reset');
  function botonZoom(id, fn) {
    var b = document.getElementById(id);
    if (b) b.addEventListener('click', fn);
  }
  botonZoom('graph-zoom-in', function () { zoomEn(zoom.k * 1.6, W / 2, H / 2); });
  botonZoom('graph-zoom-out', function () { zoomEn(zoom.k / 1.6, W / 2, H / 2); });
  botonZoom('graph-zoom-reset', function () { zoomEn(1, W / 2, H / 2); });

  window.addEventListener('resize', function () {
    clearTimeout(resize._t);
    resize._t = setTimeout(resize, 120);
  });

  // El panel puede cambiar de tamaño después del primer layout (fuentes,
  // imágenes): el canvas se redimensiona con él para no quedar descentrado.
  if ('ResizeObserver' in window) {
    var ro = new ResizeObserver(function () { resize(); });
    ro.observe(stage);
  } else {
    setTimeout(resize, 300);
    setTimeout(resize, 1200);
  }

  // ---------- Tooltip ----------------------------------------
  var tip = document.getElementById('graph-tooltip');
  var tipTitle = tip && tip.querySelector('[data-tip-title]');
  var tipSub = tip && tip.querySelector('[data-tip-sub]');

  function toggleTooltip(n) {
    if (!tip) return;
    if (!n) { tip.classList.add('opacity-0'); return; }
    tipTitle.textContent = n.carrera ? n.label + ' · ' + n.carrera : n.label;
    tipSub.textContent = n.sub || '';
    tipSub.style.display = n.sub ? '' : 'none';
    placeTooltip(n);
    tip.classList.remove('opacity-0');
  }

  function placeTooltip(n) {
    if (!tip) return;
    var s = toScreen(n);
    tip.style.left = Math.max(80, Math.min(W - 80, s.x)) + 'px';
    tip.style.top = (s.y - n.r * escalaR() - 12) + 'px';
  }

  // ---------- Datos ------------------------------------------
  function load() {
    if (!DATA_URL) { buildGraph([]); return; }
    // Pestaña de fondo: nadie mira, no vale la pena gastar cuota del endpoint.
    // Con muchos visitantes a la vez (link compartido) esto corta la mayoría
    // del tráfico, porque el celular manda la app a segundo plano seguido.
    if (document.hidden) return;

    fetch(DATA_URL, { cache: 'no-store' })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.text();
      })
      .then(function (texto) {
        var registros = desdeCSV(texto.replace(/^\uFEFF/, '').trim());

        // Si la hoja no cambió, no se toca el grafo: rearmarlo recalienta la
        // simulación y el mapa se reacomoda sin motivo.
        var firma = JSON.stringify(registros);
        if (firma === ultimaFirma) return;
        ultimaFirma = firma;

        console.info('[mapa] ' + registros.length + ' inscritos leídos de la hoja');
        buildGraph(registros);
      })
      .catch(function (err) {
        console.warn('[mapa] no pude leer los inscritos:', err.message);
        // Sin datos se dibuja sólo el esqueleto: nunca se inventan inscritos.
        if (!nodes.length) buildGraph([]);
      });
  }

  resize();
  load();
  requestAnimationFrame(frame);
  if (DATA_URL && REFRESH_MS > 0) setInterval(load, REFRESH_MS);
  // Al volver a la pestaña no se espera hasta el próximo poll: se refresca ya.
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) load();
  });
})();
