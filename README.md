# Cotizador · La Innovación

Convierte una solicitud de cotización tal como llega —correo, WhatsApp o un Excel de hasta 100
líneas— en una lista de productos revisada y lista para cotizar.

## Arrancar

```bash
npm install
cp .env.local.example .env.local   # credenciales del ERP y clave del modelo
npm run sync                       # trae el catálogo: ~3 min la primera vez
npm run dev                        # http://localhost:3100
```

`npm run sync` es obligatorio antes del primer arranque: sin el espejo local la app no puede
buscar nada. Conviene dejarlo en un cron de madrugada.

## Cómo está armado

```
Solicitud ──► Cliente ──► Productos ──► Cotización
 texto/Excel   ERP vivo    espejo local   ⏳ falta backend
```

**El catálogo se espeja en local.** El endpoint de productos del ERP tarda entre 9 y 26 segundos
por petición sin importar los filtros: una búsqueda por código de barras que devuelve 394 bytes
tarda 10.3 s, porque el coste es el escaneo de la vista y no las filas. Ese endpoint no sirve ni
para buscar mientras alguien escribe ni para proponer alternativas, que exige recorrer el
catálogo entero. El volcado completo son 13 páginas, unos 3 minutos y 33 MB en SQLite; después,
cada búsqueda responde en decenas de milisegundos.

**Los clientes se consultan contra el espejo también**, aunque el ERP responda rápido: su
búsqueda es un `LIKE` y no tolera que las palabras vengan en otro orden. Con FTS5,
`innovacion marmolite` encuentra `INNOVACION MARMOLITE Y GRANITO IMG, SRL`.

**Lo local sirve para encontrar; el ERP, para comprometer.** La existencia y el precio de las
líneas ya elegidas se revalidan contra el ERP al emitir, así que un espejo con horas de
antigüedad nunca llega al documento final.

### Cómo se resuelve cada línea

Cuatro señales, en `src/lib/buscar.ts`:

| Señal | Qué aporta |
|---|---|
| `bm25` de FTS5 | Ordena. Ya pondera rareza y longitud, y lo hace bien. |
| `cobertura` | Cuánto del pedido aparece en el producto, pesado por IDF. |
| `posicionNucleo` | Si la descripción **empieza** por el tipo de producto pedido. |
| `bonoDisponibilidad` | Desempata entre productos del tipo correcto. Nada más. |

`posicionNucleo` es la que más rinde. El catálogo nombra siempre `TIPO + marca + modelo`
(`ABANICO KDK N56LG…`, `NEVERA WHIRLPOOL…`), y los pedidos en español ponen el sustantivo
primero. Sin esa señal, un `NIPLE KDK` cuya segunda descripción menciona "abanico techo" gana
por coincidir en todas las palabras: es un repuesto **para** abanicos, y buscando por palabras
"es un X" y "es una pieza de X" son indistinguibles.

Los pedidos vienen en plural (`12 abanicos de techo`) y el ERP guarda en singular, así que los
términos se singularizan antes de consultar; sin eso `abanicos` no coincide con `ABANICO` ni por
prefijo.

El `bonoDisponibilidad` está deliberadamente acotado por debajo de `posicionNucleo`. Con un rango
mayor pasaba esto: las 152 lavadoras del catálogo están bloqueadas y sin existencia, y un
`BALANCIN COFLEX` con 1.201 unidades le ganaba a todas. Que no haya lavadoras es justamente lo
que el vendedor necesita saber.

### El triaje

Cada línea sale clasificada, y de ahí depende toda la interfaz:

- **exacto** — código, código de barras o descripción idéntica. Entra marcada.
- **probable** — un candidato claramente por delante. Entra marcada.
- **ambiguo** — varios parecidos entre sí. Entra desmarcada.
- **sin match** — nada razonable que ofrecer. Entra desmarcada.

Con 100 líneas no se le pueden poner 300 decisiones enfrente a nadie. La barra de estado del lote
es proporcional y filtra al hacer clic, así que "12 a revisar de 100" se ve antes de leer una
sola fila. Las variantes se piden con un botón, presente en **todas** las filas: si solo
apareciera en las problemáticas dejaría de servir para ofrecer una alternativa mejor sobre un
match correcto.

Lo dudoso entra desmarcado a propósito. Incluir por defecto algo que el sistema no tiene claro es
la forma más fácil de que una línea equivocada llegue al cliente.

### La capa de IA

El modelo nunca ve el catálogo: 63.702 productos son del orden de 1.3 millones de tokens. La
recuperación es local y Claude solo razona sobre la lista corta de candidatos, en dos momentos —
separar las líneas de un texto sucio, y reordenar y explicar los candidatos de lo que quedó
dudoso. Lo que ya entró por código no se le manda.

Sin `ANTHROPIC_API_KEY` todo funciona igual, con parseo por reglas y ranking por FTS. Es
notablemente peor en los casos semánticos: `lavadora carga frontal` termina en un repuesto de
grifería porque ninguna señal de texto sabe que un BALANCIN no es una lavadora, y
`refrigerador` no encuentra nada porque esa palabra no existe en el catálogo —el ERP dice
`NEVERA`—. Ahí es donde el modelo hace la diferencia.

### Lo que aprende

Cada corrección del cotizador se guarda como vocabulario de ese cliente (tabla `aprendizaje`).
Los clientes repiten su forma de nombrar las cosas, así que esas correcciones hacen que la
próxima solicitud entre resuelta. Ya funciona, aunque el paso de emisión todavía no exista.

## Lo que falta y por qué

Tres endpoints del ERP bloquean el cierre del circuito. Están especificados con su JSON y su
tabla de NAV en [`docs/SOLICITUD_ENDPOINTS.md`](docs/SOLICITUD_ENDPOINTS.md):

| Falta | Efecto hoy |
|---|---|
| Estado de cuenta del cliente | Solo se ve el `blocked` de NAV: si está frenado, no cuánto debe. |
| `POST` de cotización | No se puede emitir. Ningún endpoint del ERP escribe. |
| Precio e ITBIS por cliente | El precio mostrado es de lista, sin impuesto ni descuentos. |

En la interfaz eso aparece marcado como **Próximamente**, con la explicación a la vista.

## Estructura

```
scripts/sync-catalogo.ts    Volcado del ERP al espejo local
src/lib/erp.ts              Cliente del API de GestionIncidencias
src/lib/db.ts               SQLite + FTS5 (node:sqlite, sin dependencia nativa)
src/lib/buscar.ts           Recuperación, puntaje y triaje por confianza
src/lib/parseo.ts           Texto libre y Excel → líneas, con trazabilidad de origen
src/lib/ia.ts               Claude: extracción y reordenamiento
src/app/api/               Rutas: solicitud, clientes, productos, cotización
src/components/            Interfaz
```

Cada línea guarda de dónde salió (hoja y fila, en el caso de Excel) desde el primer momento, por
si hay que devolverle al cliente su propio archivo con los precios llenos. Eso no se puede
reconstruir después.

## Notas

- **Puerto 3100**, para no chocar con el ERP.
- **`data/catalogo.db` no se versiona.** Se reconstruye con `npm run sync`.
- Las credenciales del `.env.local.example` son las de la instancia de **pruebas**. Producción es
  el `:3000` de la misma máquina, donde estos endpoints solo existen después de un build y un
  `pm2 restart`.
