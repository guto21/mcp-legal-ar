# REPORTE DE REPARACIONES - mcp-legal-ar
**Fecha:** 10/06/2026 | **Base:** REPORTE_TESTING_MCP_LEGAL_AR.md (9/6) + resumen de sesion anterior
**Archivos tocados:** `servers/legal-mcp/build/{index,infoleg,juba,bopba,ptn,bora,tfn,normativapba}.js` + `scripts/smoke-test-fixes.mjs`

> ⚠️ **Los cambios requieren reiniciar el MCP** (cerrar y reabrir Claude Desktop o recargar el conector). Los procesos en memoria siguen corriendo el codigo viejo.

---

## 1. JUBA::info - Error -32602 (CRITICA) ✅
**Causa real (no era de JUBA):** el gateway `index.js` expone `juba_info` como `juba__info` via `stripInternalPrefix` (strip destructivo), pero `callTool` reconstruia el nombre original con `slice()` y reenviaba `info` al hijo → -32602.
**Fix:** mapa `toolNameMap` (nombre expuesto → nombre original) poblado en `initialize()` y consultado en `callTool()`. Corrige de paso cualquier tool futura cuyo nombre interno empiece con el prefijo del conector.

## 2. InfoLEG 403 / ban de IP (CRITICA) ✅ workaround completo
Verificado en esta sesion desde una red distinta:
- `servicios.infoleg.gob.ar` API v2.0: **muerta de verdad** (cuerpo vacio tambien desde IP no baneada).
- `argentina.gob.ar/normativa/nacional/{id}` y `/{id}/texto`: **server-rendered con texto completo** (probado con id 296831 → Decreto-Ley 1311/56 integro, y 296846 → Ley 27.401 con sus 40 articulos). Mismo espacio de IDs que InfoLEG, host distinto al baneado.
- Los listados de busqueda y boletin de argentina.gob.ar renderizan por JS (confirmado: el HTML estatico trae solo el formulario).

**Fixes en `infoleg.js`:**
- Nuevo `fetchTextoFromArgentinaGobAr(id, tipoTexto)`: descarga el texto desde argentina.gob.ar, valida que no sea la ficha resumen ni pagina de bloqueo, extrae el cuerpo y recorta menues. Insertado como **Intento 3** de `fetchCleanText` (antes de los intentos Puppeteer contra el host baneado). Si se pidio `actualizado`, devuelve el original con **advertencia explicita** y link a `/normas-modifican` para verificar reformas.
- `obtener_texto_norma` muestra la advertencia cuando aplica.
- **Buscador ciego reparado sin conocer el endpoint JSON:** `searchNormativaOfficial` y `fetchBoletin` ahora renderizan la pagina con Puppeteer (la SPA dispara su propio XHR) cuando el HTML estatico viene vacio, y parsean el DOM resultante (tabla + fallback de anchors a `/normativa/nacional/...-{id}`). Beneficia a `buscar_normativa_avanzada`, `buscar_norma_por_tipo_numero_anio`, `buscar_normas_por_dependencia`, `consultar_boletin_por_*`, `buscar_en_sumario_boletin` y al fallback de `buscar_normativa`.
- `obtener_metadatos_norma`: con `idNorma` va directo a la ficha deterministica `argentina.gob.ar/normativa/nacional/{id}` (server-rendered), sin pasar por el buscador.
- `alcance_fuente` documenta la nueva cadena.
- `index.js`: timeout del conector infoleg subido a 90s (la cadena con Puppeteer no entraba en los 20s por defecto → habria devuelto timeout aunque el fallback funcionara).

## 3. BOPBA::detector_plazos_edictos - crash 'verbosity' (MEDIA) ✅
**Causa:** API de `pdf-parse` v2.4.5 mal usada: `new PDFParse()` sin opciones + `parser.parse(buffer)`. El constructor exige `{ data }` y el metodo es `getText()`; pdfjs recibia `undefined` y moria leyendo `.verbosity`.
**Fix:** corregido en los 3 usos de `bopba.js` (`actualizar_tasas`, `descargar_seccion`, `detector_plazos_edictos`).

## 4. BOPBA::ver_seccion - campos vacios (MEDIA) ✅
La pagina `/ver` renderiza por JS. Fix: `link_descargar` ahora se construye siempre con la convencion deterministica `/secciones/{id}/descargar` (la misma que usa `descargar_seccion`); mas selectores para el titulo; y si el HTML no aporta vista previa, se extrae la primera pagina del PDF con el parser ya reparado.

## 5. Detectores de plazos PTN y BOPBA - falsos negativos (MEDIA) ✅
Tres bugs compartidos: (a) regex de fechas con flag `/g` reutilizada con `.test()` → `lastIndex` sucio salteaba parrafos; (b) `\d+\s+(días?\s+(habiles|corridos)?|...)` exigia espacio despues de "días" → "10 días." nunca matcheaba, y "habiles" estaba sin tilde; (c) cero cobertura de formatos forenses reales.
**Fix:** set curado de patrones que cubre "diez (10) días hábiles", plazos en letras, "dentro del plazo", "contados desde la notificación", "bajo apercibimiento", "perentorio/improrrogable/fatal", prorroga, suspension/interrupcion de plazo, fechas en letras ("1° de marzo de 2026") y "a más tardar". Se eliminaron los ~85 patrones de relleno ("plazo de castigo", "plazo de estadía") que solo generaban ruido. Dedupe de etiquetas e higiene de `lastIndex`.
Nota: el caso del reporte ("facultades delegadas") correctamente da 0 - esa frase no contiene plazo.

## 6. JUBA::obtener_sentencia - stub vacio (MEDIA) ✅
`fetchJubaDocument` valida ahora: sin ningun metadato y con texto neto trivial (sin rotulos) → error explicito "Fallo no encontrado en JUBA" con indicacion de verificar el ID por busqueda.

## 7. NormativaPBA::mapa_normativo_tema (BAJA) ✅
`q[phrase]` con una palabra daba 0. Fix: frase exacta primero y, si el mapa queda vacio, reintento automatico con `q[with_some_words]` (el parametro de `buscar_normativa`, verificado con 31k resultados). El encabezado informa el modo usado.

## 8. BORA::obtener_sumario_del_dia - truncamiento (BAJA) ✅
Paginacion real: parametros `seccion`, `pagina`, `items_por_pagina` (default 50, max 200). Informa total de avisos, pagina X de Y, rango mostrado y la llamada para la pagina siguiente. Errores por seccion se reportan aparte.

## 9. TFN::buscar_resolucion_por_expediente (BAJA) ✅
Acepta `expediente` como alias de `numero_expediente`; si faltan ambos devuelve mensaje claro en vez del -32602 criptico.

---

## BATERIA DE PRUEBAS (tras reiniciar el MCP)

1. `node scripts/smoke-test-fixes.mjs` - sintaxis + fallback argentina.gob.ar + buscador Puppeteer.
2. `juba__info` → debe devolver la ficha de capacidades (antes -32602).
3. `juba__obtener_sentencia` con id `999999` → error explicito, no stub.
4. `bopba__detector_plazos_edictos` con id de seccion vigente → sin crash 'verbosity'.
5. `bopba__ver_seccion` id vigente → `link_descargar` poblado y vista previa del PDF.
6. `ptn__detector_plazos_dictamenes` con texto: "Debera expedirse dentro de los diez (10) días hábiles contados desde la notificación, bajo apercibimiento de caducidad." → debe detectar 5+ indicadores.
7. `infoleg__obtener_texto_norma` id `296831`, tipoTexto `original` → Decreto-Ley 1311/56 via argentina.gob.ar aunque siga el ban.
8. `infoleg__buscar_normativa` "locacion de obra" → resultados via render Puppeteer.
9. `bora__obtener_sumario_del_dia` con `items_por_pagina: 30` → paginado.
10. `normativapba__mapa_normativo_tema` tema "educación" → mapa poblado (modo palabras clave).

## RONDA 2 (post-testing en vivo del 10/6)

**JUBA::obtener_sentencia (FAIL → corregido).** El stub real del id 999999 trae ~250 caracteres de chrome de UI ("VISUALIZACION DEL TEXTO COMPLETO... Imprimir Descargar...") que superaban el umbral de 100. La heuristica ahora elimina todos los rotulos y botones (lista completa capturada del stub real) y ademas exige marcadores de contenido juridico (VISTOS/CONSIDERANDO/RESUELVE/etc.) cuando no hay metadatos.

**InfoLEG::buscar_normativa resultados irrelevantes (PARCIAL → corregido).** Los 3 "resultados" eran los destacados de "novedades normativas" de la landing de argentina.gob.ar (slug /norma-{id}): el parametro texto se ignora en el HTML estatico y el escaneo de anchors los levantaba como si fueran resultados, bloqueando el fallback Puppeteer. Ahora el HTML estatico solo se acepta si trae la tabla de resultados real; el escaneo de anchors corre unicamente sobre la pagina renderizada y excluye el patron /norma-{id} de los destacados.

**NormativaPBA::mapa_normativo_tema (FAIL → corregido).** Diagnostico en vivo contra normas.gba.gob.ar: el filtro server-side q[terms][raw_type] esta roto en el sitio (0 resultados con 'ley', 'Ley' y 'LEY'; el campo existe porque filtra, pero ningun valor del indice matchea), mientras q[terms][number] y [year] funcionan (verificado: number=14744 → Ley 14744). Fix: busqueda sin filtro de tipo + clasificacion local por el slug del enlace (/ar-b/ley/, /ar-b/decreto/, etc.), recorriendo hasta 4 paginas o 5 normas por jerarquia. El mismo fix se aplico a buscar_normativa (su parametro tipo_norma arrastraba el bug y filtra ahora localmente, con nota en la salida).

**Re-test tras nuevo reinicio del MCP:**
- `juba__obtener_sentencia` id 999999 → "Fallo no encontrado en JUBA".
- `infoleg__buscar_normativa` "locacion de obra" → o resultados pertinentes via Puppeteer, o error/0 honesto (nunca mas novedades ajenas). Si da 0: capturar el XHR real del buscador con DevTools (F12 → Network → buscar en la pagina) y pasarme la URL.
- `normativapba__mapa_normativo_tema` tema "educación" → mapa con leyes/decretos/resoluciones/disposiciones.
- `normativapba__buscar_normativa` palabras_clave "educación" + tipo_norma "ley" → solo leyes.

## RONDA 3 (re-test del 10/6, tarde)

Resultado del re-test: JUBA ✅, NormativaPBA mapa ✅, NormativaPBA buscar con tipo ✅. InfoLEG buscar_normativa seguia reportando el 403 del WAF.

**Causa raiz encontrada: Puppeteer no esta instalado.** Figura en `servers/legal-mcp/package.json` (`"puppeteer": "^25.1.0"`) pero `node_modules/puppeteer` no existe en ningun nivel del repo. TODOS los fallbacks de render JS (incluidos los de la sesion anterior) venian fallando en silencio con ERR_MODULE_NOT_FOUND; el unico error visible quedaba siendo el 403 del Solr.

Fixes de codigo: el import de Puppeteer ahora lanza un error explicito con la solucion; `searchNormativaOfficial` y `fetchBoletin` propagan la causa del render fallido en vez de devolver un falso "0 resultados"; `buscar_normativa` reporta el error del fallback junto al del Solr.

**Accion requerida (una sola vez):**
```
cd C:\Users\Ximena\mcp-legal-ar\servers\legal-mcp
npm install
```
(Descarga Chrome para Puppeteer, ~150-200 MB; puede tardar varios minutos.) Luego reiniciar Claude Desktop y re-probar `infoleg__buscar_normativa` "locacion de obra". Si con Puppeteer instalado da 0 o irrelevantes, la SPA no auto-ejecuta la busqueda desde la URL: capturar el XHR real con DevTools (F12 → Network → buscar en la pagina) y pasar la URL del request.

## RONDA 4 (re-test del 10/6, noche)

Estado: JUBA ✅, NormativaPBA ✅✅. InfoLEG sigue en 403 pero con dato nuevo decisivo: **el navegador del usuario ya accede a servicios.infoleg (407.805 resultados para "locacion de obra") → el ban de IP expiró**. El 403 que persiste contra el MCP es fingerprinting del WAF (axios sin JS), exactamente el caso que cubre el fallback Puppeteer... que sigue sin poder ejecutarse porque **`npm install` aún no se corrió** (verificado: `node_modules/puppeteer` no existe).

Mejoras de esta ronda:
- `searchCentralSolr`: el motivo del fallo de Puppeteer ahora viaja en el mensaje de error visible (antes solo consola).
- `buscar_normativa`: nuevo parámetro `fraseExacta` (true → envía el criterio entre comillas al Solr de InfoLEG). Responde al ruido detectado: "locacion de obra" suelto matchea cada palabra en cualquier parte del texto (designaciones, MERCOSUR, edificación, etc.).

**Acción pendiente (la misma de Ronda 3, es el único gate):**
```
cd C:\Users\Ximena\mcp-legal-ar\servers\legal-mcp
npm install
```
Reiniciar Claude Desktop y probar `infoleg__buscar_normativa` con criterio "locacion de obra" y `fraseExacta: true`. Captura de DevTools: solo si tras instalar Puppeteer persiste el 403 (improbable, dado que el ban expiró y Puppeteer presenta huella de Chrome real).

## RONDA 5 (cierre) - EL BUSCADOR NACIONAL RESUELTO

Hallazgo definitivo (del HTML crudo del formulario): el buscador de argentina.gob.ar/normativa NO es una SPA con XHR. Es un form Drupal `method="POST"`: los resultados se renderizan server-side solo en la respuesta del POST; todo GET devuelve el formulario vacio. Por eso el parser veia 0 y Puppeteer tampoco ayudaba.

Protocolo implementado en `searchNormativaViaPost` (via primaria de `searchNormativaOfficial`):
1. GET /normativa → extraer `form_build_id` fresco.
2. POST /normativa?{limit,offset} con campos: s=1, jurisdiccion, tipo_norma (slugs plurales: leyes/decretos/decretos_ley/...), numero, anio, dependencia, publicacion_desde/hasta, texto, `tarro_de_miel` VACIO (honeypot anti-bot), form_build_id, form_id=infoleg_normativa_search_form. Sin captcha en este form.
3. Reglas del form replicadas: tipo "leyes" no admite anio (se omite con aviso; filtrar leyes por numero); dependencia se ajusta a la opcion oficial del select por matching insensible a tildes/mayusculas.

Verificacion final (test-busqueda-post.mjs en maquina del usuario):
- "locacion de obra" texto libre → 407.808 normas, 50 devueltas via POST ✅ (mismo conteo que el navegador)
- Ley 27430 con anio 2017 → omite anio, devuelve exactamente Ley 27430 (id 305262) ✅
- Leyes + dependencia "Ministerio de Trabajo" → 0 correcto (las leyes emanan del Congreso, no de ministerios; conjunto vacio por definicion)

Estado final del modulo InfoLEG:
- Busquedas nacionales: ✅ via POST a argentina.gob.ar (sin tocar el host baneado, sin Puppeteer)
- Texto por ID: ✅ via argentina.gob.ar/{id}/texto (original; actualizado con advertencia mientras dure el ban)
- servicios.infoleg.gob.ar: sigue baneado para trafico automatizado de esta IP (tambien a Puppeteer); el buscador clasico Solr y texact.htm vuelven solos cuando el WAF levante el ban, porque siguen primeros en la cadena de intentos.

## RONDA 6 - TEXTO CONSOLIDADO Y CODIGOS TRONCALES

Disparador: en otra sesion, "buscar el art. 1 del Codigo Penal" fallo por buscador (texto libre entierra los codigos bajo normas recientes) y la respuesta cito el TEXTO ORIGINAL de 1921 (2 incisos) cuando el art. 1 vigente tiene un inciso 3° incorporado por Ley 27.401. Riesgo de cita erronea real.

Dos mejoras:
1. **Texto consolidado via argentina.gob.ar:** se descubrio y verifico que `/normativa/nacional/{id}/actualizacion` sirve el TEXTO ACTUALIZADO server-rendered con notas de reforma articulo por articulo (verificado con el Codigo Penal id 16546). `fetchTextoFromArgentinaGobAr` ahora intenta /actualizacion primero cuando se pide "actualizado" y solo cae al original (con advertencia) si la norma no tiene consolidado. El ban de servicios.infoleg ya no cuesta el texto vigente.
2. **Tool nueva `localizar_codigo`:** resuelve el ID InfoLEG de los codigos troncales sin pasar por el buscador. IDs verificados uno por uno contra la fuente (10/6/26): Codigo Penal = Ley 11.179, id 16546; CCyC = Ley 26.994, id 235975; LCT = Ley 20.744, id 25552; CPCCN = Ley 17.454, id 16547; Codigo Aduanero = Ley 22.415, id 16536. La descripcion instruye al agente a usarla antes que buscar_normativa para cualquier codigo.

Re-test tras reiniciar: pedir "art. 1 del Codigo Penal segun InfoLEG" → debe usar localizar_codigo → obtener_texto_norma 16546 actualizado → art. 1 con TRES incisos y nota de sustitucion por Ley 27.401.

## RONDA 7 - PJN REACTIVADO (HITL) + README

Decision: reactivar PJN Consulta y PJN Jurisprudencia. El codigo ya tenia el patron correcto y compatible: `iniciar_hitl_browser` abre Chromium visible (headless:false), el USUARIO resuelve el reCAPTCHA a mano, `finalizar_hitl_browser` cosecha cookies+userAgent de la sesion ya validada. No hay OCR ni bypass automatizado; la verificacion humana la hace una persona. Las demas tools reciben el captchaToken obtenido por esa via.

Cambios:
- `index.js`: descomentados los conectores `pjn` y `pjnjuris` (el comentario "reCAPTCHA obligatorio" estaba obsoleto; el flujo HITL lo cubre de forma compatible). Sintaxis verificada; pjn=16 tools, pjnjuris=20.
- `README.md`: 8 → 10 conectores operativos. Diagrama de arquitectura, lista de fuentes, creditos y nota de seguridad actualizados. Nueva subseccion "Como usar PJN (CAPTCHA manual)". SAIJ queda como unico pendiente (403 anti-bot; posible fallback de host).

Linea mantenida (inmodificable): NO se incorpora ninguna solucion de resolucion/evasion automatizada de CAPTCHA, sea propia, no-publica o "que cumpla medidas de seguridad". El repo sigue 100% open source y auditable porque la unica via de captcha es HITL (humano resuelve), que ya vive en el codigo abierto.

Pendiente real unico: SAIJ (mismo patron 403 que tenia InfoLEG; evaluar fallback de host alternativo en otra sesion).

## RONDA 8 - PJN CONSULTA REESCRITO (HITL v2, busqueda dentro del navegador)

Disparador: la 2da revision (ver comentario historico en index.js) confirmo que las tools de Voftec eran scaffold puro: POSTeaban campos inventados ("modo", "criterio", "party_name") por axios sin cookies a home.seam (app JSF/Seam) → siempre 0 resultados, falso negativo peligroso. Camino 1 (portar) descartado: no habia nada funcional que portar. Se ejecuto el Camino 2.

**Captura en vivo (mano a mano con el usuario):** `scripts/pjn-capture.mjs` (nuevo) abre Chromium, el usuario resuelve el captcha y navega; el script vuelca DOM + trafico a `_capturas/pjn-capture-*.json`. Hallazgos verificados el 10/6:
- El captcha NO es Google reCAPTCHA: es servicio propio del PJN (captcha.pjn.gov.ar, sitekey "SCW", dialog PrimeFaces, token al hidden `captcha-response`). El campo `g-recaptcha-response` del codigo viejo no existe en el portal.
- Form real `formPublica`: `expedienteTab-value` (porExpediente|porParte), selects `camaraNumAni`/`camaraPartes` (28 jurisdicciones CSJ..FTU, value numerico posicional), `numero`, `anio`, `tipo`, `nomIntervParte`, botones `buscarPorNumeroButton`/`buscarPorParteButton` + ViewState.
- Flujo: POST home.seam → resultados en `consultaParte.seam?cid=N` (tabla Expediente|Dependencia|Caratula|Situacion|Ult.Act., link por fila con ids `j_idt*` DINAMICOS) → `expediente.seam` (detalle + tablas Fecha|Movimiento y OFICINA|FECHA|TIPO|DESCRIPCION|A FS.).
- Limite del portal publico anonimo: busqueda por parte solo tipo DEMANDADO.

**Reescritura `build/pjn.js` (v2.0.0):** toda la interaccion corre DENTRO de `globalPage` (sesion HITL viva); cero POSTs cookieless; ids `j_idt*` nunca hardcodeados (la fila se ubica por la tabla de resultados); jurisdiccion resuelta matcheando el texto de la opcion (tolera reordenamientos). Tools: `iniciar_hitl_browser`, `estado_hitl` (nuevo), `finalizar_hitl_browser` (ahora SOLO cierra; ya no "cosecha cookies", que era inutil), `consultar_expediente` (jurisdiccion+numero+anio), `pjn_buscar_expediente_por_parte`, `obtener_resultados` (post-captcha), `abrir_expediente`, `obtener_actuaciones`, `pjn_obtener_resoluciones_expediente`, `volver_a_resultados`, `exportar_expediente`, `generar_certificacion_forense` (hash SHA-256 del HTML de la pagina abierta), `detector_plazos_judiciales` (regexes curadas, mismo criterio que ronda 5), `alcance_fuente`. Capacidades que el portal NO ofrece quedan como stubs honestos con error explicativo (busqueda semantica, relacionados, reparacion historica, gestion documental, descarga de PDFs).

Si aparece el captcha en medio de una busqueda, la tool devuelve "CAPTCHA PENDIENTE", el usuario lo resuelve en la ventana (el form se autosubmite) y se sigue con `obtener_resultados`.

`index.js`: conector pjn rehabilitado; timeout pjn 30s → 90s (arranque de Chromium + settle). pjnjuris sigue deshabilitado (mismo problema de scaffold; pendiente de identica reescritura en sesion dedicada).

Linea inmodificable mantenida: ninguna resolucion/evasion automatizada de captcha; unico camino HITL.

**Verificacion en vivo (10/6, tras primer reinicio):**
- `iniciar_hitl_browser` ✅ y `consultar_expediente` CIV 33004/2026 ✅: trajo el expediente real (caratula, JUZGADO CIVIL 109, EN LETRA, 13 actuaciones completas). Hallazgo: con RESULTADO UNICO el portal saltea consultaParte.seam y va directo a expediente.seam; el codigo esperaba solo la lista y reportaba timeout (aunque la busqueda funcionaba). FIX: `settle` acepta multiples URLs destino y `ejecutarBusqueda` scrapea el detalle directo con la nota "resultado unico".
- `obtener_actuaciones` ✅ (mismo expediente). FIX menor: se filtran las tablas plantilla vacias (Fecha|Movimiento con solo headers).
- `pjn_buscar_expediente_por_parte` ✗ en primer intento: el click generico en la solapa no llegaba al handler RichFaces. FIX: ids semanticos estables descubiertos en la captura (`formPublica:porExpediente|porParte|porRH:header:inactive`); `activarTab` usa la API `RichFaces.component("formPublica:expedienteTab").switchToItem(...)` con fallback al click en el header inactivo.
- Hallazgo adicional: las actuaciones SI exponen enlaces "Descargar"/"Ver" en la consulta publica → la descarga de PDFs es implementable en una proxima iteracion (stub actualizado para reflejarlo).
- Captcha: en esta sesion el portal no lo exigio; el circuito CAPTCHA PENDIENTE → resolver → obtener_resultados queda sin ejercitar.

**Re-test del usuario en otra sesion (con el codigo del PRIMER reinicio): fallo el circuito captcha.** Sintoma: el usuario resolvio el captcha 2 veces "y no pasa nada". Causas encontradas (ambas del conector, no del portal):
1. Cada reintento de busqueda hacia `irAHome` → recargaba la pagina y ANULABA el captcha recien resuelto (circulo vicioso agente-reintenta / usuario-resuelve).
2. `obtener_resultados` solo aceptaba consultaParte.seam: con resultado unico el post-captcha cae en expediente.seam y la tool lo rechazaba como error.

FIX (flujo propuesto por el usuario): nueva tool `continuar_tras_captcha` que espera la navegacion SIN tocar la pagina y scrapea lista o expediente segun donde caiga; `consultar_expediente`/`por_parte` se NIEGAN a relanzarse si hay captcha visible (guard `bloqueoPorCaptcha`); `obtener_resultados` ahora relee cualquiera de las dos paginas; el aviso CAPTCHA PENDIENTE instruye explicitamente: usuario resuelve → avisa "listo" → `continuar_tras_captcha`, nunca relanzar.

**2do re-test del usuario: el captcha aparece YA AL CARGAR la home, antes de cualquier busqueda.** El conector no contemplaba ese momento: el agente busco igual y el aviso llego tarde. FIXES:
- `iniciar_hitl_browser` espera 1,5s, detecta el captcha inicial y avisa ANTES de que el agente busque.
- `irAHome` ya no recarga si la pagina actual es home.seam (la recarga tiraba la verificacion recien resuelta).
- `bloqueoPorCaptcha` ahora devuelve mensaje informativo (no error) con instruccion contextual: captcha en home → resolver y RELANZAR la misma busqueda (el form se conserva); captcha con busqueda en vuelo → `continuar_tras_captcha`.

**3er re-test del usuario:** `consultar_expediente` CIV 33004/2026 ✅ SIN TIMEOUT (resultado unico resuelto). `pjn_buscar_expediente_por_parte` ✗ timeout, y el aviso del captcha inicial sigue llegando tarde. Diagnostico: (a) el detector de captcha solo miraba .ui-dialog/.modal/[role=dialog]; si el modal del PJN no matchea, `settle` espera 30s y reporta timeout en vez de CAPTCHA PENDIENTE; (b) el modal inicial tarda mas de 1,5s en aparecer (roundtrip a captcha.pjn.gov.ar). FIXES:
- `captchaVisible` ampliado: + .rf-pp-cntr (RichFaces popupPanel), iframes/divs/imgs con 'captcha' en src/id/class (el hidden #captcha-response no matchea porque es invisible).
- `iniciar_hitl_browser`: espera inicial 1,5s → 4s antes de chequear el captcha.
- Mensaje de timeout de busqueda: instruye preguntar al usuario si hay captcha visible y, en su caso, resolver → 'listo' → `continuar_tras_captcha`, sin relanzar.

**4to re-test del usuario: deadlock "Desafio aprobado".** El aviso previo a la busqueda YA funciono (iniciar_hitl_browser aviso el captcha inicial y espero el "listo"). Pero el widget del captcha del PJN QUEDA VISIBLE en pantalla con el texto "Desafio aprobado" - no se cierra solo. El detector lo seguia contando como pendiente → el candado anti-relanzamiento bloqueaba todo → loop de "resolvelo de nuevo" con el usuario repitiendo que ya estaba aprobado. FIXES:
- Nuevo `estadoCaptcha`: "no" | "pendiente" | "aprobado". Senal confiable de aprobacion: token poblado en el hidden #captcha-response (visto en la captura de red); fallback: texto "Desafio aprobado/verificado" en el widget.
- `captchaVisible` (lo que bloquea/avisa) ahora solo es true con estado "pendiente".
- Auto-reenvio en `ejecutarBusqueda`: si hay timeout con captcha "aprobado", re-clickea el boton de busqueda una vez (el form conserva datos y token) y vuelve a esperar. Cubre el caso "resolvio el captcha pero el submit original se perdio" sin intervencion del usuario.
- `continuar_tras_captcha`: con "aprobado" + pagina en home, instruye relanzar la busqueda (sin recarga, el token se conserva).
- Mensajes: "avisame cuando este (con un ok alcanza)" y aclaracion de que 'Desafio aprobado' visible = resuelto.

**5to re-test del usuario: ✅ VERIFICACION COMPLETA.**
- Aviso de captcha → "ok" → `pjn_buscar_expediente_por_parte` CIV "gomez pablo" → 15 resultados.
- `abrir_expediente` fila 1 → CIV 028526/2026 con detalle real (caratula, situacion EN LETRA, acuerdo homologado, apelacion por honorarios).
- `consultar_expediente` CIV 33004/2026 (resultado unico) ya habia dado ✅ sin timeout en el re-test anterior.
- Un solo captcha por sesion en este flujo; el circuito aprobado/auto-reenvio funciono sin intervencion extra.

PJN CONSULTA: OPERATIVO. Ajuste cosmetico final: la descripcion de `iniciar_hitl_browser` instruye al agente a avisar ANTES de abrir la ventana (la ventana siempre va a abrirse antes de que el mensaje del tool llegue; el aviso previo lo da el agente).

Mejoras futuras anotadas (no bloqueantes): descarga de PDFs de actuaciones (el portal expone 'Descargar'/'Ver'); solapa Reparacion Historica; paginacion de resultados >15 si aparece un caso real que la requiera.

## RONDA 9 - SAIJ REPARADO + PJN JURISPRUDENCIA REESCRITO (camino a los 11)

### SAIJ (conector 10) ✅ fix aplicado, pendiente re-test
- `scripts/saij-probe.mjs` (nuevo) probo 4 vias desde la maquina del usuario: **el 403
  anti-bot YA NO EXISTE** (axios pelado llega al servidor). Lo que quedaba era un 500
  identico en las 4 vias = consulta malformada, no bloqueo.
- Captura del trafico real del buscador (`_capturas/captura-www-saij-gob-ar-*.json`):
  el termino viaja en **`r`** (rawQuery), NO en `s` como asumia el codigo de Joaquin.
  Formato: `r="+titulo: despido"`, `r="+tema:despido"`, frases con `?` entre palabras
  (`despido?por?riña`); `s` vacio; `f` facetas; `o`/`p` paginacion; `v=colapsada`.
- Fix en `servers/saij-mcp/build/services/search-service.js` (`buildRawQuery` + `searchRaw`)
  y manejo explicito del 500 en `api-client.js`. Conector habilitado en `index.js`
  (via wrapper `legal-mcp/build/saij.js`).

### PJN Jurisprudencia (conector 11) ✅ reescrito, pendiente re-test
- El host del scaffold (`scw.pjn.gov.ar/scw/api/jurisprudencia`) NO existe. Portal real:
  **https://sj.pjn.gov.ar/consulta/** (Sistema de Jurisprudencia del Consejo de la
  Magistratura; el dominio jurisprudencia.pjn.gov.ar da ERR_CONNECTION_TIMED_OUT).
- API capturada en vivo (`_capturas/captura-sj-pjn-gov-ar-*.json`):
  GET `/api/public/camaras`, `/magistrados/search-all`, `/oficinas/search-all` (libres);
  POST `/api/public/sumarios/search?page&sort=fallo.fecha,DESC&tokenCaptcha=T` con body
  JSON rico (busquedaGeneralKeywords, camaraCarga, fallo.expediente, fechas) -> sin token
  da 400; GET `/api/public/sumarios/{id}` para el detalle. Los resultados ya incluyen el
  texto del sumario. Captcha propio (sitekey JURISPRUDENCIA), token en hidden #captcha-response.
- `build/pjnjuris.js` v2.0.0: todas las llamadas via fetch DENTRO de la pagina HITL
  (cookies anti-bot TSPD + token). Tools: iniciar/estado/finalizar HITL, listar_camaras,
  listar_magistrados, buscar_jurisprudencia_fed, pjn_buscar_sumarios, por_expediente,
  por_caratula, obtener_sumario, exportar_fallo, certificacion forense (hash del JSON),
  detector de plazos; stubs honestos para CSJN, PDF, guia judicial, concursos, estadisticas.
  Habilitado en index.js; timeout 60s -> 90s.

### Extras de la ronda
- LICENSE SCBA cerrado en THIRD_PARTY_NOTICES (el repo NO tiene archivo LICENSE; la
  declaracion MIT esta en el README del autor - documentado tal cual).
- Hallazgo comunitario: marketplace hernan-cc/claude-plugins (saij/csjn/juba/juscaba
  via uvx + skill judicial-recon). JusCABA anotado como posible conector 12.

### Re-test SAIJ (en vivo, 2da iteracion) — afinado del rawQuery
- 1er intento del fix daba 0 en multipalabra: el texto libre se expandia server-side
  a `contenido:` (campo MUERTO en el indice) y la frase con `?` incluia stopwords
  ("locacion?de?obra") que no estan indexados y rompen el match.
- Verificado uno por uno: `+titulo:despido` ✅, `+texto:despido` ✅, `+texto:locacion` ✅,
  `+texto:locacion?de?obra` ✗ (0). Fix definitivo de `buildRawQuery`: sin campo →
  `texto:`; multipalabra → AND de `+campo:palabra` por termino, descartando stopwords
  (de, la, el, en, por...). SAIJ OPERATIVO.

### PJN Jurisprudencia — captcha de un solo uso, rediseño del flujo
Hallazgo en vivo (re-test del usuario): el captcha NO esta en el formulario; aparece
DESPUES de apretar "Buscar", y la propia app lo consume en su POST (token de un solo
uso). Por eso reintentar la busqueda desde el conector siempre daba CAPTCHA PENDIENTE:
el token ya estaba gastado. Rediseño: en vez de pelear por el token, se intercepta
`window.fetch` (instalado en iniciar_hitl_browser e irAlBuscador) y se guarda la
ultima respuesta de `/sumarios/search` y de `/sumarios/{id}` que dispara la propia
pagina. Nueva tool `leer_resultados` devuelve lo que el portal ya entrego;
`obtener_sumario` usa primero el detalle interceptado. El usuario hace la busqueda
normal en la ventana (incluido el captcha) y el conector lee el resultado.

### pjnjuris - `buscar_asistido` (division de trabajo propuesta por el usuario)
Feedback del usuario: que el conector complete la busqueda y el solo ponga el captcha.
Nueva tool `buscar_asistido` {texto}: encuentra el campo de busqueda visible en la SPA
(heuristica por placeholder/aria-label; setter nativo + eventos input/change para que
Angular lo registre), clickea "Buscar" por texto del boton, y espera hasta 70s mientras
el usuario resuelve el captcha; el interceptor de fetch captura la respuesta y la tool
la devuelve en la misma llamada. Requisito: el usuario para una vez en la seccion
(camara/tipo) antes de llamar. Fallback: `leer_resultados`.

### pjnjuris - SOLUCION DEFINITIVA: captcha inyectado (independiente de la SPA)
Problema final: la SPA Angular de sj.pjn.gov.ar a veces renderiza VACIA bajo Puppeteer
(la ruta #/pages/seleccionar-camara queda en blanco), entonces no hay formulario ni
boton ni widget de captcha que el usuario pueda usar. buscar_asistido fallaba ("no
encontre boton Buscar") porque no habia UI.

Diagnostico clave: `listar_camaras` SI devolvio las 28 camaras desde la ventana → el
anti-bot NO bloquea; el contexto del navegador (origen sj.pjn.gov.ar + cookies TSPD)
esta sano. Lo unico que necesita token es POST /sumarios/search.

Fix `preparar_captcha`: inyecta el widget oficial del PJN (init.js de captcha.pjn.gov.ar,
sitekey JURISPRUDENCIA) en un div propio (.pjn-captcha) flotante sobre la ventana, sin
depender de la UI del portal. El usuario resuelve ESE captcha → el widget puebla
#captcha-response → buscar_jurisprudencia_fed lee el token y dispara la busqueda por la
API. Mismo sitekey y origen que la app oficial: el server valida el token igual.

VERIFICADO EN VIVO (11/06... en realidad 10/06 noche): preparar_captcha → usuario
resolvio → buscar_jurisprudencia_fed "locacion de obra" CCF → **5 sumarios reales**
(Parques Nacionales c/ Antartida Seguros 2024, etc.) con expediente, fecha y texto.
PJN JURISPRUDENCIA OPERATIVO. SON LOS 11.

### Re-test rapido (tras cualquier reinicio)
1. `saij__saij_search_legislacion` "locacion de obra" → resultados (AND por termino) ✅ verificado.
2. `saij__saij_search_jurisprudencia` "daños punitivos" → resultados.
3. `pjnjuris__iniciar_hitl_browser` → `preparar_captcha` → usuario resuelve → `buscar_jurisprudencia_fed` texto+camara → sumarios ✅ verificado.
4. `pjnjuris__obtener_sumario` con un ID → texto integro.

## PENDIENTES / RIESGOS CONOCIDOS
- **No verificado en vivo:** que la SPA de argentina.gob.ar auto-ejecute la busqueda al cargar la URL con parametros bajo Puppeteer (el sandbox de esta sesion no podia correr node ni navegador). Si el test 8 da 0 resultados, el siguiente paso es capturar el XHR real con DevTools (pestaña Network al buscar) y pegarme la URL del request.
- El "texto actualizado" consolidado sigue dependiendo de `texact.htm` en servicios.infoleg (host baneado para tu IP): mientras dure el ban, las consultas `actualizado` devuelven el original con advertencia.
- El ban del WAF sigue vigente: moderar frecuencia de requests cuando expire.
- `juba__info` se expone con ese nombre por el strip de prefijo del gateway; el hijo la registra como `juba_info`. Con el fix del mapa ambas rutas resuelven bien.
