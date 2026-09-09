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
Consulta el tipo de respuesta y lo comunica mediante el campo estándar
`behaviorHints.proxyHeaders.response['content-type']`. Si el servidor no admite
HEAD o no informa el MIME, comprueba una pequeña parte del contenido y cancela
la descarga de diagnóstico.

El addon conserva el contenedor y el identificador del episodio. Los enlaces
directos MP4/M3U8 del catálogo se consideran alternativas cuando falla el
resolver del servidor; las páginas embed no se ofrecen como videos.

Solo se interceptan las solicitudes de metadatos al host `xtream.internal`.
Las solicitudes de video, sus firmas y sus rangos pasan por la red original.
Las listas HLS no se reconstruyen: se conservan las variantes y las pistas de
audio/subtítulos del servidor. No se modifica el código del reproductor.

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
