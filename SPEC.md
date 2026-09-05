# Gemelo Digital del Transporte Urbano de Lima — Especificación

> **Gemelo Digital (Digital Twin):** representación virtual, basada en datos, de un
> sistema real que se puede *observar, animar y consultar*. Aquí modelamos la red de
> transporte masivo y semimasivo de Lima Metropolitana y el Callao: sus corredores,
> estaciones, flota, frecuencias por hora del día e indicadores de demanda.

## 1. Objetivo

Un sitio **estático** (desplegable en **GitHub Pages**, sin build obligatorio) que ofrece:

1. **Mapa vivo / simulación ("el gemelo")** — un lienzo (`<canvas>`) que dibuja la red
   sobre una proyección geográfica de Lima y **anima vehículos** (trenes y buses)
   recorriendo cada línea. Un reloj de 24 h controla la simulación; las **frecuencias
   (headways) cambian según la hora pico/valle** usando la curva de demanda real.
   Controles: play/pausa, velocidad (1×…600×), hora del día, filtro por modo/línea.
2. **Tablero de datos (dataviz)** — KPIs de red + gráficos: reparto modal de viajes,
   pasajeros/día por modo, curva de demanda horaria, crecimiento de la red y
   comparación con otras ciudades de la región.
3. **Panel de contexto** — ficha por línea (estado, km, estaciones, flota) y una
   sección de metodología/fuentes.

### Principios de diseño técnico
- **Sin dependencias de tiles externos.** El mapa se dibuja con proyección propia
  (equirectangular) sobre `<canvas>`; funciona offline y en GitHub Pages sin API keys.
- CDNs permitidas únicamente desde cdnjs (Chart.js). Todo lo demás inline/local.
- Los datos viven en `data/*.json` y se cargan por `fetch()` (Pages los sirve por HTTP).
- Responsive, tema claro/oscuro, accesible (contraste AA, `prefers-reduced-motion`
  detiene la animación).
- Español (es-PE) como idioma principal.

## 2. Estructura de archivos

```
gemelo-lima-transporte/
├── index.html              # shell de la app (layout, paneles)
├── .nojekyll               # evita que Pages procese con Jekyll
├── assets/
│   ├── css/styles.css      # tema, tokens de color, layout
│   └── js/
│       ├── data.js         # carga y normaliza los JSON
│       ├── twin.js         # proyección + render del mapa + motor de simulación
│       ├── charts.js       # dashboards (Chart.js)
│       └── app.js          # orquestador: UI, controles, estado
└── data/
    ├── network.json        # líneas + estaciones (coords) + flota + frecuencias
    ├── routes.geojson      # polilíneas de cada corredor (para animar y dibujar)
    ├── indicators.json     # KPIs, reparto modal, demanda, series, comparativas
    └── context.json        # narrativa: historia, ATU, problemas, proyectos futuros
```

## 3. Esquemas de datos (CONTRATO — los agentes deben respetarlo)

### 3.1 `data/network.json`
```jsonc
{
  "meta": { "city": "Lima Metropolitana y Callao", "updated": "2026", "srs": "WGS84" },
  "lines": [
    {
      "id": "L1",                       // único, corto. Debe coincidir con routes.geojson
      "name": "Metro de Lima — Línea 1",
      "short": "L1",
      "mode": "metro",                  // metro | brt | corredor | tren_urbano
      "status": "operational",          // operational | construction | planned
      "color": "#2E7D32",               // color de marca de la línea (hex)
      "length_km": 34.6,
      "stations_count": 26,
      "avg_speed_kmh": 34,
      "operating_hours": { "start": "05:00", "end": "23:00" },
      "headway_min": { "peak": 6, "offpeak": 12 },   // minutos entre vehículos
      "fleet": { "vehicles": 44, "capacity_per_vehicle": 1200 },
      "daily_riders": 700000,           // pax/día (estimado, citar en sources)
      "opened_year": 2011,
      "stations": [                     // en orden a lo largo de la línea
        { "id":"L1-01", "name":"Villa El Salvador", "lat":-12.2139, "lng":-76.9386,
          "order":1, "interchange":[] },     // interchange: ids de líneas que conectan
        { "id":"L1-02", "name":"Parque Industrial", "lat":-12.2049, "lng":-76.9445,
          "order":2, "interchange":[] }
        // ... todas las estaciones
      ]
    }
    // ... L2, Metropolitano, Corredores (Rojo, Azul, Morado, Amarillo, Verde), etc.
  ]
}
```
**Líneas mínimas a incluir:** Metro L1 (operativa), Metro L2 (construcción), Metro L3 y L4
(planeadas), Metropolitano (BRT, troncal + ampliación norte), Corredores Complementarios
(Rojo, Azul, Morado; Amarillo/Verde si hay datos). Coordenadas **aproximadas pero
plausibles** de estaciones reales (usar ubicaciones conocidas). Cada `id` de línea debe
existir también en `routes.geojson`.

### 3.2 `data/routes.geojson`
`FeatureCollection` de `LineString`, **una feature por línea**, con coordenadas
`[lng, lat]` ordenadas a lo largo del corredor (más densas que las estaciones —añadir
vértices intermedios en curvas— para una animación fluida). Propiedades obligatorias:
```jsonc
{ "type":"FeatureCollection", "features":[
  { "type":"Feature",
    "properties": { "id":"L1", "name":"Metro Línea 1", "mode":"metro",
                    "status":"operational", "color":"#2E7D32" },
    "geometry": { "type":"LineString", "coordinates": [[-76.9386,-12.2139], ...] } }
]}
```
Opcional: una feature con `properties.id == "_costa"` (LineString de la línea de costa)
y/o `properties.id == "_limite"` para un contorno tenue de referencia geográfica.

### 3.3 `data/indicators.json`
```jsonc
{
  "kpis": [
    { "id":"red_masiva_km", "label":"Red masiva (km)", "value":0, "unit":"km",
      "note":"Metro + BRT operativos", "source_ref":0 }
  ],
  "modal_share": [        // reparto de viajes diarios de Lima (% suma ≈ 100)
    { "mode":"Combi / Cúster", "pct":0 }, { "mode":"Bus", "pct":0 },
    { "mode":"Metro", "pct":0 }, { "mode":"Metropolitano/BRT", "pct":0 },
    { "mode":"Taxi / App", "pct":0 }, { "mode":"Auto privado", "pct":0 },
    { "mode":"A pie", "pct":0 }, { "mode":"Bicicleta / otros", "pct":0 }
  ],
  "ridership_by_mode": [ { "mode":"Metro L1", "daily":0, "color":"#2E7D32" } ],
  "demand_curve": [       // EXACTO 24 puntos, index 0..1 relativo al pico (usado por la simulación)
    { "hour":0, "index":0.05 } /* ... hasta hour:23 */
  ],
  "network_growth": [ { "year":2011, "km":0 } ],   // km de red masiva por año
  "comparisons": [        // metro/BRT vs población de ciudades pares
    { "city":"Lima", "metro_km":0, "brt_km":0, "pop_m":0 },
    { "city":"Santiago", "metro_km":0, "brt_km":0, "pop_m":0 },
    { "city":"Bogotá", "metro_km":0, "brt_km":0, "pop_m":0 },
    { "city":"Ciudad de México", "metro_km":0, "brt_km":0, "pop_m":0 }
  ],
  "sources": [ { "label":"ATU — ...", "url":"https://..." } ]   // source_ref = índice aquí
}
```
`demand_curve` es **compartido**: alimenta los gráficos *y* modula las frecuencias del
gemelo (menos headway en horas pico → más vehículos en el mapa).

### 3.4 `data/context.json`
```jsonc
{
  "intro": "1–2 párrafos: qué es la red de Lima y por qué un gemelo digital.",
  "timeline": [ { "year":2010, "title":"...", "text":"..." } ],
  "authority": { "name":"ATU — Autoridad de Transporte Urbano para Lima y Callao",
                 "text":"rol y competencias" },
  "challenges": [ { "title":"Informalidad", "text":"..." } ],
  "future": [ { "title":"Línea 2 del Metro", "text":"...", "eta":"2026+" } ],
  "methodology": "Cómo se construyó el gemelo, qué es real vs. estimado.",
  "sources": [ { "label":"...", "url":"https://..." } ]
}
```

## 4. Motor de simulación (twin.js) — resumen funcional
- Proyección equirectangular de `[lng,lat]` a píxeles con `bbox` autoajustado de todas
  las rutas + padding; se recalcula en resize.
- Cada línea genera "vehículos" espaciados según `headway_min` y la hora simulada
  (interpolando `demand_curve`): posición = distancia acumulada sobre la polilínea.
- `requestAnimationFrame`; el reloj avanza `speed×` el tiempo real. Ida y vuelta.
- Interacción: hover/click en estación → tooltip con datos; filtros por modo/línea.
- Respeta `prefers-reduced-motion` (dibuja estático).

## 5. Despliegue (GitHub Pages)
Sitio estático en la raíz. Opción rápida: rama `main`, Settings → Pages → *Deploy from a
branch* → `main` / `(root)`. `.nojekyll` incluido. Opcional: workflow de GitHub Actions.

## 6. Alcance de datos / veracidad
Cifras **de referencia** basadas en fuentes públicas (ATU, operadores, prensa, estudios
de movilidad JICA/BID). El gemelo es una **maqueta educativa**: la geometría de rutas es
aproximada y las frecuencias son representativas. Toda cifra citada lleva fuente en
`sources`. Se rotula claramente lo real vs. lo estimado.
