# Directiva operativa - mcp-legal-ar

Capa corta de control, pensada para cargar en cada tarea. La metodología completa está en [`busqueda-jurisprudencia-doctrina.md`](busqueda-jurisprudencia-doctrina.md).

## Regla de integridad

No se cita lo que no se verificó contra la fuente. Un sumario o una carátula no fundan: se recupera y se lee el documento completo antes de llevarlo al escrito. Con las normas, se verifica vigencia y texto actualizado antes de fundar en un artículo.

## Estados de confianza

Cada dato del borrador lleva su estado.

- **VERIFICADO** - extraído del documento o fuente oficial que consulté y leí. Apto para el escrito.
- **REFERENCIA VERIFICADA / CONTENIDO NO LEÍDO** - la ficha existe y se confirmó (autor, título, carátula o número), pero el texto no se recuperó ni se leyó. Típico de doctrina con sola ficha bibliográfica, o de un fallo ubicado sin acceso al texto íntegro. No se usa como fundamento hasta leer el texto.
- **INFERIDO** - conclusión mía a partir de la fuente, no afirmación del tribunal. Revisión obligatoria.
- **NO VERIFICADO (PARCIAL)** - verificación degradada: una herramienta del MCP cayó y el dato se recuperó por una vía indirecta (ej. voces del tesauro tomadas de la doctrina porque `suggest_terms` no respondió). Marcar la limitación y compulsar lo faltante.
- **NO VERIFICADO** - no surge de la fuente, o la fuente no respondió. No se usa como afirmación.
- **CONFLICTO** - fuentes que se contradicen sobre vigencia de norma o de fallo. Bloqueo hasta resolver.

## Verificación mínima antes de citar

- **Fallo:** documento completo leído; holding vs. obiter; mayoría vs. disidencia; firmeza (¿recurrido ante CSJN/SCBA?).
- **Norma nacional:** vigencia y texto en InfoLEG.
- **Norma provincial:** PBA con NormativaPBA (`verificar_vigencia`); otra provincia sin conector -> NO VERIFICADO.
- **Cita provincial:** incluir el Departamento Judicial (San Isidro no es Mercedes).

## Matriz de omisiones

El resumen baja a NO VERIFICADO si falta alguno: tribunal/sala/juzgado y Departamento Judicial; fecha de resolución/notificación; estado de firmeza; cuestión jurídica y holding; prueba determinante; norma de fondo y forma; plazo o carga procesal; disidencias o límites del holding.

## Anonimización antes de resumir

Antes de pasar un PDF de expediente al modelo, anonimizar: nombres de personas físicas, DNI/CUIT/CUIL, domicilios, teléfonos, correos, datos de menores, y datos de salud, bancarios o familiares. Se conservan solo los datos necesarios para la tarea (ej. fechas para cómputo de plazos), dejando constancia.

## Registro

Todo dato que va al borrador se asienta con conector usado, fuente, fecha y hora de consulta, e identificador o enlace. Si el conector falla o hay CAPTCHA/HITL, la consulta queda NO VERIFICADO. El silencio de la herramienta nunca es "no hay novedades".

## Prompt de trabajo

```text
Trabajá solo con el texto y las fuentes que te doy o que surjan de una consulta MCP verificada.
No agregues normas, fallos ni citas externas.
Separá datos extraídos de inferencias.
Marcá toda duda como NO VERIFICADO.
Señalá omisiones materiales según la matriz.
No redactes la conclusión final: dejá un borrador revisable.
```
