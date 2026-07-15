const rows = [
  { name: "core/current", detail: "v0.2.0 · verified", state: "active" },
  { name: "workspace/harness", detail: "Codex · 6 skills", state: "ready" },
  { name: "workspace/files", detail: "local · private", state: "ready" },
  { name: "workspace/plugins", detail: "API v1 · governed", state: "idle" },
];

export function ArchitecturePanel() {
  return (
    <article className="architecture-panel">
      <header><span className="window-dots"><i /><i /><i /></span><span>~/.personal-agent</span><span className="badge-dark">LOCAL</span></header>
      <div className="architecture-tree"><div className="tree-trunk" />{rows.map((row) => <div className="architecture-row" key={row.name}><span className={`state-light ${row.state}`} /><div><strong>{row.name}</strong><small>{row.detail}</small></div></div>)}</div>
      <footer><span>127.0.0.1</span><span>Workspace preserved</span></footer>
    </article>
  );
}
