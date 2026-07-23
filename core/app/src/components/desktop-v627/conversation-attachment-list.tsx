import type { PendingAttachment } from "./conversation-attachments";

export function ConversationAttachmentList({
  attachments,
  onRemove,
}: {
  attachments: PendingAttachment[];
  onRemove: (index: number) => void;
}) {
  if (!attachments.length) return null;
  return <div className="composer-selected-attachments" aria-label="待发送附件">
    {attachments.map((attachment, index) => {
      const image = attachment.mimeType.startsWith("image/");
      return <div className={`composer-selected-file${image ? " image" : ""}`} key={`${attachment.name}-${index}`}>
        {image
          ? <img src={`data:${attachment.mimeType};base64,${attachment.content}`} alt="" />
          : <span className="composer-file-mark" aria-hidden="true">{fileExtension(attachment.name)}</span>}
        <span title={attachment.name}>{attachment.name}</span>
        <button type="button" onClick={() => onRemove(index)} aria-label={`移除附件 ${attachment.name}`}>×</button>
      </div>;
    })}
  </div>;
}

function fileExtension(name: string) {
  return name.includes(".") ? name.split(".").pop()?.slice(0, 5).toUpperCase() || "FILE" : "FILE";
}
