import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { createConversationScroll } from '../core/app/src/lib/conversation-scroll.ts';
import { safeChatImageUrl, isImagePreviewKey } from '../core/app/src/lib/chat-image-preview.ts';
import { renderMarkdown } from '../core/app/src/lib/markdown.ts';

function viewport() {
  const state = { top: 0, viewport: 300, messages: Array.from({ length: 10 }, (_, index) => ({ id: String(index), height: 100 })), pinned: true, writes: [] };
  const frames = new Map(); let nextId = 0;
  const positions = () => { let position = 0; return state.messages.map((item) => { const top = position; position += item.height; return { ...item, top }; }); };
  const height = () => state.messages.reduce((total, item) => total + item.height, 0);
  const scroll = createConversationScroll({
    metrics: () => ({ top: state.top, height: height(), viewport: state.viewport }),
    anchor: () => { const item = positions().find(item => item.top + item.height > state.top); return item ? { id: item.id, offset: item.top - state.top } : null; },
    offset: (id) => { const item = positions().find(item => item.id === id); return item ? item.top - state.top : null; },
    writeTop: (top) => { state.top = top; state.writes.push(top); },
    frame: (callback) => { frames.set(++nextId, callback); return nextId; }, cancelFrame: (id) => frames.delete(id),
    pinnedChanged: (pinned) => { state.pinned = pinned; },
  });
  const flush = () => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback()); scroll.scrolled(false); };
  const readAt = (top) => { state.top = top; scroll.scrolled(true); };
  return { state, scroll, flush, readAt, height };
}

test('polling and optimistic messages follow only while the reader remains at latest', () => {
  const v = viewport(); v.scroll.layoutChanged(); v.flush(); assert.equal(v.state.top, 700);
  v.readAt(410); assert.equal(v.state.pinned, false);
  for (let i = 0; i < 3; i++) { v.state.messages.push({ id: `new-${i}`, height: 80 }); v.scroll.layoutChanged(); v.flush(); assert.equal(v.state.top, 410); }
  v.readAt(v.height() - v.state.viewport); assert.equal(v.state.pinned, true);
  v.state.messages.push({ id: 'follow', height: 100 }); v.scroll.layoutChanged(); v.flush();
  assert.equal(v.state.top, v.height() - v.state.viewport);
});

test('prepend anchor ignores concurrent new responses and late image growth above the reader', () => {
  const v = viewport(); v.scroll.layoutChanged(); v.flush(); v.readAt(435); v.scroll.release();
  // Reader moves while the earlier-history HTTP request is still pending.
  v.readAt(515);
  v.state.messages.unshift({ id: 'earlier', height: 200 });
  v.state.messages.push({ id: 'concurrent-reply', height: 400 });
  v.scroll.layoutChanged(); v.flush(); assert.equal(v.state.top, 715);
  v.state.messages[1].height += 150; v.scroll.layoutChanged(); v.flush();
  assert.equal(v.state.top, 865); assert.equal(v.state.pinned, false);
});

test('upward input before a queued refresh or first response wins over pending auto-follow', () => {
  const v = viewport(); v.scroll.layoutChanged(); v.scroll.release(); v.flush();
  assert.equal(v.state.top, 0); assert.equal(v.state.pinned, false);
  v.scroll.latest(); v.flush(); assert.equal(v.state.top, 700);
  v.scroll.layoutChanged(); v.scroll.release(); v.readAt(550); v.flush();
  assert.equal(v.state.top, 550); assert.equal(v.state.pinned, false);
});

test('layout-driven scroll and viewport resize never restore pin; explicit latest does', () => {
  const v = viewport(); v.scroll.layoutChanged(); v.flush(); v.readAt(500);
  v.state.viewport = 500; v.state.top = 500; v.scroll.scrolled(false);
  assert.equal(v.state.pinned, false);
  v.scroll.layoutChanged(); v.flush(); assert.equal(v.state.pinned, false);
  v.scroll.latest(); v.flush(); assert.equal(v.state.pinned, true);
  v.scroll.layoutChanged(); const writes = v.state.writes.length; v.scroll.dispose(); v.flush();
  assert.equal(v.state.writes.length, writes);
});

test('chat markdown images have keyboard preview semantics without changing ordinary links or files', () => {
  const image = renderMarkdown('[![方案](/app/files/image.png)](https://example.com/full.png)', undefined, true);
  assert.match(image, /data-chat-image="true"/); assert.match(image, /role="button"/); assert.match(image, /tabindex="0"/);
  assert.match(image, /aria-label="预览图片 方案"/); assert.doesNotMatch(image, /<a |target=/);
  assert.doesNotMatch(renderMarkdown('![图](/image.png)'), /data-chat-image|role="button"/);
  assert.match(renderMarkdown('[文件](/report.pdf)', undefined, true), /<a href="\/report.pdf" target="_blank"/);
  assert.equal(isImagePreviewKey('Enter'), true); assert.equal(isImagePreviewKey(' '), true); assert.equal(isImagePreviewKey('Escape'), false);
  for (const unsafe of ['javascript:alert(1)', 'file:///C:/secret.png', 'data:text/html,hello', 'https://user:pass@example.com/x.png']) assert.equal(safeChatImageUrl(unsafe), '');
  for (const safe of ['/app/files/x', 'image.png', 'blob:https://example.com/image', 'https://example.com/image.png']) assert.equal(safeChatImageUrl(safe), safe);
});

test('conversation wiring cancels races and opens all structured image paths in the shared modal', () => {
  const read = (file) => fs.readFileSync(new URL(`../core/app/src/${file}`, import.meta.url), 'utf8');
  const page = read('components/desktop-v627/conversation-page.tsx');
  assert.doesNotMatch(page, /follow: true|scrollLatest|previousHeight/);
  assert.match(page, /earlierLoadingRef\.current = true/); assert.match(page, /consumedCursors\.current\.has\(cursor\)/);
  assert.match(page, /signal: controller\.signal/); assert.match(page, /回到最新/);
  for (const file of ['components/desktop-v627/conversation-message-list.tsx', 'components/desktop-v627/conversation-attachment-list.tsx', 'components/mobile-conversation-reader.tsx', 'components/mobile-current/task-display-presentation.tsx']) {
    const source = read(file); assert.match(source, /ChatImageButton/); assert.doesNotMatch(source, /target="_blank"/);
  }
  const dialog = read('components/chat-images/chat-image-dialog.tsx');
  assert.match(dialog, /showModal/); assert.match(dialog, /onCancel=/); assert.match(dialog, /previous\.focus\(\{ preventScroll: true \}\)/);
  assert.match(dialog, /document\.body\.style\.overflow = oldOverflow/); assert.match(dialog, /关闭图片预览/);
  assert.match(dialog, /图片暂时无法加载/); assert.doesNotMatch(dialog, /window\.open|<iframe|target="_blank"/);
});
