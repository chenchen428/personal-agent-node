#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const GIFT_TEMPLATE_ID = "gift-advisor-report";
export const GIFT_TEMPLATE_VERSION = 1;
export const GIFT_TEMPLATE_MARKER = "personal-agent-page-template";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(scriptDirectory, "..");
const planFileName = "gift-plan.json";
const MAX_INPUT_BYTES = 1024 * 1024;

const labelsByLocale = {
  "zh-CN": {
    prepared: "为你准备的礼物提案",
    portrait: "收礼者画像",
    facts: "我们确切知道",
    inferences: "谨慎推断",
    unknowns: "仍需确认",
    strategies: "三条送礼路径",
    strategyLead: "不是寻找唯一答案，而是在不同价值之间做选择。",
    all: "全部方案",
    recommendations: "推荐清单",
    recommendationLead: "每项都说明为什么合适，以及下单前需要确认什么。",
    sortFit: "按契合度",
    sortPrice: "按预算",
    fit: "契合度",
    evidence: "为什么合适",
    watchouts: "下单前确认",
    personalization: "让它更有心意",
    details: "查看判断依据",
    close: "收起判断依据",
    shortlist: "加入备选",
    shortlisted: "已加入备选",
    openProduct: "查看商品",
    officialProduct: "官网商品",
    listedPrice: "页面标价",
    imageUnavailable: "商品图暂时无法加载",
    checked: "核验",
    delivery: "把礼物送到心坎上",
    deliveryLead: "礼物本身只完成一半，确认、包装与表达决定另一半。",
    sources: "商品与价格来源",
    noSources: "本提案使用礼物形态与估算价格，没有附带未经核验的购买链接。",
    copy: "复制备选清单",
    copied: "已复制备选清单",
    copyEmpty: "先选择至少一个备选",
    print: "打印 / 存为 PDF",
    theme: "切换暮色模式",
    themeLight: "切换日光模式",
    budget: "预算",
    occasion: "场合",
    relationship: "关系",
    generated: "生成时间",
    ending: "礼物不是证明你多会挑，而是让对方感到：你真的看见了我。",
    capability: "信息说明",
  },
  "en-US": {
    prepared: "A considered gift proposal",
    portrait: "Recipient portrait",
    facts: "What we know",
    inferences: "Careful inferences",
    unknowns: "Still to confirm",
    strategies: "Gift strategies",
    strategyLead: "There is no single perfect answer—choose the value you want the gift to carry.",
    all: "All ideas",
    recommendations: "Recommendation shortlist",
    recommendationLead: "Every option explains its fit and what to confirm before buying.",
    sortFit: "Best fit",
    sortPrice: "Price",
    fit: "Fit",
    evidence: "Why it fits",
    watchouts: "Confirm first",
    personalization: "Make it personal",
    details: "View rationale",
    close: "Hide rationale",
    shortlist: "Add to shortlist",
    shortlisted: "Shortlisted",
    openProduct: "View product",
    officialProduct: "Official product",
    listedPrice: "Listed price",
    imageUnavailable: "Product image is temporarily unavailable",
    checked: "Checked",
    delivery: "Deliver the feeling",
    deliveryLead: "The object is only half of the gift. Timing, presentation, and words complete it.",
    sources: "Product and price sources",
    noSources: "This proposal uses gift forms and estimated prices; it includes no unverified purchase links.",
    copy: "Copy shortlist",
    copied: "Shortlist copied",
    copyEmpty: "Choose at least one option first",
    print: "Print / Save PDF",
    theme: "Toggle evening theme",
    themeLight: "Toggle daylight theme",
    budget: "Budget",
    occasion: "Occasion",
    relationship: "Relationship",
    generated: "Generated",
    ending: "A gift is not proof of taste. It is a way to say: I really noticed you.",
    capability: "Information note",
  },
  "ja-JP": {
    prepared: "あなたのためのギフト提案",
    portrait: "贈る相手の理解",
    facts: "分かっていること",
    inferences: "慎重な推測",
    unknowns: "確認したいこと",
    strategies: "贈り方の方向",
    strategyLead: "唯一の正解ではなく、贈り物に込める価値を選びます。",
    all: "すべて",
    recommendations: "おすすめ候補",
    recommendationLead: "合う理由と、購入前に確認したい点を明示します。",
    sortFit: "相性順",
    sortPrice: "価格順",
    fit: "相性",
    evidence: "合う理由",
    watchouts: "購入前の確認",
    personalization: "心を添える工夫",
    details: "根拠を見る",
    close: "根拠を閉じる",
    shortlist: "候補に追加",
    shortlisted: "候補に追加済み",
    openProduct: "商品を見る",
    officialProduct: "公式商品",
    listedPrice: "掲載価格",
    imageUnavailable: "商品画像を読み込めません",
    checked: "確認日",
    delivery: "気持ちまで届ける",
    deliveryLead: "品物は半分。タイミング、包み方、言葉が残り半分です。",
    sources: "商品・価格の情報源",
    noSources: "未確認の購入リンクは掲載せず、ギフト形態と価格目安のみを示しています。",
    copy: "候補をコピー",
    copied: "候補をコピーしました",
    copyEmpty: "先に候補を選んでください",
    print: "印刷 / PDF 保存",
    theme: "夕暮れテーマに切替",
    themeLight: "日中テーマに切替",
    budget: "予算",
    occasion: "機会",
    relationship: "関係",
    generated: "作成日",
    ending: "贈り物はセンスの証明ではなく、「あなたをちゃんと見ている」と伝える方法です。",
    capability: "情報について",
  },
};

export function generateGiftAdvisorPage({ projectDir, output, template = GIFT_TEMPLATE_ID } = {}) {
  if (template !== GIFT_TEMPLATE_ID) throw giftError("INVALID_TEMPLATE", `--template must be ${GIFT_TEMPLATE_ID}`);
  const resolvedProject = path.resolve(required(projectDir, "--project-dir"));
  const resolvedOutput = path.resolve(required(output, "--output"));
  const derivedRoot = path.join(resolvedProject, "derived");
  if (!isInside(derivedRoot, resolvedOutput)) {
    throw giftError("PROJECT_OUTPUT_VIOLATION", "Page output must stay inside the project derived directory");
  }
  const planPath = path.join(resolvedProject, planFileName);
  if (!fs.existsSync(planPath)) throw giftError("PLAN_REQUIRED", `${planFileName} is missing`);
  const bytes = fs.readFileSync(planPath);
  if (!bytes.length || bytes.length > MAX_INPUT_BYTES) {
    throw giftError("PLAN_SIZE_INVALID", `${planFileName} must be between 1 byte and 1 MiB`);
  }
  let input;
  try {
    input = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw giftError("PLAN_JSON_INVALID", `${planFileName} is not valid JSON: ${error.message}`);
  }
  const plan = validateGiftPlan(input);
  const html = renderGiftPage(plan);
  const cover = renderGiftCoverSvg(plan);
  const target = replaceGeneratedDirectory(resolvedOutput, {
    "index.html": html,
    "cover.svg": cover,
  });
  const manifest = {
    schemaVersion: 1,
    templateId: GIFT_TEMPLATE_ID,
    templateVersion: GIFT_TEMPLATE_VERSION,
    artifactMarker: GIFT_TEMPLATE_MARKER,
    source: {
      kind: "space-owned-gift-advisor-plan-v1",
      planSha256: sha256(bytes),
      recommendationCount: plan.recommendations.length,
      strategyCount: plan.strategies.length,
      locale: plan.locale,
      visualAcceptance: "user",
    },
    files: {
      "index.html": fileRecord(path.join(target, "index.html")),
      "cover.svg": fileRecord(path.join(target, "cover.svg")),
    },
  };
  fs.writeFileSync(path.join(target, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  const verification = verifyGiftAdvisorPage(target);
  return {
    ok: true,
    schemaVersion: 1,
    template: {
      id: GIFT_TEMPLATE_ID,
      version: GIFT_TEMPLATE_VERSION,
      artifactMarker: GIFT_TEMPLATE_MARKER,
      visualAcceptance: "user",
    },
    output: path.relative(resolvedProject, target),
    planSha256: manifest.source.planSha256,
    artifactSha256: verification.manifest.files["index.html"].sha256,
    files: verification.files,
  };
}

export function validateGiftPlan(value) {
  object(value, "gift plan");
  exactKeys(value, [
    "schemaVersion", "title", "subtitle", "generatedAt", "locale", "recipient", "budget", "intent",
    "constraints", "portrait", "strategies", "recommendations", "deliveryPlan", "sources", "capabilityNote",
  ], "gift plan");
  if (value.schemaVersion !== 1) throw giftError("PLAN_SCHEMA_INVALID", "schemaVersion must be 1");
  const locale = enumValue(value.locale, Object.keys(labelsByLocale), "locale");
  const plan = {
    schemaVersion: 1,
    title: text(value.title, "title", 1, 100),
    subtitle: text(value.subtitle, "subtitle", 1, 180),
    generatedAt: dateTime(value.generatedAt, "generatedAt"),
    locale,
    recipient: recipient(value.recipient),
    budget: moneyRange(value.budget, "budget"),
    intent: text(value.intent, "intent", 1, 400),
    constraints: textArray(value.constraints, "constraints", 0, 16, 120),
    portrait: portrait(value.portrait),
    strategies: strategies(value.strategies),
    recommendations: [],
    deliveryPlan: deliveryPlan(value.deliveryPlan),
    sources: sources(value.sources),
    ...(value.capabilityNote === undefined ? {} : { capabilityNote: text(value.capabilityNote, "capabilityNote", 1, 240) }),
  };
  if (plan.budget.min > plan.budget.max) throw giftError("BUDGET_INVALID", "budget.min must not exceed budget.max");
  plan.recommendations = recommendations(value.recommendations, plan);
  const represented = new Set(plan.recommendations.map((item) => item.strategyId));
  if (represented.size < 2) throw giftError("PORTFOLIO_INVALID", "recommendations must represent at least two strategies");
  const sourcesByUrl = new Map(plan.sources.map((source) => [source.url, source]));
  for (const recommendation of plan.recommendations) {
    const source = sourcesByUrl.get(recommendation.product.url);
    if (!source || source.checkedAt !== recommendation.product.checkedAt) {
      throw giftError(
        "PRODUCT_EVIDENCE_MISSING",
        `${recommendation.id} product URL and check date must have a matching source`,
      );
    }
  }
  return plan;
}

export function verifyGiftAdvisorPage(directory) {
  const manifestPath = path.join(directory, "manifest.json");
  if (!fs.existsSync(manifestPath)) throw giftError("ARTIFACT_INVALID", "manifest.json is missing");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (manifest.templateId !== GIFT_TEMPLATE_ID
    || manifest.templateVersion !== GIFT_TEMPLATE_VERSION
    || manifest.artifactMarker !== GIFT_TEMPLATE_MARKER
    || manifest.source?.kind !== "space-owned-gift-advisor-plan-v1"
    || manifest.source?.visualAcceptance !== "user") {
    throw giftError("ARTIFACT_INVALID", "gift template manifest contract is invalid");
  }
  for (const [name, expected] of Object.entries(manifest.files || {})) {
    const file = path.join(directory, name);
    if (!fs.existsSync(file)) throw giftError("ARTIFACT_INVALID", `${name} is missing`);
    const actual = fileRecord(file);
    if (expected.bytes !== actual.bytes || expected.sha256 !== actual.sha256) {
      throw giftError("ARTIFACT_INVALID", `${name} hash mismatch`);
    }
  }
  const html = fs.readFileSync(path.join(directory, "index.html"), "utf8");
  const requiredTokens = [
    `name="personal-agent-page-template" content="${GIFT_TEMPLATE_MARKER}"`,
    `name="personal-agent-page-template-id" content="${GIFT_TEMPLATE_ID}"`,
    `name="personal-agent-page-template-version" content="${GIFT_TEMPLATE_VERSION}"`,
    `data-template-marker="${GIFT_TEMPLATE_MARKER}"`,
    `data-template-id="${GIFT_TEMPLATE_ID}"`,
    `data-template-version="${GIFT_TEMPLATE_VERSION}"`,
    "data-gift-filter",
    "data-shortlist",
    "copyShortlist",
    "window.print()",
    "data-portrait-disclaimer",
  ];
  for (const token of requiredTokens) {
    if (!html.includes(token)) throw giftError("ARTIFACT_INVALID", `generated Page is missing ${token}`);
  }
  if (/(?:file:\/\/|(?:localhost|127\.0\.0\.1)(?::\d+)?|<iframe\b|<object\b|<embed\b|<form\b)/i.test(html)) {
    throw giftError("ARTIFACT_INVALID", "generated Page contains a forbidden local or active resource");
  }
  if (/<(?:script|link)\b[^>]*(?:src|href)=["']https?:\/\//i.test(html)) {
    throw giftError("ARTIFACT_INVALID", "generated Page loads remote code or styles");
  }
  const remoteImages = html.match(/<img\b[^>]*\bsrc=["']https:\/\/[^"']+["'][^>]*>/gi) || [];
  if (remoteImages.length !== manifest.source.recommendationCount
    || remoteImages.some((tag) => !/\bclass=["'][^"']*\bproduct-image\b[^"']*["']/i.test(tag))) {
    throw giftError("ARTIFACT_INVALID", "generated Page must contain one verified product image per recommendation");
  }
  return { files: Object.keys(manifest.files).sort(), manifest };
}

export function renderGiftPage(plan) {
  const l = labelsByLocale[plan.locale];
  const strategiesById = new Map(plan.strategies.map((strategy, index) => [strategy.id, { ...strategy, index }]));
  const budgetLabel = formatMoneyRange(plan.budget, plan.locale);
  const generatedLabel = new Intl.DateTimeFormat(plan.locale, { dateStyle: "medium" }).format(new Date(plan.generatedAt));
  const facts = plan.portrait.facts.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  const inferences = plan.portrait.inferences.map((item) => `
    <article>
      <span>${escapeHtml(item.preference)}</span>
      <p><b>${escapeHtml(item.evidence)}</b>${escapeHtml(item.implication)}</p>
    </article>`).join("");
  const unknowns = plan.portrait.unknowns.length
    ? plan.portrait.unknowns.map((item) => `<li>${escapeHtml(item)}</li>`).join("")
    : `<li>—</li>`;
  const strategyButtons = plan.strategies.map((item) =>
    `<button type="button" role="tab" aria-selected="false" data-gift-filter="${escapeAttr(item.id)}"><span>${escapeHtml(item.label)}</span><small>${escapeHtml(item.tagline)}</small></button>`
  ).join("");
  const strategyCards = plan.strategies.map((item, index) => `
    <article class="strategy-card strategy-${index + 1}">
      <span>0${index + 1}</span>
      <h3>${escapeHtml(item.label)}</h3>
      <strong>${escapeHtml(item.tagline)}</strong>
      <p>${escapeHtml(item.rationale)}</p>
    </article>`).join("");
  const recommendationCards = plan.recommendations.map((item) =>
    renderRecommendation(item, strategiesById.get(item.strategyId), plan.locale, l)
  ).join("");
  const constraintChips = plan.constraints.length
    ? plan.constraints.map((item) => `<span>${escapeHtml(item)}</span>`).join("")
    : `<span>—</span>`;
  const interestChips = plan.recipient.interests.map((item) => `<span>${escapeHtml(item)}</span>`).join("");
  const delivery = plan.deliveryPlan.map((item) => `
    <article>
      <span>${escapeHtml(item.step)}</span>
      <div><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.detail)}</p></div>
    </article>`).join("");
  const sourceRows = plan.sources.length
    ? plan.sources.map((source) => `<li><a href="${escapeAttr(source.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.title)}</a><span>${escapeHtml(source.publisher)} · ${escapeHtml(source.checkedAt)}</span></li>`).join("")
    : `<li class="source-empty">${escapeHtml(l.noSources)}</li>`;
  const capability = plan.capabilityNote
    ? `<aside class="capability-note"><strong>${escapeHtml(l.capability)}</strong><p>${escapeHtml(plan.capabilityNote)}</p></aside>`
    : "";
  const productImageSources = [...new Set(
    plan.recommendations.map((item) => new URL(item.product.image.url).origin),
  )].sort().map(escapeAttr).join(" ");

  return `<!doctype html>
<html lang="${escapeAttr(plan.locale)}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta name="color-scheme" content="light dark">
  <meta name="referrer" content="no-referrer">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data: ${productImageSources}; connect-src 'none'; font-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'">
  <meta name="personal-agent-page-template" content="${GIFT_TEMPLATE_MARKER}">
  <meta name="personal-agent-page-template-id" content="${GIFT_TEMPLATE_ID}">
  <meta name="personal-agent-page-template-version" content="${GIFT_TEMPLATE_VERSION}">
  <title>${escapeHtml(plan.title)}</title>
  <style>${pageCss()}${productCss()}</style>
</head>
<body data-template-marker="${GIFT_TEMPLATE_MARKER}" data-template-id="${GIFT_TEMPLATE_ID}" data-template-version="${GIFT_TEMPLATE_VERSION}">
  <header class="topbar">
    <a href="#main" class="brand" aria-label="Gift Advisor"><span>礼</span><b>GIFT ADVISOR</b></a>
    <div class="top-actions">
      <button type="button" data-theme-toggle data-theme-evening="${escapeAttr(l.theme)}" data-theme-light="${escapeAttr(l.themeLight)}" aria-label="${escapeAttr(l.theme)}" title="${escapeAttr(l.theme)}"><span aria-hidden="true">◐</span></button>
      <button type="button" onclick="window.print()">${escapeHtml(l.print)}</button>
    </div>
  </header>

  <main id="main">
    <section class="hero">
      <div class="hero-copy">
        <div class="eyebrow"><i></i>${escapeHtml(l.prepared)}</div>
        <h1>${escapeHtml(plan.title)}</h1>
        <p class="hero-subtitle" style="color:var(--muted)">${escapeHtml(plan.subtitle)}</p>
        <blockquote>${escapeHtml(plan.intent)}</blockquote>
        <div class="hero-meta">
          <span><small>${escapeHtml(l.relationship)}</small>${escapeHtml(plan.recipient.relationship)}</span>
          <span><small>${escapeHtml(l.occasion)}</small>${escapeHtml(plan.recipient.occasion)}</span>
          <span><small>${escapeHtml(l.budget)}</small>${escapeHtml(budgetLabel)}</span>
        </div>
      </div>
      <div class="gift-still-life" aria-hidden="true">
        <div class="orbit orbit-one"></div><div class="orbit orbit-two"></div>
        <div class="gift-box"><i></i><b></b><span>✦</span></div>
        <div class="gift-tag">${escapeHtml(plan.recipient.displayName)}</div>
        <span class="spark spark-one">✦</span><span class="spark spark-two">◇</span>
      </div>
    </section>

    <section class="recipient-strip" aria-label="${escapeAttr(l.portrait)}">
      <div><span>${escapeHtml(plan.recipient.displayName.slice(0, 2))}</span><p><small>${escapeHtml(plan.recipient.relationship)} · ${escapeHtml(plan.recipient.occasion)}</small><strong>${escapeHtml(plan.recipient.displayName)}</strong></p></div>
      <div class="interest-chips">${interestChips}</div>
      <p><small>${escapeHtml(l.generated)}</small>${escapeHtml(generatedLabel)}</p>
    </section>

    <section class="portrait section" id="portrait">
      <header class="section-heading"><span>01</span><div><p>${escapeHtml(l.portrait)}</p><h2>${escapeHtml(plan.subtitle)}</h2></div></header>
      <div class="portrait-grid">
        <article class="portrait-panel fact-panel"><header><span>FACTS</span><h3>${escapeHtml(l.facts)}</h3></header><ul>${facts}</ul></article>
        <article class="portrait-panel inference-panel"><header><span>INFERENCE</span><h3>${escapeHtml(l.inferences)}</h3></header><div>${inferences}</div></article>
        <article class="portrait-panel unknown-panel"><header><span>UNKNOWN</span><h3>${escapeHtml(l.unknowns)}</h3></header><ul>${unknowns}</ul></article>
      </div>
      <div class="portrait-footer"><p data-portrait-disclaimer>${escapeHtml(plan.portrait.disclaimer)}</p><div>${constraintChips}</div></div>
    </section>

    <section class="strategies section" id="strategies">
      <header class="section-heading"><span>02</span><div><p>${escapeHtml(l.strategies)}</p><h2>${escapeHtml(l.strategyLead)}</h2></div></header>
      <div class="strategy-cards">${strategyCards}</div>
    </section>

    <section class="recommendations section" id="recommendations">
      <header class="section-heading recommendation-heading">
        <span>03</span><div><p>${escapeHtml(l.recommendations)}</p><h2>${escapeHtml(l.recommendationLead)}</h2></div>
      </header>
      <div class="recommendation-toolbar">
        <div class="filter-tabs" role="tablist" aria-label="${escapeAttr(l.strategies)}">
          <button type="button" class="active" role="tab" aria-selected="true" data-gift-filter="all"><span>${escapeHtml(l.all)}</span><small>${plan.recommendations.length}</small></button>
          ${strategyButtons}
        </div>
        <label><span class="sr-only">${escapeHtml(l.sortFit)}</span><select data-sort><option value="fit">${escapeHtml(l.sortFit)}</option><option value="price">${escapeHtml(l.sortPrice)}</option></select></label>
      </div>
      <div class="recommendation-grid" data-recommendation-grid>${recommendationCards}</div>
      <div class="shortlist-bar"><p aria-live="polite" data-copy-status></p><button type="button" data-copy-shortlist>${escapeHtml(l.copy)} <span>→</span></button></div>
    </section>

    <section class="delivery section" id="delivery">
      <header class="section-heading"><span>04</span><div><p>${escapeHtml(l.delivery)}</p><h2>${escapeHtml(l.deliveryLead)}</h2></div></header>
      <div class="delivery-steps">${delivery}</div>
    </section>

    <section class="sources section" id="sources">
      <header><span>05</span><h2>${escapeHtml(l.sources)}</h2></header>
      <ul>${sourceRows}</ul>
      ${capability}
    </section>

    <footer class="page-footer"><div><span>礼</span><b>GIFT ADVISOR</b></div><p>${escapeHtml(l.ending)}</p></footer>
  </main>

  <script>${pageScript(l)}</script>
</body>
</html>`;
}

function renderRecommendation(item, strategy, locale, l) {
  const index = strategy.index + 1;
  const product = item.product;
  const listedPrice = `${l.listedPrice} · ${product.listedPrice.display}`;
  return `<article class="gift-card strategy-${index}" data-recommendation data-strategy="${escapeAttr(item.strategyId)}" data-price="${item.price.min}" data-fit="${item.fitScore}" data-title="${escapeAttr(item.title)}">
    <header><span class="rank">${String(item.rank).padStart(2, "0")}</span><span class="strategy-label">${escapeHtml(strategy.label)}</span><button type="button" data-shortlist aria-pressed="false" aria-label="${escapeAttr(`${l.shortlist}: ${item.title}`)}">◇</button></header>
    <a class="product-image-link" href="${escapeAttr(product.url)}" target="_blank" rel="noopener noreferrer" aria-label="${escapeAttr(`${l.openProduct}: ${item.title}`)}">
      <img class="product-image" src="${escapeAttr(product.image.url)}" alt="${escapeAttr(product.image.alt)}" loading="lazy" decoding="async" referrerpolicy="no-referrer">
      <span class="product-image-fallback" hidden>${escapeHtml(l.imageUnavailable)}</span>
      <b>${escapeHtml(item.productFamily)}</b>
    </a>
    <div class="gift-card-copy">
      <p class="category">${escapeHtml(item.category)}</p>
      <h3>${escapeHtml(item.title)}</h3>
      <p class="summary">${escapeHtml(item.summary)}</p>
      <div class="price-row"><strong>${escapeHtml(formatMoneyRange(item.price, locale))}</strong><span>${escapeHtml(l.fit)} ${item.fitScore}</span></div>
      <p class="listed-price">${escapeHtml(listedPrice)} · ${escapeHtml(product.priceNote)}</p>
      <a class="product-link" href="${escapeAttr(product.url)}" target="_blank" rel="noopener noreferrer">
        <span>${escapeHtml(product.label)} ↗</span>
        <small>${escapeHtml(product.merchant)} · ${escapeHtml(product.availability)} · ${escapeHtml(l.checked)} ${escapeHtml(product.checkedAt)}</small>
      </a>
    </div>
    <div class="gift-details" hidden>
      ${detailList(l.evidence, item.fitReasons)}
      ${detailList(l.watchouts, item.watchouts)}
      ${detailList(l.personalization, item.personalization)}
    </div>
    <button type="button" class="detail-toggle" data-detail-toggle aria-expanded="false"><span>${escapeHtml(l.details)}</span><i>＋</i></button>
  </article>`;
}

function detailList(title, items) {
  return `<section><h4>${escapeHtml(title)}</h4><ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></section>`;
}

export function renderGiftCoverSvg(plan) {
  const budget = formatMoneyRange(plan.budget, plan.locale);
  const strategies = plan.strategies.slice(0, 3);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="680" viewBox="0 0 1200 680" role="img" aria-labelledby="title desc">
  <title id="title">${escapeXml(plan.title)}</title>
  <desc id="desc">${escapeXml(plan.subtitle)}</desc>
  <defs>
    <linearGradient id="paper" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#fffaf2"/><stop offset="1" stop-color="#efe4d7"/></linearGradient>
    <radialGradient id="rose" cx=".5" cy=".35" r=".7"><stop stop-color="#d88d87"/><stop offset="1" stop-color="#a95168"/></radialGradient>
    <filter id="shadow"><feDropShadow dx="0" dy="24" stdDeviation="26" flood-color="#4b2938" flood-opacity=".18"/></filter>
  </defs>
  <rect width="1200" height="680" fill="url(#paper)"/>
  <circle cx="1008" cy="118" r="240" fill="#b76876" opacity=".07"/>
  <circle cx="104" cy="612" r="220" fill="#75816d" opacity=".08"/>
  <g font-family="Avenir Next,PingFang SC,sans-serif" fill="#30262d">
    <g transform="translate(72 64)"><rect width="44" height="44" rx="22" fill="#65354e"/><text x="22" y="29" fill="#fff9ef" text-anchor="middle" font-family="Songti SC,serif" font-size="22">礼</text><text x="59" y="27" font-size="14" font-weight="700" letter-spacing="3">GIFT ADVISOR</text></g>
    <text x="72" y="178" fill="#b25e6c" font-size="14" font-weight="700" letter-spacing="4">A CONSIDERED GIFT PROPOSAL</text>
    <text x="72" y="250" font-family="Songti SC,serif" font-size="52" font-weight="600">${escapeXml(crop(plan.title, 18))}</text>
    <text x="72" y="304" fill="#6f6269" font-family="Songti SC,serif" font-size="22">${escapeXml(crop(plan.subtitle, 34))}</text>
    <g transform="translate(72 368)">
      ${strategies.map((item, index) => `<g data-cover-item="${escapeAttr(item.id)}" transform="translate(${index * 218} 0)"><text y="0" fill="#b25e6c" font-size="12">0${index + 1}</text><line x1="0" y1="18" x2="180" y2="18" stroke="#d8c9be"/><text y="50" font-family="Songti SC,serif" font-size="23">${escapeXml(crop(item.label, 8))}</text><text y="80" fill="#7c7075" font-size="13">${escapeXml(crop(item.tagline, 12))}</text></g>`).join("")}
    </g>
    <g transform="translate(72 574)"><text fill="#80737a" font-size="12">${escapeXml(plan.recipient.relationship)} · ${escapeXml(plan.recipient.occasion)}</text><text x="280" fill="#80737a" font-size="12">${escapeXml(budget)}</text></g>
  </g>
  <g transform="translate(835 215)" filter="url(#shadow)">
    <ellipse cx="128" cy="318" rx="184" ry="42" fill="#5d3345" opacity=".1"/>
    <rect x="7" y="72" width="242" height="230" rx="20" fill="url(#rose)"/>
    <rect x="-11" y="47" width="278" height="58" rx="14" fill="#c97278"/>
    <rect x="109" y="47" width="39" height="255" fill="#c39a54"/>
    <rect x="7" y="164" width="242" height="34" fill="#c39a54"/>
    <path d="M129 52C87 40 63 8 78-12c17-22 57 11 51 64Z" fill="none" stroke="#c39a54" stroke-width="24"/>
    <path d="M129 52c42-12 66-44 51-64-17-22-57 11-51 64Z" fill="none" stroke="#c39a54" stroke-width="24"/>
    <text x="282" y="52" fill="#bd8b45" font-size="38">✦</text>
    <text x="-76" y="106" fill="#a95b6b" font-size="28">◇</text>
  </g>
  </svg>`;
}

function pageScript(l) {
  const strings = JSON.stringify({
    details: l.details,
    close: l.close,
    shortlist: l.shortlist,
    shortlisted: l.shortlisted,
    copied: l.copied,
    copyEmpty: l.copyEmpty,
  }).replaceAll("<", "\\u003c");
  return `(() => {
  "use strict";
  const labels = ${strings};
  const grid = document.querySelector("[data-recommendation-grid]");
  const cards = [...document.querySelectorAll("[data-recommendation]")];
  const filters = [...document.querySelectorAll("[data-gift-filter]")];
  const status = document.querySelector("[data-copy-status]");
  let activeFilter = "all";

  document.querySelectorAll(".product-image").forEach((image) => {
    image.addEventListener("error", () => {
      image.hidden = true;
      image.nextElementSibling.hidden = false;
    });
  });

  const showFilter = (filter) => {
    activeFilter = filter;
    filters.forEach((button) => {
      const active = button.dataset.giftFilter === filter;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
    });
    cards.forEach((card) => { card.hidden = filter !== "all" && card.dataset.strategy !== filter; });
  };

  filters.forEach((button) => button.addEventListener("click", () => showFilter(button.dataset.giftFilter)));

  document.querySelector("[data-sort]").addEventListener("change", (event) => {
    const key = event.target.value;
    [...cards]
      .sort((left, right) => key === "price"
        ? Number(left.dataset.price) - Number(right.dataset.price)
        : Number(right.dataset.fit) - Number(left.dataset.fit))
      .forEach((card) => grid.append(card));
    showFilter(activeFilter);
  });

  document.querySelectorAll("[data-detail-toggle]").forEach((button) => button.addEventListener("click", () => {
    const card = button.closest("[data-recommendation]");
    const detail = card.querySelector(".gift-details");
    const expanded = button.getAttribute("aria-expanded") === "true";
    button.setAttribute("aria-expanded", String(!expanded));
    button.querySelector("span").textContent = expanded ? labels.details : labels.close;
    button.querySelector("i").textContent = expanded ? "＋" : "−";
    detail.hidden = expanded;
  }));

  document.querySelectorAll("[data-shortlist]").forEach((button) => button.addEventListener("click", () => {
    const selected = button.getAttribute("aria-pressed") !== "true";
    button.setAttribute("aria-pressed", String(selected));
    button.textContent = selected ? "◆" : "◇";
    const title = button.closest("[data-recommendation]").dataset.title;
    button.setAttribute("aria-label", (selected ? labels.shortlisted : labels.shortlist) + ": " + title);
  }));

  const copyText = async (value) => {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(value);
    const area = document.createElement("textarea");
    area.value = value;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  };

  async function copyShortlist() {
    const selected = cards.filter((card) => card.querySelector("[data-shortlist]").getAttribute("aria-pressed") === "true");
    if (!selected.length) {
      status.textContent = labels.copyEmpty;
      return;
    }
    const text = selected.map((card) => {
      const title = card.querySelector("h3").textContent;
      const price = card.querySelector(".price-row strong").textContent;
      return "• " + title + " — " + price;
    }).join("\\n");
    try {
      await copyText(text);
      status.textContent = labels.copied;
    } catch {
      status.textContent = text;
    }
  }

  document.querySelector("[data-copy-shortlist]").addEventListener("click", copyShortlist);
  const themeToggle = document.querySelector("[data-theme-toggle]");
  themeToggle.addEventListener("click", () => {
    const evening = document.body.classList.toggle("evening");
    const label = evening ? themeToggle.dataset.themeLight : themeToggle.dataset.themeEvening;
    themeToggle.setAttribute("aria-label", label);
    themeToggle.setAttribute("title", label);
  });
})();`;
}

function pageCss() {
  return `:root{color:#30262d;background:#f4ede3;font-family:"Avenir Next","PingFang SC","Microsoft YaHei",sans-serif;font-synthesis:none;--ink:#30262d;--muted:#766970;--paper:#fffaf2;--canvas:#f4ede3;--line:#d8cbbf;--plum:#65354e;--plum-deep:#412233;--rose:#b85f6e;--rose-soft:#e9c4bd;--sage:#71806c;--gold:#bd8b45;--shadow:0 24px 70px rgba(65,38,50,.12)}*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;min-width:320px;background:radial-gradient(circle at 5% 14%,rgba(184,95,110,.09),transparent 25%),radial-gradient(circle at 96% 72%,rgba(113,128,108,.1),transparent 24%),var(--canvas);color:var(--ink);transition:background .25s,color .25s}button,select{font:inherit;color:inherit}button,a,select{outline-offset:3px}button:focus-visible,a:focus-visible,select:focus-visible{outline:2px solid var(--rose)}button{cursor:pointer}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap}.topbar{position:relative;z-index:10;width:min(1280px,calc(100% - 64px));height:84px;display:flex;align-items:center;justify-content:space-between;margin:0 auto;border-bottom:1px solid rgba(96,65,78,.18)}.brand{display:flex;align-items:center;gap:11px;color:inherit;text-decoration:none}.brand span,.page-footer span{width:38px;height:38px;display:grid;place-items:center;border-radius:50%;background:var(--plum);color:#fff9ef;font-family:"Songti SC","STSong",serif;font-size:19px;box-shadow:0 8px 22px rgba(65,34,51,.2)}.brand b,.page-footer b{font-size:10px;letter-spacing:.23em}.top-actions{display:flex;align-items:center;gap:8px}.top-actions button{min-height:36px;border:1px solid var(--line);border-radius:999px;padding:0 14px;background:rgba(255,250,242,.68);font-size:10px}.top-actions button:first-child{width:36px;padding:0;font-size:17px}main{width:min(1280px,calc(100% - 64px));margin:0 auto}.hero{min-height:600px;display:grid;grid-template-columns:minmax(0,1.12fr) minmax(360px,.88fr);align-items:center;gap:56px;padding:60px 0}.eyebrow{display:flex;align-items:center;gap:14px;margin-bottom:22px;color:var(--rose);font-size:10px;font-weight:750;letter-spacing:.23em;text-transform:uppercase}.eyebrow i{width:56px;height:1px;background:currentColor}.hero h1{max-width:760px;margin:0;font-family:"Iowan Old Style","Songti SC","STSong",serif;font-size:clamp(48px,6vw,82px);font-weight:600;letter-spacing:-.045em;line-height:1.12}.hero-subtitle{max-width:680px;margin:24px 0 0;color:#685a62;font-family:"Iowan Old Style","Songti SC","STSong",serif;font-size:21px;line-height:1.7}.hero blockquote{max-width:660px;margin:30px 0 0;border-left:2px solid var(--rose);padding:3px 0 3px 20px;color:var(--muted);font-size:13px;line-height:1.85}.hero-meta{display:flex;flex-wrap:wrap;gap:0;margin-top:34px;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}.hero-meta span{min-width:130px;padding:13px 24px 13px 0;font-family:"Iowan Old Style","Songti SC",serif;font-size:16px}.hero-meta span+span{border-left:1px solid var(--line);padding-left:24px}.hero-meta small{display:block;margin-bottom:5px;color:var(--muted);font-family:"Avenir Next","PingFang SC",sans-serif;font-size:8px;letter-spacing:.13em}.gift-still-life{position:relative;min-height:470px;display:grid;place-items:center}.orbit{position:absolute;border:1px solid rgba(101,53,78,.14);border-radius:50%}.orbit-one{width:430px;height:430px}.orbit-two{width:326px;height:326px;border-style:dashed;transform:rotate(17deg)}.gift-box{position:relative;width:210px;height:188px;border-radius:10px 10px 29px 29px;background:linear-gradient(145deg,rgba(255,255,255,.25),transparent 44%),var(--rose);box-shadow:0 38px 62px rgba(78,40,55,.23),inset -14px -12px 26px rgba(65,30,44,.1);transform:rotate(-4deg)}.gift-box:before,.gift-box:after{content:"";position:absolute;z-index:2;top:-61px;width:67px;height:76px;border:17px solid var(--gold);border-radius:60% 48% 18% 50%}.gift-box:before{left:46px;transform:rotate(-24deg)}.gift-box:after{right:41px;transform:scaleX(-1) rotate(-24deg)}.gift-box i{position:absolute;z-index:3;top:-21px;left:-14px;width:238px;height:48px;border-radius:9px;background:#cb7379;box-shadow:0 8px 14px rgba(60,28,39,.16)}.gift-box b{position:absolute;z-index:4;top:-22px;bottom:0;left:89px;width:35px;background:var(--gold)}.gift-box span{position:absolute;right:-64px;top:-126px;color:var(--gold);font-size:40px}.gift-tag{position:absolute;right:2%;bottom:67px;border:1px solid rgba(101,53,78,.15);border-radius:999px;padding:10px 16px;background:rgba(255,250,242,.78);color:var(--plum);font-family:"Iowan Old Style","Songti SC",serif;font-size:14px;box-shadow:0 12px 34px rgba(65,42,52,.08);backdrop-filter:blur(8px)}.spark{position:absolute;color:var(--rose)}.spark-one{top:87px;left:4%;font-size:27px}.spark-two{right:9%;top:135px;font-size:21px}.recipient-strip{min-height:94px;display:grid;grid-template-columns:240px minmax(0,1fr) auto;align-items:center;gap:24px;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}.recipient-strip>div:first-child{display:flex;align-items:center;gap:13px}.recipient-strip>div:first-child>span{width:42px;height:42px;display:grid;place-items:center;border:1px solid var(--plum);border-radius:50%;color:var(--plum);font-family:"Songti SC",serif}.recipient-strip p{margin:0}.recipient-strip p strong,.recipient-strip p small{display:block}.recipient-strip p strong{font-family:"Songti SC",serif;font-size:16px}.recipient-strip p small{margin-bottom:4px;color:var(--muted);font-size:9px}.interest-chips{display:flex;flex-wrap:wrap;gap:7px}.interest-chips span,.portrait-footer div span{border:1px solid var(--line);border-radius:999px;padding:7px 10px;background:rgba(255,250,242,.6);color:var(--muted);font-size:9px}.recipient-strip>p{text-align:right}.section{padding:96px 0}.section-heading{display:grid;grid-template-columns:76px minmax(0,1fr);align-items:start;margin-bottom:40px}.section-heading>span,.sources>header>span{color:var(--rose);font-family:"Iowan Old Style",serif;font-size:15px;font-style:italic}.section-heading p{margin:0 0 9px;color:var(--rose);font-size:9px;font-weight:750;letter-spacing:.2em;text-transform:uppercase}.section-heading h2{max-width:760px;margin:0;font-family:"Iowan Old Style","Songti SC",serif;font-size:clamp(30px,4vw,47px);font-weight:560;letter-spacing:-.035em;line-height:1.28}.portrait-grid{display:grid;grid-template-columns:.86fr 1.42fr .72fr;border-top:1px solid var(--ink);border-bottom:1px solid var(--line)}.portrait-panel{min-width:0;padding:27px}.portrait-panel+.portrait-panel{border-left:1px solid var(--line)}.portrait-panel header{display:flex;align-items:baseline;justify-content:space-between;gap:14px;border-bottom:1px solid var(--line);padding-bottom:13px}.portrait-panel header span{color:var(--rose);font-size:8px;letter-spacing:.16em}.portrait-panel h3{margin:0;font-family:"Songti SC",serif;font-size:17px}.portrait-panel ul{display:grid;gap:13px;margin:20px 0 0;padding:0;list-style:none}.portrait-panel li{position:relative;padding-left:16px;color:var(--muted);font-size:11px;line-height:1.6}.portrait-panel li:before{content:"";position:absolute;top:.55em;left:0;width:6px;height:6px;border:1px solid var(--rose);border-radius:50%}.inference-panel>div{display:grid;gap:0}.inference-panel article{padding:16px 0;border-bottom:1px solid var(--line)}.inference-panel article:last-child{border-bottom:0}.inference-panel article span{display:block;margin-bottom:7px;color:var(--plum);font-family:"Songti SC",serif;font-size:15px}.inference-panel article p{margin:0;color:var(--muted);font-size:10px;line-height:1.7}.inference-panel article b{display:block;margin-bottom:3px;color:var(--ink);font-weight:600}.portrait-footer{display:flex;align-items:center;justify-content:space-between;gap:24px;padding:18px 0;border-bottom:1px solid var(--line)}.portrait-footer>p{max-width:640px;margin:0;color:var(--muted);font-size:10px;line-height:1.6}.portrait-footer>div{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:6px}.strategies{padding-top:70px}.strategy-cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}.strategy-card{position:relative;min-height:250px;overflow:hidden;border:1px solid var(--line);padding:29px;background:rgba(255,250,242,.7)}.strategy-card:after{content:"";position:absolute;right:-50px;bottom:-70px;width:150px;height:150px;border:1px solid currentColor;border-radius:50%;opacity:.14}.strategy-card>span{color:var(--rose);font-family:Georgia,serif;font-size:11px}.strategy-card h3{margin:42px 0 6px;font-family:"Songti SC",serif;font-size:27px;font-weight:550}.strategy-card strong{display:block;color:var(--plum);font-size:11px}.strategy-card p{margin:18px 0 0;color:var(--muted);font-size:11px;line-height:1.7}.strategy-2{--card-accent:var(--sage)}.strategy-3{--card-accent:var(--gold)}.strategy-4{--card-accent:#5d7181}.strategy-card.strategy-2>span,.strategy-card.strategy-2 strong,.gift-card.strategy-2 .category{color:var(--sage)}.strategy-card.strategy-3>span,.strategy-card.strategy-3 strong,.gift-card.strategy-3 .category{color:var(--gold)}.strategy-card.strategy-4>span,.strategy-card.strategy-4 strong,.gift-card.strategy-4 .category{color:#5d7181}.recommendations{padding-top:64px}.recommendation-heading{margin-bottom:28px}.recommendation-toolbar{position:sticky;z-index:6;top:0;display:flex;align-items:center;justify-content:space-between;gap:18px;padding:12px 0;background:rgba(244,237,227,.91);border-top:1px solid var(--line);border-bottom:1px solid var(--line);backdrop-filter:blur(12px)}.filter-tabs{display:flex;min-width:0;overflow-x:auto;gap:7px;padding:2px}.filter-tabs button{flex:none;min-height:42px;display:flex;align-items:center;gap:8px;border:1px solid transparent;border-radius:999px;padding:0 14px;background:transparent;font-size:10px}.filter-tabs button small{color:var(--muted)}.filter-tabs button.active{border-color:var(--plum);background:var(--plum);color:#fff}.filter-tabs button.active small{color:#eadce2}.recommendation-toolbar select{min-height:40px;border:1px solid var(--line);border-radius:999px;padding:0 32px 0 13px;background:var(--paper);font-size:10px}.recommendation-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;padding-top:18px}.gift-card{min-width:0;display:flex;flex-direction:column;border:1px solid var(--line);background:var(--paper);box-shadow:0 18px 46px rgba(59,39,48,.06);transition:transform .2s,box-shadow .2s}.gift-card:hover{transform:translateY(-3px);box-shadow:var(--shadow)}.gift-card[hidden]{display:none}.gift-card>header{height:50px;display:flex;align-items:center;gap:10px;border-bottom:1px solid var(--line);padding:0 15px}.gift-card .rank{font-family:Georgia,serif;font-size:11px}.strategy-label{margin-right:auto;color:var(--muted);font-size:9px}.gift-card [data-shortlist]{width:30px;height:30px;border:0;border-radius:50%;background:transparent;color:var(--plum);font-size:17px}.gift-card [data-shortlist][aria-pressed=true]{background:var(--plum);color:#fff}.gift-mark{position:relative;height:166px;display:grid;place-items:center;overflow:hidden;background:linear-gradient(145deg,#f0d9d5,#e7c1bc)}.gift-card.strategy-2 .gift-mark{background:linear-gradient(145deg,#dfe5dc,#bdc9b8)}.gift-card.strategy-3 .gift-mark{background:linear-gradient(145deg,#efe1c8,#d5b67d)}.gift-card.strategy-4 .gift-mark{background:linear-gradient(145deg,#dde5ea,#b9c7d0)}.gift-mark>span{position:relative;z-index:2;width:80px;height:80px;display:grid;place-items:center;border:1px solid rgba(48,38,45,.55);border-radius:50%;background:rgba(255,250,242,.55);font-family:"Songti SC",serif;font-size:34px;box-shadow:0 20px 40px rgba(48,38,45,.1)}.gift-mark i{position:absolute;width:240px;height:240px;border:1px dashed rgba(48,38,45,.2);border-radius:50%}.gift-mark b{position:absolute;right:11px;bottom:9px;color:rgba(48,38,45,.62);font-size:8px;font-weight:650;letter-spacing:.12em}.gift-card-copy{padding:20px 20px 15px}.category{margin:0 0 7px;color:var(--rose);font-size:8px;font-weight:750;letter-spacing:.14em}.gift-card h3{min-height:51px;margin:0;font-family:"Songti SC",serif;font-size:20px;font-weight:580;line-height:1.35}.summary{min-height:64px;margin:12px 0 0;color:var(--muted);font-size:10px;line-height:1.65}.price-row{display:flex;align-items:end;justify-content:space-between;gap:10px;margin-top:18px}.price-row strong{font-family:"Iowan Old Style","Songti SC",serif;font-size:17px}.price-row span{border-radius:999px;padding:5px 7px;background:#f1e7dd;color:var(--muted);font-size:8px}.gift-details{padding:0 20px 16px}.gift-details section{border-top:1px solid var(--line);padding:14px 0 2px}.gift-details h4{margin:0 0 8px;font-size:9px}.gift-details ul{display:grid;gap:6px;margin:0;padding:0;list-style:none}.gift-details li{position:relative;padding-left:12px;color:var(--muted);font-size:9px;line-height:1.55}.gift-details li:before{content:"·";position:absolute;left:1px}.product-link{display:flex;flex-wrap:wrap;align-items:center;gap:6px;border-top:1px solid var(--line);margin-top:13px;padding-top:14px;color:var(--plum);font-size:10px;font-weight:700;text-decoration:none}.product-link small{width:100%;color:var(--muted);font-size:8px;font-weight:400}.detail-toggle{min-height:44px;display:flex;align-items:center;justify-content:space-between;border:0;border-top:1px solid var(--line);margin-top:auto;padding:0 20px;background:transparent;color:var(--muted);font-size:9px}.detail-toggle i{font-size:15px;font-style:normal}.shortlist-bar{display:flex;align-items:center;justify-content:flex-end;gap:16px;border-bottom:1px solid var(--line);padding:18px 0}.shortlist-bar p{margin:0;color:var(--rose);font-size:9px}.shortlist-bar button{min-height:42px;border:1px solid var(--plum);border-radius:999px;padding:0 18px;background:var(--plum);color:#fff;font-size:10px}.shortlist-bar button span{margin-left:16px}.delivery{padding-top:76px}.delivery-steps{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));border-top:1px solid var(--ink)}.delivery-steps article{min-height:150px;display:grid;grid-template-columns:42px 1fr;gap:14px;border-bottom:1px solid var(--line);padding:24px 20px 24px 0}.delivery-steps article:nth-child(3n+2),.delivery-steps article:nth-child(3n+3){border-left:1px solid var(--line);padding-left:20px}.delivery-steps>article>span{color:var(--rose);font-family:Georgia,serif;font-size:11px}.delivery-steps h3{margin:0 0 9px;font-family:"Songti SC",serif;font-size:16px}.delivery-steps p{margin:0;color:var(--muted);font-size:10px;line-height:1.65}.sources{border-top:1px solid var(--ink);padding-top:26px}.sources>header{display:flex;align-items:center;gap:24px;margin-bottom:22px}.sources h2{margin:0;font-family:"Songti SC",serif;font-size:22px}.sources ul{margin:0;padding:0;list-style:none}.sources li{display:flex;align-items:center;justify-content:space-between;gap:20px;border-top:1px solid var(--line);padding:13px 0;font-size:10px}.sources a{color:var(--ink);text-decoration-thickness:1px;text-underline-offset:3px}.sources li span{color:var(--muted);font-size:9px}.source-empty{justify-content:flex-start!important;color:var(--muted);line-height:1.6}.capability-note{display:grid;grid-template-columns:140px 1fr;gap:20px;border-top:1px solid var(--line);padding:18px 0}.capability-note strong{font-size:10px}.capability-note p{margin:0;color:var(--muted);font-size:10px;line-height:1.65}.page-footer{min-height:210px;display:grid;grid-template-columns:220px 1fr;align-items:center;border-top:1px solid var(--line);margin-top:84px}.page-footer>div{display:flex;align-items:center;gap:11px}.page-footer p{max-width:650px;margin:0;font-family:"Iowan Old Style","Songti SC",serif;font-size:26px;line-height:1.55}.evening{--ink:#f3e9e1;--muted:#bfb0b6;--paper:#2c2228;--canvas:#21191e;--line:#51434a;--plum:#d69aaa;--plum-deep:#e4b3bf;--rose:#e59a9e;--rose-soft:#6d4852;--sage:#aebca9;--gold:#dab56f;background:radial-gradient(circle at 5% 14%,rgba(184,95,110,.13),transparent 25%),#21191e}.evening .top-actions button,.evening .interest-chips span,.evening .portrait-footer div span{background:rgba(44,34,40,.74)}.evening .recommendation-toolbar{background:rgba(33,25,30,.92)}.evening .strategy-card{background:rgba(44,34,40,.7)}.evening .price-row span{background:#47373f}.evening .gift-mark{color:#30262d}@media(max-width:900px){.topbar,main{width:min(100% - 32px,760px)}.hero{min-height:auto;grid-template-columns:1fr;padding:46px 0 24px}.hero h1{font-size:clamp(42px,12vw,66px)}.gift-still-life{min-height:390px}.recipient-strip{grid-template-columns:1fr auto}.interest-chips{grid-column:1/-1;grid-row:2;padding-bottom:18px}.portrait-grid{grid-template-columns:1fr 1fr}.unknown-panel{grid-column:1/-1;border-top:1px solid var(--line);border-left:0!important}.strategy-cards,.recommendation-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.delivery-steps{grid-template-columns:repeat(2,minmax(0,1fr))}.delivery-steps article:nth-child(n){border-left:0;padding-left:0}.delivery-steps article:nth-child(even){border-left:1px solid var(--line);padding-left:20px}.page-footer{grid-template-columns:1fr;gap:24px;padding:44px 0}}@media(max-width:620px){.topbar{width:calc(100% - 24px);height:68px}.brand b{display:none}.top-actions button:last-child{padding:0 10px}.top-actions button:last-child{font-size:0}.top-actions button:last-child:after{content:"PDF";font-size:9px}main{width:calc(100% - 24px)}.hero{gap:12px}.hero h1{font-size:43px}.hero-subtitle{font-size:17px}.hero-meta span{min-width:33.333%;padding-right:10px;font-size:13px}.hero-meta span+span{padding-left:10px}.gift-still-life{min-height:335px;transform:scale(.82);margin:-25px -10%}.recipient-strip{grid-template-columns:1fr}.recipient-strip>p{text-align:left;padding-bottom:14px}.section{padding:68px 0}.section-heading{grid-template-columns:42px 1fr}.section-heading h2{font-size:29px}.portrait-grid,.strategy-cards,.recommendation-grid,.delivery-steps{grid-template-columns:1fr}.portrait-panel+.portrait-panel{border-left:0;border-top:1px solid var(--line)}.portrait-footer{align-items:flex-start;flex-direction:column}.portrait-footer>div{justify-content:flex-start}.strategy-card{min-height:210px}.recommendation-toolbar{align-items:flex-end;flex-direction:column}.filter-tabs{width:100%}.recommendation-toolbar label{align-self:flex-end}.gift-card h3,.summary{min-height:0}.delivery-steps article:nth-child(n){border-left:0;padding-left:0}.sources li{align-items:flex-start;flex-direction:column;gap:5px}.capability-note{grid-template-columns:1fr;gap:6px}.page-footer{margin-top:44px}.page-footer p{font-size:21px}}@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}.gift-card{transition:none}}@media print{.topbar,.recommendation-toolbar,.detail-toggle,.shortlist-bar,[data-shortlist]{display:none!important}body{background:#fff;color:#222}.section{break-inside:avoid;padding:32px 0}.gift-details{display:block!important}.recommendation-grid{grid-template-columns:repeat(2,1fr)}.gift-card{break-inside:avoid;box-shadow:none}.page-footer{min-height:120px}}`;
}

function productCss() {
  return `.product-image-link{position:relative;height:210px;display:grid;place-items:center;overflow:hidden;border-bottom:1px solid var(--line);background:#f3ece3;color:inherit;text-decoration:none}.product-image{width:100%;height:100%;display:block;object-fit:contain;padding:12px;background:#fff}.product-image-link b{position:absolute;right:10px;bottom:10px;border-radius:999px;padding:6px 9px;background:rgba(48,38,45,.78);color:#fff;font-size:8px;letter-spacing:.08em;backdrop-filter:blur(8px)}.product-image-fallback{padding:24px;color:var(--muted);font-size:10px;text-align:center}.listed-price{min-height:32px;margin:9px 0 0;color:var(--muted);font-size:8px;line-height:1.55}.product-link{display:flex;flex-wrap:wrap;align-items:center;gap:5px;border:1px solid var(--line);border-radius:10px;margin-top:13px;padding:11px 12px;background:rgba(101,53,78,.04);color:var(--plum);font-size:10px;font-weight:700;text-decoration:none}.product-link:hover{border-color:var(--plum);background:rgba(101,53,78,.08)}.product-link small{width:100%;color:var(--muted);font-size:8px;font-weight:400;line-height:1.5}.evening .product-image-link{background:#33282e}.evening .product-link{background:rgba(214,154,170,.06)}@media(max-width:620px){.product-image-link{height:238px}}@media print{.product-image-link{height:155px}.product-link{display:none}}`;
}

function recipient(value) {
  object(value, "recipient");
  exactKeys(value, ["displayName", "relationship", "occasion", "location", "ageBand", "occupation", "interests"], "recipient");
  return {
    displayName: text(value.displayName, "recipient.displayName", 1, 60),
    relationship: text(value.relationship, "recipient.relationship", 1, 40),
    occasion: text(value.occasion, "recipient.occasion", 1, 50),
    interests: textArray(value.interests, "recipient.interests", 0, 12, 60),
    ...(value.location === undefined ? {} : { location: text(value.location, "recipient.location", 1, 80) }),
    ...(value.ageBand === undefined ? {} : { ageBand: text(value.ageBand, "recipient.ageBand", 1, 40) }),
    ...(value.occupation === undefined ? {} : { occupation: text(value.occupation, "recipient.occupation", 1, 80) }),
  };
}

function portrait(value) {
  object(value, "portrait");
  exactKeys(value, ["facts", "inferences", "unknowns", "disclaimer"], "portrait");
  array(value.inferences, "portrait.inferences", 1, 12);
  return {
    facts: textArray(value.facts, "portrait.facts", 1, 16, 180),
    inferences: value.inferences.map((item, index) => {
      object(item, `portrait.inferences[${index}]`);
      exactKeys(item, ["preference", "evidence", "implication"], `portrait.inferences[${index}]`);
      return {
        preference: text(item.preference, `portrait.inferences[${index}].preference`, 1, 80),
        evidence: text(item.evidence, `portrait.inferences[${index}].evidence`, 1, 180),
        implication: text(item.implication, `portrait.inferences[${index}].implication`, 1, 180),
      };
    }),
    unknowns: textArray(value.unknowns, "portrait.unknowns", 0, 12, 160),
    disclaimer: text(value.disclaimer, "portrait.disclaimer", 1, 240),
  };
}

function strategies(value) {
  array(value, "strategies", 2, 4);
  const ids = new Set();
  return value.map((item, index) => {
    object(item, `strategies[${index}]`);
    exactKeys(item, ["id", "label", "tagline", "rationale"], `strategies[${index}]`);
    const id = slug(item.id, `strategies[${index}].id`, 40);
    if (ids.has(id)) throw giftError("PLAN_SCHEMA_INVALID", `duplicate strategy id: ${id}`);
    ids.add(id);
    return {
      id,
      label: text(item.label, `strategies[${index}].label`, 1, 32),
      tagline: text(item.tagline, `strategies[${index}].tagline`, 1, 80),
      rationale: text(item.rationale, `strategies[${index}].rationale`, 1, 180),
    };
  });
}

function recommendations(value, plan) {
  array(value, "recommendations", 3, 9);
  const strategyIds = new Set(plan.strategies.map((item) => item.id));
  const ids = new Set();
  const ranks = new Set();
  const families = new Set();
  const productUrls = new Set();
  const productImageUrls = new Set();
  return value.map((item, index) => {
    object(item, `recommendations[${index}]`);
    exactKeys(item, [
      "id", "strategyId", "rank", "title", "category", "productFamily", "price", "summary",
      "fitReasons", "watchouts", "personalization", "fitScore", "product",
    ], `recommendations[${index}]`);
    const id = slug(item.id, `recommendations[${index}].id`, 60);
    const strategyId = slug(item.strategyId, `recommendations[${index}].strategyId`, 40);
    if (ids.has(id)) throw giftError("PORTFOLIO_INVALID", `duplicate recommendation id: ${id}`);
    if (!strategyIds.has(strategyId)) throw giftError("PORTFOLIO_INVALID", `unknown strategyId: ${strategyId}`);
    ids.add(id);
    const rank = integer(item.rank, `recommendations[${index}].rank`, 1, 9);
    if (ranks.has(rank)) throw giftError("PORTFOLIO_INVALID", `duplicate rank: ${rank}`);
    ranks.add(rank);
    const productFamily = text(item.productFamily, `recommendations[${index}].productFamily`, 1, 50);
    const familyKey = productFamily.toLocaleLowerCase(plan.locale);
    if (families.has(familyKey)) throw giftError("PORTFOLIO_INVALID", `duplicate product family: ${productFamily}`);
    families.add(familyKey);
    const price = moneyRange(item.price, `recommendations[${index}].price`);
    if (price.min > price.max) throw giftError("BUDGET_INVALID", `${id} price.min must not exceed price.max`);
    if (price.currency !== plan.budget.currency
      || price.min < plan.budget.min
      || price.max > plan.budget.max) {
      throw giftError("BUDGET_INVALID", `${id} must stay inside ${plan.budget.currency} ${plan.budget.min}-${plan.budget.max}`);
    }
    const validatedProduct = product(item.product, `recommendations[${index}].product`);
    if (productUrls.has(validatedProduct.url)) {
      throw giftError("PORTFOLIO_INVALID", `duplicate product URL: ${validatedProduct.url}`);
    }
    if (productImageUrls.has(validatedProduct.image.url)) {
      throw giftError("PORTFOLIO_INVALID", `duplicate product image URL: ${validatedProduct.image.url}`);
    }
    productUrls.add(validatedProduct.url);
    productImageUrls.add(validatedProduct.image.url);
    return {
      id,
      strategyId,
      rank,
      title: text(item.title, `recommendations[${index}].title`, 1, 90),
      category: text(item.category, `recommendations[${index}].category`, 1, 50),
      productFamily,
      price,
      summary: text(item.summary, `recommendations[${index}].summary`, 1, 260),
      fitReasons: textArray(item.fitReasons, `recommendations[${index}].fitReasons`, 1, 4, 140),
      watchouts: textArray(item.watchouts, `recommendations[${index}].watchouts`, 1, 4, 140),
      personalization: textArray(item.personalization, `recommendations[${index}].personalization`, 1, 4, 140),
      fitScore: integer(item.fitScore, `recommendations[${index}].fitScore`, 0, 100),
      product: validatedProduct,
    };
  }).sort((left, right) => left.rank - right.rank);
}

function product(value, field) {
  object(value, field);
  exactKeys(value, [
    "brand", "model", "label", "url", "merchant", "checkedAt", "availability",
    "listedPrice", "priceNote", "image",
  ], field);
  object(value.listedPrice, `${field}.listedPrice`);
  exactKeys(value.listedPrice, ["currency", "amount", "display"], `${field}.listedPrice`);
  object(value.image, `${field}.image`);
  exactKeys(value.image, ["url", "alt", "sourceUrl", "checkedAt"], `${field}.image`);
  const url = httpsUrl(value.url, `${field}.url`);
  const imageUrl = httpsUrl(value.image.url, `${field}.image.url`);
  const imageSourceUrl = httpsUrl(value.image.sourceUrl, `${field}.image.sourceUrl`);
  const checkedAt = dateOnly(value.checkedAt, `${field}.checkedAt`);
  const imageCheckedAt = dateOnly(value.image.checkedAt, `${field}.image.checkedAt`);
  if (imageSourceUrl !== url || imageCheckedAt !== checkedAt) {
    throw giftError("PRODUCT_EVIDENCE_MISSING", `${field}.image must use the product page and check date`);
  }
  const listedCurrency = text(value.listedPrice.currency, `${field}.listedPrice.currency`, 3, 3);
  if (!/^[A-Z]{3}$/.test(listedCurrency)) {
    throw giftError("PLAN_SCHEMA_INVALID", `${field}.listedPrice.currency must be an ISO-like uppercase currency`);
  }
  return {
    brand: text(value.brand, `${field}.brand`, 1, 60),
    model: text(value.model, `${field}.model`, 1, 100),
    label: text(value.label, `${field}.label`, 1, 50),
    url,
    merchant: text(value.merchant, `${field}.merchant`, 1, 80),
    checkedAt,
    availability: text(value.availability, `${field}.availability`, 1, 80),
    listedPrice: {
      currency: listedCurrency,
      amount: finiteNumber(value.listedPrice.amount, `${field}.listedPrice.amount`, 0),
      display: text(value.listedPrice.display, `${field}.listedPrice.display`, 1, 40),
    },
    priceNote: text(value.priceNote, `${field}.priceNote`, 1, 160),
    image: {
      url: imageUrl,
      alt: text(value.image.alt, `${field}.image.alt`, 1, 180),
      sourceUrl: imageSourceUrl,
      checkedAt: imageCheckedAt,
    },
  };
}

function deliveryPlan(value) {
  array(value, "deliveryPlan", 1, 6);
  return value.map((item, index) => {
    object(item, `deliveryPlan[${index}]`);
    exactKeys(item, ["step", "title", "detail"], `deliveryPlan[${index}]`);
    return {
      step: text(item.step, `deliveryPlan[${index}].step`, 1, 8),
      title: text(item.title, `deliveryPlan[${index}].title`, 1, 70),
      detail: text(item.detail, `deliveryPlan[${index}].detail`, 1, 220),
    };
  });
}

function sources(value) {
  array(value, "sources", 0, 20);
  return value.map((item, index) => {
    object(item, `sources[${index}]`);
    exactKeys(item, ["title", "url", "publisher", "checkedAt"], `sources[${index}]`);
    return {
      title: text(item.title, `sources[${index}].title`, 1, 140),
      url: httpsUrl(item.url, `sources[${index}].url`),
      publisher: text(item.publisher, `sources[${index}].publisher`, 1, 80),
      checkedAt: dateOnly(item.checkedAt, `sources[${index}].checkedAt`),
    };
  });
}

function moneyRange(value, field) {
  object(value, field);
  exactKeys(value, ["currency", "min", "max"], field);
  const currency = text(value.currency, `${field}.currency`, 3, 3);
  if (!/^[A-Z]{3}$/.test(currency)) throw giftError("PLAN_SCHEMA_INVALID", `${field}.currency must be an ISO-like uppercase currency`);
  return {
    currency,
    min: finiteNumber(value.min, `${field}.min`, 0),
    max: finiteNumber(value.max, `${field}.max`, 0),
  };
}

function formatMoneyRange(range, locale) {
  const formatter = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: range.currency,
    maximumFractionDigits: range.max < 100 ? 2 : 0,
  });
  return `${formatter.format(range.min)}–${formatter.format(range.max)}`;
}

function object(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw giftError("PLAN_SCHEMA_INVALID", `${field} must be an object`);
  }
}

function array(value, field, min, max) {
  if (!Array.isArray(value) || value.length < min || value.length > max) {
    throw giftError("PLAN_SCHEMA_INVALID", `${field} must contain ${min}-${max} items`);
  }
}

function exactKeys(value, allowed, field) {
  const allowedSet = new Set(allowed);
  const extra = Object.keys(value).filter((key) => !allowedSet.has(key));
  if (extra.length) throw giftError("PLAN_SCHEMA_INVALID", `${field} contains unsupported fields: ${extra.join(", ")}`);
}

function text(value, field, min, max) {
  if (typeof value !== "string") throw giftError("PLAN_SCHEMA_INVALID", `${field} must be text`);
  const normalized = value.trim();
  if (normalized.length < min || normalized.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(normalized)) {
    throw giftError("PLAN_SCHEMA_INVALID", `${field} length or control characters are invalid`);
  }
  return normalized;
}

function textArray(value, field, min, max, maxLength) {
  array(value, field, min, max);
  const output = value.map((item, index) => text(item, `${field}[${index}]`, 1, maxLength));
  if (new Set(output).size !== output.length) throw giftError("PLAN_SCHEMA_INVALID", `${field} contains duplicates`);
  return output;
}

function slug(value, field, maxLength) {
  const normalized = text(value, field, 2, maxLength);
  if (!/^[a-z][a-z0-9-]+$/.test(normalized)) throw giftError("PLAN_SCHEMA_INVALID", `${field} must be lowercase hyphen-case`);
  return normalized;
}

function enumValue(value, allowed, field) {
  if (!allowed.includes(value)) throw giftError("PLAN_SCHEMA_INVALID", `${field} must be one of ${allowed.join(", ")}`);
  return value;
}

function integer(value, field, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) throw giftError("PLAN_SCHEMA_INVALID", `${field} must be an integer from ${min} to ${max}`);
  return value;
}

function finiteNumber(value, field, min) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min) throw giftError("PLAN_SCHEMA_INVALID", `${field} must be a finite number >= ${min}`);
  return value;
}

function dateTime(value, field) {
  const normalized = text(value, field, 20, 40);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(normalized) || Number.isNaN(Date.parse(normalized))) {
    throw giftError("PLAN_SCHEMA_INVALID", `${field} must be an ISO UTC date-time`);
  }
  return normalized;
}

function dateOnly(value, field) {
  const normalized = text(value, field, 10, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized) || Number.isNaN(Date.parse(`${normalized}T00:00:00Z`))) {
    throw giftError("PLAN_SCHEMA_INVALID", `${field} must be YYYY-MM-DD`);
  }
  return normalized;
}

function httpsUrl(value, field) {
  const normalized = text(value, field, 9, 2048);
  let parsed;
  try {
    parsed = new URL(normalized);
  } catch {
    throw giftError("PLAN_SCHEMA_INVALID", `${field} must be a valid HTTPS URL`);
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || isLocalHost(parsed.hostname)) {
    throw giftError("PLAN_SCHEMA_INVALID", `${field} must be a public HTTPS URL without credentials`);
  }
  if (/(?:^|\.)example\.(?:com|org|net)$/.test(parsed.hostname.toLocaleLowerCase())) {
    throw giftError("PLAN_SCHEMA_INVALID", `${field} must not use a placeholder host`);
  }
  return parsed.toString();
}

function isLocalHost(hostname) {
  const value = hostname.toLocaleLowerCase();
  return value === "localhost"
    || value === "::1"
    || value.endsWith(".local")
    || /^127\./.test(value)
    || /^10\./.test(value)
    || /^192\.168\./.test(value)
    || /^169\.254\./.test(value)
    || /^172\.(?:1[6-9]|2\d|3[01])\./.test(value);
}

function replaceGeneratedDirectory(target, files) {
  const parent = path.dirname(target);
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  const suffix = `${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
  const staging = path.join(parent, `.${path.basename(target)}.next-${suffix}`);
  const previous = path.join(parent, `.${path.basename(target)}.previous-${suffix}`);
  fs.mkdirSync(staging, { mode: 0o700 });
  try {
    for (const [name, content] of Object.entries(files)) {
      fs.writeFileSync(path.join(staging, name), content, { mode: 0o600 });
    }
    if (fs.existsSync(target)) fs.renameSync(target, previous);
    fs.renameSync(staging, target);
    if (fs.existsSync(previous)) fs.rmSync(previous, { recursive: true, force: true });
    return target;
  } catch (error) {
    if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true, force: true });
    if (!fs.existsSync(target) && fs.existsSync(previous)) fs.renameSync(previous, target);
    throw error;
  }
}

function fileRecord(file) {
  const value = fs.readFileSync(file);
  return { bytes: value.length, sha256: sha256(value) };
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function isInside(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function crop(value, length) {
  const textValue = String(value || "");
  return textValue.length <= length ? textValue : `${textValue.slice(0, length - 1)}…`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

function escapeXml(value) {
  return escapeHtml(value);
}

function giftError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function required(value, flag) {
  if (!value) throw giftError("INVALID_ARGUMENT", `${flag} is required`);
  return value;
}

function parseOptions(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    if (key === "--json") options.json = true;
    else if (key.startsWith("--")) {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw giftError("INVALID_ARGUMENT", `${key} requires a value`);
      options[key.slice(2)] = value;
      index += 1;
    } else {
      throw giftError("INVALID_ARGUMENT", `unexpected argument: ${key}`);
    }
  }
  return options;
}

function emit(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

const directRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (directRun) {
  try {
    const options = parseOptions(process.argv.slice(2));
    emit(generateGiftAdvisorPage({
      projectDir: options["project-dir"],
      output: options.output,
      template: options.template || GIFT_TEMPLATE_ID,
    }));
  } catch (error) {
    emit({ ok: false, error: { code: error.code || "GIFT_ADVISOR_FAILED", message: error.message } });
    process.exitCode = 1;
  }
}
