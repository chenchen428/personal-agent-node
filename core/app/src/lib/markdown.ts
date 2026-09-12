import MarkdownIt from "markdown-it";

export type MarkdownLinkTransform = (href: string) => string | null;
type MarkdownRenderEnv = { linkTransform?: MarkdownLinkTransform; previewImages?: boolean };
type MarkdownLinkToken = { attrs?: Array<[string, string]> | null; attrSet: (name: string, value: string) => void };
const tokenType = (token: unknown) => (token as { type?: string } | undefined)?.type;

const markdown = new MarkdownIt({
  breaks: true,
  html: false,
  linkify: true,
  typographer: false,
});

const defaultLinkOpen = markdown.renderer.rules.link_open || ((tokens, index, options, _env, self) => self.renderToken(tokens, index, options));
markdown.renderer.rules.link_open = (tokens, index, options, env, self) => {
  if ((env as MarkdownRenderEnv).previewImages && tokenType(tokens[index + 1]) === "image" && tokenType(tokens[index + 2]) === "link_close") return "";
  const token = tokens[index] as unknown as MarkdownLinkToken;
  const originalHref = token.attrs?.find(([name]) => name === "href")?.[1] || "";
  const linkTransform = (env as MarkdownRenderEnv).linkTransform;
  const transformedHref = linkTransform?.(originalHref) || null;
  if (transformedHref) token.attrSet("href", transformedHref);
  else {
    token.attrSet("target", "_blank");
    token.attrSet("rel", "noopener noreferrer");
  }
  return defaultLinkOpen(tokens, index, options, env, self);
};

const defaultLinkClose = markdown.renderer.rules.link_close || ((tokens, index, options, _env, self) => self.renderToken(tokens, index, options));
markdown.renderer.rules.link_close = (tokens, index, options, env, self) => {
  if ((env as MarkdownRenderEnv).previewImages && tokenType(tokens[index - 1]) === "image" && tokenType(tokens[index - 2]) === "link_open") return "";
  return defaultLinkClose(tokens, index, options, env, self);
};
const defaultImage = markdown.renderer.rules.image!;
markdown.renderer.rules.image = (tokens, index, options, env, self) => {
  if ((env as MarkdownRenderEnv).previewImages) {
    tokens[index].attrSet("data-chat-image", "true"); tokens[index].attrSet("role", "button");
    const content = (tokens[index] as unknown as { content?: string }).content;
    tokens[index].attrSet("tabindex", "0"); tokens[index].attrSet("aria-label", `预览图片 ${content || "对话图片"}`);
  }
  return defaultImage(tokens, index, options, env, self);
};

export function renderMarkdown(content: string, linkTransform?: MarkdownLinkTransform, previewImages = false) {
  const renderWithEnv = markdown.render as unknown as (source: string, env: MarkdownRenderEnv) => string;
  return renderWithEnv.call(markdown, String(content || ""), { linkTransform, previewImages });
}
