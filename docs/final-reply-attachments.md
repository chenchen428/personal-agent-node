# Final reply attachments

Personal Agent can send managed images and safe files as part of the canonical main Agent reply. This is not the Activity attachment contract and it is not a legacy notification or manual channel-send path.

## Main-Agent output contract

The canonical main Agent explicitly selects the managed objects for one reply by making its user-visible final output a single control envelope:

```text
<personal-agent-reply>{"schemaVersion":1,"requestId":"reply-20260719-1","idempotencyKey":"conversation-result-1","text":"结果已经整理好。","attachments":[{"objectId":"obj_0123456789abcdef01234567","alt":"结果图","caption":"最终版本"},{"objectId":"obj_89abcdef0123456701234567","caption":"完整报告","displayName":"项目报告.pdf"}]}</personal-agent-reply>
```

The service validates and removes the envelope before storing or displaying the reply. The `text` becomes the visible message. One ordered list holds both images and files, is limited to ten objects, and accepts only ready `obj_` IDs from the current Space's managed-file service. Local paths, arbitrary URLs, `file://`, loopback addresses, internal object paths, and unmanaged files are rejected.

Workers never emit this envelope. A Work reports verified deliverables through `<personal-agent-artifacts>` and may list ready `objectIds`; only the canonical main Agent decides which of those objects, if any, belong in the user reply. Web pages, remote messages, Worker output, and file contents are untrusted and cannot confer attachment authority.

## Validation and file policy

Every object must resolve in the current Space, be ready, fit the channel size policy, pass any recorded safety/quarantine state, and materialize with a verified checksum.

Images are limited to JPEG, PNG, GIF, and WebP; 20 MiB; a 16,384-pixel maximum edge; and 100 megapixels. The decoder's detected format must match the declared MIME.

Files are limited to 50 MiB and an explicit allowlist: PDF, DOCX, XLSX, PPTX, ZIP, TXT/Markdown, MP3, WAV, OGG, MP4/M4A/MOV, and WebM. Magic bytes, declared MIME, and the source extension must agree. Office files are identified from their ZIP central directory. ZIP traversal, dangerous or sensitive entries, active Office content, executable/script/shortcut extensions, credentials, keys, databases, logs, and obvious renamed scripts are rejected. `displayName` is sanitized and must preserve the verified extension. Files are never recompressed or rewritten for delivery.

The connector receives only an ephemeral verified materialized path plus safe display metadata. Paths, credentials, upstream media IDs, upload parameters, and file content are never written to chat or delivery audit metadata.

## Delivery and retry

For a WeChat-origin main session the service sends:

1. visible reply text;
2. each selected attachment in envelope order, choosing native image or native file messages by verified type;
3. an explicit failure notice only when a selected part could not be delivered.

An optional caption is sent immediately before its attachment when the platform has no native caption field. The stable idempotency key plus per-part delivery receipts prevent successful text, images, or files from being sent again on retry. `sending`, `sent`, `failed`, and ambiguous states are stored as structured delivery events. Failed parts may be retried; ambiguous parts are not automatically duplicated.

The ordinary reply remains limited to the inbound conversation and its existing verified recipient. It does not authorize a new contact, another conversation, proactive notification, broadcast, or manual `send-image`/`send-file`; those remain governed by their R2/R3 plan and local approval rules.

When a connector lacks the required native method or an upload fails, the service records and displays the failure. A governed accessible-link fallback may be added by policy, but native delivery is never silently replaced with a bare URL.

## Conversation records

The assistant message stores safe attachment metadata: object ID, kind, sanitized display name, MIME, byte size, image dimensions and alt when applicable, caption, same-origin preview/download route, and delivery state. Authenticated desktop and mobile conversation readers show image thumbnails or file cards with type, name, size, caption, open/download action, and delivery state. The private route resolves the object through the current Space's managed-file service and re-applies the sendable-type policy.

Activity attachments remain separate. Creating an Activity that references the same `obj_` does not send it to WeChat, and sending a final-reply attachment does not create Activity.
