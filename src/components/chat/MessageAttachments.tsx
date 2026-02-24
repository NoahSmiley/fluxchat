import { Download } from "lucide-react";
import type { Attachment } from "@/types/shared.js";
import { getFileUrl } from "@/lib/api/index.js";

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${(bytes / 1073741824).toFixed(1)} GB`;
}

export function MessageAttachments({ attachments }: { attachments: Attachment[] }) {
  if (!attachments.length) return null;

  return (
    <div className="attachment-list">
      {attachments.map((att) => {
        const url = getFileUrl(att.id, att.filename);

        if (att.contentType.startsWith("image/")) {
          return (
            <div key={att.id} className="attachment-image">
              <a href={url} target="_blank" rel="noopener noreferrer">
                <img src={url} alt={att.filename} loading="lazy" />
              </a>
            </div>
          );
        }

        if (att.contentType.startsWith("video/")) {
          return (
            <div key={att.id} className="attachment-video">
              <video src={url} controls preload="metadata" />
            </div>
          );
        }

        if (att.contentType.startsWith("audio/")) {
          return (
            <div key={att.id} className="attachment-audio">
              <audio src={url} controls preload="metadata" />
              <span className="attachment-audio-name">{att.filename}</span>
            </div>
          );
        }

        return (
          <a key={att.id} href={url} className="attachment-file" download={att.filename}>
            <Download size={16} />
            <span className="attachment-file-name">{att.filename}</span>
            <span className="attachment-file-size">{formatFileSize(att.size)}</span>
          </a>
        );
      })}
    </div>
  );
}
