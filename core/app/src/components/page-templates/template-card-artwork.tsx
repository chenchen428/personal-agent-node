export function TemplateCardArtwork({
  alt,
  badge,
  coverPath,
  footer,
}: {
  alt: string;
  badge: string;
  coverPath: string;
  footer: string;
}) {
  return <div className="template-card-artwork" aria-label={alt}>
    <img alt={alt} decoding="async" fetchPriority="high" loading="eager" src={coverPath} />
    <span className="template-artwork-live"><i />{badge}</span>
    <footer><span>{footer}</span><b>真实产物</b></footer>
  </div>;
}
