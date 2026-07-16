"use client";

import { useState } from "react";
import { copyText, formatCompactDuration, groupSkills, useRemote } from "./data";
import { MobileListShell } from "./shell";
import { MobileWechatStatus } from "./wechat-status";
import type { Overview, Skill } from "./types";

export function MobileAbout() {
  const overview = useRemote<Overview>("/api/node/v1/client/overview");
  const skills = useRemote<{ skills: Skill[] }>("/api/skills");
  const mail = useRemote<{ status: { suggestedRecipients?: string[] } }>("/api/system/mail/status");
  const [copied, setCopied] = useState(false);
  const address = mail.value?.status?.suggestedRecipients?.[0] || "agent@你的域名";
  const groups = groupSkills(skills.value?.skills || []);
  return <MobileListShell section="about" title="关于" note="你的 PA">
    <section className="about-machine"><span className="about-pa-mark">PA</span><div><span className="eyebrow">Personal Agent</span><h1>本机 Personal Agent</h1><p>{overview.value?.machine.id || "正在读取本机信息"}</p></div><span className="machine-live">● 在线</span></section>
    <section className="about-section"><header><h2>这台电脑</h2><span>只读</span></header><dl className="about-facts"><div><dt>运行状态</dt><dd>正常</dd></div><div><dt>已运行</dt><dd>{overview.value ? formatCompactDuration(overview.value.machine.uptimeSeconds) : "读取中"}</dd></div><div><dt>任务</dt><dd>{overview.value?.counts.work ?? "—"}</dd></div><div><dt>发布页</dt><dd>{overview.value?.counts.pages ?? "—"}</dd></div></dl></section>
    <MobileWechatStatus />
    <section className="about-section"><header><h2>PA 邮箱</h2><span>{overview.value?.counts.mail ?? 0} 封</span></header><div className="about-mail"><div><strong>{address}</strong><p>邮件正文和附件保存在这台电脑上。</p></div><button type="button" disabled={copied} onClick={() => { void copyText(address).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1500); }); }}>{copied ? "已复制" : "复制地址"}</button></div></section>
    <section className="about-section about-skills-section"><header><h2>技能</h2><span>{skills.value?.skills?.length || 0} 项</span></header><div className="about-skill-groups">{groups.map((group) => <section className="about-skill-group" key={group.name}><header><h3>{group.name}</h3><span>{group.skills.length}</span></header><div className="about-skill-list">{group.skills.map((skill) => <article key={skill.id}><span className="about-skill-icon">{skill.name.slice(0, 1)}</span><div><strong>{skill.name}</strong><p>{skill.description || "PA 会在需要时使用这项能力。"}</p></div></article>)}</div></section>)}</div></section>
  </MobileListShell>;
}
