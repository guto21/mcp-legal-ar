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
    await instalarInterceptor(page);
}

/**
 * Engancha window.fetch para guardar la ULTIMA respuesta de sumarios/search y de
 * sumarios/{id} que dispara la PROPIA app (con su token de captcha de un solo uso).
 * Asi no peleamos por el token: el usuario hace la busqueda normal en la pagina y
 * nosotros leemos lo que el portal ya devolvio. Idempotente.
 */
async function instalarInterceptor(page) {
    await page.evaluate(() => {
        if (window.__pjnHook) return;
        window.__pjnHook = true;
        window.__pjnCaptura = { search: null, searchTs: 0, detalle: {}, ultimoError: null };
        const origFetch = window.fetch;
        window.fetch = async function (...args) {
            const url = (args[0] && args[0].url) ? args[0].url : String(args[0]);
            const resp = await origFetch.apply(this, args);
            try {
                if (/\/api\/public\/sumarios\/search/.test(url)) {
                    const clone = resp.clone();
                    clone.json().then((j) => { window.__pjnCaptura.search = j; window.__pjnCaptura.searchTs = Date.now(); })
                        .catch(() => { });
                } else if (/\/api\/public\/sumarios\/\d+(\?|$)/.test(url)) {
                    const id = (url.match(/sumarios\/(\d+)/) || [])[1];
                    const clone = resp.clone();
                    clone.json().then((j) => { if (id) window.__pjnCaptura.detalle[id] = j; }).catch(() => { });
                }
            } catch { /* no romper la app */ }
            return resp;
        };
    }).catch(() => { /* contexto en transicion */ });
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
            await instalarInterceptor(globalPage);
            return txt("Navegador abierto en " + HOME_URL + ".\n\nFLUJO RECOMENDADO (el captcha aparece al apretar Buscar y es de un solo uso):\n1. El usuario elige UNA VEZ la seccion en la ventana (camara y tipo, ej. CCF > Sumarios).\n2. Llama a `buscar_asistido` con el texto: el conector completa el campo y aprieta Buscar; el usuario SOLO resuelve el captcha cuando salta. La tool espera y devuelve los sumarios sola.\n3. Alternativa: si el usuario ya busco a mano, `leer_resultados` trae lo que la pagina cargo.\n\nAVISALE antes de buscar_asistido: 'Voy a completar y buscar; cuando aparezca el verificador, resolvelo'.");
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

    // ---- Captcha inyectado: independiente de la SPA (que a veces no renderiza) --
    server.tool("preparar_captcha", "Inyecta el widget de captcha oficial del PJN (sitekey JURISPRUDENCIA) directamente en la ventana, sin depender de la interfaz del portal (que a veces carga vacia). El usuario resuelve el captcha que aparece y despues se hace la busqueda. Usar esto cuando la pagina del portal se ve vacia o no muestra el formulario.", {}, async () => {
        try {
            const page = await getPage();
            await instalarInterceptor(page);
            const r = await page.evaluate(async () => {
                // Limpia un widget previo
                document.querySelectorAll(".pjn-captcha-host").forEach((e) => e.remove());
                const host = document.createElement("div");
                host.className = "pjn-captcha-host";
                host.style.cssText = "position:fixed;top:20px;left:50%;transform:translateX(-50%);z-index:2147483647;background:#fff;padding:16px;border:2px solid #354458;border-radius:8px;box-shadow:0 4px 24px rgba(0,0,0,.3)";
                const titulo = document.createElement("div");
                titulo.textContent = "Resolvé el captcha para buscar jurisprudencia:";
                titulo.style.cssText = "font-family:sans-serif;font-size:14px;margin-bottom:8px;color:#354458";
                const widget = document.createElement("div");
                widget.className = "pjn-captcha";
                widget.setAttribute("data-sitekey", "JURISPRUDENCIA");
                host.appendChild(titulo); host.appendChild(widget); document.body.appendChild(host);
                // Carga el init.js oficial del captcha (crea el iframe + #captcha-response)
                await new Promise((res, rej) => {
                    const s = document.createElement("script");
                    s.src = "https://captcha.pjn.gov.ar/api/init.js?sitekey=JURISPRUDENCIA&_=" + Date.now();
                    s.onload = res; s.onerror = () => rej(new Error("no se pudo cargar init.js del captcha"));
                    document.body.appendChild(s);
                });
                await new Promise((r) => setTimeout(r, 800));
                const tieneInput = !!document.querySelector(".pjn-captcha #captcha-response, #captcha-response");
                const tieneIframe = !!document.querySelector(".pjn-captcha iframe, iframe[src*='captcha']");
                return { tieneInput, tieneIframe };
            });
            if (!r.tieneIframe && !r.tieneInput) {
                return err("Inyecte el widget pero no aparecio el iframe del captcha. Puede que el portal haya cambiado el sitekey. Reintenta o avisame.");
            }
            return txt(`Widget de captcha inyectado en la ventana (arriba, centrado). Decile al usuario: 'Resolve el captcha que aparecio arriba y avisame con un ok'. Cuando confirme, llama a buscar_jurisprudencia_fed (o por_expediente/por_caratula) con los parametros: el token recien generado se usa solo.`);
        } catch (error) {
            return err(`Error en preparar_captcha: ${error instanceof Error ? error.message : String(error)}`);
        }
    });

    // ---- Busqueda asistida: el conector completa y clickea, el usuario solo
    //      resuelve el captcha cuando aparece -------------------------------
    server.tool("buscar_asistido", "Completa el campo de busqueda EN LA PAGINA y aprieta Buscar; NO bloquea (devuelve enseguida). Despues el usuario resuelve el captcha que salta y se llama `leer_resultados`. Requisito: el usuario debe estar parado en la seccion elegida (camara/tipo ya seleccionados en la ventana). ANTES de llamarla avisale: 'Voy a completar y buscar; cuando salte el verificador, resolvelo y avisame'.", {
        texto: z.string().describe("Termino o frase a buscar (va al campo de busqueda visible)"),
    }, async (args) => {
        try {
            const page = await getPage();
            await instalarInterceptor(page);
            const fill = await page.evaluate((texto) => {
                const vis = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
                const inputs = [...document.querySelectorAll("input[type='text'], input:not([type]), textarea")].filter(vis);
                let input = inputs.find((i) => /busc|general|palabra|texto|t[eé]rmino/i.test((i.placeholder || "") + (i.getAttribute("aria-label") || "") + (i.id || ""))) || inputs[0];
                if (!input) return { ok: false, motivo: "No encontre un campo de texto visible. El usuario debe abrir la seccion de busqueda (elegir camara y tipo) en la ventana." };
                const proto = input.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
                const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
                if (setter) setter.call(input, texto); else input.value = texto;
                input.dispatchEvent(new Event("input", { bubbles: true }));
                input.dispatchEvent(new Event("change", { bubbles: true }));
                input.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
                const txtOf = (b) => ((b.textContent || "") + " " + (b.value || "") + " " + (b.getAttribute("aria-label") || "") + " " + (b.title || "") + " " + (b.className || "") + " " + (b.querySelector("i,span,svg") ? b.querySelector("i,span,svg").className : "")).toLowerCase();
                const cand = [...document.querySelectorAll("button, a, input[type='submit'], input[type='button'], [role='button']")].filter(vis);
                // 1) por texto/aria/title "buscar"; 2) por icono de lupa (fa-search, search, lupa, magnif)
                let btn = cand.find((b) => /buscar|consultar/.test(txtOf(b)))
                    || cand.find((b) => /search|lupa|magnif|fa-search|icon-magnifier|feather-search/.test(txtOf(b)));
                if (btn) { btn.click(); return { ok: true, via: "boton" }; }
                // 3) submit del form que contiene el input
                if (input.form) { try { input.form.requestSubmit ? input.form.requestSubmit() : input.form.submit(); return { ok: true, via: "form-submit" }; } catch { /* sigue */ } }
                // 4) Enter sobre el input (muchos buscadores disparan asi)
                for (const type of ["keydown", "keypress", "keyup"]) {
                    input.dispatchEvent(new KeyboardEvent(type, { bubbles: true, key: "Enter", code: "Enter", keyCode: 13, which: 13 }));
                }
                return { ok: true, via: "enter" };
            }, args.texto);
            if (!fill.ok) return err(`buscar_asistido: ${fill.motivo}`);
            await sleep(2000); // que el modal de captcha alcance a aparecer
            return txt(`Listo: complete "${args.texto}" y dispare la busqueda (via: ${fill.via}).\n\nDecile al usuario: 'Resolve el captcha que aparecio y avisame con un ok'. Cuando confirme, llama a \`leer_resultados\` (la respuesta queda capturada apenas el portal la entrega, no hace falta el token).`);
        } catch (error) {
            return err(`Error en buscar_asistido: ${error instanceof Error ? error.message : String(error)}`);
        }
    });

    // ---- Lectura de lo que la propia pagina ya cargo (camino confiable) ----
    server.tool("leer_resultados", "Devuelve los resultados de la ULTIMA busqueda que el usuario hizo directamente en la pagina del portal (el conector intercepta la respuesta que el portal ya entrego, sin necesitar el token del captcha). Usar despues de que el usuario busco y ve resultados en la ventana.", {}, async () => {
        try {
            const page = await getPage();
            await instalarInterceptor(page);
            // Poll corto: el usuario pudo acabar de resolver el captcha y el portal
            // estar entregando la respuesta justo ahora.
            let cap = null;
            const deadline = Date.now() + 12000;
            do {
                cap = await page.evaluate(() => window.__pjnCaptura || null);
                if (cap && cap.search) break;
                await sleep(1500);
            } while (Date.now() < deadline);
            if (!cap || !cap.search) {
                return txt("Todavia no hay resultados capturados. Si el usuario ya resolvio el captcha y ve los resultados en pantalla, reintenta leer_resultados en unos segundos. Si no, que complete la busqueda en la ventana primero.");
            }
            return txt(formatearPagina({ json: cap.search, status: 200 }, "Resultados de la busqueda", cap.search.number ?? 0));
        } catch (error) {
            return err(`Error en leer_resultados: ${error instanceof Error ? error.message : String(error)}`);
        }
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
            // 1) si la pagina ya cargo ese detalle (el usuario abrio el sumario), usarlo.
            let s = await page.evaluate((id) => (window.__pjnCaptura?.detalle?.[id]) || null, String(args.id));
            // 2) si no, intentar via API (puede requerir token segun el portal).
            if (!s) {
                const r = await apiFetch(page, `/api/public/sumarios/${args.id}`);
                if (r.status !== 200 || !r.json) return err(`Sumario ${args.id} no disponible (status ${r.status}). Si el portal lo pide, abrilo en la ventana y reintento.`);
                s = r.json;
            }
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
