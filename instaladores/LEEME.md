# Actualizar tu copia de mcp-legal-ar

Estos scripts actualizan tu instalacion local con un solo clic, sin tener que
tipear los comandos a mano. Reemplazan al proceso manual de la seccion
"Actualizacion" del README.

A diferencia del repo `claude-for-legal-argentina` (que son archivos que Claude
lee directo), esto es un servidor MCP que se compila y se carga al abrir Claude
Desktop. Por eso actualizar tiene tres partes: bajar el codigo, reinstalar
dependencias y -clave- reiniciar Claude Desktop. Mientras Claude este abierto,
sigue usando la version vieja: el cambio entra recien al reiniciarlo.

## Cual uso

| Tu situacion | Windows | Mac / Linux |
|---|---|---|
| Clonaste con git | `actualizar.bat` | `actualizar.sh` |
| Bajaste el ZIP, sin git | `actualizar-sin-git.bat` | `actualizar-sin-git.sh` |

En Windows: doble clic. En Mac/Linux: `bash instaladores/<archivo>`.

Cada uno hace lo mismo en orden: baja la ultima version, corre `npm install`
(raiz y `servers/legal-mcp`) y te recuerda reiniciar Claude Desktop.

## Por que no hay actualizacion automatica programada

En el otro repo dejamos un instalador que programa la actualizacion sola. Aca no
conviene por defecto: como el cambio no surte efecto hasta reiniciar Claude
Desktop, una tarea silenciosa de fondo te dejaria con la sensacion de que "no
actualizo" hasta el proximo reinicio, y un `npm install` a medias en segundo
plano puede romper dependencias sin que lo veas. Es mas seguro correr el
actualizador cuando vos quieras y reiniciar a continuacion.

Si igual lo queres programado, se puede agregar en una linea (mismo patron que el
`actualizar-repo.bat` de la raiz). Pedilo y lo sumo.

## Archivos auxiliares (no los corras a mano)

- `_actualizar-sin-git.ps1` - lo invoca `actualizar-sin-git.bat` en Windows.
