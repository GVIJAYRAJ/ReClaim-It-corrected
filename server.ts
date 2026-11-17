import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { createServer as createViteServer } from 'vite';
import { db, hashPassword, initDatabase, uploadsDir, verifyPassword } from './server/db.ts';
import {
  analyzeItemImage,
  evaluateMatchWithGemini,
  runAssistantChat,
  type ChatTurn,
} from './server/gemini.ts';

initDatabase();

interface AuthUser {
  id: number;
  email: string;
  name: string;
  role: 'student' | 'admin';
  student_id: string;
  phone: string;
  auth_provider: 'local' | 'google';
  otp_verified: number;
  avatar_url: string;
  created_at: string;
}

interface AuthedRequest extends Request {
  authUser?: AuthUser;
}

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
]);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    const safeExt = ['.jpg', '.jpeg', '.png', '.webp'].includes(ext) ? ext : '.jpg';
    cb(null, `${crypto.randomUUID()}${safeExt}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB max per image
    files: 5,
  },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME_TYPES.has(file.mimetype.toLowerCase())) {
      cb(null, true);
    } else {
      cb(new Error('Only JPG, JPEG, PNG, and WEBP image files are allowed.'));
    }
  },
});

function createSession(userId: number): string {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(
    token,
    userId,
    expiresAt
  );
  return token;
}

function getUserFromRequest(req: Request): AuthUser | undefined {
  const token = req.header('x-session-token');
  if (!token) return undefined;
  const row = db
    .prepare(
      `SELECT u.id, u.email, u.name, u.role, u.student_id, u.phone, u.auth_provider, u.otp_verified, u.avatar_url, u.created_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token = ? AND s.expires_at > datetime('now')`
    )
    .get(token) as AuthUser | undefined;
  return row;
}

function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
  const user = getUserFromRequest(req);
  if (!user) {
    res.status(401).json({ error: 'Authentication required. Please sign in.' });
    return;
  }
  req.authUser = user;
  next();
}

function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction): void {
  const user = getUserFromRequest(req);
  if (!user) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }
  if (user.role !== 'admin') {
    res.status(403).json({ error: 'Administrator permission required.' });
    return;
  }
  req.authUser = user;
  next();
}

function logActivity(
  actorEmail: string,
  action: string,
  targetType: string,
  targetId: number | null,
  details: string
): void {
  db.prepare(
    'INSERT INTO activity_logs (actor_email, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)'
  ).run(actorEmail, action, targetType, targetId, details);
}

interface RawItemRow {
  id: number;
  type: 'lost' | 'found';
  title: string;
  description: string;
  category: string;
  location: string;
  item_date: string;
  contact_name: string;
  contact_phone: string;
  contact_email: string;
  status: string;
  reporter_id: number;
  ai_tags: string;
  created_at: string;
  updated_at: string;
}

function enrichItem(item: RawItemRow) {
  const images = db
    .prepare(
      'SELECT id, item_id, url, is_primary, mime_type, size_bytes, created_at FROM item_images WHERE item_id = ? ORDER BY is_primary DESC, id ASC'
    )
    .all(item.id);
  const claimCountRow = db
    .prepare('SELECT COUNT(*) as count FROM claims WHERE item_id = ?')
    .get(item.id) as { count: number };
  return {
    ...item,
    images,
    claim_count: claimCountRow.count,
  };
}

function computeHeuristicScore(lost: RawItemRow, found: RawItemRow): { score: number; reason: string } {
  let score = 0;
  const reasons: string[] = [];

  if (lost.category.toLowerCase() === found.category.toLowerCase()) {
    score += 35;
    reasons.push(`same category (${lost.category})`);
  }

  const lostTokens = new Set(
    `${lost.title} ${lost.description} ${lost.ai_tags}`
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2)
  );
  const foundTokens = new Set(
    `${found.title} ${found.description} ${found.ai_tags}`
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2)
  );

  const overlap: string[] = [];
  for (const t of lostTokens) {
    if (foundTokens.has(t)) overlap.push(t);
  }
  if (overlap.length > 0) {
    const keywordPts = Math.min(40, overlap.length * 9);
    score += keywordPts;
    reasons.push(`matching descriptors (${overlap.slice(0, 4).join(', ')})`);
  }

  const lostLoc = lost.location.toLowerCase().split(/[·,\s]+/).filter((w) => w.length > 2);
  const foundLoc = found.location.toLowerCase();
  const locHits = lostLoc.filter((w) => foundLoc.includes(w));
  if (locHits.length > 0) {
    score += 15;
    reasons.push(`campus proximity (${locHits.slice(0, 2).join(' ')})`);
  }

  const d1 = new Date(lost.item_date).getTime();
  const d2 = new Date(found.item_date).getTime();
  if (!Number.isNaN(d1) && !Number.isNaN(d2)) {
    const dayDiff = Math.abs(d1 - d2) / (1000 * 60 * 60 * 24);
    if (dayDiff <= 3) {
      score += 10;
      reasons.push('within 3-day reporting window');
    } else if (dayDiff <= 7) {
      score += 5;
    }
  }

  const bounded = Math.min(98, score);
  const reason =
    reasons.length > 0
      ? `Potential match requiring verification: ${reasons.join(', ')}.`
      : 'Potential match requiring verification based on campus metadata.';
  return { score: bounded, reason };
}

function runHeuristicMatchesForItem(itemId: number): number {
  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(itemId) as RawItemRow | undefined;
  if (!item || item.status === 'Recovered') return 0;

  const oppositeType = item.type === 'lost' ? 'found' : 'lost';
  const candidates = db
    .prepare("SELECT * FROM items WHERE type = ? AND status != 'Recovered'")
    .all(oppositeType) as RawItemRow[];

  let createdCount = 0;
  const upsertMatch = db.prepare(`
    INSERT INTO matches (lost_item_id, found_item_id, score, reason, ai_verified, status)
    VALUES (?, ?, ?, ?, 0, 'Suggested')
    ON CONFLICT(lost_item_id, found_item_id) DO UPDATE SET
      score = MAX(matches.score, excluded.score),
      reason = excluded.reason
  `);

  for (const candidate of candidates) {
    const lost = item.type === 'lost' ? item : candidate;
    const found = item.type === 'found' ? item : candidate;
    const { score, reason } = computeHeuristicScore(lost, found);
    if (score >= 45) {
      upsertMatch.run(lost.id, found.id, score, reason);
      createdCount += 1;

      if (score >= 70) {
        db.prepare(
          `INSERT INTO notifications (user_id, user_email, title, message, type, related_item_id)
           VALUES (?, ?, ?, ?, 'match', ?)`
        ).run(
          lost.reporter_id,
          lost.contact_email,
          `Potential Match Detected (${score}%)`,
          `A ${found.type} report "${found.title}" may match "${lost.title}". Verification required before claiming.`,
          found.id
        );
      }
    }
  }
  return createdCount;
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json({ limit: '12mb' }));
  app.use('/uploads', express.static(uploadsDir));

  // Health endpoint
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'Reclaim It Campus Lost & Found' });
  });

  // ========================
  // AUTH & OTP ENDPOINTS
  // ========================
  app.post('/api/auth/register', (req, res) => {
    const { name, email, password, student_id, phone } = req.body as {
      name?: string;
      email?: string;
      password?: string;
      student_id?: string;
      phone?: string;
    };

    if (!name || !email || !password) {
      res.status(400).json({ error: 'Name, email, and password are required.' });
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(normalizedEmail);
    if (existing) {
      res.status(409).json({ error: 'An account with this email already exists. Please sign in.' });
      return;
    }

    const role = normalizedEmail === 'gvijayraj2005@gmail.com' ? 'admin' : 'student';
    const pwHash = hashPassword(password);
    const result = db
      .prepare(
        `INSERT INTO users (email, name, role, student_id, phone, password_hash, auth_provider, otp_verified)
         VALUES (?, ?, ?, ?, ?, ?, 'local', 0)`
      )
      .run(
        normalizedEmail,
        name.trim(),
        role,
        (student_id || '').trim(),
        (phone || '7397631012').trim(),
        pwHash
      );

    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    db.prepare('INSERT INTO otp_codes (email, code, expires_at) VALUES (?, ?, ?)').run(
      normalizedEmail,
      code,
      expiresAt
    );

    logActivity(normalizedEmail, 'Account Registered', 'user', Number(result.lastInsertRowid), 'OTP verification issued');

    res.status(201).json({
      message: 'Account created. Enter the 6-digit OTP verification code to activate your account.',
      email: normalizedEmail,
      otpPreview: code,
    });
  });

  app.post('/api/auth/verify-otp', (req, res) => {
    const { email, code } = req.body as { email?: string; code?: string };
    if (!email || !code) {
      res.status(400).json({ error: 'Email and 6-digit OTP code are required.' });
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();
    const otpRow = db
      .prepare(
        `SELECT * FROM otp_codes
         WHERE email = ? AND code = ? AND used = 0 AND expires_at > ?
         ORDER BY id DESC LIMIT 1`
      )
      .get(normalizedEmail, code.trim(), new Date().toISOString()) as { id: number } | undefined;

    if (!otpRow) {
      res.status(400).json({ error: 'Invalid or expired OTP code.' });
      return;
    }

    db.prepare('UPDATE otp_codes SET used = 1 WHERE id = ?').run(otpRow.id);
    db.prepare('UPDATE users SET otp_verified = 1 WHERE email = ?').run(normalizedEmail);

    const user = db
      .prepare(
        'SELECT id, email, name, role, student_id, phone, auth_provider, otp_verified, avatar_url, created_at FROM users WHERE email = ?'
      )
      .get(normalizedEmail) as AuthUser;

    const token = createSession(user.id);
    logActivity(normalizedEmail, 'OTP Verified', 'user', user.id, 'Account activated via OTP');
    res.json({ user, token });
  });

  app.post('/api/auth/resend-otp', (req, res) => {
    const { email } = req.body as { email?: string };
    if (!email) {
      res.status(400).json({ error: 'Email is required.' });
      return;
    }
    const normalizedEmail = email.trim().toLowerCase();
    const user = db.prepare('SELECT id FROM users WHERE email = ?').get(normalizedEmail);
    if (!user) {
      res.status(404).json({ error: 'Account not found.' });
      return;
    }
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    db.prepare('INSERT INTO otp_codes (email, code, expires_at) VALUES (?, ?, ?)').run(
      normalizedEmail,
      code,
      expiresAt
    );
    res.json({ message: 'Fresh OTP generated.', otpPreview: code });
  });

  app.post('/api/auth/login', (req, res) => {
    const { email, password } = req.body as { email?: string; password?: string };
    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required.' });
      return;
    }
    const normalizedEmail = email.trim().toLowerCase();
    const row = db.prepare('SELECT * FROM users WHERE email = ?').get(normalizedEmail) as
      | (AuthUser & { password_hash: string })
      | undefined;

    if (!row || !row.password_hash || !verifyPassword(password, row.password_hash)) {
      res.status(401).json({ error: 'Invalid email or password.' });
      return;
    }

    if (!row.otp_verified) {
      const code = String(Math.floor(100000 + Math.random() * 900000));
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
      db.prepare('INSERT INTO otp_codes (email, code, expires_at) VALUES (?, ?, ?)').run(
        normalizedEmail,
        code,
        expiresAt
      );
      res.status(403).json({
        error: 'Account requires OTP verification before sign-in.',
        requiresOtp: true,
        email: normalizedEmail,
        otpPreview: code,
      });
      return;
    }

    const token = createSession(row.id);
    const { password_hash: _pw, ...safeUser } = row;
    logActivity(normalizedEmail, 'User Sign In', 'user', row.id, 'Local credentials login');
    res.json({ user: safeUser, token });
  });

  app.post('/api/auth/google', (req, res) => {
    const { email, name, avatar_url } = req.body as {
      email?: string;
      name?: string;
      avatar_url?: string;
    };
    if (!email) {
      res.status(400).json({ error: 'Google account email is required.' });
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();
    let user = db
      .prepare(
        'SELECT id, email, name, role, student_id, phone, auth_provider, otp_verified, avatar_url, created_at FROM users WHERE email = ?'
      )
      .get(normalizedEmail) as AuthUser | undefined;

    if (!user) {
      const role = normalizedEmail === 'gvijayraj2005@gmail.com' ? 'admin' : 'student';
      const result = db
        .prepare(
          `INSERT INTO users (email, name, role, student_id, phone, auth_provider, otp_verified, avatar_url)
           VALUES (?, ?, ?, ?, '7397631012', 'google', 1, ?)`
        )
        .run(normalizedEmail, (name || normalizedEmail.split('@')[0]).trim(), role, '', avatar_url || '');

      user = db
        .prepare(
          'SELECT id, email, name, role, student_id, phone, auth_provider, otp_verified, avatar_url, created_at FROM users WHERE id = ?'
        )
        .get(Number(result.lastInsertRowid)) as AuthUser;
    } else {
      db.prepare('UPDATE users SET otp_verified = 1, avatar_url = COALESCE(NULLIF(?, \'\'), avatar_url) WHERE id = ?').run(
        avatar_url || '',
        user.id
      );
      user = db
        .prepare(
          'SELECT id, email, name, role, student_id, phone, auth_provider, otp_verified, avatar_url, created_at FROM users WHERE id = ?'
        )
        .get(user.id) as AuthUser;
    }

    const token = createSession(user.id);
    logActivity(normalizedEmail, 'Google OAuth Sign In', 'user', user.id, `Role: ${user.role}`);
    res.json({ user, token });
  });

  app.post('/api/auth/demo', (req, res) => {
    const { role } = req.body as { role?: 'student' | 'admin' };
    const email = role === 'admin' ? 'gvijayraj2005@gmail.com' : 'alex.rivera@campus.edu';
    const user = db
      .prepare(
        'SELECT id, email, name, role, student_id, phone, auth_provider, otp_verified, avatar_url, created_at FROM users WHERE email = ?'
      )
      .get(email) as AuthUser | undefined;
    if (!user) {
      res.status(404).json({ error: 'Demo account unavailable.' });
      return;
    }
    const token = createSession(user.id);
    res.json({ user, token });
  });

  app.get('/api/auth/me', (req, res) => {
    const user = getUserFromRequest(req);
    if (!user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }
    res.json({ user });
  });

  app.post('/api/auth/logout', (req, res) => {
    const token = req.header('x-session-token');
    if (token) {
      db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    }
    res.json({ ok: true });
  });

  // ========================
  // STATS & OVERVIEW
  // ========================
  app.get('/api/stats', (_req, res) => {
    const totals = db
      .prepare(
        `SELECT
          COUNT(*) as total_items,
          SUM(CASE WHEN type = 'lost' THEN 1 ELSE 0 END) as lost_count,
          SUM(CASE WHEN type = 'found' THEN 1 ELSE 0 END) as found_count,
          SUM(CASE WHEN status = 'Recovered' THEN 1 ELSE 0 END) as recovered_count,
          SUM(CASE WHEN status IN ('Open', 'Matched', 'Under Verification') THEN 1 ELSE 0 END) as active_count
         FROM items`
      )
      .get() as {
      total_items: number;
      lost_count: number;
      found_count: number;
      recovered_count: number;
      active_count: number;
    };

    const matchStats = db
      .prepare("SELECT COUNT(*) as active_matches FROM matches WHERE status != 'Dismissed'")
      .get() as { active_matches: number };

    const claimStats = db
      .prepare(
        `SELECT
          COUNT(*) as total_claims,
          SUM(CASE WHEN status IN ('Pending', 'Under Verification') THEN 1 ELSE 0 END) as open_claims
         FROM claims`
      )
      .get() as { total_claims: number; open_claims: number };

    const categories = db
      .prepare('SELECT category, COUNT(*) as count FROM items GROUP BY category ORDER BY count DESC')
      .all();

    res.json({
      ...totals,
      ...matchStats,
      ...claimStats,
      categories,
    });
  });

  // ========================
  // ITEMS & IMAGE GALLERY
  // ========================
  app.get('/api/items', (req: AuthedRequest, res) => {
    const { type, category, status, location, dateFrom, dateTo, q, mine } = req.query as Record<
      string,
      string | undefined
    >;

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (type && (type === 'lost' || type === 'found')) {
      conditions.push('type = ?');
      params.push(type);
    }
    if (category && category !== 'All') {
      conditions.push('category = ?');
      params.push(category);
    }
    if (status && status !== 'All') {
      conditions.push('status = ?');
      params.push(status);
    }
    if (location) {
      conditions.push('LOWER(location) LIKE ?');
      params.push(`%${location.toLowerCase()}%`);
    }
    if (dateFrom) {
      conditions.push('item_date >= ?');
      params.push(dateFrom);
    }
    if (dateTo) {
      conditions.push('item_date <= ?');
      params.push(dateTo);
    }
    if (q) {
      conditions.push(
        '(LOWER(title) LIKE ? OR LOWER(description) LIKE ? OR LOWER(location) LIKE ? OR LOWER(ai_tags) LIKE ? OR LOWER(category) LIKE ?)'
      );
      const like = `%${q.toLowerCase()}%`;
      params.push(like, like, like, like, like);
    }
    if (mine === '1') {
      const user = getUserFromRequest(req);
      if (!user) {
        res.status(401).json({ error: 'Sign in required to view your reports.' });
        return;
      }
      conditions.push('reporter_id = ?');
      params.push(user.id);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = db
      .prepare(`SELECT * FROM items ${where} ORDER BY created_at DESC, id DESC`)
      .all(...params) as RawItemRow[];

    res.json({ items: rows.map(enrichItem) });
  });

  app.get('/api/items/:id', (req, res) => {
    const itemId = Number(req.params.id);
    const item = db.prepare('SELECT * FROM items WHERE id = ?').get(itemId) as RawItemRow | undefined;
    if (!item) {
      res.status(404).json({ error: 'Item not found.' });
      return;
    }

    const matches = db
      .prepare(
        `SELECT m.*,
          li.title as lost_title, li.location as lost_location, li.item_date as lost_date,
          fi.title as found_title, fi.location as found_location, fi.item_date as found_date,
          (SELECT url FROM item_images WHERE item_id = li.id ORDER BY is_primary DESC, id ASC LIMIT 1) as lost_image,
          (SELECT url FROM item_images WHERE item_id = fi.id ORDER BY is_primary DESC, id ASC LIMIT 1) as found_image
         FROM matches m
         JOIN items li ON li.id = m.lost_item_id
         JOIN items fi ON fi.id = m.found_item_id
         WHERE (m.lost_item_id = ? OR m.found_item_id = ?) AND m.status != 'Dismissed'
         ORDER BY m.score DESC`
      )
      .all(itemId, itemId);

    const claims = db
      .prepare('SELECT * FROM claims WHERE item_id = ? ORDER BY created_at DESC')
      .all(itemId);

    res.json({
      item: enrichItem(item),
      matches,
      claims,
    });
  });

  app.post('/api/items', requireAuth, upload.array('images', 5), (req: AuthedRequest, res) => {
    const user = req.authUser!;
    const {
      type,
      title,
      description,
      category,
      location,
      item_date,
      contact_name,
      contact_phone,
      contact_email,
      ai_tags,
    } = req.body as Record<string, string | undefined>;

    if (!type || (type !== 'lost' && type !== 'found')) {
      res.status(400).json({ error: 'Report type must be lost or found.' });
      return;
    }
    if (!title || !description || !category || !location || !item_date) {
      res.status(400).json({ error: 'Title, description, category, location, and date are required.' });
      return;
    }

    const result = db
      .prepare(
        `INSERT INTO items (type, title, description, category, location, item_date, contact_name, contact_phone, contact_email, status, reporter_id, ai_tags)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Open', ?, ?)`
      )
      .run(
        type,
        title.trim(),
        description.trim(),
        category.trim(),
        location.trim(),
        item_date.trim(),
        (contact_name || user.name).trim(),
        (contact_phone || user.phone || '7397631012').trim(),
        (contact_email || user.email).trim(),
        user.id,
        (ai_tags || '').trim()
      );

    const newItemId = Number(result.lastInsertRowid);
    const files = (req.files as Express.Multer.File[]) || [];

    const insertImage = db.prepare(
      'INSERT INTO item_images (item_id, url, is_primary, mime_type, size_bytes) VALUES (?, ?, ?, ?, ?)'
    );
    files.forEach((f, idx) => {
      insertImage.run(newItemId, `/uploads/${f.filename}`, idx === 0 ? 1 : 0, f.mimetype, f.size);
    });

    const matchesCreated = runHeuristicMatchesForItem(newItemId);
    if (matchesCreated > 0) {
      db.prepare("UPDATE items SET status = 'Matched' WHERE id = ?").run(newItemId);
    }

    logActivity(
      user.email,
      `Reported ${type} item`,
      'item',
      newItemId,
      `${title.trim()} (${files.length} image(s), ${matchesCreated} potential match(es))`
    );

    const created = db.prepare('SELECT * FROM items WHERE id = ?').get(newItemId) as RawItemRow;
    res.status(201).json({
      item: enrichItem(created),
      matchesCreated,
    });
  });

  app.patch('/api/items/:id', requireAuth, (req: AuthedRequest, res) => {
    const user = req.authUser!;
    const itemId = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM items WHERE id = ?').get(itemId) as RawItemRow | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Item not found.' });
      return;
    }
    if (existing.reporter_id !== user.id && user.role !== 'admin') {
      res.status(403).json({ error: 'You are not authorized to modify this report.' });
      return;
    }

    const { title, description, category, location, item_date, status, contact_phone } = req.body as Record<
      string,
      string | undefined
    >;

    db.prepare(
      `UPDATE items
       SET title = ?, description = ?, category = ?, location = ?, item_date = ?, status = ?, contact_phone = ?, updated_at = datetime('now')
       WHERE id = ?`
    ).run(
      title?.trim() || existing.title,
      description?.trim() || existing.description,
      category?.trim() || existing.category,
      location?.trim() || existing.location,
      item_date?.trim() || existing.item_date,
      status?.trim() || existing.status,
      contact_phone?.trim() || existing.contact_phone,
      itemId
    );

    logActivity(user.email, 'Updated item report', 'item', itemId, `Status: ${status || existing.status}`);
    const updated = db.prepare('SELECT * FROM items WHERE id = ?').get(itemId) as RawItemRow;
    res.json({ item: enrichItem(updated) });
  });

  app.delete('/api/items/:id', requireAuth, (req: AuthedRequest, res) => {
    const user = req.authUser!;
    const itemId = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM items WHERE id = ?').get(itemId) as RawItemRow | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Item not found.' });
      return;
    }
    if (existing.reporter_id !== user.id && user.role !== 'admin') {
      res.status(403).json({ error: 'You are not authorized to delete this report.' });
      return;
    }

    db.prepare('DELETE FROM items WHERE id = ?').run(itemId);
    logActivity(user.email, 'Deleted item report', 'item', itemId, existing.title);
    res.json({ ok: true });
  });

  app.post('/api/items/:id/images', requireAuth, upload.array('images', 5), (req: AuthedRequest, res) => {
    const user = req.authUser!;
    const itemId = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM items WHERE id = ?').get(itemId) as RawItemRow | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Item not found.' });
      return;
    }
    if (existing.reporter_id !== user.id && user.role !== 'admin') {
      res.status(403).json({ error: 'You are not authorized to upload images to this report.' });
      return;
    }

    const files = (req.files as Express.Multer.File[]) || [];
    if (files.length === 0) {
      res.status(400).json({ error: 'Please select at least one valid image (JPG, JPEG, PNG, WEBP).' });
      return;
    }

    const currentCount = (
      db.prepare('SELECT COUNT(*) as count FROM item_images WHERE item_id = ?').get(itemId) as {
        count: number;
      }
    ).count;

    const insertImage = db.prepare(
      'INSERT INTO item_images (item_id, url, is_primary, mime_type, size_bytes) VALUES (?, ?, ?, ?, ?)'
    );
    files.forEach((f, idx) => {
      insertImage.run(
        itemId,
        `/uploads/${f.filename}`,
        currentCount === 0 && idx === 0 ? 1 : 0,
        f.mimetype,
        f.size
      );
    });

    logActivity(user.email, 'Added item images', 'item', itemId, `Uploaded ${files.length} photo(s)`);
    const updated = db.prepare('SELECT * FROM items WHERE id = ?').get(itemId) as RawItemRow;
    res.json({ item: enrichItem(updated) });
  });

  app.patch('/api/items/:id/images/:imageId/primary', requireAuth, (req: AuthedRequest, res) => {
    const user = req.authUser!;
    const itemId = Number(req.params.id);
    const imageId = Number(req.params.imageId);
    const existing = db.prepare('SELECT * FROM items WHERE id = ?').get(itemId) as RawItemRow | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Item not found.' });
      return;
    }
    if (existing.reporter_id !== user.id && user.role !== 'admin') {
      res.status(403).json({ error: 'Not authorized to reorder images for this item.' });
      return;
    }

    db.prepare('UPDATE item_images SET is_primary = 0 WHERE item_id = ?').run(itemId);
    db.prepare('UPDATE item_images SET is_primary = 1 WHERE id = ? AND item_id = ?').run(imageId, itemId);
    const updated = db.prepare('SELECT * FROM items WHERE id = ?').get(itemId) as RawItemRow;
    res.json({ item: enrichItem(updated) });
  });

  app.delete('/api/items/:id/images/:imageId', requireAuth, (req: AuthedRequest, res) => {
    const user = req.authUser!;
    const itemId = Number(req.params.id);
    const imageId = Number(req.params.imageId);
    const existing = db.prepare('SELECT * FROM items WHERE id = ?').get(itemId) as RawItemRow | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Item not found.' });
      return;
    }
    if (existing.reporter_id !== user.id && user.role !== 'admin') {
      res.status(403).json({ error: 'You are not authorized to delete images from this report.' });
      return;
    }

    const imgRow = db
      .prepare('SELECT * FROM item_images WHERE id = ? AND item_id = ?')
      .get(imageId, itemId) as { id: number; url: string } | undefined;

    if (!imgRow) {
      res.status(404).json({ error: 'Image not found.' });
      return;
    }

    db.prepare('DELETE FROM item_images WHERE id = ?').run(imageId);
    if (imgRow.url.startsWith('/uploads/')) {
      const filePath = path.resolve(process.cwd(), imgRow.url.slice(1));
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }

    // Ensure another image becomes primary if available
    const remaining = db
      .prepare('SELECT id FROM item_images WHERE item_id = ? ORDER BY is_primary DESC, id ASC LIMIT 1')
      .get(itemId) as { id: number } | undefined;
    if (remaining) {
      db.prepare('UPDATE item_images SET is_primary = 1 WHERE id = ?').run(remaining.id);
    }

    logActivity(user.email, 'Deleted item image', 'item', itemId, `Image #${imageId}`);
    const updated = db.prepare('SELECT * FROM items WHERE id = ?').get(itemId) as RawItemRow;
    res.json({ item: enrichItem(updated) });
  });

  // ========================
  // INTELLIGENT MATCHING
  // ========================
  app.get('/api/matches', (_req, res) => {
    const matches = db
      .prepare(
        `SELECT m.*,
          li.title as lost_title, li.description as lost_description, li.category as lost_category,
          li.location as lost_location, li.item_date as lost_date, li.contact_email as lost_email, li.status as lost_status,
          fi.title as found_title, fi.description as found_description, fi.category as found_category,
          fi.location as found_location, fi.item_date as found_date, fi.contact_email as found_email, fi.status as found_status,
          (SELECT url FROM item_images WHERE item_id = li.id ORDER BY is_primary DESC, id ASC LIMIT 1) as lost_image,
          (SELECT url FROM item_images WHERE item_id = fi.id ORDER BY is_primary DESC, id ASC LIMIT 1) as found_image
         FROM matches m
         JOIN items li ON li.id = m.lost_item_id
         JOIN items fi ON fi.id = m.found_item_id
         ORDER BY m.score DESC, m.created_at DESC`
      )
      .all();

    res.json({ matches });
  });

  app.post('/api/matches/run', async (req: AuthedRequest, res) => {
    const useAi = Boolean(req.body?.useAi);
    const lostItems = db
      .prepare("SELECT * FROM items WHERE type = 'lost' AND status != 'Recovered'")
      .all() as RawItemRow[];
    const foundItems = db
      .prepare("SELECT * FROM items WHERE type = 'found' AND status != 'Recovered'")
      .all() as RawItemRow[];

    const upsertMatch = db.prepare(`
      INSERT INTO matches (lost_item_id, found_item_id, score, reason, ai_verified, status)
      VALUES (?, ?, ?, ?, ?, 'Suggested')
      ON CONFLICT(lost_item_id, found_item_id) DO UPDATE SET
        score = excluded.score,
        reason = excluded.reason,
        ai_verified = MAX(matches.ai_verified, excluded.ai_verified)
    `);

    let evaluated = 0;
    let aiEnhanced = 0;
    let aiErrorMessage = '';

    for (const lost of lostItems) {
      const lostImg = db
        .prepare('SELECT url FROM item_images WHERE item_id = ? ORDER BY is_primary DESC, id ASC LIMIT 1')
        .get(lost.id) as { url: string } | undefined;

      for (const found of foundItems) {
        const heuristic = computeHeuristicScore(lost, found);
        if (heuristic.score < 35) continue;

        let finalScore = heuristic.score;
        let finalReason = heuristic.reason;
        let aiVerified = 0;

        if (useAi) {
          const foundImg = db
            .prepare('SELECT url FROM item_images WHERE item_id = ? ORDER BY is_primary DESC, id ASC LIMIT 1')
            .get(found.id) as { url: string } | undefined;
          try {
            const aiEval = await evaluateMatchWithGemini(
              { ...lost, primary_image_url: lostImg?.url },
              { ...found, primary_image_url: foundImg?.url }
            );
            if (aiEval) {
              finalScore = aiEval.score;
              finalReason = aiEval.reason;
              aiVerified = 1;
              aiEnhanced += 1;
            }
          } catch (err) {
            aiErrorMessage = err instanceof Error ? err.message : 'Gemini match check failed.';
          }
        }

        if (finalScore >= 45) {
          upsertMatch.run(lost.id, found.id, finalScore, finalReason, aiVerified);
          evaluated += 1;
        }
      }
    }

    res.json({
      evaluated,
      aiEnhanced,
      aiWarning: aiErrorMessage || undefined,
    });
  });

  app.patch('/api/matches/:id', requireAuth, (req: AuthedRequest, res) => {
    const user = req.authUser!;
    const matchId = Number(req.params.id);
    const { status } = req.body as { status?: 'Suggested' | 'Confirmed' | 'Dismissed' };
    if (!status || !['Suggested', 'Confirmed', 'Dismissed'].includes(status)) {
      res.status(400).json({ error: 'Invalid match status.' });
      return;
    }

    const match = db.prepare('SELECT * FROM matches WHERE id = ?').get(matchId) as
      | { id: number; lost_item_id: number; found_item_id: number }
      | undefined;
    if (!match) {
      res.status(404).json({ error: 'Match record not found.' });
      return;
    }

    db.prepare('UPDATE matches SET status = ? WHERE id = ?').run(status, matchId);
    if (status === 'Confirmed') {
      db.prepare("UPDATE items SET status = 'Under Verification' WHERE id IN (?, ?)").run(
        match.lost_item_id,
        match.found_item_id
      );
    }

    logActivity(user.email, `Match ${status}`, 'match', matchId, `Lost #${match.lost_item_id} <-> Found #${match.found_item_id}`);
    res.json({ ok: true });
  });

  // ========================
  // CLAIMS MANAGEMENT
  // ========================
  app.get('/api/claims', requireAuth, (req: AuthedRequest, res) => {
    const user = req.authUser!;
    const baseQuery = `
      SELECT c.*, i.title as item_title, i.type as item_type, i.category as item_category, i.location as item_location,
             i.status as item_status,
             (SELECT url FROM item_images WHERE item_id = i.id ORDER BY is_primary DESC, id ASC LIMIT 1) as item_image
      FROM claims c
      JOIN items i ON i.id = c.item_id
    `;

    const claims =
      user.role === 'admin'
        ? db.prepare(`${baseQuery} ORDER BY c.created_at DESC`).all()
        : db
            .prepare(`${baseQuery} WHERE c.claimant_id = ? OR i.reporter_id = ? ORDER BY c.created_at DESC`)
            .all(user.id, user.id);

    res.json({ claims });
  });

  app.post('/api/claims', requireAuth, (req: AuthedRequest, res) => {
    const user = req.authUser!;
    const { item_id, claimant_phone, proof_description, identifying_details } = req.body as {
      item_id?: number;
      claimant_phone?: string;
      proof_description?: string;
      identifying_details?: string;
    };

    if (!item_id || !proof_description) {
      res.status(400).json({ error: 'Item ID and proof of ownership description are required.' });
      return;
    }

    const item = db.prepare('SELECT * FROM items WHERE id = ?').get(Number(item_id)) as RawItemRow | undefined;
    if (!item) {
      res.status(404).json({ error: 'Item not found.' });
      return;
    }

    const result = db
      .prepare(
        `INSERT INTO claims (item_id, claimant_id, claimant_name, claimant_email, claimant_phone, proof_description, identifying_details, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'Pending')`
      )
      .run(
        item.id,
        user.id,
        user.name,
        user.email,
        (claimant_phone || user.phone || '7397631012').trim(),
        proof_description.trim(),
        (identifying_details || '').trim()
      );

    const claimId = Number(result.lastInsertRowid);
    db.prepare(
      `INSERT INTO notifications (user_id, user_email, title, message, type, related_item_id)
       VALUES (?, ?, ?, ?, 'claim', ?)`
    ).run(
      item.reporter_id,
      item.contact_email,
      'New Ownership Claim Submitted',
      `${user.name} submitted an ownership claim for "${item.title}".`,
      item.id
    );

    logActivity(user.email, 'Submitted Claim', 'claim', claimId, `Item #${item.id}: ${item.title}`);
    const created = db.prepare('SELECT * FROM claims WHERE id = ?').get(claimId);
    res.status(201).json({ claim: created });
  });

  app.patch('/api/claims/:id', requireAdmin, (req: AuthedRequest, res) => {
    const admin = req.authUser!;
    const claimId = Number(req.params.id);
    const { status, admin_notes } = req.body as {
      status?: 'Pending' | 'Under Verification' | 'Approved' | 'Rejected' | 'Recovered';
      admin_notes?: string;
    };

    const allowed = ['Pending', 'Under Verification', 'Approved', 'Rejected', 'Recovered'];
    if (!status || !allowed.includes(status)) {
      res.status(400).json({ error: 'Invalid claim status.' });
      return;
    }

    const claim = db.prepare('SELECT * FROM claims WHERE id = ?').get(claimId) as
      | { id: number; item_id: number; claimant_id: number; claimant_email: string; claimant_name: string }
      | undefined;

    if (!claim) {
      res.status(404).json({ error: 'Claim not found.' });
      return;
    }

    db.prepare(
      "UPDATE claims SET status = ?, admin_notes = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(status, (admin_notes || '').trim(), claimId);

    const item = db.prepare('SELECT * FROM items WHERE id = ?').get(claim.item_id) as RawItemRow;
    if (status === 'Under Verification' || status === 'Approved') {
      db.prepare("UPDATE items SET status = 'Under Verification', updated_at = datetime('now') WHERE id = ?").run(
        claim.item_id
      );
    } else if (status === 'Recovered') {
      db.prepare("UPDATE items SET status = 'Recovered', updated_at = datetime('now') WHERE id = ?").run(
        claim.item_id
      );
    }

    const notifType = status === 'Recovered' ? 'recovery' : 'claim';
    db.prepare(
      `INSERT INTO notifications (user_id, user_email, title, message, type, related_item_id)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      claim.claimant_id,
      claim.claimant_email,
      `Claim ${status}`,
      `Your ownership claim for "${item.title}" is now marked ${status}.${admin_notes ? ` Note: ${admin_notes}` : ''}`,
      notifType,
      item.id
    );

    logActivity(admin.email, `Updated Claim to ${status}`, 'claim', claimId, item.title);
    const updated = db.prepare('SELECT * FROM claims WHERE id = ?').get(claimId);
    res.json({ claim: updated });
  });

  // ========================
  // NOTIFICATIONS & ADMIN
  // ========================
  app.get('/api/notifications', requireAuth, (req: AuthedRequest, res) => {
    const user = req.authUser!;
    const rows =
      user.role === 'admin'
        ? db
            .prepare(
              'SELECT * FROM notifications WHERE user_id = ? OR user_email = ? ORDER BY created_at DESC LIMIT 30'
            )
            .all(user.id, user.email)
        : db
            .prepare('SELECT * FROM notifications WHERE user_id = ? OR user_email = ? ORDER BY created_at DESC LIMIT 30')
            .all(user.id, user.email);

    res.json({ notifications: rows });
  });

  app.patch('/api/notifications/read', requireAuth, (req: AuthedRequest, res) => {
    const user = req.authUser!;
    db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ? OR user_email = ?').run(
      user.id,
      user.email
    );
    res.json({ ok: true });
  });

  app.get('/api/admin/overview', requireAdmin, (_req, res) => {
    const users = db
      .prepare(
        'SELECT id, email, name, role, student_id, phone, auth_provider, otp_verified, created_at FROM users ORDER BY created_at DESC'
      )
      .all();
    const logs = db.prepare('SELECT * FROM activity_logs ORDER BY created_at DESC LIMIT 40').all();
    const images = db
      .prepare(
        `SELECT img.*, i.title as item_title, i.type as item_type
         FROM item_images img
         JOIN items i ON i.id = img.item_id
         ORDER BY img.created_at DESC`
      )
      .all();
    res.json({ users, logs, images });
  });

  app.patch('/api/admin/users/:id/role', requireAdmin, (req: AuthedRequest, res) => {
    const admin = req.authUser!;
    const targetId = Number(req.params.id);
    const { role } = req.body as { role?: 'student' | 'admin' };
    if (!role || (role !== 'student' && role !== 'admin')) {
      res.status(400).json({ error: 'Invalid role.' });
      return;
    }
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, targetId);
    logActivity(admin.email, 'Changed User Role', 'user', targetId, `Role updated to ${role}`);
    res.json({ ok: true });
  });

  // ========================
  // GEMINI AI INTELLIGENCE
  // ========================
  app.post('/api/ai/analyze-image', requireAuth, async (req, res) => {
    try {
      const { imageBase64, mimeType } = req.body as { imageBase64?: string; mimeType?: string };
      if (!imageBase64 || !mimeType) {
        res.status(400).json({ error: 'Image payload and MIME type are required.' });
        return;
      }
      const analysis = await analyzeItemImage(imageBase64, mimeType);
      res.json({ analysis });
    } catch (error) {
      console.error('Gemini analyze-image error:', error);
      const message = error instanceof Error ? error.message : 'Failed to analyze item image.';
      res.status(500).json({ error: message });
    }
  });

  app.post('/api/ai/chat', async (req, res) => {
    try {
      const { history, message } = req.body as { history?: ChatTurn[]; message?: string };
      if (!message || !message.trim()) {
        res.status(400).json({ error: 'Message is required.' });
        return;
      }

      const items = db
        .prepare(
          'SELECT id, type, title, category, location, item_date, status FROM items ORDER BY created_at DESC LIMIT 25'
        )
        .all() as Array<{
        id: number;
        type: string;
        title: string;
        category: string;
        location: string;
        item_date: string;
        status: string;
      }>;

      const summary = items
        .map(
          (it) =>
            `[#${it.id}] ${it.type.toUpperCase()} | ${it.title} | ${it.category} | ${it.location} | ${it.item_date} | Status: ${it.status}`
        )
        .join('\n');

      const reply = await runAssistantChat(Array.isArray(history) ? history : [], message.trim(), summary);
      res.json({ reply });
    } catch (error) {
      console.error('Gemini chat error:', error);
      const message = error instanceof Error ? error.message : 'Assistant failed to respond.';
      res.status(500).json({ error: message });
    }
  });

  // ========================
  // GOOGLE WORKSPACE PROXIES
  // ========================
  app.post('/api/workspace/gmail/send', requireAuth, async (req: AuthedRequest, res) => {
    const authHeader = req.header('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Google Workspace access token missing. Sign in with Google to send Gmail alerts.' });
      return;
    }

    const { to, subject, body } = req.body as { to?: string; subject?: string; body?: string };
    if (!to || !subject || !body) {
      res.status(400).json({ error: 'Recipient email, subject, and message body are required.' });
      return;
    }

    const rfc2822 = [
      `To: ${to}`,
      `Subject: ${subject}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      '',
      body,
    ].join('\r\n');

    const raw = Buffer.from(rfc2822).toString('base64url');
    const gmailRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: {
        Authorization: authHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ raw }),
    });

    const data = await gmailRes.json();
    if (!gmailRes.ok) {
      res.status(gmailRes.status).json({
        error: data?.error?.message || 'Gmail API failed to send email.',
      });
      return;
    }

    logActivity(req.authUser!.email, 'Sent Gmail Alert', 'gmail', null, `To: ${to} | Subject: ${subject}`);
    res.json({ ok: true, id: data.id });
  });

  app.get('/api/workspace/gmail/messages', requireAuth, async (req, res) => {
    const authHeader = req.header('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Google Workspace access token missing. Sign in with Google to view Gmail messages.' });
      return;
    }

    const listRes = await fetch(
      'https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=8',
      {
        headers: { Authorization: authHeader },
      }
    );
    const listData = await listRes.json();
    if (!listRes.ok) {
      res.status(listRes.status).json({
        error: listData?.error?.message || 'Failed to read Gmail inbox.',
      });
      return;
    }

    const messageRefs = (listData.messages || []) as Array<{ id: string }>;
    const detailed = await Promise.all(
      messageRefs.slice(0, 8).map(async (m) => {
        const msgRes = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
          { headers: { Authorization: authHeader } }
        );
        const msg = await msgRes.json();
        const headers = (msg.payload?.headers || []) as Array<{ name: string; value: string }>;
        const findHeader = (name: string) =>
          headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || '';
        return {
          id: msg.id,
          snippet: msg.snippet || '',
          subject: findHeader('Subject') || '(No Subject)',
          from: findHeader('From') || 'Unknown Sender',
          date: findHeader('Date') || '',
        };
      })
    );

    res.json({ messages: detailed });
  });

  app.post('/api/workspace/sheets/export', requireAuth, async (req: AuthedRequest, res) => {
    const authHeader = req.header('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Google Workspace access token missing. Sign in with Google to export to Sheets.' });
      return;
    }

    const { spreadsheetId: existingId } = req.body as { spreadsheetId?: string };
    let targetId = existingId?.trim() || '';
    let spreadsheetUrl = '';
    let itemsTab = 'Lost & Found Items';
    let claimsTab = 'Ownership Claims';

    if (!targetId) {
      const createRes = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
        method: 'POST',
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          properties: {
            title: `Reclaim It Campus Recovery Log (${new Date().toISOString().slice(0, 10)})`,
          },
          sheets: [
            { properties: { title: itemsTab } },
            { properties: { title: claimsTab } },
          ],
        }),
      });
      const created = await createRes.json();
      if (!createRes.ok) {
        res.status(createRes.status).json({
          error: created?.error?.message || 'Failed to create Google Sheet.',
        });
        return;
      }
      targetId = created.spreadsheetId;
      spreadsheetUrl = created.spreadsheetUrl;
    } else {
      const metaRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${targetId}`, {
        headers: { Authorization: authHeader },
      });
      const meta = await metaRes.json();
      if (!metaRes.ok) {
        res.status(metaRes.status).json({
          error: meta?.error?.message || 'Unable to inspect target Google Sheet.',
        });
        return;
      }
      spreadsheetUrl = meta.spreadsheetUrl;
      const sheetTitles = (meta.sheets || []).map(
        (s: { properties?: { title?: string } }) => s.properties?.title || ''
      );
      if (!sheetTitles.includes(itemsTab) && sheetTitles[0]) {
        itemsTab = sheetTitles[0];
      }
      if (!sheetTitles.includes(claimsTab)) {
        claimsTab = sheetTitles[1] || sheetTitles[0] || itemsTab;
      }
    }

    const allItems = db.prepare('SELECT * FROM items ORDER BY id ASC').all() as RawItemRow[];
    const allClaims = db
      .prepare(
        `SELECT c.*, i.title as item_title
         FROM claims c JOIN items i ON i.id = c.item_id
         ORDER BY c.id ASC`
      )
      .all() as Array<{
      id: number;
      item_id: number;
      item_title: string;
      claimant_name: string;
      claimant_email: string;
      claimant_phone: string;
      status: string;
      admin_notes: string;
      created_at: string;
    }>;

    const itemValues = [
      ['ID', 'Type', 'Title', 'Category', 'Location', 'Date', 'Status', 'Reporter', 'Contact Email', 'Contact Phone'],
      ...allItems.map((it) => [
        it.id,
        it.type.toUpperCase(),
        it.title,
        it.category,
        it.location,
        it.item_date,
        it.status,
        it.contact_name,
        it.contact_email,
        it.contact_phone,
      ]),
    ];

    const claimValues = [
      ['Claim ID', 'Item ID', 'Item Title', 'Claimant', 'Email', 'Phone', 'Status', 'Admin Notes', 'Submitted At'],
      ...allClaims.map((c) => [
        c.id,
        c.item_id,
        c.item_title,
        c.claimant_name,
        c.claimant_email,
        c.claimant_phone,
        c.status,
        c.admin_notes,
        c.created_at,
      ]),
    ];

    const batchRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${targetId}/values:batchUpdate`,
      {
        method: 'POST',
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          valueInputOption: 'USER_ENTERED',
          data: [
            { range: `'${itemsTab}'!A1`, values: itemValues },
            ...(claimsTab !== itemsTab
              ? [{ range: `'${claimsTab}'!A1`, values: claimValues }]
              : []),
          ],
        }),
      }
    );

    const batchData = await batchRes.json();
    if (!batchRes.ok) {
      res.status(batchRes.status).json({
        error: batchData?.error?.message || 'Failed to write rows to Google Sheets.',
      });
      return;
    }

    logActivity(
      req.authUser!.email,
      'Synced Google Sheet',
      'sheets',
      null,
      `Exported ${allItems.length} items & ${allClaims.length} claims to ${targetId}`
    );

    res.json({
      spreadsheetId: targetId,
      spreadsheetUrl,
      exportedItems: allItems.length,
      exportedClaims: allClaims.length,
    });
  });

  app.get('/api/workspace/sheets/read', requireAuth, async (req, res) => {
    const authHeader = req.header('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Google Workspace access token missing.' });
      return;
    }

    const spreadsheetId = String(req.query.spreadsheetId || '').trim();
    if (!spreadsheetId) {
      res.status(400).json({ error: 'Spreadsheet ID is required.' });
      return;
    }

    const metaRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`, {
      headers: { Authorization: authHeader },
    });
    const meta = await metaRes.json();
    if (!metaRes.ok) {
      res.status(metaRes.status).json({
        error: meta?.error?.message || 'Unable to read Google Spreadsheet metadata.',
      });
      return;
    }

    const sheetNames = (meta.sheets || []).map(
      (s: { properties?: { title?: string } }) => s.properties?.title || 'Sheet1'
    );
    const requestedSheet = String(req.query.sheetName || '').trim();
    const activeSheet = requestedSheet && sheetNames.includes(requestedSheet) ? requestedSheet : sheetNames[0];

    const valuesRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(`'${activeSheet}'!A1:J50`)}`,
      { headers: { Authorization: authHeader } }
    );
    const valuesData = await valuesRes.json();
    if (!valuesRes.ok) {
      res.status(valuesRes.status).json({
        error: valuesData?.error?.message || 'Unable to read Google Sheet rows.',
      });
      return;
    }

    res.json({
      title: meta.properties?.title || 'Campus Spreadsheet',
      sheetNames,
      activeSheet,
      rows: valuesData.values || [],
    });
  });

  // Multer & API error handler
  app.use((err: Error, _req: Request, res: Response, next: NextFunction) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        res.status(400).json({ error: 'Image file exceeds the 5MB maximum limit.' });
        return;
      }
      res.status(400).json({ error: err.message });
      return;
    }
    if (err && err.message) {
      res.status(400).json({ error: err.message });
      return;
    }
    next();
  });

  // Vite dev middleware or static dist serving
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Reclaim It server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
