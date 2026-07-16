import { loadBrief } from "./brief-api.js";
import { renderBrief, setUiState } from "./brief-render.js";

const params = new URLSearchParams(window.location.search);
const requestedSurface = params.get("surface");
const surface = requestedSurface === "mobile" || requestedSurface === "desktop"
  ? requestedSurface
  : window.matchMedia("(max-width: 760px)").matches ? "mobile" : "desktop";

document.documentElement.dataset.appSurface = surface;
document.documentElement.classList.toggle("embedded", params.get("embedded") === "1");
document.querySelectorAll("[data-refresh]").forEach((button) => button.addEventListener("click", () => refresh(true)));
document.querySelectorAll("[data-retry]").forEach((button) => button.addEventListener("click", () => refresh(false)));

refresh(false);

async function refresh(record) {
  setUiState(surface, "loading");
  try {
    const brief = await loadBrief({ record });
    renderBrief(brief, surface);
    setUiState(surface, "ready");
  } catch (error) {
    const message = error instanceof Error ? error.message : "本机服务仍在运行，可以稍后重试。";
    document.querySelectorAll(`[data-surface-view="${surface}"] [data-error]`).forEach((node) => { node.textContent = message; });
    setUiState(surface, "error");
  }
}
