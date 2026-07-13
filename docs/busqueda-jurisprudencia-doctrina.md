# Guía de búsqueda y uso profesional de mcp-legal-ar

Directiva metodológica para pasar de una pregunta jurídica a fundamento citable con los conectores del hub. El foco no es "encontrar algo que suene bien", sino el precedente o la doctrina que efectivamente sostiene el argumento, leído en la fuente y en condiciones de citarse.

Regla de integridad: no se cita lo que no se verificó contra la fuente. Un sumario o una carátula no alcanzan; se recupera y se lee el documento antes de llevarlo al escrito.

## 1. Mapa de fuentes del hub

Cada conector cubre un terreno. Elegir mal la fuente es la primera causa de una búsqueda pobre.

- **SAIJ** - la puerta de entrada más amplia. Jurisprudencia nacional y provincial, doctrina, legislación y dictámenes, con tesauro de voces. Útil para el mapa general y doctrina de autores nacionales. Tools: `saij_search_jurisprudencia`, `saij_search_doctrina`, `saij_search_legislacion`, `saij_search_dictamenes`, `saij_resolve_citation`, `saij_get_document`, `saij_get_related_documents`, `saij_suggest_terms`.
- **CSJN** - sumarios de la Corte Suprema (1994 a hoy). Para precedentes de máxima jerarquía (leading cases). Tools: `buscar_sumarios`, `obtener_documento`.
- **JUBA** - jurisprudencia de la Provincia de Buenos Aires (SCBA y cámaras), con búsqueda por voces y por fuero. Indispensable para litigio bonaerense. Tools: `buscar_jurisprudencia`, `buscar_jurisprudencia_avanzada`, `buscar_por_voces_juridicas`, `buscar_fallos_laboral`, `buscar_fallos_civil_y_comercial`, `buscar_fallos_penal`, `buscar_fallos_contencioso_administrativo`, `buscar_por_caratula`, `buscar_por_magistrado`, `obtener_sentencia`.
- **SCBA** - texto completo de sentencias y resoluciones de la Suprema Corte bonaerense, por organismo y fecha. Complementa a JUBA para el fallo íntegro. Tools: `listar_organismos`, `buscar_documentos`.
- **PTN** - dictámenes de la Procuración del Tesoro de la Nación. Doctrina administrativa de carácter directivo para los servicios jurídicos del Estado (Cuerpo de Abogados del Estado); no vincula a jueces ni a particulares. Tools: `buscar_dictamenes`, `buscar_por_doctrina`, `buscar_por_voz`, `obtener_dictamen_texto`.
- **TFN** - jurisprudencia del Tribunal Fiscal de la Nación (tributario y aduanero federal). Tools: `buscar_resoluciones_tfn`, `buscar_por_sumarios`, `obtener_resolucion_tfn`.
- **InfoLEG** - legislación nacional y federal, texto actualizado y vigencia. Estándar para el orden nacional; su cobertura de leyes provinciales es dispar e incompleta. Tools: `buscar_normativa`, `obtener_texto_norma`, `obtener_metadatos_norma`.
- **NormativaPBA** - legislación de la Provincia de Buenos Aires (leyes, decretos, códigos procesales y de fondo locales), con verificación de vigencia provincial. Única fuente válida para norma bonaerense. Tools: `buscar_normativa`, `obtener_texto_norma`, `obtener_articulo`, `verificar_vigencia`.

Criterio rápido de direccionamiento: materia federal/nacional y doctrina general -> SAIJ; máxima jerarquía federal -> CSJN; jurisprudencia PBA -> JUBA y SCBA; norma bonaerense -> NormativaPBA; administrativo nacional -> PTN; tributario/aduanero -> TFN; norma nacional vigente -> InfoLEG.

## 2. Método de búsqueda

### 2.1. Definir la cuestión y las voces

Antes de ejecutar llamadas, defino el problema jurídico en una frase y extraigo las voces conceptuales que lo describen. El lenguaje coloquial genera ruido; el vocabulario del tesauro trae precedentes pertinentes.

Uso `saij_suggest_terms` con un término tentativo para ver la indexación oficial, y `buscar_por_voces_juridicas` en JUBA cuando el caso es bonaerense.

- Incorrecto: "no me pagan el alquiler y rompieron la casa".
- Correcto: "resolución de contrato de locación por falta de pago" y "daños y perjuicios".

### 2.2. Buscar por voces y estructurar la estrategia

- **Doctrina como mapa inicial.** Cuando el encuadre es complejo, novedoso o dudoso, inicio con `saij_search_doctrina`. La doctrina ordena los elementos normativos y suele citar los fallos líderes, permitiendo saltar directo a los fallos específicos.
- **Jurisprudencia dirigida.** Aplico filtros estrictos desde la primera llamada con `saij_search_jurisprudencia` (jurisdicción, tribunal, materia, rango de fechas) o las herramientas de JUBA por fuero (`buscar_fallos_penal`, `buscar_fallos_civil_y_comercial`). Evito búsquedas abiertas que saturen la ventana de contexto.

### 2.3. Del sumario al fallo completo

Los resultados llegan como sumarios o abstracts. Sirven para descarte primario, jamás para fundar.

Cuando un sumario es pertinente, recupero el documento íntegro con `saij_get_document`, `obtener_documento` (CSJN), `obtener_sentencia` (JUBA) o `buscar_documentos` (SCBA). En la lectura del fallo verifico cuatro cosas:

- que el holding tenga simetría con lo que sugiere el sumario;
- si la postura es de la mayoría, una disidencia o un voto concurrente;
- qué es holding (razón de la decisión) y qué es obiter dictum, porque solo el holding funda;
- el estado de firmeza. Si el fallo de Cámara está recurrido por recurso extraordinario ante la SCBA o la CSJN, o corren los plazos de impugnación, el hallazgo se clasifica como criterio interpretativo y se explicita en el escrito; no se invoca como cosa juzgada ni doctrina consolidada.

Recién ahí el precedente entra como VERIFICADO.

### 2.4. Rastrear la familia del precedente

Un buen fallo no está aislado. Con `saij_get_related_documents` mapeo la trazabilidad: precedentes que cita, sentencias posteriores que aplican su doctrina y -clave- cualquier pronunciamiento que lo haya dejado sin efecto, modificado o matizado.

### 2.5. Verificar vigencia normativa y actualidad jurisprudencial

- **Norma nacional.** Si el fallo aplica ley federal o nacional, confirmo texto y vigencia con `obtener_texto_norma` u `obtener_metadatos_norma` en InfoLEG.
- **Norma provincial.** Si el caso tramita en PBA, verifico con `verificar_vigencia` y `obtener_texto_norma` en NormativaPBA. Si la norma es de otra provincia sin conector específico, el estado es NO VERIFICADO. No asumo vigencia provincial a partir de portales nacionales.
- **Evolución jurisprudencial.** Controlo que el criterio no haya sido superado por jurisprudencia posterior de la Corte Suprema o por fallos de unificación. En PBA, el rol de unificación lo cumple la doctrina legal de la SCBA (recurso de inaplicabilidad de ley). Nota: en la justicia nacional el fallo plenario obligatorio del art. 303 CPCCN fue derogado por la Ley 26.853 (2013); ya no es mecanismo vinculante vigente, así que no corresponde controlar contra "plenarios nacionales" posteriores.

Si detecto inconsistencia entre el fallo y la norma vigente, la información queda en estado CONFLICTO y se suspende su uso hasta resolución manual.

## 3. Cómo llevar el hallazgo al escrito

### Encadenar el fundamento (subsunción)

La estructura del escrito va de lo general y abstracto a lo particular y concreto:

```
[1. LA NORMA]          -> El artículo positivo, vigente y aplicable al caso.
       |
[2. LA DOCTRINA]       -> La interpretación dogmática de esa norma.
       |
[3. LA JURISPRUDENCIA] -> Cómo aplicaron los tribunales la norma a casos análogos.
       |
[4. LA SUBSUNCIÓN]     -> Por qué el caso real encuadra en esa línea.
```

Principio de supremacía legal: la jurisprudencia complementa e interpreta la ley, nunca la desplaza. Un escrito fundado solo en transcripciones de fallos, que omita anclar el reclamo en el texto legal positivo, adolece de debilidad estructural.

### Formalismo y precisión en la cita

- **Jurisdicción nacional/federal.** Carátula completa, tribunal de origen, sala si corresponde, fecha exacta, y datos de publicación oficial (tomo y página de Fallos de la CSJN, o el identificador provisto por el MCP).
- **Jurisdicción provincial (en especial PBA).** Es obligatorio e insustituible el Departamento Judicial de origen (ej. Cám. Civ. y Com. San Isidro, Sala I; Cám. Apel. Penal Mercedes, Sala II). Omitir la delimitación territorial rompe la trazabilidad: distintas cámaras departamentales pueden sostener criterios opuestos sobre la misma materia.
- **Calificación técnica.** El escrito discrimina si se cita el holding de la mayoría, un obiter dictum de alta relevancia, o un voto en disidencia (este último solo con fines ilustrativos o para proponer un cambio de jurisprudencia).

### Uso analítico de la doctrina

La doctrina de autores se incorpora para consolidar la interpretación de la norma. Se cita con apellido y nombre del autor, título de la obra o artículo, tomo/página, editorial y año. Los dictámenes de la PTN se buscan con `buscar_por_doctrina` o `buscar_por_voz`, atendiendo a su carácter directivo para los servicios jurídicos del Estado.

## 4. Gestión del riesgo y control de calidad

### Estados de confianza del borrador

| Estado | Criterio operativo | Acción requerida |
| --- | --- | --- |
| VERIFICADO | El dato (fecha, articulado, holding, nombres) fue extraído del documento fuente oficial, leído e integrado. | Apto para incorporación en el escrito definitivo. |
| REFERENCIA VERIFICADA / CONTENIDO NO LEÍDO | La cita existe y se confirmó su ficha (autor, título, carátula o número), pero el texto no se recuperó ni se leyó. Típico de doctrina de la que solo se tiene la ficha bibliográfica, o de un fallo ubicado sin acceso al texto íntegro. | No se usa como fundamento. Leer el texto completo antes de citar. |
| INFERIDO | Deducción o conclusión jurídica del modelo a partir del fallo, no afirmación explícita del tribunal. | Revisión humana obligatoria para convalidar el criterio. |
| NO VERIFICADO (PARCIAL) | Verificación degradada: una herramienta del MCP cayó y el dato se recuperó por una vía indirecta (por ejemplo, voces del tesauro tomadas de la doctrina porque `suggest_terms` no respondió). | Marcar la limitación en el borrador. Compulsa directa de lo que quedó sin confirmar. |
| NO VERIFICADO | Datos que no surgen de las herramientas del MCP, fallos sin acceso a texto completo, coincidencias de texto libre no leídas o no pertinentes, o normas provinciales sin conector. | Prohibido su uso como afirmación. Comprobación manual. |
| CONFLICTO | Dos o más fuentes oficiales devuelven datos contradictorios sobre la vigencia de una norma o de un fallo. | Bloqueo del argumento. Compulsa directa antes de avanzar. |

### Matriz de control de omisiones materiales

Un resumen se considera incompleto y baja a NO VERIFICADO si carece de alguno de estos elementos:

- identificación completa del tribunal, sala, juzgado y Departamento Judicial (en fueros locales);
- fecha exacta de la resolución y de sus notificaciones o publicación;
- certificación del estado de firmeza (inexistencia de recursos pendientes);
- objeto litigioso, plataforma fáctica y fundamento central (holding);
- prueba determinante que motivó la decisión;
- normas de fondo y forma que sirvieron de sustento;
- plazos procesales vigentes, vencimientos o cargas de las partes;
- disidencias o aclaraciones que limiten el alcance de la doctrina.

### Higiene procesal y soberanía digital

El procesamiento de información judicial con modelos de lenguaje exige proteger el secreto profesional. Antes de transferir cualquier PDF de expediente, demanda o contestación a la ventana de contexto, se anonimiza:

- nombres y apellidos de personas físicas (reemplazar por iniciales o "Actor/Demandado");
- DNI, CUIT, CUIL y pasaportes;
- domicilios reales, constituidos y electrónicos, teléfonos y correos;
- datos de menores o incapaces;
- datos de salud, filiación, aspectos familiares, y datos bancarios o patrimoniales específicos.

Se conservan solo los elementos necesarios para el problema técnico-jurídico (ej. fechas de notificación para el cómputo de plazos, o montos globales si se discute un rubro), dejando constancia de la anonimización en el prompt.

### Auditoría de consulta y registro de fallas

Toda información destinada al borrador o a la base de conocimiento se registra con:

- el conector MCP empleado y la fuente oficial consultada;
- la fecha y hora exacta de la consulta;
- el enlace o identificador provisto por el sistema.

Si un conector falla, da timeout o no devuelve resultados por barreras del portal (CAPTCHA, sesión HITL), la consulta se asienta como NO VERIFICADO. El silencio de la herramienta nunca se interpreta como "ausencia de novedades" ni "inexistencia de normativa contraria".

## 5. Errores críticos a evitar

- **Citar por sumarios** sin compulsar el fallo completo. El sumario recorta condiciones fácticas o generaliza un criterio específico.
- **Fabricar o completar citas.** Inventar o rellenar fecha, sala o carátula. Si la fuente no provee la trazabilidad completa, la cita no entra.
- **Asimilar disidencias a doctrina.** Fundar en el voto en minoría como si fuera el criterio de la mayoría.
- **Invocar precedentes superados.** Omitir el control posterior y fundar en doctrina abandonada, modificada por unificación o revocada por tribunal superior.
- **Equiparar fallos no firmes a cosa juzgada.** Invocar un pronunciamiento recurrido por recurso concedido sin declarar su condición de criterio provisional.
- **Mutilar la cita provincial.** Omitir el Departamento Judicial en tribunales de PBA u otras jurisdicciones locales.
- **Extrapolar vigencia normativa provincial.** Validar una ley o código procesal provincial con InfoLEG u otra base federal de actualización dispar.
- **Fundamentación jurisprudencial pura.** Articular la pieza solo con fallos, sin invocar la norma positiva de la que emana el derecho.
- **Sobrecitación.** Tres precedentes leídos, pertinentes y análogos valen más que quince referencias abstractas no verificadas.

## 6. Directiva de comportamiento del modelo (prompt de trabajo)

```text
Trabajá única y exclusivamente con el texto y las fuentes normativas o jurisprudenciales
que te son suministradas a través de las herramientas del MCP.
Queda prohibido incorporar normas, fallos, citas o doctrinas externas que no surjan de una
consulta verificada en esta sesión.
Separá de forma visible los datos extraídos (fácticos y textuales de la fuente) de las
inferencias o conclusiones interpretativas.
Etiquetá toda laguna, duda hermenéutica o inconsistencia bajo el estado [NO VERIFICADO].
Señalá en una sección dedicada cualquier omisión material según la matriz de control.
No redactes la conclusión profesional final ni simules la firma o el cierre del escrito:
consolidá un borrador técnico revisable por el abogado.
```

## 7. Flujo metodológico de aplicación

Caso: demanda de daños y perjuicios por producto defectuoso, derecho del consumo, en PBA.

```
[PASO 1: VOCES]
  saij_suggest_terms con "defensa del consumidor" y "relación de consumo".

[PASO 2: NORMATIVA BASE]
  InfoLEG buscar_normativa -> Ley 24.240 (Defensa del Consumidor).
    [VERIFICADO: InfoLEG ID 638, B.O. 15/10/1993, vigente].
  NormativaPBA obtener_texto_norma -> Ley 13.133 (Código Provincial de Implementación
    de los Derechos de los Consumidores y Usuarios).
    [VERIFICADO: promulgada 16/12/2003, B.O. 24859, vigente con modificaciones].

[PASO 3: MAPA DOCTRINARIO]
  saij_search_doctrina con las voces del tesauro -> delimitación del daño directo
    y fallos líderes de la materia.

[PASO 4: JURISPRUDENCIA LOCAL]
  JUBA buscar_fallos_civil_y_comercial acotando por voces, últimos 5 años y
    Departamentos Judiciales pertinentes.

[PASO 5: CONTROL DE INTEGRIDAD]
  obtener_sentencia (JUBA) de los dos precedentes más análogos. Verificación de holding,
    mayoría de votos y firmeza (ausencia de recursos ante la SCBA).

[PASO 6: TRAZABILIDAD]
  saij_get_related_documents sobre los fallos seleccionados para descartar cambios
    doctrinarios ulteriores o doctrina legal de la SCBA en oposición.

[PASO 7: CONSOLIDACIÓN DEL BORRADOR]
  Norma nacional/provincial vigente -> doctrina de encuadre -> fallo líder departamental
    verificado -> subsunción de los hechos. Cada segmento rotulado con su estado (VERIFICADO).
```

Esta guía es la directiva metodológica interna para el uso de mcp-legal-ar en el diseño de estrategias de litigio y la confección de piezas judiciales. No automatiza actos procesales ni reemplaza la revisión del abogado.
