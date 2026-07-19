import { renderMarkdown, type MarkdownLinkTransform } from "@/lib/markdown";

export function MarkdownContent({ content, className = "", linkTransform }: { content: string; className?: string; linkTransform?: MarkdownLinkTransform }) {
  return <div className={`v72-markdown${className ? ` ${className}` : ""}`} dangerouslySetInnerHTML={{ __html: renderMarkdown(content, linkTransform) }} />;
}
