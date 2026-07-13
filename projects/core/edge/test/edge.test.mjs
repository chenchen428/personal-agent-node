import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadEdgeConfig, planSiteRegistration, planSiteReplacement, readMetricSummary, readSites, renderEdge, renderSiteNginx, renderWireGuard, replaceSite, siteHostnames, updateSiteStatus, upsertSite } from "../src/edge.mjs";

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "private-site-edge-"));
  const configDir = path.join(root, "config");
  const stateDir = path.join(root, "state");
  fs.mkdirSync(configDir, { recursive: true });
  const sites = {
    schemaVersion: 1,
    sites: [{
      schemaVersion: 1,
      siteId: "site_example",
      asciiDomain: "example.site",
      nodeId: "node_example",
      originUrl: "https://10.77.0.2:8843/",
      originServerName: "node-example.origin.private-site",
      wireGuardPublicKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
      status: "active",
      certificateMode: "http-san",
    }],
  };
  fs.writeFileSync(path.join(configDir, "sites.json"), JSON.stringify(sites));
  const config = loadEdgeConfig({
    PRIVATE_SITE_EDGE_CONFIG_DIR: configDir,
    PRIVATE_SITE_EDGE_STATE_DIR: stateDir,
    PRIVATE_SITE_EDGE_SITES_FILE: path.join(configDir, "sites.json"),
    PRIVATE_SITE_EDGE_NGINX_DIR: path.join(configDir, "nginx"),
    PRIVATE_SITE_EDGE_CERT_DIR: path.join(configDir, "certs"),
    PRIVATE_SITE_EDGE_WG_CONFIG: path.join(configDir, "wireguard", "wg0.conf"),
    PRIVATE_SITE_EDGE_METRICS_ROOT: path.join(stateDir, "metrics"),
  });
  return { root, config };
}

test("expands one apex into the complete fixed distribution", () => {
  const { root, config } = fixture();
  try {
    const site = readSites(config).sites[0];
    const distribution = JSON.parse(fs.readFileSync(config.distributionFile, "utf8"));
    const hosts = siteHostnames(site, distribution);
    for (const host of ["example.site", "a.example.site", "agent.example.site", "tools.example.site", "pages.example.site"]) {
      assert.ok(hosts.includes(host));
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("renders WireGuard origin mTLS and no payload buffering", () => {
  const { root, config } = fixture();
  try {
    const site = readSites(config).sites[0];
    const distribution = JSON.parse(fs.readFileSync(config.distributionFile, "utf8"));
    const nginx = renderSiteNginx(site, distribution, config);
    assert.match(nginx, /proxy_pass https:\/\/10\.77\.0\.2:8843/);
    assert.match(nginx, /proxy_ssl_verify on/);
    assert.match(nginx, /proxy_ssl_name node-example\.origin\.private-site/);
    assert.match(nginx, /proxy_request_buffering off/);
    assert.match(nginx, /listen 443 ssl;\n    http2 on;/);
    assert.doesNotMatch(nginx, /listen 443 ssl http2/);
    assert.match(nginx, /access_log .*traffic-site_example-node_example\.log private_site_metrics/);
    assert.doesNotMatch(nginx, /proxy_pass http:\/\//);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("renders one deterministic file per Site", () => {
  const { root, config } = fixture();
  try {
    const result = renderEdge({ config });
    assert.equal(result.count, 1);
    assert.ok(fs.existsSync(path.join(config.nginxOutputDir, "site-example.site.conf")));
    assert.ok(fs.existsSync(result.manifestPath));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("renders kernel-enforced peer isolation rules", () => {
  const { root, config } = fixture();
  try {
    fs.mkdirSync(path.dirname(config.wireGuardPrivateKey), { recursive: true });
    fs.writeFileSync(config.wireGuardPrivateKey, "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC=\n");
    const result = renderEdge({ config });
    const wireGuard = fs.readFileSync(result.wireGuardConfig, "utf8");
    assert.match(wireGuard, /FORWARD -i %i -o %i -j DROP/);
    assert.match(wireGuard, /INPUT -i %i -j PRIVATE_SITE_WG_INPUT/);
    assert.match(wireGuard, /ESTABLISHED,RELATED -j ACCEPT/);
    assert.match(wireGuard, /AllowedIPs = 10\.77\.0\.2\/32/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("rejects public origins", () => {
  const { root, config } = fixture();
  try {
    const document = JSON.parse(fs.readFileSync(config.sitesFile, "utf8"));
    document.sites[0].originUrl = "https://203.0.113.10:8843/";
    fs.writeFileSync(config.sitesFile, JSON.stringify(document));
    assert.throws(() => readSites(config), /private WireGuard/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("validates the resolved ACME credential target permissions", () => {
  const reconciliation = fs.readFileSync(new URL("../scripts/reconcile-certificates.sh", import.meta.url), "utf8");
  assert.match(reconciliation, /stat -Lc '%a' "\$EDGE_ACME_ENV"/);
  assert.match(reconciliation, /stat -Lc '%a' "\$ALIYUN_ACME_ENV"/);
  assert.doesNotMatch(reconciliation, /--install-cert/);
  assert.match(reconciliation, /clear_install_hooks/);
  assert.match(reconciliation, /previous_dir="\$target_dir\/previous"/);
  assert.match(reconciliation, /install -m 644 "\$previous_dir\/fullchain\.cer"/);
  assert.match(reconciliation, /--resolve "\$domain:443:127\.0\.0\.1"/);
});

test("revokes a Site through the status contract", () => {
  const { root, config } = fixture();
  try {
    const result = updateSiteStatus({ config, domain: "example.site", status: "revoked" });
    assert.equal(result.applyRequired, true);
    assert.equal(readSites(config).sites[0].status, "revoked");
    assert.equal(renderEdge({ config }).count, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("atomically adds a Site without replacing unrelated Edge records", () => {
  const { root, config } = fixture();
  try {
    const plan = planSiteRegistration({ config, siteId: "site_second", nodeId: "node_second", domain: "second.site" });
    assert.equal(plan.address, "10.77.0.3");
    const result = upsertSite({ config, site: {
      siteId: "site_second",
      nodeId: "node_second",
      asciiDomain: "second.site",
      originUrl: "https://10.77.0.3:8843/",
      wireGuardPublicKey: "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=",
      status: "active",
    } });
    assert.equal(result.created, true);
    assert.equal(readSites(config).sites.length, 2);
    assert.equal(planSiteRegistration({ config, siteId: "site_second", nodeId: "node_second", domain: "second.site" }).address, "10.77.0.3");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Edge Site upsert rejects identity takeover and unexpected addresses", () => {
  const { root, config } = fixture();
  try {
    assert.throws(
      () => planSiteRegistration({ config, siteId: "site_other", nodeId: "node_other", domain: "example.site" }),
      /identity conflicts/,
    );
    assert.throws(
      () => upsertSite({ config, site: {
        siteId: "site_second",
        nodeId: "node_second",
        asciiDomain: "second.site",
        originUrl: "https://10.77.0.9:8843/",
        wireGuardPublicKey: "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=",
        status: "active",
      } }),
      /allocated origin address/,
    );
    assert.equal(readSites(config).sites.length, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("replacement atomically archives the previous Node and removes its WireGuard peer", () => {
  const { root, config } = fixture();
  try {
    fs.mkdirSync(path.dirname(config.wireGuardPrivateKey), { recursive: true });
    fs.writeFileSync(config.wireGuardPrivateKey, "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC=\n");
    const plan = planSiteReplacement({
      config,
      siteId: "site_example",
      nodeId: "node_replacement",
      domain: "example.site",
      previousNodeId: "node_example",
    });
    assert.equal(plan.address, "10.77.0.2");
    const result = replaceSite({
      config,
      previousNodeId: "node_example",
      site: {
        siteId: "site_example",
        nodeId: "node_replacement",
        asciiDomain: "example.site",
        originUrl: "https://10.77.0.2:8843/",
        wireGuardPublicKey: "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=",
        status: "active",
      },
    });
    assert.equal(result.replaced, true);
    const document = JSON.parse(fs.readFileSync(config.sitesFile, "utf8"));
    assert.equal(document.sites[0].nodeId, "node_replacement");
    assert.equal(document.revocations[0].nodeId, "node_example");
    assert.equal(document.revocations[0].replacedByNodeId, "node_replacement");
    const repeated = replaceSite({
      config,
      previousNodeId: "node_example",
      site: {
        siteId: "site_example",
        nodeId: "node_replacement",
        asciiDomain: "example.site",
        originUrl: "https://10.77.0.2:8843/",
        wireGuardPublicKey: "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=",
        status: "active",
      },
    });
    assert.equal(repeated.alreadyReplaced, true);
    assert.equal(JSON.parse(fs.readFileSync(config.sitesFile, "utf8")).revocations.length, 1);
    const wireGuard = fs.readFileSync(renderWireGuard({ config }), "utf8");
    assert.match(wireGuard, /BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=/);
    assert.doesNotMatch(wireGuard, /AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=/);
    assert.doesNotMatch(wireGuard, /node_example/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("replacement refuses a stale previous Node identity", () => {
  const { root, config } = fixture();
  try {
    assert.throws(() => planSiteReplacement({
      config,
      siteId: "site_example",
      nodeId: "node_replacement",
      domain: "example.site",
      previousNodeId: "node_stale",
    }), /does not match/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("uses payload-free seven-day operational metrics", () => {
  const globalNginx = fs.readFileSync(new URL("../../../../infra/nginx/conf.d/05-private-site-edge.conf", import.meta.url), "utf8");
  const logrotate = fs.readFileSync(new URL("../../../../infra/edge/logrotate/private-site-edge.conf", import.meta.url), "utf8");
  for (const forbidden of [/\$remote_addr\b/, /\$request_uri\b/, /\$request(?:\s|\")/, /\$http_/, /\$cookie_/]) assert.doesNotMatch(globalNginx, forbidden);
  assert.match(logrotate, /rotate 7/);
  assert.match(logrotate, /su root @NGINX_GROUP@/);

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "private-site-metrics-"));
  try {
    const file = path.join(root, "traffic.log");
    fs.writeFileSync(file, [
      JSON.stringify({ timestamp: "2026-07-12T10:00:00+08:00", status: 200, bytesIn: 12, bytesOut: 34, duration: 0.125 }),
      JSON.stringify({ timestamp: "2026-07-12T10:01:00+08:00", status: 503, bytesIn: 5, bytesOut: 7, duration: 1.5 }),
      "invalid",
    ].join("\n"));
    assert.deepEqual(readMetricSummary(file), {
      requests: 2,
      bytesIn: 17,
      bytesOut: 41,
      durationSeconds: 1.625,
      statusClasses: { "1xx": 0, "2xx": 1, "3xx": 0, "4xx": 0, "5xx": 1 },
      lastRequestAt: "2026-07-12T10:01:00+08:00",
      truncated: false,
    });
    const truncated = readMetricSummary(file, { maxBytes: 180 });
    assert.equal(truncated.truncated, true);
    assert.ok(truncated.requests >= 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("fresh Edge bootstrap persists the no-core and no-swap privacy policy", () => {
  const bootstrap = fs.readFileSync(new URL("../../../../infra/edge/bootstrap-host.sh", import.meta.url), "utf8");
  assert.match(bootstrap, /\/etc\/sysctl\.d\/99-private-site-edge\.conf/);
  assert.match(bootstrap, /fs\.suid_dumpable = 0/);
  assert.match(bootstrap, /swapon --noheadings/);
});

test("Edge installer normalizes CRLF user records and resolves the primary group", () => {
  const installer = fs.readFileSync(new URL("../../../../scripts/install-private-site-edge-release.sh", import.meta.url), "utf8");
  assert.match(installer, /tr -d '\\r'/);
  assert.match(installer, /id -gn "\$nginx_user"/);
});
