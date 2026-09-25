/* ============================================================
   SCESI init · Comportamiento de la página
   Fecha, formulario y mapa diferidos, cinta de comunidades,
   navegación interna, menú móvil, animaciones de scroll y
   enlace activo del menú. La configuración vive en index.html.
   ============================================================ */
(function () {
  'use strict';

  // ---------- Recarga siempre arriba ----------
  // El navegador recuerda la posición de scroll y la restaura al recargar.
  // La desactivamos para que cada recarga empiece en el inicio.
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  window.scrollTo(0, 0);
  window.addEventListener('pageshow', function () { window.scrollTo(0, 0); });

  // ---------- Fecha ----------
  if (EVENTO_FECHA) {
    Array.prototype.forEach.call(document.querySelectorAll('[data-evento-fecha]'), function (el) {
      el.textContent = EVENTO_FECHA;
    });
  }

  // ---------- Formulario embebido ----------
  // Se descarga recién cuando la sección está por entrar en pantalla: quien
  // no llega hasta ahí no baja el formulario de Google.
  var frame = document.getElementById('registro-iframe');

  function montarFormulario() {
    if (!frame || frame.src) return;
    frame.src = FORM_EMBED_URL;
  }

  if (frame && FORM_EMBED_URL) {
    // El recuadro del formulario ocupa su alto final desde el principio.
    // Si apareciera recién al montarse, la sección crecería ~290 px en pleno
    // scroll y un clic en "Ubicación" terminaría a mitad de camino.
    frame.classList.remove('hidden');

    var seccion = document.getElementById('registro');
    if (seccion && 'IntersectionObserver' in window) {
      var obsForm = new IntersectionObserver(function (entradas) {
        if (!entradas[0].isIntersecting) return;
        obsForm.disconnect();
        montarFormulario();
      }, { rootMargin: '500px 0px' });
      obsForm.observe(seccion);
    } else {
      montarFormulario();
    }
  }

  // ---------- Cinta de comunidades ----------
  (function () {
    var cinta = document.getElementById('comunidades-marquee');
    var pista = document.getElementById('comunidades-track');
    if (!cinta || !pista) return;

    var quieto = window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    var VELOCIDAD = quieto ? 0 : 45;   // px por segundo del giro automático
    var ROCE = 0.94;                   // cuánto se frena la inercia por frame

    var originales = Array.prototype.slice.call(pista.children);
    if (!originales.length) {
      // Sin tarjetas la cinta sería una franja vacía: se oculta y se muestra el aviso.
      cinta.classList.add('hidden');
      var vacio = document.getElementById('comunidades-vacio');
      if (vacio) vacio.classList.remove('hidden');
      return;
    }

    var salto = 0;        // ancho de un juego completo: el punto de repetición
    var desplaz = 0;      // posición actual, siempre dentro de [0, salto)
    var inercia = 0;      // px/s que aporta el último arrastre
    var encima = false;

    function armar() {
      pista.innerHTML = '';
      originales.forEach(function (el) { pista.appendChild(el); });

      var visible = cinta.offsetWidth;
      if (!visible) return;

      // Se rellena hasta cubrir el ancho visible: con menos, al reiniciar
      // el bucle se vería el hueco.
      var guardia = 0;
      while (pista.scrollWidth < visible && guardia < 40) {
        originales.forEach(function (el) { pista.appendChild(el.cloneNode(true)); });
        guardia++;
      }

      var juego = Array.prototype.slice.call(pista.children);
      juego.forEach(function (el) {
        var copia = el.cloneNode(true);
        copia.setAttribute('aria-hidden', 'true');
        Array.prototype.forEach.call(copia.querySelectorAll('a'), function (a) {
          a.setAttribute('tabindex', '-1');
        });
        pista.appendChild(copia);
      });

      // Medido contra la primera copia: con `gap`, la mitad del ancho total
      // no cae donde empieza el juego repetido y el bucle saltaría.
      salto = pista.children[juego.length].offsetLeft - pista.children[0].offsetLeft;
      desplaz = 0;
    }

    function pintar(dt) {
      if (!salto) return;
      if (!arrastre.activo) {
        var v = (encima ? 0 : VELOCIDAD) + inercia;
        desplaz += v * dt;
        inercia *= Math.pow(ROCE, dt * 60);
        if (Math.abs(inercia) < 1) inercia = 0;
      }
      // Módulo que también funciona con valores negativos (arrastre a la derecha)
      desplaz = ((desplaz % salto) + salto) % salto;
      pista.style.transform = 'translate3d(' + (-desplaz).toFixed(2) + 'px, 0, 0)';
    }

    var previo = 0;
    function frame(ahora) {
      var dt = previo ? Math.min((ahora - previo) / 1000, 0.05) : 0;
      previo = ahora;
      pintar(dt);
      requestAnimationFrame(frame);
    }

    // ---- arrastre con mouse, lápiz o dedo ----
    // `activo` sólo se enciende cuando el gesto supera el umbral. Capturar el
    // puntero antes haría que el navegador redirija el click al contenedor y
    // los enlaces de las tarjetas no abrirían.
    var UMBRAL = 5;   // px antes de considerar que es un arrastre
    var arrastre = { activo: false, listo: false, x: 0, x0: 0, movido: 0, t: 0, v: 0, id: null };

    cinta.addEventListener('pointerdown', function (e) {
      if (e.button !== undefined && e.button !== 0) return;
      arrastre.listo = true;
      arrastre.activo = false;
      arrastre.x = arrastre.x0 = e.clientX;
      arrastre.movido = 0;
      arrastre.t = performance.now();
      arrastre.v = 0;
      arrastre.id = e.pointerId;
      inercia = 0;
    });

    cinta.addEventListener('pointermove', function (e) {
      if (!arrastre.listo) return;

      if (!arrastre.activo) {
        if (Math.abs(e.clientX - arrastre.x0) < UMBRAL) return;
        arrastre.activo = true;
        try { cinta.setPointerCapture(e.pointerId); } catch (err) {}
        cinta.classList.add('arrastrando');
        arrastre.x = e.clientX;
        arrastre.t = performance.now();
      }

      var dx = e.clientX - arrastre.x;
      var ahora = performance.now();
      var dt = Math.max(ahora - arrastre.t, 1) / 1000;

      desplaz -= dx;
      arrastre.movido += Math.abs(dx);
      arrastre.v = -dx / dt;          // px/s, para la inercia al soltar
      arrastre.x = e.clientX;
      arrastre.t = ahora;
      pintar(0);
    });

    function soltar(e) {
      if (!arrastre.listo) return;
      var arrastraba = arrastre.activo;
      arrastre.listo = false;
      arrastre.activo = false;
      cinta.classList.remove('arrastrando');

      var id = (e && e.pointerId !== undefined) ? e.pointerId : arrastre.id;
      if (id !== null && cinta.hasPointerCapture && cinta.hasPointerCapture(id)) {
        cinta.releasePointerCapture(id);
      }

      // La inercia arranca donde quedó el gesto y se frena sola
      inercia = arrastraba ? Math.max(-2600, Math.min(2600, arrastre.v)) : 0;
    }

    cinta.addEventListener('pointerup', soltar);
    cinta.addEventListener('pointercancel', soltar);
    cinta.addEventListener('pointerleave', soltar);

    // Un arrastre no debe terminar abriendo el enlace que quedó bajo el dedo
    cinta.addEventListener('click', function (e) {
      if (arrastre.movido > UMBRAL) { e.preventDefault(); e.stopPropagation(); }
      arrastre.movido = 0;
    }, true);

    cinta.addEventListener('mouseenter', function () { encima = true; });
    cinta.addEventListener('mouseleave', function () { encima = false; });
    cinta.addEventListener('focusin', function () { encima = true; });
    cinta.addEventListener('focusout', function () { encima = false; });

    armar();
    requestAnimationFrame(frame);

    var t;
    window.addEventListener('resize', function () {
      clearTimeout(t);
      t = setTimeout(armar, 200);
    });
  })();

  // ---------- Mapa ----------
  var MAPA_URL = 'https://www.google.com/maps?q=-17.3927776,-66.1456021&z=18&hl=es&output=embed';
  var mapa = document.getElementById('mapa-iframe');
  var mapaHueco = document.getElementById('mapa-placeholder');
  var mapaSec = document.getElementById('ubicacion');

  function montarMapa() {
    if (!mapa || mapa.src) return;
    mapa.src = MAPA_URL;
    mapa.classList.remove('hidden');
    if (mapaHueco) mapaHueco.remove();
  }

  if (mapa && mapaSec && 'IntersectionObserver' in window) {
    var obsMapa = new IntersectionObserver(function (e) {
      if (!e[0].isIntersecting) return;
      obsMapa.disconnect();
      montarMapa();
    }, { rootMargin: '500px 0px' });
    obsMapa.observe(mapaSec);
  } else {
    montarMapa();
  }

  // ---------- Navegación interna sin hash en la URL ----------
  // Con el <a href="#registro"> nativo, el ancla queda pegada en la barra de
  // direcciones y al recargar el navegador vuelve a saltar ahí. Movemos el
  // scroll a mano y dejamos la URL limpia.
  document.addEventListener('click', function (e) {
    var enlace = e.target.closest ? e.target.closest('a[href^="#"]') : null;
    if (!enlace) return;

    var id = enlace.getAttribute('href').slice(1);
    if (!id) { e.preventDefault(); irA(document.body); return; }   // href="#"

    var destino = document.getElementById(id);
    if (!destino) return;

    e.preventDefault();
    irA(destino);
  });

  function irA(destino) {
    var brusco = window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    destino.scrollIntoView({ behavior: brusco ? 'auto' : 'smooth', block: 'start' });

    // Red de seguridad: si algo cambió de alto durante el recorrido (una
    // imagen, un iframe), el destino se corrió. Al terminar se reajusta.
    if (destino !== document.body) {
      var intentos = 0;
      var corregir = function () {
        var desvio = destino.getBoundingClientRect().top -
          parseFloat(getComputedStyle(destino).scrollMarginTop || 0);
        if (Math.abs(desvio) > 6 && intentos++ < 2) {
          destino.scrollIntoView({ behavior: 'auto', block: 'start' });
        }
      };
      if ('onscrollend' in window) {
        window.addEventListener('scrollend', corregir, { once: true });
      }
      setTimeout(corregir, 1400);
    }

    // El foco acompaña al scroll: sin esto, el teclado y los lectores de
    // pantalla se quedan en el enlace y la sección nunca recibe el turno.
    if (destino !== document.body) {
      destino.setAttribute('tabindex', '-1');
      destino.focus({ preventScroll: true });
    }
  }

  // ---------- Menú móvil ----------
  var toggle = document.getElementById('menu-toggle');
  var menu = document.getElementById('menu-movil');
  var icon = document.getElementById('menu-icon');

  function cerrarMenu() {
    if (!menu) return;
    menu.style.maxHeight = '0px';
    menu.classList.remove('border-[#C4B5FD]/15');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-label', 'Abrir menú');
    icon.textContent = 'menu';
  }

  function abrirMenu() {
    menu.style.maxHeight = menu.scrollHeight + 'px';
    menu.classList.add('border-[#C4B5FD]/15');
    toggle.setAttribute('aria-expanded', 'true');
    toggle.setAttribute('aria-label', 'Cerrar menú');
    icon.textContent = 'close';
  }

  if (toggle && menu) {
    toggle.addEventListener('click', function () {
      if (toggle.getAttribute('aria-expanded') === 'true') cerrarMenu();
      else abrirMenu();
    });

    Array.prototype.forEach.call(menu.querySelectorAll('.menu-link'), function (link) {
      link.addEventListener('click', cerrarMenu);
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') cerrarMenu();
    });

    window.addEventListener('resize', function () {
      if (window.innerWidth >= 1024) cerrarMenu();
    });
  }

  // ---------- Reveal al entrar en pantalla ----------
  (function () {
    var suave = !window.matchMedia ||
      !window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (!suave || !('IntersectionObserver' in window)) return;

    // Reglas en vez de selectores acoplados a la anidación exacta:
    // de cada sección (salvo el hero) se revelan su título, sus párrafos
    // de entrada y sus tarjetas.
    var objetivos = [];
    var secciones = document.querySelectorAll('main section:not(#inicio)');

    Array.prototype.forEach.call(secciones, function (sec) {
      var titulo = sec.querySelector('h2');
      if (titulo) objetivos.push(titulo);

      // El párrafo introductorio es el que acompaña al h2, no los de las tarjetas.
      if (titulo && titulo.parentNode) {
        Array.prototype.forEach.call(titulo.parentNode.children, function (el) {
          if (el.tagName === 'P') objetivos.push(el);
        });
      }

      // Tarjetas: article, o cualquier bloque con esquinas redondeadas grandes.
      var cinta = sec.querySelector('.marquee');
      if (cinta) objetivos.push(cinta);

      Array.prototype.forEach.call(
        sec.querySelectorAll('article, .rounded-2xl, .rounded-xl'),
        function (el) {
          if (el.closest('article') && el.tagName !== 'ARTICLE') return;
          if (el.closest('.marquee')) return;   // lo mueve la cinta, no el reveal
          if (objetivos.indexOf(el) === -1) objetivos.push(el);
        }
      );
    });

    objetivos = objetivos.filter(function (el, i) {
      return el && objetivos.indexOf(el) === i && !el.closest('header') && !el.closest('#graph-stage');
    });

    if (!objetivos.length) return;
    document.documentElement.classList.add('js-reveal');

    objetivos.forEach(function (el) { el.setAttribute('data-reveal', ''); });

    var observer = new IntersectionObserver(function (entradas) {
      entradas.forEach(function (entrada) {
        if (!entrada.isIntersecting) return;
        var el = entrada.target;

        // Escalonado por posición dentro del contenedor, topeado para que
        // una grilla larga no termine con medio segundo de espera.
        var hermanos = Array.prototype.slice.call(el.parentNode.children);
        var i = Math.min(hermanos.indexOf(el), 5);
        el.style.transitionDelay = (i * 70) + 'ms';
        el.classList.add('is-visible');

        contarNumeros(el);
        observer.unobserve(el);
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });

    objetivos.forEach(function (el) { observer.observe(el); });

    /** Las métricas suben de 0 a su valor cuando la tarjeta aparece. */
    function contarNumeros(raiz) {
      Array.prototype.forEach.call(raiz.querySelectorAll('.text-\\[48px\\]'), function (span) {
        var m = /^(\d+)(\D*)$/.exec(span.textContent.trim());
        if (!m) return;
        var fin = parseInt(m[1], 10), sufijo = m[2], ini = performance.now();
        var DURACION = 2200;
        span.textContent = '0' + sufijo;
        (function paso(ahora) {
          var t = Math.min(1, (ahora - ini) / DURACION);
          var e = 1 - Math.pow(1 - t, 3);   // frena suave al final
          span.textContent = Math.round(fin * e) + sufijo;
          if (t < 1) requestAnimationFrame(paso);
        })(ini);
      });
    }
  })();

  // ---------- Enlace activo según la sección visible ----------
  var enlaces = Array.prototype.slice.call(
    document.querySelectorAll('header nav a[href^="#"]:not([data-no-spy])')
  );
  var secciones = enlaces
    .map(function (a) { return document.querySelector(a.getAttribute('href')); })
    .filter(Boolean);

  if (secciones.length && 'IntersectionObserver' in window) {
    var activas = Object.create(null);

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        activas[entry.target.id] = entry.isIntersecting ? entry.intersectionRatio : 0;
      });

      var mejorId = null, mejor = 0;
      Object.keys(activas).forEach(function (id) {
        if (activas[id] > mejor) { mejor = activas[id]; mejorId = id; }
      });
      if (!mejorId) return;

      enlaces.forEach(function (a) {
        var activo = a.getAttribute('href') === '#' + mejorId;
        a.classList.toggle('bg-surface-container-high', activo && !a.classList.contains('menu-link'));
        a.classList.toggle('text-on-surface', activo);
        // Sin cambiar el grosor de la letra: el enlace cambiaría de ancho y,
        // como el menú está centrado, todos los demás se correrían.
        a.classList.toggle('text-on-surface-variant', !activo);
        if (activo) a.setAttribute('aria-current', 'page');
        else a.removeAttribute('aria-current');
      });
    }, { threshold: [0.15, 0.4, 0.7], rootMargin: '-80px 0px -40% 0px' });

    secciones.forEach(function (sec) { observer.observe(sec); });
  }
})();
