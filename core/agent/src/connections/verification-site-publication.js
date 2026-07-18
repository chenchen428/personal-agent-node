import sharp from "sharp";
import { renderVerificationSite } from "./verification-site-template.js";

export const VERIFICATION_SITE_TITLE = "Personal Agent Node · 公网入口已就绪";
export const VERIFICATION_SITE_SUMMARY = "一张用于确认 Personal Agent Node 公网发布链路的完整介绍页：说明本地能力、发布边界与适用场景。";

export async function createVerificationSitePublication({ marker, domain }) {
  const [desktop, mobile] = await Promise.all([
    renderThumbnail({ domain, width: 1200, height: 750, mobile: false }),
    renderThumbnail({ domain, width: 750, height: 1200, mobile: true }),
  ]);
  return {
    folder: "domain-verification",
    fileName: "index.html",
    content: renderVerificationSite({ marker, domain }),
    encoding: "utf8",
    mimeType: "text/html; charset=utf-8",
    overwrite: true,
    title: VERIFICATION_SITE_TITLE,
    summary: VERIFICATION_SITE_SUMMARY,
    desktopThumbnail: {
      fileName: "page-thumbnail-desktop.png",
      content: desktop.toString("base64"),
      encoding: "base64",
      alt: "Personal Agent Node 公网入口验证发布桌面预览",
    },
    mobileThumbnail: {
      fileName: "page-thumbnail-mobile.png",
      content: mobile.toString("base64"),
      encoding: "base64",
      alt: "Personal Agent Node 公网入口验证发布移动预览",
    },
  };
}

async function renderThumbnail({ domain, width, height, mobile }) {
  const svg = mobile ? mobilePreviewSvg(domain) : desktopPreviewSvg(domain);
  return sharp(Buffer.from(svg)).resize(width, height, { fit: "fill" }).png({ compressionLevel: 9 }).toBuffer();
}

function desktopPreviewSvg(domain) {
  const safeDomain = escapeXml(domain);
  return `<svg width="1200" height="750" viewBox="0 0 1200 750" xmlns="http://www.w3.org/2000/svg">
    <rect width="1200" height="750" fill="#f4f1e9"/>
    <path d="M64 86H1136M64 626H1136" stroke="#d8d1c4"/>
    <rect x="64" y="28" width="38" height="38" rx="9" fill="#25231f"/>
    <text x="83" y="53" fill="#fbfaf6" font-family="Arial,sans-serif" font-size="13" font-weight="700" text-anchor="middle">PA</text>
    <text x="116" y="53" fill="#25231f" font-family="Arial,'Microsoft YaHei',sans-serif" font-size="17" font-weight="700">Personal Agent Node</text>
    <circle cx="1015" cy="47" r="4" fill="#2f6a4d"/>
    <text x="1027" y="52" fill="#2f6a4d" font-family="Consolas,monospace" font-size="11" font-weight="700" letter-spacing="1.5">VERIFIED PUBLICATION</text>
    <text x="64" y="153" fill="#c35f3d" font-family="Consolas,monospace" font-size="12" font-weight="700" letter-spacing="2">LOCAL-FIRST · PUBLIC WHEN YOU CHOOSE</text>
    <text x="64" y="250" fill="#25231f" font-family="Georgia,'Microsoft YaHei',serif" font-size="72" font-weight="500">你的 Node，已经有了</text>
    <text x="64" y="333" fill="#25231f" font-family="Georgia,'Microsoft YaHei',serif" font-size="72" font-weight="500">自己的公开入口。</text>
    <text x="68" y="385" fill="#5b564e" font-family="Arial,'Microsoft YaHei',sans-serif" font-size="18">在本地理解、执行与保存结果，只把你选择的内容安全地发布到公网。</text>
    <path d="M850 146V536" stroke="#d8d1c4"/>
    <text x="886" y="181" fill="#706b62" font-family="Consolas,monospace" font-size="10" letter-spacing="1">PUBLIC DOMAIN</text>
    <text x="886" y="211" fill="#25231f" font-family="Arial,sans-serif" font-size="14">${safeDomain}</text>
    <path d="M886 238H1112" stroke="#d8d1c4"/>
    <text x="886" y="274" fill="#706b62" font-family="Consolas,monospace" font-size="10" letter-spacing="1">WHY THIS PAGE</text>
    <text x="886" y="308" fill="#25231f" font-family="Arial,'Microsoft YaHei',sans-serif" font-size="15">生成页面</text>
    <text x="886" y="341" fill="#25231f" font-family="Arial,'Microsoft YaHei',sans-serif" font-size="15">建立穿透</text>
    <text x="886" y="374" fill="#25231f" font-family="Arial,'Microsoft YaHei',sans-serif" font-size="15">公网回读</text>
    <text x="64" y="493" fill="#c35f3d" font-family="Consolas,monospace" font-size="11" font-weight="700">01</text>
    <text x="100" y="493" fill="#25231f" font-family="Arial,'Microsoft YaHei',sans-serif" font-size="17" font-weight="700">本地工作</text>
    <text x="276" y="493" fill="#c35f3d" font-family="Consolas,monospace" font-size="11" font-weight="700">02</text>
    <text x="312" y="493" fill="#25231f" font-family="Arial,'Microsoft YaHei',sans-serif" font-size="17" font-weight="700">真实连接</text>
    <text x="488" y="493" fill="#c35f3d" font-family="Consolas,monospace" font-size="11" font-weight="700">03</text>
    <text x="524" y="493" fill="#25231f" font-family="Arial,'Microsoft YaHei',sans-serif" font-size="17" font-weight="700">结果沉淀</text>
    <text x="700" y="493" fill="#c35f3d" font-family="Consolas,monospace" font-size="11" font-weight="700">04</text>
    <text x="736" y="493" fill="#25231f" font-family="Arial,'Microsoft YaHei',sans-serif" font-size="17" font-weight="700">按需发布</text>
    <text x="64" y="685" fill="#25231f" font-family="Georgia,serif" font-size="26">Local by default. Public by intent.</text>
    <text x="1136" y="683" fill="#706b62" font-family="Consolas,monospace" font-size="10" text-anchor="end">DOMAIN BINDING VERIFICATION</text>
  </svg>`;
}

function mobilePreviewSvg(domain) {
  const safeDomain = escapeXml(domain);
  return `<svg width="750" height="1200" viewBox="0 0 750 1200" xmlns="http://www.w3.org/2000/svg">
    <rect width="750" height="1200" fill="#f4f1e9"/>
    <path d="M44 90H706M44 1058H706" stroke="#d8d1c4"/>
    <rect x="44" y="28" width="38" height="38" rx="9" fill="#25231f"/>
    <text x="63" y="53" fill="#fbfaf6" font-family="Arial,sans-serif" font-size="13" font-weight="700" text-anchor="middle">PA</text>
    <text x="98" y="53" fill="#25231f" font-family="Arial,'Microsoft YaHei',sans-serif" font-size="17" font-weight="700">Personal Agent Node</text>
    <circle cx="689" cy="47" r="5" fill="#2f6a4d"/>
    <text x="44" y="159" fill="#c35f3d" font-family="Consolas,monospace" font-size="12" font-weight="700" letter-spacing="2">VERIFIED PUBLICATION</text>
    <text x="44" y="262" fill="#25231f" font-family="Georgia,'Microsoft YaHei',serif" font-size="65">你的 Node，</text>
    <text x="44" y="338" fill="#25231f" font-family="Georgia,'Microsoft YaHei',serif" font-size="65">已经有了自己的</text>
    <text x="44" y="414" fill="#25231f" font-family="Georgia,'Microsoft YaHei',serif" font-size="65">公开入口。</text>
    <text x="47" y="475" fill="#5b564e" font-family="Arial,'Microsoft YaHei',sans-serif" font-size="19">在本地理解、执行与保存结果，</text>
    <text x="47" y="507" fill="#5b564e" font-family="Arial,'Microsoft YaHei',sans-serif" font-size="19">只把你选择的内容安全地带到公网。</text>
    <path d="M44 564H706" stroke="#d8d1c4"/>
    <text x="44" y="611" fill="#706b62" font-family="Consolas,monospace" font-size="10" letter-spacing="1">PUBLIC DOMAIN</text>
    <text x="44" y="645" fill="#25231f" font-family="Arial,sans-serif" font-size="15">${safeDomain}</text>
    <path d="M44 684H706" stroke="#d8d1c4"/>
    <text x="44" y="738" fill="#c35f3d" font-family="Consolas,monospace" font-size="12" font-weight="700">01</text>
    <text x="92" y="738" fill="#25231f" font-family="Arial,'Microsoft YaHei',sans-serif" font-size="20" font-weight="700">本地工作与长期上下文</text>
    <text x="44" y="801" fill="#c35f3d" font-family="Consolas,monospace" font-size="12" font-weight="700">02</text>
    <text x="92" y="801" fill="#25231f" font-family="Arial,'Microsoft YaHei',sans-serif" font-size="20" font-weight="700">连接邮件与内容平台</text>
    <text x="44" y="864" fill="#c35f3d" font-family="Consolas,monospace" font-size="12" font-weight="700">03</text>
    <text x="92" y="864" fill="#25231f" font-family="Arial,'Microsoft YaHei',sans-serif" font-size="20" font-weight="700">沉淀任务、数据与 Pages</text>
    <text x="44" y="927" fill="#c35f3d" font-family="Consolas,monospace" font-size="12" font-weight="700">04</text>
    <text x="92" y="927" fill="#25231f" font-family="Arial,'Microsoft YaHei',sans-serif" font-size="20" font-weight="700">明确选择后再公开发布</text>
    <text x="44" y="1119" fill="#25231f" font-family="Georgia,serif" font-size="28">Local by default.</text>
    <text x="44" y="1154" fill="#25231f" font-family="Georgia,serif" font-size="28">Public by intent.</text>
  </svg>`;
}

function escapeXml(value) {
  return String(value || "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character]);
}
