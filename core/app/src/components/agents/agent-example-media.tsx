import { FileText } from "lucide-react";
import type { AgentExamplePresentation } from "./agent-example-presentation";

export function AgentExampleMedia({ presentation, immersive = false }: {
  presentation: AgentExamplePresentation;
  immersive?: boolean;
}) {
  const { example, media, poster, preview } = presentation;
  const className = immersive ? "agent-example-media is-immersive" : "agent-example-media";
  if (preview && media === "video") return <div className={className}>
    <video controls playsInline poster={poster} preload="metadata" src={preview} />
  </div>;
  if (preview) return <div className={className}>
    <iframe title={example.title} src={preview} sandbox="allow-scripts allow-same-origin" />
  </div>;
  return <div className={`${className} agent-example-placeholder`}>
    <FileText aria-hidden="true" />
    <strong>{example.title}</strong>
    <p>{example.description || example.summary}</p>
  </div>;
}
