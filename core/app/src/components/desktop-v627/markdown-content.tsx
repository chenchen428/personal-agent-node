import { renderMarkdown } from "@/lib/markdown";

export function MarkdownContent({ content, className = "" }: { content: string; className?: string }) {
  return <div className={`v72-markdown${className ? ` ${className}` : ""}`} dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }} />;
}
