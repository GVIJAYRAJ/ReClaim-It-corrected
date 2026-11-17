import { useEffect, useState } from 'react';
import { Sparkles, Trash2, Upload } from 'lucide-react';
import { apiFetch } from '../lib/api';
import type { Item, User } from '../types';

const CATEGORIES = [
  'Electronics',
  'Bags & Carry',
  'Audio',
  'Keys & IDs',
  'Academic',
  'Accessories',
  'Clothing',
  'Other',
];

const CAMPUS_LOCATIONS = [
  'Main Science Library',
  'Student Commons',
  'Engineering Hall B',
  'Central Quad Courtyard',
  'Lecture Hall C-102',
  'North Transit Stop',
  'Athletics & Recreation Center',
];

interface PreviewFile {
  file: File;
  previewUrl: string;
}

interface ReportFormViewProps {
  currentUser: User | null;
  initialType?: 'lost' | 'found';
  onRequireAuth: () => void;
  onCreated: (item: Item, matchesCreated: number) => void;
}

export function ReportFormView({
  currentUser,
  initialType = 'lost',
  onRequireAuth,
  onCreated,
}: ReportFormViewProps) {
  const [type, setType] = useState<'lost' | 'found'>(initialType);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('Electronics');
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('Main Science Library');
  const [itemDate, setItemDate] = useState(new Date().toISOString().slice(0, 10));
  const [contactName, setContactName] = useState(currentUser?.name || '');
  const [contactPhone, setContactPhone] = useState(currentUser?.phone || '7397631012');
  const [contactEmail, setContactEmail] = useState(currentUser?.email || '');
  const [aiTags, setAiTags] = useState('');

  const [previews, setPreviews] = useState<PreviewFile[]>([]);
  const [analyzingImage, setAnalyzingImage] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setType(initialType);
  }, [initialType]);

  useEffect(() => {
    if (currentUser) {
      setContactName(currentUser.name);
      setContactEmail(currentUser.email);
      if (currentUser.phone) setContactPhone(currentUser.phone);
    }
  }, [currentUser]);

  const handleFilesSelected = (files: FileList | null) => {
    if (!files) return;
    setError('');
    const allowed = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);
    const next: PreviewFile[] = [...previews];

    for (const file of Array.from(files)) {
      if (next.length >= 5) {
        setError('Maximum 5 photographs allowed per report.');
        break;
      }
      if (!allowed.has(file.type.toLowerCase())) {
        setError('Only JPG, JPEG, PNG, and WEBP image files are accepted.');
        continue;
      }
      if (file.size > 5 * 1024 * 1024) {
        setError(`"${file.name}" exceeds the 5MB per-image limit.`);
        continue;
      }
      next.push({ file, previewUrl: URL.createObjectURL(file) });
    }
    setPreviews(next);
  };

  const removePreview = (index: number) => {
    const target = previews[index];
    if (target) URL.revokeObjectURL(target.previewUrl);
    setPreviews((prev) => prev.filter((_, idx) => idx !== index));
  };

  const handleAnalyzeFirstPhoto = async () => {
    if (!currentUser) {
      onRequireAuth();
      return;
    }
    const first = previews[0];
    if (!first) {
      setError('Upload at least one photograph first to use Gemini Auto-Fill.');
      return;
    }
    setAnalyzingImage(true);
    setError('');
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('Could not read selected image file.'));
        reader.readAsDataURL(first.file);
      });

      const data = await apiFetch<{
        analysis: { title: string; category: string; description: string; tags: string[] };
      }>('/api/ai/analyze-image', {
        method: 'POST',
        body: JSON.stringify({
          imageBase64: base64,
          mimeType: first.file.type || 'image/jpeg',
        }),
      });

      setTitle(data.analysis.title);
      if (CATEGORIES.includes(data.analysis.category)) {
        setCategory(data.analysis.category);
      }
      setDescription(data.analysis.description);
      setAiTags(data.analysis.tags.join(', '));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gemini image analysis failed.');
    } finally {
      setAnalyzingImage(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) {
      onRequireAuth();
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const formData = new FormData();
      formData.append('type', type);
      formData.append('title', title);
      formData.append('category', category);
      formData.append('description', description);
      formData.append('location', location);
      formData.append('item_date', itemDate);
      formData.append('contact_name', contactName || currentUser.name);
      formData.append('contact_phone', contactPhone || '7397631012');
      formData.append('contact_email', contactEmail || currentUser.email);
      formData.append('ai_tags', aiTags);
      previews.forEach((p) => formData.append('images', p.file));

      const data = await apiFetch<{ item: Item; matchesCreated: number }>('/api/items', {
        method: 'POST',
        body: formData,
      });

      previews.forEach((p) => URL.revokeObjectURL(p.previewUrl));
      setPreviews([]);
      setTitle('');
      setDescription('');
      setAiTags('');
      onCreated(data.item, data.matchesCreated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit report.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="max-w-4xl mx-auto px-4 sm:px-6 py-10">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">
          Report a Lost or Found Item
        </h1>
        <p className="text-slate-600 mt-2 max-w-2xl">
          Submit clear item details and up to 5 photographs (JPG, JPEG, PNG, WEBP). Our matching engine automatically checks cross-reports and notifies affected students.
        </p>
      </div>

      {!currentUser && (
        <div className="mb-6 p-4 rounded-xl bg-white border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-slate-900">Sign in required to publish reports</p>
            <p className="text-xs text-slate-600 mt-0.5">
              Sign in with Google or your campus OTP account so we can notify you on matches and claims.
            </p>
          </div>
          <button
            type="button"
            onClick={onRequireAuth}
            className="px-4 py-2 rounded-lg bg-blue-800 hover:bg-blue-900 text-white text-sm font-medium whitespace-nowrap shrink-0"
          >
            Sign In to Continue
          </button>
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        className="bg-white border border-slate-200 rounded-xl p-6 sm:p-8 space-y-6"
      >
        {/* Report Type Segmented Switcher */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-slate-200">
          <div>
            <label className="block text-sm font-semibold text-slate-900">Report Type</label>
            <p className="text-xs text-slate-500 mt-0.5">
              Select whether you misplaced this item or discovered it on campus.
            </p>
          </div>
          <div className="inline-flex p-1 bg-slate-100 rounded-lg shrink-0">
            <button
              type="button"
              onClick={() => setType('lost')}
              className={`px-4 py-2 text-sm font-medium rounded-md transition-colors whitespace-nowrap ${
                type === 'lost'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Lost Item
            </button>
            <button
              type="button"
              onClick={() => setType('found')}
              className={`px-4 py-2 text-sm font-medium rounded-md transition-colors whitespace-nowrap ${
                type === 'found'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Found Item
            </button>
          </div>
        </div>

        {/* Multi-Image Upload + Previews */}
        <div>
          <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
            <div>
              <label className="block text-sm font-semibold text-slate-900">
                Item Photographs
              </label>
              <p className="text-xs text-slate-500">
                JPG, JPEG, PNG, or WEBP up to 5MB each (first photo is primary cover).
              </p>
            </div>
            {previews.length > 0 && (
              <button
                type="button"
                onClick={handleAnalyzeFirstPhoto}
                disabled={analyzingImage}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-blue-200 bg-blue-50 hover:bg-blue-100 text-xs font-medium text-blue-800 transition-colors disabled:opacity-60 whitespace-nowrap"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>{analyzingImage ? 'Analyzing photo...' : 'Auto-Fill from Photo with Gemini'}</span>
              </button>
            )}
          </div>

          <label className="flex flex-col items-center justify-center border-2 border-dashed border-slate-300 hover:border-blue-800 rounded-xl p-6 bg-slate-50/70 cursor-pointer transition-colors">
            <Upload className="w-6 h-6 text-slate-400 mb-2" />
            <span className="text-sm font-medium text-slate-700">
              Click to select item photos from your device
            </span>
            <span className="text-xs text-slate-500 mt-1">
              Up to 5 images · JPG, JPEG, PNG, WEBP
            </span>
            <input
              type="file"
              accept="image/jpeg,image/jpg,image/png,image/webp"
              multiple
              onChange={(e) => handleFilesSelected(e.target.files)}
              className="hidden"
            />
          </label>

          {previews.length > 0 && (
            <div className="mt-4 grid grid-cols-2 sm:grid-cols-5 gap-3">
              {previews.map((p, idx) => (
                <div
                  key={p.previewUrl}
                  className="relative aspect-[4/3] rounded-lg overflow-hidden border border-slate-200 bg-slate-100"
                >
                  <img
                    src={p.previewUrl}
                    alt={`Preview ${idx + 1}`}
                    className="w-full h-full object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => removePreview(idx)}
                    aria-label={`Remove preview ${idx + 1}`}
                    className="absolute top-1.5 right-1.5 p-1 rounded-md bg-slate-900/75 hover:bg-red-600 text-white transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                  {idx === 0 && (
                    <span className="absolute bottom-1.5 left-1.5 px-1.5 py-0.5 rounded bg-slate-900/80 text-[10px] font-medium text-white">
                      Cover
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Core Metadata */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-slate-700 mb-1">Item Title</label>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., Silver 14-inch Ultrabook in Charcoal Felt Sleeve"
              className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-800/20 focus:border-blue-800"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Category</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-800/20 focus:border-blue-800"
            >
              {CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              {type === 'lost' ? 'Date Lost' : 'Date Found'}
            </label>
            <input
              type="date"
              required
              value={itemDate}
              onChange={(e) => setItemDate(e.target.value)}
              className="w-full px-3.5 py-2.5 text-sm font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-800/20 focus:border-blue-800"
            />
          </div>

          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Campus Location
            </label>
            <input
              type="text"
              required
              list="campus-locations-list"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Building, room, or outdoor landmark"
              className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-800/20 focus:border-blue-800"
            />
            <datalist id="campus-locations-list">
              {CAMPUS_LOCATIONS.map((loc) => (
                <option key={loc} value={loc} />
              ))}
            </datalist>
          </div>

          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Detailed Description
            </label>
            <textarea
              required
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Include color, brand, distinguishing marks, case or accessories, and exact time window..."
              className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-800/20 focus:border-blue-800"
            />
          </div>
        </div>

        {/* Contact Info */}
        <div className="pt-4 border-t border-slate-200 grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Contact Name</label>
            <input
              type="text"
              required
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
              placeholder="Your name"
              className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-800/20 focus:border-blue-800"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Phone Number</label>
            <input
              type="tel"
              required
              value={contactPhone}
              onChange={(e) => setContactPhone(e.target.value)}
              placeholder="7397631012"
              className="w-full px-3.5 py-2 text-sm font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-800/20 focus:border-blue-800"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Contact Email</label>
            <input
              type="email"
              required
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
              placeholder="you@campus.edu"
              className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-800/20 focus:border-blue-800"
            />
          </div>
        </div>

        {error && (
          <div className="p-3.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
            {error}
          </div>
        )}

        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            type="submit"
            disabled={submitting}
            className="px-6 py-2.5 bg-blue-800 hover:bg-blue-900 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-60 whitespace-nowrap"
          >
            {submitting
              ? 'Submitting Report...'
              : type === 'lost'
                ? 'Publish Lost Item Report'
                : 'Publish Found Item Report'}
          </button>
        </div>
      </form>
    </section>
  );
}
