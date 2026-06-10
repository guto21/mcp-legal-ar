#!/usr/bin/env node
/**
 * pjn-capture.mjs - Captura forense del DOM y trafico de red de scw.pjn.gov.ar
 *
 * Uso:
 *   cd servers/legal-mcp
 *   node scripts/pjn-capture.mjs
 *
 * Flujo:
 *   1. Abre Chromium visible en https://scw.pjn.gov.ar/scw/home.seam
 *   2. El usuario resuelve el captcha y navega manualmente:
 *      - busqueda por numero de expediente (uno conocido)
 *      - pantalla de resultados
 *      - detalle del expediente / actuaciones
 *   3. En CADA pantalla clave: volver a la consola y apretar ENTER
 *      (pide una etiqueta opcional, ej. "resultados").
 *   4. Escribir "fin" + ENTER para volcar todo y cerrar.
 *
 * Salida: _capturas/pjn-capture-<timestamp>.json (raiz del repo)
 * No guarda cookies ni credenciales. Solo estructura DOM y trafico.
 */
import puppeteer from "puppeteer";
import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, "..", "..", "..", "_capturas");
// URL objetivo como primer argumento; default: consulta de expedientes.
// Ej: node scripts/pjn-capture.mjs https://jurisprudencia.pjn.gov.ar
//     node scripts/pjn-capture.mjs https://www.saij.gob.ar
const TARGET = process.argv[2] || "https://scw.pjn.gov.ar/scw/home.seam";
// Dominio base del objetivo (sin www) para filtrar el trafico relevante.
const HOST_CORE = new URL(TARGET).hostname.replace(/^www\./, "").split(".").slice(-3).join(".");
const DOM_HTML_MAX = 400_000;
const BODY_MAX = 120_000;
const POST_MAX = 6_000;

const capture = {
  meta: { target: TARGET, started: new Date().toISOString(), tool: "pjn-capture.mjs v1" },
  network: [],
  snapshots: [],
};

const trunc = (s, n) => (typeof s === "string" && s.length > n ? s.slice(0, n) + `...[TRUNCADO ${s.length} chars]` : s);

function logNet(entry) {
  capture.network.push(entry);
}

async function snapshotPage(page, label) {
  let dom;
  try {
    dom = await page.evaluate(() => {
      const vis = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
      const txt = (s, n = 120) => (s || "").replace(/\s+/g, " ").trim().slice(0, n);
      const forms = [...document.querySelectorAll("form")].map((f) => ({
        id: f.id, name: f.name, action: f.action, method: f.method, enctype: f.enctype,
      }));
      const campos = [...document.querySelectorAll("input,select,textarea,button")].slice(0, 400).map((el) => {
        const base = {
          tag: el.tagName.toLowerCase(), type: el.type || null, id: el.id || null, name: el.name || null,
          value: el.name === "javax.faces.ViewState" ? "[VIEWSTATE presente]" : txt(el.value, 80),
          placeholder: el.placeholder || null, visible: vis(el),
          form: el.form ? el.form.id || el.form.name : null,
          onclick: el.getAttribute ? txt(el.getAttribute("onclick"), 300) : null,
          label: el.labels && el.labels[0] ? txt(el.labels[0].textContent) : (el.getAttribute("aria-label") || el.title || null),
        };
        if (el.tagName === "SELECT") {
          base.options = [...el.options].slice(0, 80).map((o) => ({ value: o.value, text: txt(o.textContent, 80) }));
        }
        if (el.tagName === "BUTTON") base.text = txt(el.textContent, 80);
        return base;
      });
      const anchors = [...document.querySelectorAll("a")].filter((a) =>
        (a.getAttribute("href") || "").includes(".seam") || a.getAttribute("onclick")
      ).slice(0, 150).map((a) => ({
        href: a.getAttribute("href"), onclick: txt(a.getAttribute("onclick"), 300),
        id: a.id || null, text: txt(a.textContent, 100),
      }));
      const tablas = [...document.querySelectorAll("table")].slice(0, 25).map((t) => ({
        id: t.id || null, clase: t.className || null, filas: t.rows.length,
        encabezados: [...t.querySelectorAll("th")].slice(0, 20).map((th) => txt(th.textContent, 60)),
        muestra: [...t.rows].slice(0, 4).map((r) => [...r.cells].slice(0, 12).map((c) => txt(c.textContent, 80))),
      }));
      const viewState = document.querySelector('input[name="javax.faces.ViewState"]');
      const scripts = [...document.querySelectorAll("script[src]")].map((s) => s.src.split("/").pop())
        .filter((s) => /jsf|faces|rich|prime|jquery|captcha|recaptcha/i.test(s)).slice(0, 25);
      const iframes = [...document.querySelectorAll("iframe")].slice(0, 10).map((f) => ({ src: f.src, id: f.id || null, title: f.title || null }));
      return {
        url: location.href, titulo: document.title,
        tieneViewState: !!viewState,
        tieneRecaptcha: !!document.querySelector('.g-recaptcha, iframe[src*="recaptcha"], [data-sitekey]'),
        siteKey: (document.querySelector("[data-sitekey]") || {}).dataset?.sitekey || null,
        forms, campos, anchors, tablas, scripts, iframes,
        textoVisible: txt(document.body.innerText, 3000),
      };
    });
  } catch (e) {
    dom = { error: String(e) };
  }
  let html = "";
  try { html = trunc(await page.content(), DOM_HTML_MAX); } catch { /* navegacion en curso */ }
  capture.snapshots.push({ n: capture.snapshots.length + 1, label, ts: new Date().toISOString(), dom, html });
  console.log(`  [snapshot ${capture.snapshots.length}] "${label}" -> ${dom.url || "?"} (forms: ${dom.forms?.length ?? "?"}, tablas: ${dom.tablas?.length ?? "?"})`);
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  console.log("Abriendo Chromium en " + TARGET);
  const browser = await puppeteer.launch({ headless: false, defaultViewport: null, args: ["--start-maximized"] });
  const page = (await browser.pages())[0] || (await browser.newPage());

  page.on("request", (req) => {
    const url = req.url();
    if (!(url.includes(HOST_CORE) || /pjn\.gov\.ar|recaptcha|gstatic/.test(url))) return;
    logNet({
      dir: "req", ts: new Date().toISOString(), method: req.method(), url,
      tipo: req.resourceType(),
      postData: req.method() === "POST" ? trunc(req.postData() || "", POST_MAX) : undefined,
      headers: ((h) => ({ "content-type": h["content-type"], accept: h["accept"], faces: h["faces-request"] }))(req.headers()),
    });
  });
  page.on("response", async (res) => {
    const url = res.url();
    if (!(url.includes(HOST_CORE) || /pjn\.gov\.ar/.test(url))) return;
    const ct = res.headers()["content-type"] || "";
    const entry = { dir: "res", ts: new Date().toISOString(), status: res.status(), url, contentType: ct };
    if (/text|json|xml|javascript/.test(ct) && res.status() < 400) {
      try { entry.body = trunc(await res.text(), BODY_MAX); } catch { entry.body = "[no legible]"; }
    }
    logNet(entry);
  });
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) console.log(`  [nav] ${frame.url()}`);
  });

  await page.goto(TARGET, { waitUntil: "domcontentloaded", timeout: 60_000 }).catch((e) => console.error("goto:", e.message));
  await snapshotPage(page, "inicial");

  console.log(`
================================================================
INSTRUCCIONES
 1. Resolve el captcha en la ventana de Chromium.
 2. Hace la busqueda (numero de expediente conocido) y navega
    al detalle y a las actuaciones.
 3. En CADA pantalla clave volve aca y apreta ENTER
    (te pide una etiqueta, ej: "captcha-resuelto", "resultados",
    "detalle", "actuaciones").
 4. Escribi "fin" + ENTER para guardar y cerrar.
================================================================
`);

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => new Promise((res) => rl.question(q, res));
  for (;;) {
    const resp = (await ask('ENTER = snapshot | "fin" = terminar > ')).trim();
    if (resp.toLowerCase() === "fin") break;
    const label = resp || `manual-${capture.snapshots.length + 1}`;
    await snapshotPage(page, label);
  }
  rl.close();

  capture.meta.finished = new Date().toISOString();
  const slug = TARGET.replace(/https?:\/\//, "").replace(/[^a-z0-9]+/gi, "-").slice(0, 40);
  const outFile = path.join(OUT_DIR, `captura-${slug}-${capture.meta.started.replace(/[:.]/g, "-")}.json`);
  await fs.writeFile(outFile, JSON.stringify(capture, null, 1), "utf8");
  console.log(`\nCaptura guardada: ${outFile}`);
  console.log(`Snapshots: ${capture.snapshots.length} | Eventos de red: ${capture.network.length}`);
  await browser.close().catch(() => {});
  process.exit(0);
}

main().catch((e) => { console.error("Error fatal:", e); process.exit(1); });
