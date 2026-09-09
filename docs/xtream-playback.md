# Reproducción Xtream

## Diagnóstico

Los dos servidores facilitados responden a la API Xtream. Se comprobaron una
película y un episodio en cada servidor: lista maestra, lista de variante y primer
segmento de video, con respuestas HTTP 200 y CORS habilitado.

- El catálogo puede declarar `mp4`, aunque la ruta de reproducción entregue HLS.
  La extensión del archivo no basta para elegir el formato.
- Las rutas `https://xtream.internal/.../playlist/...` son ficticias. Interceptar
  `fetch` no las convierte en URLs accesibles para el elemento de video nativo,
  los cargadores XHR de HLS o los dispositivos externos.
- El interceptor de `/proxy/` volvía a llamar a `fetch` con otra ruta `/proxy/`,
  generando recursión. Además elegía el primer servidor guardado y podía alterar
  solicitudes de otros addons.
- El servidor devuelve `application/vnd.apple.mpegurl; charset=utf-8`. La versión
  instalada del reproductor compara el MIME de HLS sin parámetros. Algunos
  navegadores pueden reproducirlo de forma nativa, pero eso no resuelve las rutas
  ficticias ni garantiza que se active HLS.js en otros navegadores.
- Los enlaces de páginas embed no son archivos de video, aunque no terminen en
  `.html`. El servidor Render ya realiza la extracción de los enlaces probados.

## Corrección

La integración entrega al reproductor la URL HTTP real del servidor seleccionado.
Consulta el tipo de respuesta para identificar una opción de video. Si el
servidor no admite HEAD o no informa el MIME, comprueba una pequeña parte del
contenido y cancela la descarga de diagnóstico.

La respuesta HEAD de las rutas de video de los servidores instalados se entrega
al reproductor con un MIME normalizado. No se utiliza `proxyHeaders`: ese campo
hace que el núcleo dirija el video al servidor local de Stremio. Los cuerpos de
las listas y segmentos pasan por la red original sin transformaciones.

El addon conserva el contenedor y el identificador del episodio. Los enlaces
directos MP4/M3U8 del catálogo se consideran alternativas cuando falla el
resolver del servidor; las páginas embed no se ofrecen como videos.

Los metadatos del addon se sirven en el host virtual `xtream.internal`.
Las solicitudes de video, sus firmas y sus rangos pasan por la red original.
Las listas HLS no se reconstruyen: se conservan las variantes y las pistas de
audio/subtítulos del servidor. No se modifica el código del reproductor.

Cada addon responde únicamente a sus propios identificadores, incluso si su
manifiesto instalado todavía anuncia el prefijo antiguo `xc_`. Esto evita que
dos servidores instalados dupliquen las opciones de una misma película.
Para TV se comprueban hasta tres fuentes con el mismo nombre de canal y se
entrega una sola disponible; no se sustituye por otro canal de nombre diferente.

Los archivos de cada despliegue usan el identificador del commit de Vercel.
La actualización del service worker espera al flujo existente de confirmación
y recarga de la aplicación, evitando mezclar una página y un worker de versiones
distintas. Las pestañas abiertas con una versión anterior deben actualizarse.

## Verificación

```sh
pnpm exec jest tests/xtreamPlayback.test.js --runInBand
pnpm exec eslint src/routes/Addons/XtreamAddon/xtreamInterceptor.js src/routes/Addons/XtreamAddon/xtreamStreams.js src/workerInit.js
pnpm build
```

Las pruebas automáticas cubren HLS servido como MP4, MP4 real, HEAD no admitido,
identificación por contenido, cancelación de descargas de diagnóstico, rechazo
de HTML, firmas, selección del servidor, solicitudes nativas y episodios.

El cambio del frontend no repara enlaces eliminados, bloqueos de proveedores ni
errores de extracción del servidor. Las comprobaciones de red son muestras,
no una validación de todo el catálogo.
