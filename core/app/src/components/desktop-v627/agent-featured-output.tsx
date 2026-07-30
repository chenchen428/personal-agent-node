"use client";

import { Check, ChevronLeft, ChevronRight, Monitor, Smartphone } from "lucide-react";
import { useEffect, useState } from "react";
import type { AgentExample, AgentProfile } from "./types";
import { Badge, SegmentedControl } from "../desktop-v72/primitives";

type OutputDevice = AgentExample["devices"][number];

export function AgentFeaturedOutput({ agent }: { agent: AgentProfile }) {
  const output = agent.example;
  const [device, setDevice] = useState<OutputDevice>(output?.devices[0] || "web");

  useEffect(() => {
    if (output) setDevice(output.devices[0]);
  }, [output]);

  if (!output) return null;
  const deviceOptions = output.devices.map((value) => ({
    label: value === "web" ? "桌面端" : "移动端",
    value,
  }));

  return <section className="agent-featured-output" aria-labelledby="featured-output-title">
    <div className={`agent-output-stage is-${device} is-${output.kind}`}>
      <header>
        <div><span>{output.eyebrow}</span><strong>{device === "mobile" ? "移动端作品" : "桌面端结果"}</strong></div>
        {deviceOptions.length > 1
          ? <SegmentedControl options={deviceOptions} value={device} onChange={(value) => setDevice(value as OutputDevice)} />
          : <span className="agent-output-device-note"><Smartphone aria-hidden />移动端主视图</span>}
      </header>
      <div className="agent-output-frame-wrap">
        <AgentOutputPreview device={device} output={output} />
      </div>
    </div>
    <aside className="agent-output-story">
      <div className="agent-output-story-status"><Badge tone="success">代表产物</Badge><span>已随产品交付</span></div>
      <span>{agent.publicProfile.role}</span>
      <h2 id="featured-output-title">{output.title}</h2>
      <p>{output.description}</p>
      <ul>{output.meta.map((item) => <li key={item}><Check aria-hidden />{item}</li>)}</ul>
      <dl>
        <div><dt>产物规格</dt><dd>{output.format}</dd></div>
        <div><dt>适配设备</dt><dd>{output.devices.includes("web") ? <span><Monitor aria-hidden />Web</span> : null}{output.devices.includes("mobile") ? <span><Smartphone aria-hidden />移动端</span> : null}</dd></div>
        <div><dt>验收归属</dt><dd>Agent 专业检查 + 用户最终验收</dd></div>
      </dl>
    </aside>
  </section>;
}

function AgentOutputPreview({ device, output }: { device: OutputDevice; output: AgentExample }) {
  if (output.kind === "gallery" && output.items) return <AgentOutputGallery items={output.items} title={output.title} />;
  if (output.kind === "video" && output.src) {
    return <div className="agent-output-frame"><video controls playsInline poster={output.poster} preload="metadata"><source src={output.src} type="video/mp4" /></video></div>;
  }
  if (output.kind === "image" && output.src) {
    return <div className="agent-output-frame"><div className="agent-output-image-scroll"><img src={output.src} alt={output.title} /></div></div>;
  }
  const query = `agent-output=1&device=${device}`;
  const separator = output.src?.includes("?") ? "&" : "?";
  return <div className="agent-output-frame"><iframe src={`${output.src}${separator}${query}`} title={`${output.title}代表产物`} referrerPolicy="no-referrer" /></div>;
}

function AgentOutputGallery({ items, title }: { items: NonNullable<AgentExample["items"]>; title: string }) {
  const [index, setIndex] = useState(0);
  const previous = () => setIndex((value) => (value + items.length - 1) % items.length);
  const next = () => setIndex((value) => (value + 1) % items.length);
  const item = items[index];

  return <div className="agent-output-frame agent-output-gallery">
    <img src={item.src} alt={item.alt} />
    <div className="agent-output-gallery-controls">
      <button type="button" aria-label={`查看${title}上一张`} title="上一张" onClick={previous}><ChevronLeft aria-hidden /></button>
      <span>{String(index + 1).padStart(2, "0")} / {String(items.length).padStart(2, "0")}</span>
      <button type="button" aria-label={`查看${title}下一张`} title="下一张" onClick={next}><ChevronRight aria-hidden /></button>
    </div>
  </div>;
}
