declare module "markdown-it" {
  type Token = { attrSet(name: string, value: string): void };
  type Rule = (tokens: Token[], index: number, options: object, env: object, self: { renderToken(tokens: Token[], index: number, options: object): string }) => string;
  export default class MarkdownIt {
    constructor(options?: { breaks?: boolean; html?: boolean; linkify?: boolean; typographer?: boolean });
    renderer: { rules: Record<string, Rule | undefined> };
    render(content: string): string;
  }
}
