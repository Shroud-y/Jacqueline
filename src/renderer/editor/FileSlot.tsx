import { useState, type DragEvent, type ReactNode } from 'react';
import type { AssetKind } from '@shared/character';
import { formatBytes } from './media';

export interface SlotFile {
  name: string;
  url: string;
  kind: AssetKind;
  /** Null while the folder has not been read yet. */
  bytes: number | null;
}

interface FileSlotProps {
  label: string;
  hint?: string;
  file: SlotFile | null;
  /** What may be chosen or dropped here. */
  kinds: AssetKind[];
  /** `path` is set when a file was dropped; without it a file picker is shown. */
  onChoose: (path?: string) => void;
  onRemove: () => void;
  /** The file's own size in pixels, once it is known. */
  onMeasured?: (size: { width: number; height: number }) => void;
  busy?: boolean;
  /** More buttons beside Replace and Remove, for a filled slot. */
  actions?: ReactNode;
}

const KIND_LABEL: Record<AssetKind, string> = { image: 'Picture', video: 'Video', audio: 'Sound', font: 'Font' };

/** A place for one file: empty with a way to fill it, or the file with ways to change it. */
export default function FileSlot({ label, hint, file, kinds, onChoose, onRemove, onMeasured, busy = false, actions }: FileSlotProps): JSX.Element {
  const [over, setOver] = useState(false);
  const [size, setSize] = useState<{ url: string; width: number; height: number } | null>(null);

  const measured = (width: number, height: number): void => {
    if (!file || width <= 0 || height <= 0) return;
    setSize({ url: file.url, width, height });
    onMeasured?.({ width, height });
  };

  const onDragOver = (event: DragEvent): void => {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setOver(true);
  };

  const onDrop = (event: DragEvent): void => {
    event.preventDefault();
    setOver(false);
    const dropped = event.dataTransfer.files[0];
    const path = dropped ? window.jacquelineEditor?.pathForFile(dropped) : '';
    if (path) onChoose(path);
  };

  const drop = { onDragOver, onDragLeave: () => setOver(false), onDrop };
  const dims = size && file && size.url === file.url ? `${size.width} × ${size.height}` : null;
  const meta = file ? [KIND_LABEL[file.kind], dims, file.bytes !== null ? formatBytes(file.bytes) : null].filter(Boolean).join(' · ') : '';

  return (
    <div className="slot-field">
      <div className="field-label">{label}</div>
      {file ? (
        <>
          <div className="slot" data-over={over} {...drop}>
            {/* A sound has nothing to show. */}
            {file.kind === 'image' ? (
              <span className="slot-thumb" aria-hidden="true">
                <img src={file.url} alt="" draggable={false} onLoad={(event) => measured(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight)} />
              </span>
            ) : file.kind === 'video' ? (
              <span className="slot-thumb" aria-hidden="true">
                <video
                  src={file.url}
                  muted
                  preload="metadata"
                  disablePictureInPicture
                  onLoadedMetadata={(event) => measured(event.currentTarget.videoWidth, event.currentTarget.videoHeight)}
                />
              </span>
            ) : null}
            <span className="slot-meta">
              <span className="slot-name">{file.name}</span>
              <span className="slot-detail">{meta}</span>
            </span>
          </div>
          <div className="slot-actions">
            {actions}
            <button type="button" className="button quiet" disabled={busy} onClick={() => onChoose()}>
              Replace
            </button>
            <button type="button" className="button quiet" disabled={busy} onClick={onRemove}>
              Remove
            </button>
          </div>
        </>
      ) : (
        <button type="button" className="slot slot-empty" data-over={over} disabled={busy} onClick={() => onChoose()} {...drop}>
          {busy ? 'Copying…' : 'Choose a file or drop it here'}
        </button>
      )}
      {hint ? <div className="field-hint">{hint}</div> : null}
      <span className="visually-hidden">Accepts: {kinds.map((kind) => KIND_LABEL[kind].toLowerCase()).join(', ')}</span>
    </div>
  );
}
