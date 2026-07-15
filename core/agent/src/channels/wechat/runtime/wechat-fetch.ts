import { Agent, EnvHttpProxyAgent } from "undici";

const TLS_CERT_ERROR_CODES = new Set([
  "SELF_SIGNED_CERT_IN_CHAIN",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "CERT_HAS_EXPIRED",
]);

let insecureAgent: Agent | null = null;
let proxyAgent: EnvHttpProxyAgent | null = null;
let insecureProxyAgent: EnvHttpProxyAgent | null = null;

export async function wechatFetch(input: string | URL, init: RequestInit = {}): Promise<Response> {
  const proxyConfig = getProxyConfig();
  if (allowInsecureWechatTls()) {
    return await fetch(input, withDispatcher(init, getWechatDispatcher({ insecure: true, proxyConfig })));
  }

  if (hasProxyConfig(proxyConfig)) {
    return await fetch(input, withDispatcher(init, getWechatDispatcher({ insecure: false, proxyConfig })));
  }

  try {
    return await fetch(input, init);
  } catch (error) {
    if (!allowAutoTlsFallback() || !hasTlsCertificateError(error)) {
      throw error;
    }
    return await fetch(input, withDispatcher(init, getWechatDispatcher({ insecure: true, proxyConfig })));
  }
}

function allowInsecureWechatTls(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.WECHAT_ILINK_TLS_REJECT_UNAUTHORIZED === "0" || env.WECHAT_TLS_REJECT_UNAUTHORIZED === "0";
}

function allowAutoTlsFallback(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.WECHAT_ILINK_TLS_AUTO_FALLBACK === "1";
}

function withDispatcher(init: RequestInit, dispatcher: Agent | EnvHttpProxyAgent): RequestInit {
  const requestInit = { ...init } as RequestInit & { dispatcher: Agent | EnvHttpProxyAgent };
  requestInit.dispatcher = dispatcher;
  return requestInit;
}

function getWechatDispatcher(params: {
  insecure: boolean;
  proxyConfig: ProxyConfig;
}): Agent | EnvHttpProxyAgent {
  if (hasProxyConfig(params.proxyConfig)) {
    if (params.insecure) {
      insecureProxyAgent ||= createProxyAgent(params.proxyConfig, true);
      return insecureProxyAgent;
    }
    proxyAgent ||= createProxyAgent(params.proxyConfig, false);
    return proxyAgent;
  }

  insecureAgent ||= new Agent({ connect: { rejectUnauthorized: false } });
  return insecureAgent;
}

type ProxyConfig = {
  httpProxy: string;
  httpsProxy: string;
  noProxy: string;
};

function createProxyAgent(proxyConfig: ProxyConfig, insecure: boolean): EnvHttpProxyAgent {
  const tlsOptions = insecure ? { rejectUnauthorized: false } : undefined;
  return new EnvHttpProxyAgent({
    httpProxy: proxyConfig.httpProxy || undefined,
    httpsProxy: proxyConfig.httpsProxy || undefined,
    noProxy: proxyConfig.noProxy || undefined,
    connect: tlsOptions,
    requestTls: tlsOptions,
  });
}

function getProxyConfig(env: NodeJS.ProcessEnv = process.env): ProxyConfig {
  const allProxy = getEnvValue(env, "ALL_PROXY", "all_proxy");
  return {
    httpProxy: getEnvValue(env, "HTTP_PROXY", "http_proxy") || allProxy,
    httpsProxy: getEnvValue(env, "HTTPS_PROXY", "https_proxy") || allProxy,
    noProxy: getEnvValue(env, "NO_PROXY", "no_proxy") || "127.0.0.1,localhost,::1",
  };
}

function hasProxyConfig(proxyConfig: ProxyConfig): boolean {
  return Boolean(proxyConfig.httpProxy || proxyConfig.httpsProxy);
}

function getEnvValue(env: NodeJS.ProcessEnv, primary: string, secondary: string): string {
  return (env[primary] || env[secondary] || "").trim();
}

function hasTlsCertificateError(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && !seen.has(current)) {
    seen.add(current);
    if (typeof current === "object" && current !== null) {
      const code = (current as { code?: unknown }).code;
      if (typeof code === "string" && TLS_CERT_ERROR_CODES.has(code)) return true;
      current = (current as { cause?: unknown }).cause;
    } else {
      break;
    }
  }
  return false;
}
