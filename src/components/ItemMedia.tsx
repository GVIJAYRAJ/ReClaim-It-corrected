import { useEffect, useState } from 'react';
import {
  CameraOff,
  ChevronLeft,
  ChevronRight,
  Maximize2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { ItemImage } from '../types';

interface ItemImageFrameProps {
  src?: string;
  alt: string;
  category?: string;
  className?: string;
  onClick?: () => void;
}

export function ItemImageFrame({
  src,
  alt,
  category,
  className = '',
  onClick,
}: ItemImageFrameProps) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return (
      <div
        onClick={onClick}
        className={`flex flex-col items-center justify-center bg-slate-100 text-slate-500 border border-slate-200 select-none ${
          onClick ? 'cursor-pointer hover:bg-slate-200/70 transition-colors' : ''
        } ${className}`}
      >
        <CameraOff className="w-7 h-7 text-slate-400 mb-2" strokeWidth={1.6} />
        <span className="text-xs font-medium text-slate-600 px-3 text-center">
          No photograph uploaded
        </span>
        {category ? (
          <span className="text-[11px] text-slate-400 mt-0.5">{category}</span>
        ) : null}
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      onClick={onClick}
      className={className}
    />
  );
}

interface ImageLightboxProps {
  images: ItemImage[];
  initialIndex: number;
  title: string;
  onClose: () => void;
}

export function ImageLightbox({
  images,
  initialIndex,
  title,
  onClose,
}: ImageLightboxProps) {
  const [index, setIndex] = useState(initialIndex);
  const [zoomed, setZoomed] = useState(false);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight' && images.length > 1) {
        setIndex((i) => (i + 1) % images.length);
        setZoomed(false);
      }
      if (e.key === 'ArrowLeft' && images.length > 1) {
        setIndex((i) => (i - 1 + images.length) % images.length);
        setZoomed(false);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [images.length, onClose]);

  const active = images[index];
  if (!active) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/90 flex flex-col justify-between p-4 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={`Image gallery for ${title}`}
    >
      <div className="flex items-center justify-between text-white">
        <div className="min-w-0">
          <p className="text-sm font-medium truncate">{title}</p>
          <p className="text-xs text-slate-400 tabular-nums">
            Photo {index + 1} of {images.length}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setZoomed((z) => !z)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-xs font-medium text-white transition-colors"
          >
            {zoomed ? <ZoomOut className="w-4 h-4" /> : <ZoomIn className="w-4 h-4" />}
            <span>{zoomed ? 'Reset Zoom' : 'Zoom 2x'}</span>
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close lightbox"
            className="p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      <div className="relative flex-1 flex items-center justify-center overflow-auto my-4">
        {images.length > 1 && (
          <button
            type="button"
            onClick={() => {
              setIndex((i) => (i - 1 + images.length) % images.length);
              setZoomed(false);
            }}
            aria-label="Previous image"
            className="absolute left-2 sm:left-4 z-10 p-2.5 rounded-full bg-slate-900/75 hover:bg-slate-900 text-white border border-white/15 transition-colors"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
        )}

        <img
          src={active.url}
          alt={`${title} photograph ${index + 1}`}
          referrerPolicy="no-referrer"
          onClick={() => setZoomed((z) => !z)}
          className={`max-h-[75vh] max-w-full rounded-lg object-contain transition-transform duration-200 cursor-zoom-in ${
            zoomed ? 'scale-150 cursor-zoom-out' : 'scale-100'
          }`}
        />

        {images.length > 1 && (
          <button
            type="button"
            onClick={() => {
              setIndex((i) => (i + 1) % images.length);
              setZoomed(false);
            }}
            aria-label="Next image"
            className="absolute right-2 sm:right-4 z-10 p-2.5 rounded-full bg-slate-900/75 hover:bg-slate-900 text-white border border-white/15 transition-colors"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        )}
      </div>

      {images.length > 1 && (
        <div className="flex items-center justify-center gap-2 overflow-x-auto pb-1">
          {images.map((img, i) => (
            <button
              key={img.id}
              type="button"
              onClick={() => {
                setIndex(i);
                setZoomed(false);
              }}
              className={`w-16 h-12 rounded-md overflow-hidden border-2 transition-all shrink-0 ${
                i === index ? 'border-blue-500 opacity-100' : 'border-transparent opacity-55 hover:opacity-85'
              }`}
            >
              <img
                src={img.url}
                alt={`Thumbnail ${i + 1}`}
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover"
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function LightboxTriggerIcon() {
  return <Maximize2 className="w-4 h-4" />;
}
