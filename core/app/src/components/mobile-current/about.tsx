"use client";

import { Bot, Mail, Sparkles } from "lucide-react";
import { groupSkills, useRemote } from "./data";
import { MobileListShell } from "./shell";
import { MobileTokenUsageSection } from "./token-usage";
import { MobileWechatStatus } from "./wechat-status";
import { MobileAboutMachineSkeleton, MobileAboutSectionSkeleton } from "./skeletons";
import type { Overview, RuntimeOverview, Skill } from "./types";

export function MobileAbout() {
  const overview = useRemote<Overview>("/api/node/v1/client/overview");
  const runtime = useRemote<RuntimeOverview>("/api/node/v1/client/runtime");
  const skills = useRemote<{ skills: Skill[] }>("/api/skills");
  const mail = useRemote<{ status: { suggestedRecipients?: string[] } }>("/api/system/mail/status");
  const address = mail.value?.status?.suggestedRecipients?.[0] || "agent@你的域名";
  const groups = groupSkills(skills.value?.skills || []);
  return <MobileListShell section="about" title="关于" note="你的 PA">
    <div className="mobile-about">
      {overview.loading ? <MobileAboutMachineSkeleton /> : <section className="mobile-about-machine"><span className="mobile-about-mark">PA</span><div><span>当前机器</span><h1>{overview.value?.machine.id || "本机"}</h1><p>本机运行 · 最近检查：刚刚</p></div><em>{overview.value?.machine.state === "running" ? "在线" : "检查中"}</em></section>}
      {runtime.loading || overview.loading ? <MobileAboutSectionSkeleton /> : <section className="mobile-about-section"><header><div><Bot aria-hidden="true" /><h2>工作机器</h2></div><span>{runtime.value?.version || "未知版本"}</span></header><dl><div><dt>Agent 运行时</dt><dd>Codex CLI</dd></div><div><dt>运行位置</dt><dd>用户自己的电脑</dd></div><div><dt>远程访问</dt><dd>{overview.value?.machine.mobileAddress ? "安全连接正常" : "正在检查"}</dd></div></dl></section>}
      <MobileWechatStatus />
      {mail.loading ? <MobileAboutSectionSkeleton /> : <section className="mobile-about-section"><header><div><Mail aria-hidden="true" /><h2>邮箱</h2></div><span>本机接收</span></header><strong className="mobile-about-email">{address}</strong><p>邮件正文和附件保存在当前工作机器，不上传到 Cloud。</p></section>}
      <MobileTokenUsageSection />
      {skills.loading ? <MobileAboutSectionSkeleton /> : <section className="mobile-about-section mobile-about-skills"><header><div><Sparkles aria-hidden="true" /><h2>技能</h2></div><span>{groups.length} 类 · {skills.value?.skills?.length || 0} 项</span></header>{groups.map((group) => <div className="mobile-about-skill-group" key={group.name}><div><strong>{group.name}</strong><span>{group.skills.length}</span></div>{group.skills.map((skill) => <article key={`${group.name}-${skill.id || skill.name}`}><span>{skill.name.slice(0, 1)}</span><div><strong>{skill.name}</strong><p>{skill.description || "PA 会在需要时使用这项能力。"}</p></div></article>)}</div>)}</section>}
    </div>
  </MobileListShell>;
}
