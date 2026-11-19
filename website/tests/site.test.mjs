#!/usr/bin/env node
/* Verifies the built landing: verbatim source content, navigation anchors,
   self-contained assets, and the approved external links — nothing else. */

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, readdir, readFile, stat } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import test, { before } from "node:test";
import { promisify } from "node:util";
import { gzipSync } from "node:zlib";

const run = promisify(execFile);
const root = resolve(import.meta.dirname, "..");
const dist = join(root, "dist");

let html = "";
let css = "";
/* index.html with tags stripped: content fidelity must not depend on which
   inline elements the markup happens to use. */
let text = "";

/* Exact strings carried over from the source site; see ../../CONTENT-AUDIT.md. */
const REQUIRED_TEXT = [
  "ИИ умеет больше, чем отвечать в чате.",
  "Научитесь поручать ему реальные дела.",
  "Индивидуальные занятия по ИИ · онлайн",
  "Записаться на бесплатный чек-ап",
  "Посмотреть примеры",
  "30 минут бесплатно",
  "Программирование не требуется",
  "Всё собираем на вашей задаче",
  "Отправь Андрею последний инвойс. Напиши, что оплатить нужно до пятницы",
  "Ждёт вашего подтверждения",
  "Не рассказывать, а показать",
  "Ответ — это ещё не выполненная задача",
  "Автоматизируем работу. Не ответственность.",
  "Что вы сможете собрать для себя",
  "Письмо голосом с телефона",
  "Цифровой двойник из переписок",
  "Циклы и паттерны в Telegram",
  "Учёт, инвойсы и декларации",
  "Статусы и сроки документов",
  "Личный архив документов",
  "Тренер и трекер привычек",
  "Сложный поиск поездок и жилья",
  "Личный ассистент с памятью",
  "И это только начало",
  "Сначала ваша задача. Потом инструменты.",
  "Меня зовут Алексей Грищенко.",
  "Алло, Нейросеточная?",
  "Коротко о важном",
  "Нужно уметь программировать?",
  "Чем это отличается от курса по промптам?",
  "ИИ получит доступ ко всем моим данным?",
  "Он может сам отправлять письма и подавать документы?",
  "Можно ли доверять анализу переписок и фото?",
  "Можно прийти со своей задачей?",
  "Какую задачу вы до сих пор делаете вручную?",
  "Напишите мне слово «задача»",
  "Не присылайте конфиденциальные файлы"
];

/* Dropped from the page on the client's instruction; see ../../CONTENT-AUDIT.md.
   Listed so a copy-paste cannot quietly bring them back. */
const REMOVED_TEXT = [
  "Индивидуальное обучение практической работе с ИИ.",
  "Без привязки к одной модели, сервису или приложению.",
  "Алексей · ИИ по делу"
];

const REQUIRED_LINKS = [
  "https://t.me/AlexOxitocin",
  "https://t.me/+uzk17Dr2rREyNmRi",
  "https://www.linkedin.com/in/aleksei-grishchenko/",
  "https://ks-design.art/"
];

/* Any URL in built output must start with one of these. */
const ALLOWED_URL_PREFIXES = [
  ...REQUIRED_LINKS,
  "https://alex-neon.ks-design.workers.dev",
  "http://www.w3.org/",
  "https://www.w3.org/",
  "http://www.sitemaps.org/"
];

async function distFiles(dir = dist) {
  const entries = await readdir(dir, { withFileTypes: true });
  const out = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await distFiles(path)));
    else out.push(path);
  }
  return out;
}

before(async () => {
  await run(process.execPath, [join(root, "scripts/build.mjs")]);
  html = await readFile(join(dist, "index.html"), "utf8");
  css = await readFile(join(dist, "assets/styles.css"), "utf8");
  text = html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ");
});

test("landing keeps the verbatim source content", () => {
  for (const phrase of REQUIRED_TEXT) {
    assert.ok(text.includes(phrase), `missing verbatim text: ${phrase}`);
  }
});

test("quotation marks follow the source: guillemets, never low-nine", () => {
  assert.ok(
    !/[„“”]/.test(text),
    "source uses « » throughout, including nested quotes"
  );
  for (const phrase of [
    "«Отправь Андрею последний инвойс и напиши, что оплата до пятницы»",
    "«найди договор аренды за 2024 год»",
    "Помнит не «всё на свете», а нужное и разрешённое.",
    "«Алло, Нейросеточная?»"
  ]) {
    assert.ok(text.includes(phrase), `missing quoted phrase: ${phrase}`);
  }
});

test("document metadata and a single h1", () => {
  assert.ok(html.includes('lang="ru"'), "html lang must be ru");
  assert.ok(html.includes('name="viewport"'), "viewport meta required");
  assert.ok(
    html.includes(
      "<title>ИИ по делу — индивидуальное обучение на ваших задачах</title>"
    ),
    "source page title preserved"
  );
  assert.equal(html.match(/<h1[\s>]/g)?.length, 1, "exactly one h1");
});

test("navigation anchor targets exist", () => {
  for (const id of ["examples", "control", "process", "about", "contact"]) {
    assert.ok(new RegExp(`id="${id}"`).test(html), `missing #${id}`);
  }
});

test("approved outbound links are present", () => {
  for (const link of REQUIRED_LINKS) {
    assert.ok(html.includes(`href="${link}"`), `missing link: ${link}`);
  }
});

test("no unapproved external URLs anywhere in dist", async () => {
  for (const file of await distFiles()) {
    if (![".html", ".css", ".js", ".svg", ".xml", ".txt"].includes(extname(file)))
      continue;
    // Bundled OFL licence texts carry upstream project URLs by design; their
    // provenance lives in ../../third-party-notices.md.
    if (file.includes(join("assets", "fonts"))) continue;
    const content = await readFile(file, "utf8");
    for (const [url] of content.matchAll(/https?:\/\/[^\s"'<>()]+/g)) {
      assert.ok(
        ALLOWED_URL_PREFIXES.some((prefix) => url.startsWith(prefix)),
        `unapproved URL ${url} in ${file}`
      );
    }
  }
});

test("both interactive fields are present and honour reduced motion", async () => {
  assert.ok(html.includes('class="hero-canvas"'), "hero canvas missing");
  assert.ok(
    html.includes('class="process-canvas"'),
    "process canvas missing: the steps answer the pointer too"
  );
  const neural = await readFile(join(dist, "assets/neural.js"), "utf8");
  assert.ok(
    /prefers-reduced-motion/.test(neural),
    "neural.js must check prefers-reduced-motion"
  );
  /* The generator is shared with the social-card renderer. */
  await access(join(dist, "assets/field.js"));
  /* The palette is a separate module, so it has to reach dist too. */
  await access(join(dist, "assets/palette.js"));
});

/* Touch has no hover, so the hero seeds its own pulses there. That is the one
   thing on the page that moves without the visitor asking, so every gate it
   leans on is worth pinning down: it must be off for a mouse, off under
   reduced motion, and off while the field is asleep — the last one is what
   keeps a phone from animating a hero that scrolled away. */
test("the hero's ambient pulses stay behind every motion gate", async () => {
  const neural = await readFile(join(dist, "assets/neural.js"), "utf8");
  assert.ok(/ambientEvery:\s*\d+/.test(neural), "the hero must ask for ambient pulses");
  const gate = neural.match(/const ambientDue = \(\) =>\s*([^;]+);/);
  assert.ok(gate, "ambientDue must exist as the single gate for the pulses");
  for (const condition of ["ambientEvery > 0", "coarseQuery.matches", "!reduced", "!asleep()"]) {
    assert.ok(gate[1].includes(condition), `ambientDue must require ${condition}`);
  }
  assert.ok(
    /hover: none/.test(neural),
    "coarseQuery must be the hover query, or a mouse would get the pulses too"
  );
  /* stop() runs on reduced motion, on a hidden tab and off-screen; if it left
     the timer pending the field would wake itself back up a few seconds later. */
  assert.ok(
    /function stop\(\) \{\s*stopAmbient\(\);/.test(neural),
    "stopping the loop must also cancel the pending pulse"
  );
});

/* The dome is the whole point of the phone hero, and its geometry is the part
   most likely to go quietly wrong: it is derived from the live layout, so a
   copy block that grows or a narrower screen silently changes it. placement.js
   is pure apart from two globals, so the real function can be measured here
   against a stand-in layout instead of trusted by eye. */
test("the stacked dome is a half sphere that clears the copy", async () => {
  const canvas = { getBoundingClientRect: () => ({ left: 0, top: 0 }) };
  /* 375 × 812 phone: copy ends at 512, hero and canvas fill the viewport. */
  const vars = { "--nx": "0.5", "--ny": "1", "--nr": "0.62" };
  globalThis.getComputedStyle = () => ({ getPropertyValue: (n) => vars[n] ?? "" });
  globalThis.document = {
    querySelector: (sel) =>
      sel === ".hero-copy"
        ? { getBoundingClientRect: () => ({ right: 375, bottom: 512 }) }
        : null
  };

  const { measureShape } = await import(join(root, "src/js/placement.js"));
  const cssWidth = 375;
  const cssHeight = 812;
  const shape = measureShape({
    canvas,
    options: { keepRightOf: ".hero-copy", keepBelow: ".site-header", keepBelowStacked: ".hero-copy" },
    cssWidth,
    cssHeight,
    dpr: 1,
    W: cssWidth,
    H: cssHeight
  });

  assert.ok(shape.stacked, "a full-width copy leaves no column, so this is the stacked layout");
  /* Centre on the bottom edge is what makes the visible part a half sphere:
     any higher and the underside shows, any lower and it is a shallow arc. */
  assert.equal(shape.cy, cssHeight, "the equator must sit on the canvas bottom edge");
  assert.ok(shape.ry > 0, "the dome must survive the clearance clamps");
  assert.ok(
    shape.cy - shape.ry > 512,
    `the dome tops out at ${shape.cy - shape.ry}, which is into the copy above 512`
  );
  /* Cropping the shoulders is deliberate; cropping past them is the shallow
     arc this replaced, so the radius stays inside the documented bound. */
  assert.ok(
    shape.rx <= cssWidth * 0.62 + 0.001,
    `radius ${shape.rx} crops more than the shoulders off a ${cssWidth}px canvas`
  );
  assert.equal(shape.rx, shape.ry, "the dome is a circle, not an ellipse");

  /* The phone layout reserves a content-sized band: 24 px of clearance plus
     the width-bound radius. Its canvas height therefore does not follow the
     visible viewport when Safari's bars collapse during a scroll. */
  const reservedRadius = cssWidth * 0.62;
  const stableHeight = 512 + 24 + reservedRadius;
  const stable = measureShape({
    canvas,
    options: { keepRightOf: ".hero-copy", keepBelowStacked: ".hero-copy" },
    cssWidth,
    cssHeight: stableHeight,
    dpr: 1,
    W: cssWidth,
    H: stableHeight
  });
  assert.equal(stable.ry, reservedRadius, "the reserved band must leave the width-bound radius");
  assert.equal(stable.cy - stable.ry, 512 + 24, "the stable dome must keep its copy gap");
  assert.match(
    css,
    /@media \(max-width: 60em\)[\s\S]{0,500}?\.hero \{[\s\S]{0,200}?min-height: 0;[\s\S]{0,200}?padding-bottom: calc\(var\(--sp-5\) \+ 62vw\);/,
    "the mobile hero must reserve its dome by width instead of viewport height"
  );

  delete globalThis.getComputedStyle;
  delete globalThis.document;
});

/* Both of these were review findings: the budget scaled off canvas area, so a
   collapsed dome still got a canvas-sized crowd packed into it, and the
   clearance was measured once against fallback font metrics. */
test("the stacked node budget and the clearance follow the live layout", async () => {
  const neural = await readFile(join(dist, "assets/neural.js"), "utf8");
  /* Budget off the disc, not the canvas: shape.rx is the collapsing quantity,
     cssWidth * cssHeight is not. */
  assert.ok(
    /shape\.stacked[\s\S]{0,200}?Math\.PI \* \(shape\.rx \/ dpr\) \*\* 2/.test(neural),
    "the stacked budget must be reckoned from the dome's own radius"
  );
  assert.ok(
    /Math\.max\(shape\.stacked \? \d+ : 120,/.test(neural),
    "the node floor must drop for a stacked dome, or it undoes the scaling"
  );
  /* Fonts swap in after first paint and the copy rewraps, so observing both
     nodes keeps the content-sized hero band and clearance in sync. */
  assert.ok(
    /resizes\.observe\(keepOut\)/.test(neural),
    "the keep-out element must be observed, not just the canvas"
  );
  assert.ok(
    /Math\.abs\(keepOutHeight\(\) - lastKeepOut\) < 2/.test(neural),
    "its height must be part of the change guard, or the rebuild is skipped"
  );
});

test("scroll and touch glow stay behind the same gates as the pulses", async () => {
  const neural = await readFile(join(dist, "assets/neural.js"), "utf8");
  assert.ok(/scrollDriven:\s*true/.test(neural), "the hero must ask for scroll seeding");
  /* A non-passive scroll listener would let the seeding block scrolling — the
     one thing on a phone that must never stutter. */
  assert.ok(
    /"scroll",[\s\S]{0,400}?\{ passive: true \}/.test(neural),
    "the scroll listener must be passive"
  );
  const guard = neural.match(/if \(reduced \|\| !coarseQuery\.matches \|\| asleep\(\)\) return;/);
  assert.ok(guard, "scroll seeding must be off for a mouse, reduced motion and a sleeping field");
  /* The extra glow is there to answer a scrim and a small figure, both of which
     are phone-only; on a desktop it would just blow the sphere out. */
  assert.ok(
    /coarseQuery\.matches \? options\.touchGlow \?\? 1 : 1/.test(neural),
    "touchGlow must apply to coarse pointers only"
  );
});

test("the wordmark is the ALEX OXITOCIN logo with an accessible name", () => {
  assert.ok(html.includes('id="logo-alex-oxitocin"'), "logo definition missing");
  assert.equal(
    (html.match(/href="#logo-alex-oxitocin"/g) ?? []).length,
    1,
    "the logo is used once, in the header"
  );
  assert.ok(
    /<a class="brand"[^>]*aria-label="Alex Oxitocin/.test(html),
    "the brand link needs an accessible name once its text became a drawing"
  );
  /* A <symbol> would give <use> its own viewport anchored at (0,0) and shift
     the drawing out of a viewBox whose origin is negative, shaving the N. */
  assert.ok(
    !/<symbol[^>]*id="logo-alex-oxitocin"/.test(html),
    "the logo must be a plain group in <defs>, not a <symbol>"
  );
  /* The last letter's stroke has to sit inside the viewBox, cap included —
     that is exactly what was clipping the N. */
  const stroke = Number(html.match(/id="logo-alex-oxitocin"[^>]*stroke-width="([\d.]+)"/)[1]);
  /* The cap height is not pinned here — it has been retuned deliberately more
     than once. What must hold is that the N's own box, whatever its height,
     still ends inside the viewBox with its stroke cap on. */
  const [nx, nw] = html.match(/d="M(\d+) \d+V6l(\d+) \d+V6"/).slice(1).map(Number);
  const [vbLeft, , vbWidth] = html
    .match(/<svg class="logo" viewBox="(-?[\d.]+) (-?[\d.]+) ([\d.]+) ([\d.]+)"/)
    .slice(1)
    .map(Number);
  assert.ok(
    nx + nw + stroke / 2 <= vbLeft + vbWidth,
    `the N ends at ${nx + nw + stroke / 2}, past the viewBox edge ${vbLeft + vbWidth}`
  );
  assert.ok(vbLeft <= -stroke / 2, "the viewBox needs padding on the left too");
});

test("the field generator survives a degenerate box", async () => {
  const { generateField } = await import(join(root, "src/js/field.js"));
  for (const box of [
    { rx: 0, ry: 0 },
    { rx: -20, ry: 40 },
    { rx: 40, ry: 0 }
  ]) {
    const field = generateField({ cx: 100, cy: 50, nodes: 500, ...box });
    assert.equal(field.count, 0, `${JSON.stringify(box)} must yield no nodes`);
    assert.equal(field.edgeCount, 0);
  }

  /* A real circle: every coordinate and radius has to be a usable number, or
     the canvas silently draws nothing. */
  const field = generateField({
    cx: 300,
    cy: 300,
    rx: 300,
    ry: 300,
    nodes: 800,
    rim: true
  });
  assert.ok(field.count > 400, `only ${field.count} nodes generated`);
  assert.ok(
    field.x.every(Number.isFinite) && field.y.every(Number.isFinite),
    "node coordinates must all be finite"
  );
  assert.ok(
    field.r.every((radius) => Number.isFinite(radius) && radius > 0),
    "node radii must all be positive"
  );
  for (let e = 0; e < field.edgeCount; e++) {
    assert.ok(
      field.ea[e] >= 0 && field.ea[e] < field.count,
      "edge endpoints must index real nodes"
    );
    assert.ok(field.eb[e] >= 0 && field.eb[e] < field.count);
  }
});

test("the field generator gives every anchor its own dendrites", async () => {
  const { generateField } = await import(join(root, "src/js/field.js"));
  const anchors = [-300, -150, 0, 150, 300].map((x) => ({ x, y: 0 }));
  const field = generateField({
    cx: 0,
    cy: 0,
    rx: 400,
    ry: 150,
    nodes: 120,
    seed: 0x51e9,
    anchors
  });

  const neighbours = Array.from({ length: field.count }, () => []);
  for (let e = 0; e < field.edgeCount; e++) {
    neighbours[field.ea[e]].push(field.eb[e]);
    neighbours[field.eb[e]].push(field.ea[e]);
  }

  for (const anchor of anchors) {
    let nearest = 0;
    let distance = Infinity;
    for (let i = 0; i < field.count; i++) {
      const candidate = Math.hypot(field.x[i] - anchor.x, field.y[i] - anchor.y);
      if (candidate < distance) {
        nearest = i;
        distance = candidate;
      }
    }
    const seen = new Set([nearest]);
    const queue = [nearest];
    for (let q = 0; q < queue.length; q++) {
      for (const node of neighbours[queue[q]]) {
        if (seen.has(node)) continue;
        seen.add(node);
        queue.push(node);
      }
    }
    assert.ok(seen.size > 12, `anchor at x=${anchor.x} has only its ${seen.size}-node core`);
  }
});

test("fork junctions do not become endpoint somas", async () => {
  const { generateField } = await import(join(root, "src/js/field.js"));
  const field = generateField({ cx: 0, cy: 0, rx: 320, ry: 180, nodes: 500 });
  const degree = new Uint16Array(field.count);
  for (let e = 0; e < field.edgeCount; e++) {
    degree[field.ea[e]]++;
    degree[field.eb[e]]++;
  }
  const coreRadius = Math.sqrt(320 * 180) * 0.17;
  for (let i = 0; i < field.count; i++) {
    if (degree[i] < 2 || Math.hypot(field.x[i], field.y[i]) <= coreRadius * 1.1) continue;
    assert.ok(field.r[i] <= 1.6, `junction ${i} has endpoint radius ${field.r[i]}`);
  }
});

test("the social card carries the current renderer fingerprint", async () => {
  const {
    CARD_FINGERPRINT_KEY,
    createSocialField,
    fingerprintSocialCard,
    readPngText
  } = await import(join(root, "scripts/social-field.mjs"));
  const card = await readFile(join(root, "assets", "og.png"));
  assert.equal(
    readPngText(card, CARD_FINGERPRINT_KEY),
    fingerprintSocialCard(createSocialField()),
    "run npm run og and commit the regenerated card"
  );
});

test("the footer preserves the copyright and approved developer credit", () => {
  const footer = html.slice(html.indexOf("<footer"));
  assert.ok(footer.includes("© Alex Oxitocin"), "copyright line missing");
  assert.ok(!footer.includes("<use"), "the footer no longer repeats the logo");
  assert.ok(
    /<a[^>]*class="footer-signature"[^>]*href="https:\/\/ks-design\.art\/"[^>]*>ks-design\.art<\/a>/.test(footer),
    "the whole ks-design.art name must link to the portfolio"
  );
  assert.ok(
    /<p class="footer-credit" lang="en">/.test(footer),
    "the English credit needs its own language"
  );
  assert.ok(
    footer.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").includes(
      "Designed by ks-design.art · Built with AI workflows"
    ),
    "approved developer credit missing or changed"
  );
  assert.ok(!footer.includes("<img"), "the footer credit must be text");
  for (const phrase of REMOVED_TEXT) {
    assert.ok(!text.includes(phrase), `text was removed but is still present: ${phrase}`);
  }
});

test("the community mark is self-hosted and described", () => {
  assert.ok(
    html.includes('src="./assets/community-mark.jpg"'),
    "community mark missing"
  );
  assert.ok(
    /community-mark\.jpg"[^>]*alt="[^"]+"/.test(html) ||
      /alt="[^"]*Алло, Нейросеточная[^"]*"/.test(html),
    "community mark needs a meaningful alt text"
  );
});

test("keyboard focus styling exists", () => {
  assert.ok(css.includes(":focus-visible"), "css must style :focus-visible");
});

test("self-hosted fonts are shipped and referenced locally", async () => {
  const fonts = await readdir(join(dist, "assets/fonts"));
  assert.ok(
    fonts.some((file) => file.endsWith(".woff2")),
    "no woff2 fonts in dist"
  );
  assert.ok(!/fonts\.(googleapis|gstatic)\.com/.test(css + html));
});

test("every stylesheet url() resolves inside dist", async () => {
  for (const [, ref] of css.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) {
    if (ref.startsWith("data:")) continue;
    const clean = ref.replace(/^(\.\/|\/)/, "").split(/[?#]/)[0];
    await access(join(dist, "assets", clean.replace(/^assets\//, "")));
  }
});

test("stage support files are emitted", async () => {
  for (const file of [
    "404.html",
    "robots.txt",
    "sitemap.xml",
    "assets/favicon.svg",
    "assets/og.png",
    "assets/community-mark.jpg"
  ]) {
    await access(join(dist, file));
  }
});

test("nothing extra ships: the payload stays within budget", async () => {
  /* Uncompressed caps per type, with headroom over today's build. */
  const budgets = {
    ".html": 60 * 1024,
    ".css": 60 * 1024,
    ".js": 48 * 1024,
    ".woff2": 160 * 1024,
    ".jpg": 40 * 1024,
    ".png": 400 * 1024 /* og.png is fetched by crawlers, not by the page */
  };
  const totals = {};
  let gzipJsTotal = 0;
  for (const file of await distFiles()) {
    const { size } = await stat(file);
    const extension = extname(file);
    totals[extension] = (totals[extension] ?? 0) + size;
    if (extension === ".js" && file.startsWith(join(dist, "assets"))) {
      gzipJsTotal += gzipSync(await readFile(file)).length;
    }
  }
  for (const [extension, budget] of Object.entries(budgets)) {
    assert.ok(
      (totals[extension] ?? 0) <= budget,
      `${extension} payload ${totals[extension]} exceeds ${budget} bytes`
    );
  }
  assert.ok(
    gzipJsTotal <= 20 * 1024,
    `.js payload ${gzipJsTotal} bytes gzipped exceeds 20480`
  );
  assert.deepEqual(
    Object.keys(totals).sort(),
    [".css", ".html", ".jpg", ".js", ".png", ".svg", ".txt", ".woff2", ".xml"],
    "an unexpected file type appeared in dist"
  );

  /* What the browser actually downloads before first render, gzipped. */
  const critical = ["index.html", "assets/styles.css", "assets/site.js", "assets/neural.js", "assets/field.js"];
  let text = "";
  for (const file of critical) text += await readFile(join(dist, file), "utf8");
  const compressed = gzipSync(Buffer.from(text), { level: 9 }).length;
  assert.ok(
    compressed <= 45 * 1024,
    `critical text payload ${compressed} bytes gzipped exceeds 46080`
  );
});
