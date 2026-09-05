# 🚈 Gemelo Digital · Transporte Urbano de Lima

Réplica virtual, basada en datos, de la red de **transporte masivo y semimasivo de
Lima Metropolitana y Callao**. Un sitio **estático** (GitHub Pages, sin build) que
combina un **mapa vivo con simulación de la flota** y un **tablero de datos de
movilidad**.

![estado](https://img.shields.io/badge/tipo-maqueta%20educativa-blue)
![stack](https://img.shields.io/badge/stack-HTML%20%2B%20Canvas%20%2B%20Chart.js-informational)

## ¿Qué es un "gemelo digital" aquí?

Una representación virtual de un sistema real que se puede **observar, animar y
consultar**. Modelamos 8 corredores (Metro Líneas 1–4, Metropolitano y tres Corredores
Complementarios), 141 estaciones, sus frecuencias por hora y la demanda de la ciudad.
Los vehículos circulan en tiempo simulado y las **frecuencias cambian con la hora
pico/valle** siguiendo la curva de demanda real.

## Características

- **Mapa / simulación (`<canvas>`)** — proyección geográfica propia (sin tiles ni API
  keys), vehículos animados en ambos sentidos, reloj de 24 h, control de velocidad
  (10×–600×), filtro por línea y tooltips de estaciones.
- **Tablero (Chart.js)** — reparto modal, pasajeros/día por sistema, curva de demanda
  horaria (sincronizada con el reloj del gemelo), crecimiento de la red y comparación
  con capitales de la región. Paleta accesible validada (colorblind-safe).
- **Contexto** — línea de tiempo, la ATU, retos y proyectos futuros.
- **Tema claro/oscuro**, responsive, respeta `prefers-reduced-motion`, en español (es-PE).

## Estructura

```
├── index.html              # shell de la app
├── assets/css/styles.css   # tokens de color + layout
├── assets/js/
│   ├── data.js             # carga de datos
│   ├── twin.js             # proyección + render + motor de simulación
│   ├── charts.js           # dashboards (Chart.js)
│   └── app.js              # orquestador (UI y controles)
├── data/
│   ├── network.json        # líneas + estaciones (coords) + flota + frecuencias
│   ├── routes.geojson      # polilíneas de cada corredor
│   ├── indicators.json     # KPIs, reparto modal, demanda, series, comparativas
│   └── context.json        # narrativa e historia
└── SPEC.md                 # especificación y esquemas de datos
```

## Uso local

El sitio carga los datos por `fetch()`, así que debe servirse por **HTTP** (abrir el
archivo con `file://` falla por CORS):

```bash
python3 -m http.server 8000
# abre http://localhost:8000
```

## Despliegue en GitHub Pages

1. Sube el repositorio a GitHub (la raíz contiene `index.html` y `.nojekyll`).
2. **Settings → Pages → Build and deployment → Deploy from a branch**.
3. Rama `main`, carpeta `/(root)` → **Save**.
4. En un minuto estará en `https://<usuario>.github.io/<repo>/`.

> El archivo `.nojekyll` evita que Pages procese el sitio con Jekyll.
> Alternativa con Actions: incluida en `.github/workflows/pages.yml`.

## Datos y veracidad

Maqueta **educativa**. Las cifras son de **referencia**, tomadas de fuentes públicas
(ATU, operadores, estudios de movilidad); la geometría de rutas y las frecuencias son
**aproximadas y representativas**. Cada indicador cita su fuente en la sección de
*Metodología y fuentes* del sitio. Ver `SPEC.md` para el contrato de datos.

## Licencia

MIT para el código. Los datos citan sus fuentes; verifica cada cifra antes de un uso
oficial.
