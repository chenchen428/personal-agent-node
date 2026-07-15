import {
  installPlugin,
  listPlugins,
  pluginComponentSpecs,
  removePlugin,
  setPluginState,
  verifyPlugin,
  type PluginStoreConfig,
} from "../../plugins/runtime/store.ts";

type RuntimePluginConfig = PluginStoreConfig & { extensionsDir?: string };

function normalize(config: RuntimePluginConfig): PluginStoreConfig {
  return { ...config, pluginsDir: config.pluginsDir || config.extensionsDir || "" };
}

export const listExtensions = (config: RuntimePluginConfig) => listPlugins(normalize(config));
export const extensionComponentSpecs = (config: RuntimePluginConfig) => pluginComponentSpecs(normalize(config));
export const installExtension = (config: RuntimePluginConfig, sourceDir: string) => installPlugin(normalize(config), sourceDir);
export const removeExtension = (config: RuntimePluginConfig, id: string) => removePlugin(normalize(config), id);
export const enableExtension = (config: RuntimePluginConfig, id: string) => setPluginState(normalize(config), id, "enabled");
export const disableExtension = (config: RuntimePluginConfig, id: string) => setPluginState(normalize(config), id, "disabled");
export const verifyExtension = (config: RuntimePluginConfig, id: string) => verifyPlugin(normalize(config), id);
