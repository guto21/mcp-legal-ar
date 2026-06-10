#!/usr/bin/env node
/**
 * saij-probe.mjs - Diagnostico del 403 de SAIJ desde la maquina del usuario.
 *
 * Prueba la misma consulta por 4 vias y registra que responde cada una:
 *   1. axios directo (lo que hace hoy el conector y devuelve 403)
 *   2. axios con set completo de headers de Chrome
 *   3. Puppeteer headless "new" + fetch dentro de la pagina
 *   4. Puppeteer visible (headful) + fetch dentro de la pagina
 *
 * Uso:  cd servers/legal-mcp && node scripts/saij-probe.mjs
 * Salida: _capturas/saij-probe-<ts>.json + resumen en consola.
 */
import axios from "axios";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, "..", "..", "..", "_capturas");
const BASE = "https://www.saij.gob.ar";
const FILTRO = "Total|Tipo de Documento/Jurisprudencia";
const QUERY = `/busqueda?o=0&p=3&f=${encodeURIComponent(FILTRO)}&s=${encodeURIComponent("despido")}&v=colapsada`;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const out = { fecha: new Date().toISOString(), base: BASE, query: QUERY, intentos: {} };
const resumen = (data) => {
    const s = typeof data === "string" ? data : JSON.stringify(data);
    return { esJson: typeof data === "object" || s.trim().startsWith("{"), muestra: s.slice(0, 500), largo: s.length };
};

async function probeAxios(nombre, headers) {
    try {
        const r = await axios.get(BASE + QUERY, { headers, timeout: 30000, validateStatus: () => true });
        out.intentos[nombre] = { status: r.status, ...resumen(r.data) };
    } catch (e) {
        out.intentos[nombre] = { error: e.message, code: e.code };
    }
}

async function probePuppeteer(nombre, headless) {
    let browser = null;
    try {
        const { default: puppeteer } = await import("puppeteer");
        browser = await puppeteer.launch({ headless, defaultViewport: null, args: headless ? [] : ["--window-position=-2400,10"] });
        const page = (await browser.pages())[0] || (await browser.newPage());
        await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 45000 });
        await new Promise((r) => setTimeout(r, 2500));
        const home = { status: "ok", titulo: await page.title() };
        const res = await page.evaluate(async (q) => {
            const r = await fetch(q, { headers: { "Accept": "application/json,text/plain,*/*" } });
            const text = await r.text();
            return { status: r.status, muestra: text.slice(0, 500), largo: text.length };
        }, QUERY);
        out.intentos[nombre] = { home, fetchEnPagina: res };
    } catch (e) {
        out.intentos[nombre] = { error: e.message };
    } finally {
        if (browser) { try { await browser.close(); } catch { /* ignorar */ } }
    }
}

async function main() {
    await fs.mkdir(OUT_DIR, { recursive: true });
    console.log("1/4 axios basico...");
    await probeAxios("axios_basico", { "User-Agent": UA });
    console.log("2/4 axios headers completos...");
    await probeAxios("axios_headers_chrome", {
        "User-Agent": UA,
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "es-AR,es;q=0.9,en;q=0.8",
        "Accept-Encoding": "gzip, deflate, br",
        "Referer": BASE + "/",
        "Sec-Fetch-Dest": "empty",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "same-origin",
        "sec-ch-ua": '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"Windows"',
    });
    console.log("3/4 puppeteer headless...");
    await probePuppeteer("puppeteer_headless", "new");
    console.log("4/4 puppeteer visible (la ventana se abre fuera de pantalla)...");
    await probePuppeteer("puppeteer_visible", false);

    const outFile = path.join(OUT_DIR, `saij-probe-${out.fecha.replace(/[:.]/g, "-")}.json`);
    await fs.writeFile(outFile, JSON.stringify(out, null, 1), "utf8");
    console.log("\nResultados:");
    for (const [k, v] of Object.entries(out.intentos)) {
        const st = v.status ?? v.fetchEnPagina?.status ?? v.error;
        console.log(`  ${k}: ${st}`);
    }
    console.log(`\nGuardado: ${outFile}`);
}

main().catch((e) => { console.error("Error fatal:", e); process.exit(1); });
