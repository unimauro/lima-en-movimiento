# 🚈 Lima en Movimiento

Gemelo digital, basado en datos, de la red de **transporte masivo y semimasivo de Lima
Metropolitana y Callao**. Un sitio **estático** (GitHub Pages, sin build) que combina un
**mapa real con simulación de la flota**, un **tablero de movilidad**, un **simulador del
parque automotor** y una sección de **seguridad en el transporte** — todo con datos de
fuentes públicas.

🔗 **En vivo:** https://unimauro.github.io/lima-en-movimiento/

![estado](https://img.shields.io/badge/tipo-maqueta%20educativa-blue)
![stack](https://img.shields.io/badge/stack-Leaflet%20%2B%20Chart.js-informational)
![deploy](https://img.shields.io/badge/deploy-GitHub%20Pages-black)

## Qué incluye

- **Mapa en vivo (Leaflet + Esri/OSM)** — la red masiva sobre el mapa real de la ciudad,
  con un **modelo mesoscópico simplificado (ABM-lite)**: despacho por intervalo horario,
  paradas con tiempo de *dwell* en cada estación y **ocupación** por vehículo (perfil de
  carga × demanda horaria × capacidad; pasa el cursor para verla). **Zoom, pan**, búsqueda
  de estaciones y **ficha al hacer clic** en una línea.
- **Arterias principales (32, OSM)** — Panamericanas, Vía Expresa, Evitamiento, Javier
  Prado, Universitaria, Túpac Amaru… coloreadas por **congestión según la hora** y con
  flujo de autos animado.
- **Mi viaje: casa → trabajo** — marca origen y destino en el mapa (o elige un ejemplo) y
  compara **auto**, **transporte masivo** y **combi**: tiempo a esa hora, distancia, costo
  en soles, CO₂ y **horas perdidas al año** en tráfico. Grafo multimodal + Dijkstra;
  espera = mitad del intervalo, tarifas reales, congestión = f(demanda horaria).
- **Tablero de movilidad (Chart.js)** — reparto modal, pasajeros/día por sistema, curva de
  demanda horaria (sincronizada con el reloj de la simulación), crecimiento de la red y
  comparación con capitales de la región. Paleta accesible (colorblind-safe).
- **Parque automotor** — histórico del parque vehicular + **simulador de proyección** a
  futuro. Distingue el dato oficial (MTC 2016) de los años estimados.
- **Seguridad en el transporte** — extorsión (“cupos”) y ataques a transportistas: cifras
  **agregadas** y **zonas** más afectadas, con fuentes. No se atribuyen hechos a rutas,
  empresas ni personas.
- **FAQ · Fuentes** — qué es real vs. estimado y las fuentes agrupadas por tema.
- **Chatbot** — responde con los datos reales del sitio; opcionalmente usa el gateway de IA
  `ai.tunky.net` (header `X-Client-Token` en `assets/js/chat.js`).
- **Tema claro/oscuro**, responsive, `prefers-reduced-motion`, SEO (canonical, OG/Twitter,
  sitemap, manifest, datos estructurados), en español (es-PE).

## Datos

- **Geometría y estaciones:** reales de **OpenStreetMap** (vía Overpass) — L1 (26 est.),
  Metropolitano (44), corredores por sus avenidas. L2 parcial (7/27 reales, resto aún en
  obra, aproximado); L3/L4 proyectadas.
- **Cifras:** de fuentes públicas citadas (ATU, MTC, INEI, IPE, SUNARP/AAP, Ministerio
  Público/Mininter, prensa). Las estimaciones están **marcadas** como tales.
- Cada sección cita su fuente en el sitio (**FAQ · Fuentes** y *Metodología*).

> **Maqueta educativa.** No es un sitio oficial ni está afiliado a la ATU. Verifica cada
> cifra en su fuente antes de un uso oficial.

## Estructura

```
├── index.html                 # shell de la app + SEO
├── site.webmanifest · robots.txt · sitemap.xml · .nojekyll
├── assets/
│   ├── css/styles.css         # tokens de color + layout
│   ├── favicon.svg · icon-*.png · apple-touch-icon.png · og.png
│   └── js/{data,twin,charts,chat,app}.js
├── data/
│   ├── network.json · routes.geojson     # red y trazados (OSM)
│   ├── indicators.json · context.json    # movilidad e historia
│   ├── fleet.json · security.json        # parque automotor y seguridad
│   ├── lines_detail.json                 # ficha por línea
│   └── osm/                              # extractos crudos de OSM
├── .github/workflows/pages.yml           # deploy automático
└── SPEC.md                               # esquemas de datos
```

## Uso local

El sitio carga los datos por `fetch()`, así que debe servirse por **HTTP** (con `file://`
falla por CORS):

```bash
python3 -m http.server 8000   # abre http://localhost:8000
```

## Despliegue

Push a `main` → GitHub Actions (`.github/workflows/pages.yml`) publica en GitHub Pages.
Rutas relativas: funciona en cualquier subpath. `.nojekyll` evita el procesado Jekyll.

## Licencia

Código MIT. Los datos citan sus fuentes; respétalas al reutilizar.
