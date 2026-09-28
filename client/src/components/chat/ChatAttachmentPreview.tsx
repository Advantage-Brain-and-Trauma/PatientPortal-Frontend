import { useEffect, useState } from "react";
import { Download, FileText, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { CHAT_IMAGE_EXTENSIONS } from "@/lib/chatApi";

export interface ChatAttachmentPreviewTarget {
  url: string;
  name: string;
}

const extensionOf = (name: string, url: string): string => {
  const fromName = name.split(".").pop() || "";
  const fromUrl = url.split("?")[0].split(".").pop() || "";
  return (fromName || fromUrl).toLowerCase();
};

/**
 * In-app viewer for a chat attachment: images inline, PDFs in an iframe, other
 * types (doc/xls/csv — no browser preview) as a download card. Only receives
 * URLs already vetted as absolute http(s) by the widget.
 */
export default function ChatAttachmentPreview({
  target,
  onClose,
}: {
  target: ChatAttachmentPreviewTarget | null;
  onClose: () => void;
}) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setLoaded(false);
    setFailed(false);
  }, [target?.url]);

  const extension = target ? extensionOf(target.name, target.url) : "";
  // HEIC/HEIF can't be rendered by most browsers — treat as a download.
  const isImage = CHAT_IMAGE_EXTENSIONS.includes(extension) && extension !== "heic" && extension !== "heif";
  const isPdf = extension === "pdf";
  const canPreview = (isImage || isPdf) && !failed;

  return (
    <Dialog open={!!target} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="!max-w-[900px] w-[92%] h-[85vh] p-0 gap-0 overflow-hidden flex flex-col rounded-lg shadow-soft"
      >
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <FileText className="h-4 w-4 shrink-0 text-primary" />
            <DialogTitle className="truncate text-sm font-semibold">{target?.name}</DialogTitle>
            <DialogDescription className="sr-only">Attachment preview</DialogDescription>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {target && (
              <Button asChild variant="outline" size="sm">
                <a href={target.url} download={target.name} target="_blank" rel="noopener noreferrer">
                  <Download className="h-4 w-4" /> Download
                </a>
              </Button>
            )}
            <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Close preview" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="relative flex min-h-0 flex-1 items-center justify-center bg-muted/40">
          {target && canPreview && !loaded && (
            <Spinner className="absolute size-6 text-primary" />
          )}
          {target && canPreview && isImage && (
            <img
              src={target.url}
              alt={target.name}
              className="max-h-full max-w-full object-contain"
              onLoad={() => setLoaded(true)}
              onError={() => setFailed(true)}
            />
          )}
          {target && canPreview && isPdf && (
            <iframe
              src={target.url}
              title={target.name}
              className="h-full w-full border-0 bg-card"
              onLoad={() => setLoaded(true)}
            />
          )}
          {target && !canPreview && (
            <div className="p-6 text-center">
              <FileText className="mx-auto mb-3 h-10 w-10 text-primary" />
              <p className="text-sm font-medium text-foreground">Preview isn't available for this file.</p>
              <p className="mt-1 text-xs text-muted-foreground">Download it to open it on your device.</p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
