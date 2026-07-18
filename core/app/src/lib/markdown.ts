import MarkdownIt from "markdown-it";

export type MarkdownLinkTransform = (href: string) => string | null;
type MarkdownRenderEnv = { linkTransform?: MarkdownLinkTransform };
type MarkdownLinkToken = { attrs?: Array<[string, string]> | null; attrSet: (name: string, value: string) => void };

const markdown = new MarkdownIt({
  breaks: true,
  html: false,
  linkify: true,
  typographer: false,
});

const defaultLinkOpen = markdown.renderer.rules.link_open || ((tokens, index, options, _env, self) => self.renderToken(tokens, index, options));
markdown.renderer.rules.link_open = (tokens, index, options, env, self) => {
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

export function renderMarkdown(content: string, linkTransform?: MarkdownLinkTransform) {
  const renderWithEnv = markdown.render as unknown as (source: string, env: MarkdownRenderEnv) => string;
  return renderWithEnv.call(markdown, String(content || ""), { linkTransform });
}
