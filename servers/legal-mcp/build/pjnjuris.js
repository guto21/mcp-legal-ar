#!/usr/bin/env node
/**
 * pjnjuris.js - Conector PJN Jurisprudencia (sj.pjn.gov.ar) - REESCRITURA 10/06/2026
 *
 * Portal real: Sistema de Jurisprudencia del Consejo de la Magistratura,
 * https://sj.pjn.gov.ar/consulta/ (SPA Angular + API REST publica).
 * El host del scaffold original (scw.pjn.gov.ar/scw/api/jurisprudencia) NO existe.
 *
 * API capturada en vivo (10/06/2026, _capturas/captura-sj-pjn-gov-ar-*.json):
 *   GET  /api/public/camaras                  catalogo (sin captcha)
 *   GET  /api/public/magistrados/search-all   catalogo (sin captcha)
 *   GET  /api/public/oficinas/search-all      catalogo (sin captcha)
 *   POST /api/public/sumarios/search?page=N&sort=fallo.fecha,DESC&tokenCaptcha=T
 *        body JSON con criterios; sin token valido -> 400.
 *   GET  /api/public/sumarios/{id}            detalle del sumario
 *
 * Captcha: servicio propio del PJN (captcha.pjn.gov.ar, sitekey "JURISPRUDENCIA"),
 * embebido en la pagina; al aprobarlo el token queda en el hidden #captcha-response.
 * REGLA INMODIFICABLE: lo resuelve SIEMPRE el usuario (HITL). Las busquedas corren
 * DENTRO del navegador (fetch en el contexto de la pagina: cookies TSPD + token).
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import crypto from "crypto";

const HOME_URL = "https://sj.pjn.gov.ar/consulta/";
let globalBrowser = null;
let globalPage = null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const txt = (t) => ({ content: [{ type: "text", text: t }] });
const err = (t) => ({ content: [{ type: "text", text: t }], isError: true });

const AVISO_SIN_SESION = "No hay sesion HITL activa. Ejecuta iniciar_hitl_browser; el captcha del buscador lo resuelve el usuario en la ventana.";
const AVISO_CAPTCHA = "CAPTCHA PENDIENTE. Decile al usuario: 'Resolve el captcha que aparece en la pagina de busqueda de la ventana de Chromium y avisame cuando este (con un ok alcanza)'. Cuando confirme, reintenta ESTA MISMA tool con los mismos parametros (el token queda en la pagina; no hace falta nada mas).";

function pageViva() {
    return globalBrowser && globalPage && !globalPage.isClosed();
}

async function getPage() {
    if (!pageViva()) throw new Error(AVISO_SIN_SESION);
    return globalPage;
}

/**
 * fetch() ejecutado DENTRO de la pagina HITL: viaja con las cookies de la sesion
 * (anti-bot TSPD de captcha.pjn.gov.ar incluido) y, si conToken=true, agrega el
 * tokenCaptcha leido del hidden #captcha-response que puebla el widget al aprobarse.
 */
async function apiFetch(page, path, { method = "GET", body = null, conToken = false } = {}) {
    return page.evaluate(async (path, method, body, conToken) => {
        let url = path;
        if (conToken) {
            const t = document.querySelector(".pjn-captcha #captcha-response") || document.getElementById("captcha-response");
            const token = t && typeof t.value === "string" ? t.value : "";
            if (!token || token.length < 5) return { sinToken: true };
            url += (url.includes("?") ? "&" : "?") + "tokenCaptcha=" + encodeURIComponent(token);
        }
        try {
            const r = await fetch(url, {
                method,
                headers: { "Accept": "application/json, text/plain, */*", ...(body ? { "Content-Type": "application/json" } : {}) },
                body: body ? JSON.stringify(body) : undefined,
            });
            const text = await r.text();
            let json = null;
            try { json = JSON.parse(text); } catch { /* respuesta no JSON */ }
            return { status: r.status, json, raw: json ? undefined : text.slice(0, 800) };
        } catch (e) {
            return { error: String(e) };
        }
    }, path, method, body, conToken);
}

async function irAlBuscador(page) {
    if (!page.url().startsWith("https://sj.pjn.gov.ar")) {
        await page.goto(HOME_URL, { waitUntil: "domcontentloaded", timeout: 45000 });
        await sleep(2500); // arranque de la SPA + widget captcha
    }
}

/** Cuerpo de busqueda con los defaults exactos capturados del trafico real. */
function cuerpoBusqueda({ keywords = [], camaraObj = null, expediente = null, fechaDesde = null, fechaHasta = null } = {}) {
    return {
        fallo: {
            expediente: {
                camara: expediente?.camara ?? null,
                numero: expediente?.numero ?? "",
                anio: expediente?.anio ?? "",
                numeroSubexpediente: "",
                caratulaPublica: expediente?.caratulaPublica ?? "",
            },
            numeroSentencia: null,
            fechaDesde, fechaHasta,
            magistrados: [], magistradosOperation: "AND",
        },
        titulo: null, subtitulo: null, texto: null,
        refNormativas: null, refBibliograficas: null, refJurisprudenciales: null, refDocumentales: null,
        publicacionEstado: null,
        tituloKeywords: [], tituloKeywordsOperation: "AND", tituloKeywordsNot: [], tituloKeywordsNotOperation: "OR",
        subtituloKeywords: [], subtituloKeywordsOperation: "AND", subtituloKeywordsNot: [], subtituloKeywordsNotOperation: "OR",
        textoKeywords: [], textoKeywordsOperation: "AND", textoKeywordsNot: [], textoKeywordsNotOperation: "OR",
        busquedaGeneralKeywords: keywords, busquedaGeneralKeywordsOperation: "AND",
        busquedaGeneralKeywordsNot: [], busquedaGeneralKeywordsNotOperation: "OR",
        camaraCarga: camaraObj,
    };
}

async function resolverCamara(page, codigo) {
    if (!codigo) return null;
    const r = await apiFetch(page, "/api/public/camaras");
    if (!Array.isArray(r.json)) throw new Error(`No pude obtener el catalogo de camaras (status ${r.status}).`);
    const c = r.json.find((x) => (x.codigo || "").toUpperCase() === codigo.toUpperCase());
    if (!c) throw new Error(`Camara "${codigo}" no encontrada. Disponibles: ${r.json.map((x) => x.codigo).join(", ")}`);
    return c;
}

function clean(s) { return (s || "").replace(/\s+/g, " ").trim(); }

function formatearPagina(rj, contexto, pagina) {
    const data = rj.json;
    if (!data || !Array.isArray(data.content)) {
        return `# PJN Jurisprudencia - ${contexto}\n\nRespuesta inesperada (status ${rj.status}): ${JSON.stringify(data ?? rj.raw).slice(0, 600)}`;
    }
    let out = `# PJN Jurisprudencia - ${contexto}\n\n**Total:** ${data.totalElements ?? "?"} sumarios | **Pagina:** ${(data.number ?? pagina) + 1} de ${data.totalPages ?? "?"} | **En esta pagina:** ${data.content.length}\n\n`;
    for (const s of data.content) {
        const exp = s.fallo?.expediente;
        out += `---\n**ID sumario:** ${s.id}\n**Titulo:** ${clean(s.titulo)}\n`;
        if (s.subtitulo) out += `**Subtitulo:** ${clean(s.subtitulo)}\n`;
        out += `**Camara:** ${s.camaraCarga?.codigo || "?"} - ${s.camaraCarga?.descripcion || ""}\n`;
        if (exp) out += `**Expediente:** ${clean(`${exp.numero || ""}/${exp.anio || ""}`)} ${clean(exp.caratulaPublica)}\n`;
        if (s.fallo?.fecha) out += `**Fecha del fallo:** ${s.fallo.fecha}\n`;
        if (s.texto) out += `**Sumario (extracto):** ${clean(s.texto).slice(0, 600)}${s.texto.length > 600 ? "..." : ""}\n`;
    }
    out += `\nDetalle completo: \`obtener_sumario\` con el ID. Mas resultados: misma busqueda con \`pagina\` siguiente.`;
    return out;
}

/** Ejecuta una busqueda de sumarios manejando token/captcha. */
async function buscarSumarios(page, body, { pagina = 0, contexto }) {
    const path = `/api/public/sumarios/search?page=${pagina}&sort=fallo.fecha,DESC`;
    const r = await apiFetch(page, path, { method: "POST", body, conToken: true });
    if (r.sinToken) return txt(`# PJN Jurisprudencia - ${contexto}\n\n${AVISO_CAPTCHA}`);
    if (r.error) return err(`Error de red dentro de la sesion HITL: ${r.error}`);
    if (r.status === 400 || r.status === 401 || r.status === 403) {
        return txt(`# PJN Jurisprudencia - ${contexto}\n\nEl portal rechazo el token (status ${r.status}); probablemente expiro. ${AVISO_CAPTCHA}`);
    }
    if (r.status !== 200) return err(`Status inesperado ${r.status}: ${JSON.stringify(r.json ?? r.raw).slice(0, 500)}`);
    return txt(formatearPagina(r, contexto, pagina));
}

export function registerAllTools(server) {
    // ---- Sesion HITL -------------------------------------------------------
    server.tool("iniciar_hitl_browser", "Abre el navegador interactivo (HITL) en el Sistema de Jurisprudencia del PJN (sj.pjn.gov.ar). ANTES de llamar esta tool avisale al usuario: 'Se va a abrir una ventana de Chromium; cuando hagas una busqueda puede aparecer un verificador (captcha) en la pagina: resolvelo y avisame'.", {}, async () => {
        if (pageViva()) return txt("El navegador ya esta abierto; la sesion sigue viva.");
        try {
            const { default: puppeteer } = await import("puppeteer");
            globalBrowser = await puppeteer.launch({ headless: false, defaultViewport: null, args: ["--start-maximized"] });
            globalPage = (await globalBrowser.pages())[0] || (await globalBrowser.newPage());
            await globalPage.goto(HOME_URL, { waitUntil: "domcontentloaded", timeout: 45000 });
            await sleep(3000);
            return txt("Navegador abierto en " + HOME_URL + ". Las busquedas requieren un captcha que el portal muestra en la pagina: cuando una tool devuelva CAPTCHA PENDIENTE, el usuario lo resuelve y se reintenta la misma tool.");
        } catch (error) {
            globalBrowser = null; globalPage = null;
            return err(`Error al iniciar el navegador: ${error instanceof Error ? error.message : String(error)}`);
        }
    });

    server.tool("estado_hitl", "Estado de la sesion HITL de jurisprudencia: navegador, URL y si hay token de captcha vigente en la pagina.", {}, async () => {
        if (!pageViva()) return txt("Sesion HITL: CERRADA. Ejecuta iniciar_hitl_browser.");
        const token = await globalPage.evaluate(() => {
            const t = document.querySelector(".pjn-captcha #captcha-response") || document.getElementById("captcha-response");
            return t && t.value ? "presente" : "ausente";
        }).catch(() => "desconocido");
        return txt(`Sesion HITL: ABIERTA\nURL: ${globalPage.url()}\nToken captcha: ${token}`);
    });

    server.tool("finalizar_hitl_browser", "Cierra el navegador HITL de jurisprudencia. Cerrar solo al terminar todas las consultas.", {}, async () => {
        if (!pageViva()) return txt("No habia navegador abierto.");
        try { await globalBrowser.close(); } catch { /* ignorar */ }
        globalBrowser = null; globalPage = null;
        return txt("Sesion HITL cerrada.");
    });

    // ---- Catalogos (sin captcha) -------------------------------------------
    server.tool("listar_camaras", "Lista las camaras disponibles en el Sistema de Jurisprudencia (codigo + descripcion). No requiere captcha; si requiere sesion HITL abierta.", {}, async () => {
        try {
            const page = await getPage();
            await irAlBuscador(page);
            const r = await apiFetch(page, "/api/public/camaras");
            if (!Array.isArray(r.json)) return err(`Catalogo no disponible (status ${r.status}).`);
            let out = `# PJN Jurisprudencia - Camaras (${r.json.length})\n\n| Codigo | Descripcion |\n|---|---|\n`;
            for (const c of r.json) out += `| ${c.codigo} | ${clean(c.descripcion)} |\n`;
            return txt(out);
        } catch (error) {
            return err(`Error en listar_camaras: ${error instanceof Error ? error.message : String(error)}`);
        }
    });

    server.tool("listar_magistrados", "Lista magistrados del catalogo del Sistema de Jurisprudencia, con filtro local opcional por apellido/nombre.", {
        filtro: z.string().optional().describe("Texto a filtrar (ej. 'medina')"),
    }, async (args) => {
        try {
            const page = await getPage();
            await irAlBuscador(page);
            const r = await apiFetch(page, "/api/public/magistrados/search-all");
            if (!Array.isArray(r.json)) return err(`Catalogo no disponible (status ${r.status}).`);
            let lista = r.json;
            if (args.filtro) {
                const f = args.filtro.toLowerCase();
                lista = lista.filter((m) => (m.apellidoNombre || "").toLowerCase().includes(f));
            }
            let out = `# PJN Jurisprudencia - Magistrados (${lista.length}${args.filtro ? `, filtro "${args.filtro}"` : ""})\n\n| ID | Apellido y nombre | Camara |\n|---|---|---|\n`;
            for (const m of lista.slice(0, 100)) out += `| ${m.id} | ${clean(m.apellidoNombre)} | ${m.camara?.codigo || ""} |\n`;
            if (lista.length > 100) out += `\n*(${lista.length} en total; se muestran 100 - afinar con \`filtro\`)*`;
            return txt(out);
        } catch (error) {
            return err(`Error en listar_magistrados: ${error instanceof Error ? error.message : String(error)}`);
        }
    });

    // ---- Busquedas (requieren token captcha, HITL) ---------------------------
    server.tool("buscar_jurisprudencia_fed", "Busca sumarios de jurisprudencia federal/nacional por texto libre en el Sistema de Jurisprudencia del PJN. Si devuelve CAPTCHA PENDIENTE: el usuario resuelve el captcha en la ventana y se reintenta esta misma tool.", {
        texto: z.string().describe("Termino o frase de busqueda general (ej. 'daños punitivos')"),
        camara: z.string().optional().describe("Codigo de camara para acotar (ver listar_camaras; ej. CCF, CNT)"),
        pagina: z.number().int().min(0).optional().default(0).describe("Pagina de resultados (desde 0)"),
    }, async (args) => {
        try {
            const page = await getPage();
            await irAlBuscador(page);
            const camaraObj = args.camara ? await resolverCamara(page, args.camara) : null;
            const body = cuerpoBusqueda({ keywords: [args.texto], camaraObj });
            return await buscarSumarios(page, body, { pagina: args.pagina, contexto: `"${args.texto}"${args.camara ? ` (${args.camara})` : ""}` });
        } catch (error) {
            return err(`Error en buscar_jurisprudencia_fed: ${error instanceof Error ? error.message : String(error)}`);
        }
    });

    server.tool("pjn_buscar_sumarios", "Alias de buscar_jurisprudencia_fed: busqueda de sumarios por texto libre con filtro opcional de camara.", {
        texto: z.string().describe("Termino o frase de busqueda"),
        camara: z.string().optional().describe("Codigo de camara (ver listar_camaras)"),
        pagina: z.number().int().min(0).optional().default(0),
    }, async (args) => {
        try {
            const page = await getPage();
            await irAlBuscador(page);
            const camaraObj = args.camara ? await resolverCamara(page, args.camara) : null;
            const body = cuerpoBusqueda({ keywords: [args.texto], camaraObj });
            return await buscarSumarios(page, body, { pagina: args.pagina, contexto: `Sumarios "${args.texto}"` });
        } catch (error) {
            return err(`Error en pjn_buscar_sumarios: ${error instanceof Error ? error.message : String(error)}`);
        }
    });

    server.tool("pjn_buscar_jurisprudencia_por_expediente", "Busca sumarios vinculados a un expediente (camara + numero + anio).", {
        camara: z.string().describe("Codigo de camara (ver listar_camaras)"),
        numero: z.string().describe("Numero de expediente"),
        anio: z.string().describe("Anio del expediente"),
        pagina: z.number().int().min(0).optional().default(0),
    }, async (args) => {
        try {
            const page = await getPage();
            await irAlBuscador(page);
            const camaraObj = await resolverCamara(page, args.camara);
            const body = cuerpoBusqueda({ camaraObj, expediente: { camara: camaraObj, numero: args.numero.trim(), anio: args.anio.trim() } });
            return await buscarSumarios(page, body, { pagina: args.pagina, contexto: `Expediente ${args.camara} ${args.numero}/${args.anio}` });
        } catch (error) {
            return err(`Error en pjn_buscar_jurisprudencia_por_expediente: ${error instanceof Error ? error.message : String(error)}`);
        }
    });

    server.tool("pjn_buscar_jurisprudencia_por_caratula", "Busca sumarios por caratula (publica) del expediente.", {
        caratula: z.string().describe("Texto de la caratula (ej. apellido de una parte)"),
        camara: z.string().optional().describe("Codigo de camara para acotar"),
        pagina: z.number().int().min(0).optional().default(0),
    }, async (args) => {
        try {
            const page = await getPage();
            await irAlBuscador(page);
            const camaraObj = args.camara ? await resolverCamara(page, args.camara) : null;
            const body = cuerpoBusqueda({ camaraObj, expediente: { caratulaPublica: args.caratula.trim() } });
            return await buscarSumarios(page, body, { pagina: args.pagina, contexto: `Caratula "${args.caratula}"` });
        } catch (error) {
            return err(`Error en pjn_buscar_jurisprudencia_por_caratula: ${error instanceof Error ? error.message : String(error)}`);
        }
    });

    server.tool("obtener_sumario", "Devuelve el detalle completo de un sumario por su ID (texto integro, fallo, expediente, magistrados).", {
        id: z.number().int().describe("ID del sumario (de los resultados de busqueda)"),
    }, async (args) => {
        try {
            const page = await getPage();
            await irAlBuscador(page);
            const r = await apiFetch(page, `/api/public/sumarios/${args.id}`);
            if (r.status !== 200 || !r.json) return err(`Sumario ${args.id} no disponible (status ${r.status}).`);
            const s = r.json;
            const exp = s.fallo?.expediente;
            let out = `# PJN Jurisprudencia - Sumario ${args.id}\n\n**Titulo:** ${clean(s.titulo)}\n`;
            if (s.subtitulo) out += `**Subtitulo:** ${clean(s.subtitulo)}\n`;
            out += `**Camara:** ${s.camaraCarga?.codigo || "?"} - ${s.camaraCarga?.descripcion || ""}\n`;
            if (exp) out += `**Expediente:** ${clean(`${exp.numero || ""}/${exp.anio || ""}`)} ${clean(exp.caratulaPublica)}\n`;
            if (s.fallo?.fecha) out += `**Fecha del fallo:** ${s.fallo.fecha}\n`;
            if (Array.isArray(s.fallo?.magistrados) && s.fallo.magistrados.length) {
                out += `**Magistrados:** ${s.fallo.magistrados.map((m) => m.apellidoNombre || m).join("; ")}\n`;
            }
            out += `\n## Texto del sumario\n\n${s.texto || "(sin texto)"}\n`;
            return txt(out);
        } catch (error) {
            return err(`Error en obtener_sumario: ${error instanceof Error ? error.message : String(error)}`);
        }
    });

    // ---- Utilitarias ---------------------------------------------------------
    server.tool("exportar_fallo", "Exporta un sumario a Markdown con frontmatter YAML (Obsidian/Notion).", {
        id: z.number().int().describe("ID del sumario"),
    }, async (args) => {
        try {
            const page = await getPage();
            await irAlBuscador(page);
            const r = await apiFetch(page, `/api/public/sumarios/${args.id}`);
            if (r.status !== 200 || !r.json) return err(`Sumario ${args.id} no disponible (status ${r.status}).`);
            const s = r.json;
            const fecha = new Date().toISOString();
            let out = `---\ntitle: "${clean(s.titulo).replace(/"/g, "'")}"\nsource: "PJN - Sistema de Jurisprudencia (Consejo de la Magistratura)"\nsource_url: "https://sj.pjn.gov.ar/consulta/ (sumario ${args.id})"\nexport_date: "${fecha}"\ntags:\n  - PJN\n  - jurisprudencia\n  - sumario-${args.id}\n---\n\n`;
            out += `# ${clean(s.titulo)}\n\n${s.texto || ""}\n\n---\n*Exportado el ${fecha}. Verificar en la fuente oficial.*`;
            return txt(out);
        } catch (error) {
            return err(`Error en exportar_fallo: ${error instanceof Error ? error.message : String(error)}`);
        }
    });

    server.tool("generar_certificacion_forense", "Certificacion de trazabilidad de un sumario: URL del recurso, timestamp UTC y hash SHA-256 del JSON devuelto por la API oficial.", {
        id: z.number().int().describe("ID del sumario a certificar"),
    }, async (args) => {
        try {
            const page = await getPage();
            await irAlBuscador(page);
            const r = await apiFetch(page, `/api/public/sumarios/${args.id}`);
            if (r.status !== 200 || !r.json) return err(`Sumario ${args.id} no disponible (status ${r.status}).`);
            const raw = JSON.stringify(r.json);
            const timestamp = new Date().toISOString();
            const hash = crypto.createHash("sha256").update(raw, "utf8").digest("hex");
            let out = `::: ACTA DE TRAZABILIDAD - PJN Sistema de Jurisprudencia\n\n| Metadato | Valor |\n| :--- | :--- |\n`;
            out += `| Recurso | https://sj.pjn.gov.ar/api/public/sumarios/${args.id} |\n| Timestamp UTC | ${timestamp} |\n| Tamano JSON | ${Buffer.byteLength(raw, "utf8")} bytes |\n| SHA-256 | ${hash} |\n\n`;
            out += `> JSON obtenido de la API oficial dentro de una sesion validada por un humano (HITL). No constituye certificacion oficial del PJN.\n`;
            return txt(out);
        } catch (error) {
            return err(`Error en generar_certificacion_forense: ${error instanceof Error ? error.message : String(error)}`);
        }
    });

    server.tool("detector_plazos_jurisprudencia", "Audita texto de fallos/sumarios para detectar plazos, fechas limite e hitos temporales.", {
        texto: z.string().describe("Texto a analizar"),
    }, async (args) => {
        try {
            const text = args.texto;
            const patterns = [
                { regex: /\b(\d+|un|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|quince|veinte|treinta)\s*(\(\d+\)\s*)?(d[ií]as?|meses|años?|horas?)(\s+(h[aá]biles|corridos|judiciales))?\b/i, name: "Plazo" },
                { regex: /\bdentro\s+de(l\s+plazo)?(\s+de)?(\s+los)?\s+\w+/i, name: "Plazo 'dentro de'" },
                { regex: /\bcontados?\s+(a\s+partir|desde)\b/i, name: "Computo del plazo" },
                { regex: /\bbajo\s+apercibimiento\b/i, name: "Apercibimiento" },
                { regex: /\b(perentori[oa]|improrrogable|fatal)\b/i, name: "Plazo perentorio" },
                { regex: /\b(prescribe|prescripci[oó]n)\b/i, name: "Prescripcion" },
                { regex: /\b(caduca|caducidad)\b/i, name: "Caducidad" },
                { regex: /\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b/, name: "Fecha especifica" },
                { regex: /\b\d{1,2}°?\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)(\s+de\s+\d{4})?\b/i, name: "Fecha en letras" },
                { regex: /\b(hasta\s+el|a\s+m[aá]s\s+tardar)\b/i, name: "Fecha limite" },
                { regex: /\b(notificaci[oó]n|notif[ií]quese|c[eé]dula)\b/i, name: "Notificacion" },
            ];
            const paragraphs = text.split(/\n\n+|\.\s+(?=[A-ZÁÉÍÓÚ])/);
            const results = [];
            for (const paragraph of paragraphs) {
                const trimmed = paragraph.trim();
                if (!trimmed || trimmed.length < 10) continue;
                const found = [...new Set(patterns.filter((p) => p.regex.test(trimmed)).map((p) => p.name))];
                if (found.length) results.push({ paragraph: trimmed.slice(0, 500) + (trimmed.length > 500 ? "..." : ""), matches: found });
            }
            let content = `# Auditoria de Plazos (jurisprudencia)\n\nSe identificaron **${results.length}** pasajes con indicadores temporales.\n\n`;
            if (!results.length) content += `No se detectaron plazos ni hitos temporales.\n`;
            else results.forEach((r, i) => { content += `### ${i + 1}. [${r.matches.join(", ")}]\n> ${r.paragraph}\n\n`; });
            content += `\n> Deteccion de patrones; no reemplaza la lectura del documento original.`;
            return txt(content);
        } catch (error) {
            return err(`Error en detector_plazos_jurisprudencia: ${error.message}`);
        }
    });

    server.tool("alcance_fuente", "Capacidades, flujo HITL, fuentes y limitaciones del conector pjn-juris-mcp.", {}, async () => {
        const text = `# Alcance y Fuentes - PJN Jurisprudencia (sj.pjn.gov.ar)

## Arquitectura (reescritura 10/06/2026)
Sistema de Jurisprudencia del Consejo de la Magistratura (sumarios y fallos de camaras
nacionales y federales). API REST publica; las busquedas exigen un captcha propio del
PJN que resuelve SIEMPRE el usuario (HITL). Las llamadas corren dentro del navegador
de la sesion (cookies anti-bot + token captcha de la pagina).

## Flujo de uso
1. \`iniciar_hitl_browser\` (avisar antes al usuario que se abre una ventana).
2. \`buscar_jurisprudencia_fed\` / \`pjn_buscar_sumarios\` / \`por_expediente\` / \`por_caratula\`.
   Si devuelven CAPTCHA PENDIENTE: el usuario resuelve en la ventana y se REINTENTA la misma tool.
3. \`obtener_sumario\` (detalle integro), \`exportar_fallo\`, \`generar_certificacion_forense\`.
4. Catalogos sin captcha: \`listar_camaras\`, \`listar_magistrados\`.
5. \`finalizar_hitl_browser\` al terminar.

## Limitaciones conocidas
- CSJN: sus fallos completos viven en otro portal (sj.csjn.gov.ar / csjn.gov.ar), no cubierto aun.
- Busqueda por magistrado, guia judicial, formularios, concursos y estadisticas: no implementadas.
- El token del captcha expira: ante rechazo, resolver de nuevo y reintentar.

## Aviso
Conector de investigacion sobre el portal publico oficial. No constituye asesoramiento juridico.`;
        return txt(text);
    });

    // ---- Stubs honestos ------------------------------------------------------
    const stub = (nombre, motivo) => server.tool(nombre, `NO DISPONIBLE: ${motivo}`, {}, async () =>
        err(`${nombre} no esta disponible: ${motivo}`));
    stub("pjn_buscar_jurisprudencia_por_texto_corte_suprema", "los fallos de la CSJN viven en otro portal (sj.csjn.gov.ar); pendiente de conector propio. Para sumarios de camaras usar buscar_jurisprudencia_fed.");
    stub("pjn_buscar_jurisprudencia_por_fallo", "la API publica indexa por sumario; usar busqueda por expediente/caratula y obtener_sumario.");
    stub("pjn_descargar_fallo_pdf", "la descarga de PDF del fallo no fue mapeada en la captura; pendiente para una proxima iteracion.");
    stub("buscar_por_semantica", "no existe busqueda semantica en el portal; usar terminos concretos en buscar_jurisprudencia_fed.");
    stub("relacionar_fallos", "el portal no ofrece fallos relacionados; alternativa: buscar por la misma caratula o expediente.");
    stub("pjn_buscar_guia_judicial", "corresponde a www.pjn.gov.ar/guia_judicial, sitio distinto no cubierto.");
    stub("pjn_buscar_formularios_csjn", "corresponde al sitio de la CSJN, no cubierto.");
    stub("pjn_consultar_concursos", "corresponde a otro sistema del PJN, no cubierto.");
    stub("pjn_estadisticas", "corresponde a www.pjn.gov.ar/estadisticas, sitio distinto no cubierto.");
}

export const server = new McpServer({
    name: "pjn-juris-mcp",
    version: "2.0.0"
});
registerAllTools(server);

if (typeof process !== "undefined" && !process.env.VERCEL && !process.env.NEXT_RUNTIME) {
    const cleanupBrowser = async () => {
        if (globalBrowser) {
            try { await globalBrowser.close(); } catch { /* ignorar */ }
            globalBrowser = null;
            globalPage = null;
        }
    };
    process.on("SIGINT", async () => { await cleanupBrowser(); process.exit(0); });
    process.on("SIGTERM", async () => { await cleanupBrowser(); process.exit(0); });
    process.on("exit", () => { if (globalBrowser) { try { globalBrowser.process()?.kill(); } catch { /* ignorar */ } } });
    const transport = new StdioServerTransport();
    server.connect(transport).catch((err2) => {
        console.error("Server connection failed", err2);
        process.exit(1);
    });
    console.error("PJN Jurisprudencia MCP (HITL v2, sj.pjn.gov.ar) corriendo via Stdio.");
}
//# sourceMappingURL=pjnjuris.js.map
