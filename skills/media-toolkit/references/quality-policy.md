# Media Quality Policy

| Source | Preferred output | Guidance |
|---|---|---|
| Photograph | WebP or JPEG | Start near quality 80; inspect faces, texture, and gradients |
| Illustration | WebP or PNG | Preserve crisp edges and intentional palette |
| Text-heavy card | WebP or PNG | Inspect at phone size; compression artifacts around glyphs are unacceptable |
| Transparent asset | WebP or PNG | Verify alpha edges against light and dark backgrounds |
| Diagram/SVG | Keep SVG | Rasterize only when the destination cannot accept SVG |
| Archival/master | Keep original | Create a derivative rather than replacing the master |

Compression is not successful only because bytes decreased. Reject outputs with broken transparency, unreadable text, banding, color shifts, or wrong orientation.
