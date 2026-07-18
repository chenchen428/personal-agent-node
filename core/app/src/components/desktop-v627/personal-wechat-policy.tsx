"use client";

import { Check, ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "../desktop-v72/primitives";
import type { PersonalWechatDirectory, PersonalWechatPolicy } from "./connection-types";

type Props = {
  directory: PersonalWechatDirectory;
  initialPolicy: PersonalWechatPolicy;
  saving: boolean;
  saved: boolean;
  onSave: (policy: PersonalWechatPolicy) => Promise<void>;
};

export function PersonalWechatPolicyEditor({ directory, initialPolicy, saving, saved, onSave }: Props) {
  const initialContacts = useMemo(() => new Map(initialPolicy.contacts.map((item) => [item.wxid, item.scope])), [initialPolicy]);
  const initialGroups = useMemo(() => new Map(initialPolicy.groups.map((item) => [item.wxid, item.trigger])), [initialPolicy]);
  const [contacts, setContacts] = useState(() => directory.contacts.map((item) => ({ ...item, scope: initialContacts.get(item.id) || null })));
  const [groups, setGroups] = useState(() => directory.groups.map((item) => ({ ...item, trigger: initialGroups.get(item.id) || null })));

  const save = () => onSave({
    schemaVersion: 1,
    enabled: true,
    contacts: contacts.filter((item) => item.scope).map((item) => ({ wxid: item.id, scope: item.scope! })),
    groups: groups.filter((item) => item.trigger).map((item) => ({ wxid: item.id, trigger: item.trigger! })),
    updatedAt: initialPolicy.updatedAt,
  });

  return <section className="personal-wechat-policy" aria-labelledby="personal-wechat-policy-title">
    <header><span><ShieldCheck /><span><strong id="personal-wechat-policy-title">访问策略</strong><small>已通过千寻读取 {contacts.length} 位联系人和 {groups.length} 个群 · 仅显示脱敏标识</small></span></span><em>默认拒绝</em></header>
    <div className="personal-wechat-policy-grid">
      <fieldset disabled={saving}><legend>谁能够对话并触发</legend>{contacts.length ? contacts.map((contact, index) => <div className="personal-wechat-policy-row" key={contact.id}>
        <input id={`personal-wechat-contact-${index}`} type="checkbox" checked={Boolean(contact.scope)} onChange={(event) => setContacts((items) => items.map((item) => item.id === contact.id ? { ...item, scope: event.target.checked ? "direct_and_group" as const : null } : item))} />
        <label htmlFor={`personal-wechat-contact-${index}`}><strong>{contact.name}</strong><small>{contact.maskedId}</small></label>
        <select aria-label={`${contact.name}触发范围`} value={contact.scope || "direct_and_group"} disabled={!contact.scope} onChange={(event) => setContacts((items) => items.map((item) => item.id === contact.id ? { ...item, scope: event.target.value as NonNullable<typeof item.scope> } : item))}><option value="direct_and_group">私聊 + 群内</option><option value="direct_only">仅私聊</option><option value="group_only">仅群内</option></select>
      </div>) : <p className="personal-wechat-empty">千寻没有返回联系人。</p>}</fieldset>
      <fieldset disabled={saving}><legend>哪些群可以使用</legend>{groups.length ? groups.map((group, index) => <div className="personal-wechat-policy-row" key={group.id}>
        <input id={`personal-wechat-group-${index}`} type="checkbox" checked={Boolean(group.trigger)} onChange={(event) => setGroups((items) => items.map((item) => item.id === group.id ? { ...item, trigger: event.target.checked ? "allowed_members_mention" as const : null } : item))} />
        <label htmlFor={`personal-wechat-group-${index}`}><strong>{group.name}</strong><small>{group.maskedId}</small></label>
        <select aria-label={`${group.name}触发方式`} value={group.trigger || "allowed_members_mention"} disabled={!group.trigger} onChange={(event) => setGroups((items) => items.map((item) => item.id === group.id ? { ...item, trigger: event.target.value as NonNullable<typeof item.trigger> } : item))}><option value="allowed_members_mention">名单成员 + @我</option><option value="any_member_mention">任何成员 + @我</option><option value="allowed_members_message">名单成员发言</option></select>
      </div>) : <p className="personal-wechat-empty">千寻没有返回群。</p>}</fieldset>
    </div>
    <div className="personal-wechat-policy-note"><ShieldCheck /><p>群聊默认同时校验允许联系人、允许群和 @ 当前个人微信账号。未授权私聊、未授权群、自己发送的消息和非文本消息都不会触发主 Agent。</p></div>
    <footer><span role="status" aria-live="polite">{saving ? "正在保存策略并启用消息接收" : saved ? "访问策略已保存在本机" : "确认名单后保存，消息接收才会启用"}</span><Button disabled={saving} onClick={() => void save()}>{saved ? <Check /> : null}{saving ? "正在启用" : saved ? "重新保存" : "保存并启用"}</Button></footer>
  </section>;
}
