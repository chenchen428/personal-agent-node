const viewport = document.querySelector(".drawing-viewport");
const tabs = [...document.querySelectorAll("[data-drawing-tab]")];
const panels = [...document.querySelectorAll("[data-drawing-panel]")];
const scaleOutput = document.querySelector("[data-drawing-scale]");
const download = document.querySelector("[data-drawing-download]");
const zooms = [80, 100, 125, 150, 200];
const files = {
  "p-01-plan-layout": "assets/drawings/p-01-plan-layout.svg",
  "c-01-ceiling-lighting": "assets/drawings/c-01-ceiling-lighting.svg",
  "e-01-switch-control": "assets/drawings/e-01-switch-control.svg",
  "e-02-socket-layout": "assets/drawings/e-02-socket-layout.svg",
  "w-01-plumbing": "assets/drawings/w-01-plumbing.svg",
  "m-01-cabinet": "assets/drawings/m-01-cabinet.svg",
};
let zoomIndex = 1;
let dragging = false;
let origin = null;

function selectDrawing(id, focus = false) {
  if (!files[id]) return;
  tabs.forEach((tab) => {
    const active = tab.dataset.drawingTab === id;
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
    if (active && focus) tab.focus();
  });
  panels.forEach((panel) => { panel.hidden = panel.dataset.drawingPanel !== id; });
  download.href = files[id];
  resetDrawing();
}

function setZoom(nextIndex) {
  zoomIndex = Math.max(0, Math.min(zooms.length - 1, nextIndex));
  const value = zooms[zoomIndex];
  viewport.dataset.zoom = String(value);
  scaleOutput.value = `${value}%`;
  scaleOutput.textContent = `${value}%`;
}

function resetDrawing() {
  setZoom(1);
  viewport.scrollTo({ left: 0, top: 0, behavior: "smooth" });
}

tabs.forEach((tab, index) => {
  tab.addEventListener("click", () => selectDrawing(tab.dataset.drawingTab));
  tab.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    let next;
    if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    else {
      const offset = event.key === "ArrowRight" ? 1 : -1;
      next = (index + offset + tabs.length) % tabs.length;
    }
    selectDrawing(tabs[next].dataset.drawingTab, true);
  });
});

document.querySelector("[data-drawing-action='zoom-in']").addEventListener("click", () => setZoom(zoomIndex + 1));
document.querySelector("[data-drawing-action='zoom-out']").addEventListener("click", () => setZoom(zoomIndex - 1));
document.querySelector("[data-drawing-action='reset']").addEventListener("click", resetDrawing);

viewport.addEventListener("wheel", (event) => {
  event.preventDefault();
  setZoom(zoomIndex + (event.deltaY < 0 ? 1 : -1));
}, { passive: false });

viewport.addEventListener("keydown", (event) => {
  if (event.key === "+" || event.key === "=") setZoom(zoomIndex + 1);
  else if (event.key === "-") setZoom(zoomIndex - 1);
  else if (event.key === "0") resetDrawing();
  else return;
  event.preventDefault();
});

viewport.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  dragging = true;
  origin = { x: event.clientX, y: event.clientY, left: viewport.scrollLeft, top: viewport.scrollTop };
  viewport.setPointerCapture(event.pointerId);
  viewport.dataset.dragging = "true";
});

viewport.addEventListener("pointermove", (event) => {
  if (!dragging || !origin) return;
  viewport.scrollLeft = origin.left - (event.clientX - origin.x);
  viewport.scrollTop = origin.top - (event.clientY - origin.y);
});

function stopDragging(event) {
  dragging = false;
  origin = null;
  viewport.dataset.dragging = "false";
  if (event?.pointerId != null && viewport.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId);
}

viewport.addEventListener("pointerup", stopDragging);
viewport.addEventListener("pointercancel", stopDragging);
selectDrawing("p-01-plan-layout");
