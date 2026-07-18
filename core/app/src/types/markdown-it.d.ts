declare module "markdown-it" {
  type Token = { attrGet(name: string): string | null; attrSet(name: string, value: string): void };
  type Env = { linkTransform?: (href: string) => string | null; [key: string]: unknown };
  type Rule = (tokens: Token[], index: number, options: object, env: Env, self: { renderToken(tokens: Token[], index: number, options: object): string }) => string;
  export default class MarkdownIt {
    constructor(options?: { breaks?: boolean; html?: boolean; linkify?: boolean; typographer?: boolean });
    renderer: { rules: Record<string, Rule | undefined> };
    render(content: string, env?: Env): string;
  }
}
