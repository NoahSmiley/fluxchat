import { useEffect, useState } from "react";
import type { LinkPreview } from "@/types/shared.js";
import { getLinkPreview } from "@/lib/api/index.js";

const previewCache = new Map<string, LinkPreview | null>();

export function LinkEmbed({ url }: { url: string }) {
  const [preview, setPreview] = useState<LinkPreview | null | undefined>(
    previewCache.has(url) ? previewCache.get(url) : undefined
  );

  useEffect(() => {
    if (preview !== undefined) return;
    let cancelled = false;
    getLinkPreview(url).then((data) => {
      if (!cancelled) {
        previewCache.set(url, data);
        setPreview(data);
      }
    });
    return () => { cancelled = true; };
  }, [url, preview]);

  if (!preview || (!preview.title && !preview.description && !preview.image)) return null;

  return (
    <div className="link-embed">
      <div className="link-embed-content">
        {preview.domain && (
          <span className="link-embed-domain">{preview.domain}</span>
        )}
        {preview.title && (
          <a
            className="link-embed-title"
            href={url}
            target="_blank"
            rel="noopener noreferrer"
          >
            {preview.title}
          </a>
        )}
        {preview.description && (
          <p className="link-embed-description">
            {preview.description.length > 200
              ? preview.description.slice(0, 200) + "..."
              : preview.description}
          </p>
        )}
      </div>
      {preview.image && (
        <img
          className="link-embed-image"
          src={preview.image}
          alt=""
          loading="lazy"
        />
      )}
    </div>
  );
}
