import { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Clock,
  ImagePlus,
  Mail,
  MapPin,
  Phone,
  ShieldAlert,
  Star,
  Trash2,
  X,
  ZoomIn,
} from 'lucide-react';
import { apiFetch } from '../lib/api';
import type { ClaimRecord, Item, MatchRecord, User } from '../types';
import { ImageLightbox, ItemImageFrame } from './ItemMedia';

interface ItemDetailModalProps {
  itemId: number | null;
  currentUser: User | null;
  onClose: () => void;
  onRequireAuth: () => void;
  onItemChanged: () => void;
}

export function ItemDetailModal({
  itemId,
  currentUser,
  onClose,
  onRequireAuth,
  onItemChanged,
}: ItemDetailModalProps) {
  const [item, setItem] = useState<Item | null>(null);
  const [matches, setMatches] = useState<MatchRecord[]>([]);
  const [claims, setClaims] = useState<ClaimRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [activeImgIdx, setActiveImgIdx] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);

  // Claim form state
  const [proof, setProof] = useState('');
  const [identifying, setIdentifying] = useState('');
  const [claimPhone, setClaimPhone] = useState(currentUser?.phone || '7397631012');
  const [submittingClaim, setSubmittingClaim] = useState(false);
  const [claimSuccess, setClaimSuccess] = useState('');

  // Image upload state
  const [uploadingImages, setUploadingImages] = useState(false);

  const loadDetail = async (id: number) => {
    setLoading(true);
    setError('');
    try {
      const data = await apiFetch<{
        item: Item;
        matches: MatchRecord[];
        claims: ClaimRecord[];
      }>(`/api/items/${id}`);
      setItem(data.item);
      setMatches(data.matches);
      setClaims(data.claims);
      setActiveImgIdx(0);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load item details.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (itemId !== null) {
      setClaimSuccess('');
      setProof('');
      setIdentifying('');
      loadDetail(itemId);
    } else {
      setItem(null);
    }
  }, [itemId]);

  if (itemId === null) return null;

  const canManage =
    Boolean(currentUser) &&
    Boolean(item) &&
    (currentUser!.role === 'admin' || currentUser!.id === item!.reporter_id);

  const handleUploadMore = async (files: FileList | null) => {
    if (!files || files.length === 0 || !item) return;
    setUploadingImages(true);
    setError('');
    try {
      const formData = new FormData();
      Array.from(files).forEach((f) => formData.append('images', f));
      const data = await apiFetch<{ item: Item }>(`/api/items/${item.id}/images`, {
        method: 'POST',
        body: formData,
      });
      setItem(data.item);
      onItemChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to upload image.');
    } finally {
      setUploadingImages(false);
    }
  };

  const handleSetPrimary = async (imageId: number) => {
    if (!item) return;
    try {
      const data = await apiFetch<{ item: Item }>(
        `/api/items/${item.id}/images/${imageId}/primary`,
        { method: 'PATCH' }
      );
      setItem(data.item);
      setActiveImgIdx(0);
      onItemChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to set primary image.');
    }
  };

  const handleDeleteImage = async (imageId: number) => {
    if (!item) return;
    try {
      const data = await apiFetch<{ item: Item }>(
        `/api/items/${item.id}/images/${imageId}`,
        { method: 'DELETE' }
      );
      setItem(data.item);
      setActiveImgIdx(0);
      onItemChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to delete image.');
    }
  };

  const handleSubmitClaim = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) {
      onRequireAuth();
      return;
    }
    if (!item) return;

    setSubmittingClaim(true);
    setError('');
    setClaimSuccess('');
    try {
      await apiFetch('/api/claims', {
        method: 'POST',
        body: JSON.stringify({
          item_id: item.id,
          claimant_phone: claimPhone,
          proof_description: proof,
          identifying_details: identifying,
        }),
      });
      setClaimSuccess(
        'Ownership claim submitted (Status: Pending). Track verification progress from your Dashboard.'
      );
      setProof('');
      setIdentifying('');
      await loadDetail(item.id);
      onItemChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit claim.');
    } finally {
      setSubmittingClaim(false);
    }
  };

  const activeImg = item?.images[activeImgIdx];

  return (
    <div
      className="fixed inset-0 z-40 bg-slate-950/60 overflow-y-auto p-4 sm:p-6 flex items-start justify-center"
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-white border border-slate-200 rounded-xl max-w-5xl w-full my-6 overflow-hidden shadow-2xl">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <span className="font-semibold text-slate-900">
                {item ? (item.type === 'lost' ? 'Lost Item Report' : 'Found Item Report') : 'Item Details'}
              </span>
              {item && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>{item.category}</span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono tabular-nums">ID #{item.id}</span>
                </>
              )}
            </div>
            <h2 className="text-xl font-bold text-slate-900 truncate mt-0.5">
              {item?.title || 'Loading item...'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close item details"
            className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {loading && !item ? (
          <div className="p-12 text-center text-sm text-slate-500">Loading item details...</div>
        ) : error && !item ? (
          <div className="p-8 text-center text-sm text-red-600">{error}</div>
        ) : item ? (
          <div className="p-6 grid grid-cols-1 lg:grid-cols-12 gap-8">
            {/* Left Gallery Column */}
            <div className="lg:col-span-7 space-y-4">
              <div className="relative aspect-[4/3] w-full rounded-xl overflow-hidden bg-slate-100 border border-slate-200 group">
                <ItemImageFrame
                  src={activeImg?.url}
                  alt={item.title}
                  category={item.category}
                  onClick={() => activeImg && setLightboxOpen(true)}
                  className="w-full h-full object-cover cursor-zoom-in transition-transform duration-300 group-hover:scale-[1.02]"
                />
                {activeImg && (
                  <button
                    type="button"
                    onClick={() => setLightboxOpen(true)}
                    className="absolute bottom-3 right-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900/80 hover:bg-slate-900 text-white text-xs font-medium transition-colors"
                  >
                    <ZoomIn className="w-3.5 h-3.5" />
                    <span>Inspect Photo</span>
                  </button>
                )}
              </div>

              {item.images.length > 0 && (
                <div className="flex flex-wrap items-center gap-3">
                  {item.images.map((img, idx) => (
                    <div key={img.id} className="relative group">
                      <button
                        type="button"
                        onClick={() => setActiveImgIdx(idx)}
                        className={`w-20 h-16 rounded-lg overflow-hidden border-2 transition-all block ${
                          idx === activeImgIdx
                            ? 'border-blue-800'
                            : 'border-slate-200 opacity-75 hover:opacity-100'
                        }`}
                      >
                        <img
                          src={img.url}
                          alt={`${item.title} thumbnail ${idx + 1}`}
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover"
                        />
                      </button>
                      {canManage && (
                        <div className="flex items-center justify-between gap-1 mt-1">
                          <button
                            type="button"
                            onClick={() => handleSetPrimary(img.id)}
                            title="Set as primary cover photo"
                            className={`text-[10px] inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded border ${
                              img.is_primary
                                ? 'border-blue-800 text-blue-800 bg-blue-50'
                                : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                            }`}
                          >
                            <Star className="w-2.5 h-2.5" />
                            <span>{img.is_primary ? 'Cover' : 'Set'}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteImage(img.id)}
                            title="Delete photograph"
                            className="p-0.5 text-slate-400 hover:text-red-600"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {canManage && (
                <div className="pt-2">
                  <label className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-medium text-slate-700 cursor-pointer transition-colors">
                    <ImagePlus className="w-4 h-4 text-blue-800" />
                    <span>
                      {uploadingImages ? 'Uploading photos...' : 'Add Photos (JPG, PNG, WEBP · max 5MB)'}
                    </span>
                    <input
                      type="file"
                      accept="image/jpeg,image/jpg,image/png,image/webp"
                      multiple
                      disabled={uploadingImages}
                      onChange={(e) => handleUploadMore(e.target.files)}
                      className="hidden"
                    />
                  </label>
                </div>
              )}

              {/* Potential Matches */}
              <div className="pt-4 border-t border-slate-200">
                <h3 className="text-sm font-semibold text-slate-900">
                  Intelligent Match Suggestions
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  All automated suggestions are labeled as potential matches and require physical or ID verification.
                </p>

                {matches.length === 0 ? (
                  <p className="text-xs text-slate-500 mt-3 py-3 px-4 bg-slate-50 border border-slate-200 rounded-lg">
                    No cross-report matches detected for this item yet.
                  </p>
                ) : (
                  <div className="mt-3 space-y-3">
                    {matches.map((m) => {
                      const peerTitle =
                        item.type === 'lost' ? m.found_title : m.lost_title;
                      const peerLocation =
                        item.type === 'lost' ? m.found_location : m.lost_location;
                      const peerImage =
                        item.type === 'lost' ? m.found_image : m.lost_image;
                      return (
                        <div
                          key={m.id}
                          className="p-3.5 rounded-lg border border-slate-200 bg-slate-50 flex items-start gap-3.5"
                        >
                          <div className="w-16 h-12 rounded-md overflow-hidden bg-white border border-slate-200 shrink-0">
                            <ItemImageFrame
                              src={peerImage}
                              alt={peerTitle}
                              className="w-full h-full object-cover"
                            />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs font-semibold text-amber-700 inline-flex items-center gap-1">
                                <ShieldAlert className="w-3.5 h-3.5" />
                                Potential Match — Requires Verification
                              </span>
                              <span className="text-xs font-mono font-semibold text-slate-900 tabular-nums">
                                {m.score}% match
                              </span>
                            </div>
                            <p className="text-sm font-medium text-slate-900 mt-1 truncate">
                              {peerTitle}
                            </p>
                            <p className="text-xs text-slate-600 mt-0.5">{peerLocation}</p>
                            <p className="text-xs text-slate-500 mt-1 leading-relaxed">{m.reason}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Right Metadata & Claim Column */}
            <div className="lg:col-span-5 space-y-6">
              <div>
                <div className="flex items-center gap-2 text-xs font-medium text-slate-700">
                  {item.status === 'Recovered' ? (
                    <span className="inline-flex items-center gap-1.5 text-emerald-700">
                      <CheckCircle2 className="w-4 h-4" />
                      Recovered
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-blue-800">
                      <Clock className="w-4 h-4" />
                      {item.status}
                    </span>
                  )}
                  <span aria-hidden="true" className="text-slate-300">
                    ·
                  </span>
                  <span className="font-mono tabular-nums text-slate-500">{item.item_date}</span>
                </div>

                <p className="text-sm text-slate-700 leading-relaxed mt-3">{item.description}</p>

                <dl className="mt-5 pt-4 border-t border-slate-200 space-y-2.5 text-sm">
                  <div className="flex items-start gap-2.5">
                    <MapPin className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
                    <div>
                      <dt className="text-xs text-slate-500">Campus Location</dt>
                      <dd className="font-medium text-slate-900">{item.location}</dd>
                    </div>
                  </div>
                  <div className="flex items-start gap-2.5">
                    <Mail className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
                    <div>
                      <dt className="text-xs text-slate-500">Reporter Contact</dt>
                      <dd className="font-medium text-slate-900">
                        {item.contact_name} · {item.contact_email}
                      </dd>
                    </div>
                  </div>
                  <div className="flex items-start gap-2.5">
                    <Phone className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
                    <div>
                      <dt className="text-xs text-slate-500">Campus Phone</dt>
                      <dd className="font-mono text-slate-900 tabular-nums">{item.contact_phone}</dd>
                    </div>
                  </div>
                </dl>
              </div>

              {error && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
                  {error}
                </div>
              )}
              {claimSuccess && (
                <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-800">
                  {claimSuccess}
                </div>
              )}

              {item.status !== 'Recovered' && (
                <form
                  onSubmit={handleSubmitClaim}
                  className="pt-5 border-t border-slate-200 space-y-3.5"
                >
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">
                      Submit Ownership Claim
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Provide specific ownership proof so campus staff can verify and schedule handoff.
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Proof of Ownership Description
                    </label>
                    <textarea
                      required
                      rows={3}
                      value={proof}
                      onChange={(e) => setProof(e.target.value)}
                      placeholder="Describe contents, stickers, engraving, wallpaper, or purchase proof..."
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-800/20 focus:border-blue-800"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Unique Serial / Identifying Detail
                    </label>
                    <input
                      type="text"
                      value={identifying}
                      onChange={(e) => setIdentifying(e.target.value)}
                      placeholder="e.g., Last 4 digits of serial, student ID inside pocket"
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-800/20 focus:border-blue-800"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Contact Phone Number
                    </label>
                    <input
                      type="tel"
                      required
                      value={claimPhone}
                      onChange={(e) => setClaimPhone(e.target.value)}
                      className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-800/20 focus:border-blue-800"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={submittingClaim}
                    className="w-full py-2.5 px-4 bg-blue-800 hover:bg-blue-900 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-60"
                  >
                    {currentUser
                      ? submittingClaim
                        ? 'Submitting Claim...'
                        : 'Submit Ownership Claim'
                      : 'Sign In to Submit Claim'}
                  </button>
                </form>
              )}

              {claims.length > 0 && (
                <div className="pt-4 border-t border-slate-200">
                  <h4 className="text-xs font-semibold text-slate-700 mb-2">
                    Recent Claim Activity ({claims.length})
                  </h4>
                  <div className="space-y-2">
                    {claims.map((c) => (
                      <div
                        key={c.id}
                        className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 text-xs flex items-center justify-between gap-2"
                      >
                        <span className="font-medium text-slate-800 truncate">{c.claimant_name}</span>
                        <span className="text-slate-600 shrink-0">{c.status}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : null}
      </div>

      {lightboxOpen && item && item.images.length > 0 && (
        <ImageLightbox
          images={item.images}
          initialIndex={activeImgIdx}
          title={item.title}
          onClose={() => setLightboxOpen(false)}
        />
      )}
    </div>
  );
}
