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
  onSave: (policy: PersonalWechatPolicy) => Promise<boolean>;
};

export function PersonalWechatPolicyEditor({ directory, initialPolicy, saving, saved, onSave }: Props) {
  const initialContacts = useMemo(() => new Map(initialPolicy.contacts.map((item) => [item.wxid, item.scope])), [initialPolicy]);
  const initialGroups = useMemo(() => new Map(initialPolicy.groups.map((item) => [item.wxid, item.trigger])), [initialPolicy]);
  const [contacts, setContacts] = useState(() => directory.contacts.map((item) => ({ ...item, scope: initialContacts.get(item.id) || null })));
  const [groups, setGroups] = useState(() => directory.groups.map((item) => ({ ...item, trigger: initialGroups.get(item.id) || null })));
  const [dirty, setDirty] = useState(false);
  const selectedContacts = contacts.filter((item) => item.scope).length;
  const selectedGroups = groups.filter((item) => item.trigger).length;
  const hasSelection = selectedContacts + selectedGroups > 0;

  const save = async () => {
    if (!hasSelection) return;
    const didSave = await onSave({
      schemaVersion: 1,
      enabled: true,
      contacts: contacts.filter((item) => item.scope).map((item) => ({ wxid: item.id, scope: item.scope! })),
      groups: groups.filter((item) => item.trigger).map((item) => ({ wxid: item.id, trigger: item.trigger! })),
      updatedAt: initialPolicy.updatedAt,
    });
    if (didSave) setDirty(false);
  };

  return <section className="personal-wechat-policy" aria-labelledby="personal-wechat-policy-title">
    <header><span><ShieldCheck /><span><strong id="personal-wechat-policy-title">允许范围</strong><small>直接选择下拉项即可授权；保持“不允许”就不会触发 Agent · 仅显示脱敏标识</small></span></span><em>默认拒绝</em></header>
    <div className="personal-wechat-policy-grid">
      <fieldset disabled={saving}><legend>联系人 <span>已允许 {selectedContacts}/{contacts.length}</span></legend><p className="personal-wechat-policy-help">选择这位联系人可以在哪些场景触发 Agent。</p>{contacts.length ? contacts.map((contact, index) => <div className={`personal-wechat-policy-row${contact.scope ? " is-active" : ""}`} key={contact.id}>
        <label htmlFor={`personal-wechat-contact-${index}`}><strong>{contact.name}</strong><small>{contact.maskedId}</small></label>
        <select id={`personal-wechat-contact-${index}`} aria-label={`${contact.name}触发范围`} value={contact.scope || "none"} onChange={(event) => { const scope = event.target.value === "none" ? null : event.target.value as NonNullable<typeof contact.scope>; setContacts((items) => items.map((item) => item.id === contact.id ? { ...item, scope } : item)); setDirty(true); }}><option value="none">不允许</option><option value="direct_and_group">私聊和群聊</option><option value="direct_only">仅私聊</option><option value="group_only">仅群聊</option></select>
      </div>) : <p className="personal-wechat-empty">千寻没有返回联系人。</p>}</fieldset>
      <fieldset disabled={saving}><legend>群聊 <span>已允许 {selectedGroups}/{groups.length}</span></legend><p className="personal-wechat-policy-help">选择群聊以及群里的触发方式。</p>{groups.length ? groups.map((group, index) => <div className={`personal-wechat-policy-row${group.trigger ? " is-active" : ""}`} key={group.id}>
        <label htmlFor={`personal-wechat-group-${index}`}><strong>{group.name}</strong><small>{group.maskedId}</small></label>
        <select id={`personal-wechat-group-${index}`} aria-label={`${group.name}触发方式`} value={group.trigger || "none"} onChange={(event) => { const trigger = event.target.value === "none" ? null : event.target.value as NonNullable<typeof group.trigger>; setGroups((items) => items.map((item) => item.id === group.id ? { ...item, trigger } : item)); setDirty(true); }}><option value="none">不允许</option><option value="allowed_members_mention">允许联系人 @我</option><option value="any_member_mention">任何成员 @我</option><option value="allowed_members_message">允许联系人发言</option></select>
      </div>) : <p className="personal-wechat-empty">千寻没有返回群。</p>}</fieldset>
    </div>
    <div className="personal-wechat-policy-note"><ShieldCheck /><p>只有已允许的联系人或群聊会触发 Agent；自己发送和非文本消息仍只保存记录，不会触发处理。</p></div>
    <footer><span role="status" aria-live="polite">{saving ? "正在保存并启用消息接收" : !hasSelection ? "至少允许 1 位联系人或 1 个群" : dirty ? `有未保存的修改 · 已允许 ${selectedContacts} 位联系人、${selectedGroups} 个群` : saved ? `已保存 · 允许 ${selectedContacts} 位联系人、${selectedGroups} 个群` : "确认允许范围后保存并启用"}</span><Button disabled={saving || !hasSelection || (!dirty && saved)} onClick={() => void save()}>{saved && !dirty ? <Check /> : null}{saving ? "正在保存" : saved && !dirty ? "已保存" : saved ? "保存修改" : "保存并启用"}</Button></footer>
  </section>;
}
