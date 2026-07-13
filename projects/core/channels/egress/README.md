# channel-egress

Site-owned loopback egress for channel adapters. The production runtime is a pinned sing-box release built into the workspace release artifact.

- Listen address: `127.0.0.1:1080`
- Secret source: `PRIVATE_SITE_DATA_ROOT/secrets/channels/egress.env`
- Rendered config: `PRIVATE_SITE_DATA_ROOT/channels/egress/sing-box.json`
- Runtime state: `PRIVATE_SITE_DATA_ROOT/channels/egress/`

The Node supervisor owns this optional process. It remains inactive until the secret source is configured and must never be exposed through Nginx or a public listener.
