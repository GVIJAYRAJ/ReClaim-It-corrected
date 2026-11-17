import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const dataDir = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

export const uploadsDir = path.resolve(process.cwd(), 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'reclaim_it.db');
export const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, keyHex] = parts;
  const derived = crypto.scryptSync(password, salt, 64);
  const keyBuf = Buffer.from(keyHex, 'hex');
  if (derived.length !== keyBuf.length) return false;
  return crypto.timingSafeEqual(derived, keyBuf);
}

export function initDatabase(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('student', 'admin')),
      student_id TEXT DEFAULT '',
      phone TEXT DEFAULT '',
      password_hash TEXT DEFAULT '',
      auth_provider TEXT NOT NULL DEFAULT 'local' CHECK (auth_provider IN ('local', 'google')),
      otp_verified INTEGER NOT NULL DEFAULT 0,
      avatar_url TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS otp_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL,
      code TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL CHECK (type IN ('lost', 'found')),
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      category TEXT NOT NULL,
      location TEXT NOT NULL,
      item_date TEXT NOT NULL,
      contact_name TEXT NOT NULL,
      contact_phone TEXT NOT NULL,
      contact_email TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Open' CHECK (status IN ('Open', 'Matched', 'Under Verification', 'Recovered')),
      reporter_id INTEGER NOT NULL,
      ai_tags TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (reporter_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS item_images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER NOT NULL,
      url TEXT NOT NULL,
      is_primary INTEGER NOT NULL DEFAULT 0,
      mime_type TEXT NOT NULL DEFAULT 'image/jpeg',
      size_bytes INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS matches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lost_item_id INTEGER NOT NULL,
      found_item_id INTEGER NOT NULL,
      score INTEGER NOT NULL,
      reason TEXT NOT NULL,
      ai_verified INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'Suggested' CHECK (status IN ('Suggested', 'Confirmed', 'Dismissed')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(lost_item_id, found_item_id),
      FOREIGN KEY (lost_item_id) REFERENCES items(id) ON DELETE CASCADE,
      FOREIGN KEY (found_item_id) REFERENCES items(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS claims (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER NOT NULL,
      claimant_id INTEGER NOT NULL,
      claimant_name TEXT NOT NULL,
      claimant_email TEXT NOT NULL,
      claimant_phone TEXT NOT NULL,
      proof_description TEXT NOT NULL,
      identifying_details TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Under Verification', 'Approved', 'Rejected', 'Recovered')),
      admin_notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE,
      FOREIGN KEY (claimant_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      user_email TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'system' CHECK (type IN ('match', 'claim', 'recovery', 'system')),
      related_item_id INTEGER,
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS activity_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_email TEXT NOT NULL,
      action TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id INTEGER,
      details TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number };
  if (userCount.count === 0) {
    seedInitialData();
  }
}

function seedInitialData(): void {
  const insertUser = db.prepare(`
    INSERT INTO users (email, name, role, student_id, phone, password_hash, auth_provider, otp_verified)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const adminId = Number(
    insertUser.run(
      'gvijayraj2005@gmail.com',
      'Vijayraj G',
      'admin',
      'ADMIN-001',
      '7397631012',
      hashPassword('Admin@2026'),
      'google',
      1
    ).lastInsertRowid
  );

  const alexId = Number(
    insertUser.run(
      'alex.rivera@campus.edu',
      'Alex Rivera',
      'student',
      'STU-2026-1042',
      '7397631012',
      hashPassword('Campus2026!'),
      'local',
      1
    ).lastInsertRowid
  );

  const mayaId = Number(
    insertUser.run(
      'maya.patel@campus.edu',
      'Maya Patel',
      'student',
      'STU-2026-1188',
      '7397631012',
      hashPassword('Campus2026!'),
      'local',
      1
    ).lastInsertRowid
  );

  const danielId = Number(
    insertUser.run(
      'daniel.kim@campus.edu',
      'Daniel Kim',
      'student',
      'STU-2026-0934',
      '7397631012',
      hashPassword('Campus2026!'),
      'local',
      1
    ).lastInsertRowid
  );

  const insertItem = db.prepare(`
    INSERT INTO items (type, title, description, category, location, item_date, contact_name, contact_phone, contact_email, status, reporter_id, ai_tags)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertImage = db.prepare(`
    INSERT INTO item_images (item_id, url, is_primary, mime_type, size_bytes)
    VALUES (?, ?, ?, 'image/jpeg', 245000)
  `);

  const laptopLostId = Number(
    insertItem.run(
      'lost',
      'Silver 14-inch Aluminum Ultrabook & Charcoal Felt Sleeve',
      'Left on the oak study table on the second floor of Main Science Library around 3:15 PM. Includes a charcoal felt sleeve and braided space-gray USB-C cable.',
      'Electronics',
      'Main Science Library · Floor 2 Quiet Zone',
      '2026-11-14',
      'Alex Rivera',
      '7397631012',
      'alex.rivera@campus.edu',
      'Matched',
      alexId,
      'laptop, silver, aluminum, felt sleeve, usb-c, library'
    ).lastInsertRowid
  );
  insertImage.run(laptopLostId, '/src/assets/images/item_laptop_sleeve_1794881025754.jpg', 1);

  const laptopFoundId = Number(
    insertItem.run(
      'found',
      'Silver Laptop in Charcoal Felt Sleeve with Braided USB-C Cable',
      'Found unattended at Desk 24B in the Main Science Library reading hall and handed to the library circulation security desk. Verified clean condition.',
      'Electronics',
      'Main Science Library · Circulation Desk',
      '2026-11-14',
      'Campus Security Desk',
      '7397631012',
      'gvijayraj2005@gmail.com',
      'Under Verification',
      adminId,
      'laptop, silver, charcoal sleeve, usb-c cable, library'
    ).lastInsertRowid
  );
  insertImage.run(laptopFoundId, '/src/assets/images/item_laptop_sleeve_1794881025754.jpg', 1);

  const bagLostId = Number(
    insertItem.run(
      'lost',
      'Navy Canvas Commuter Backpack with Tan Leather Trim',
      'Misplaced near the limestone benches outside the Central Quad archway between afternoon classes. Contains a grey insulated water bottle in the side pocket.',
      'Bags & Carry',
      'Central Quad · West Limestone Bench',
      '2026-11-15',
      'Maya Patel',
      '7397631012',
      'maya.patel@campus.edu',
      'Matched',
      mayaId,
      'backpack, navy canvas, leather trim, water bottle, quad'
    ).lastInsertRowid
  );
  insertImage.run(bagLostId, '/src/assets/images/item_student_backpack_1794881026117.jpg', 1);

  const bagFoundId = Number(
    insertItem.run(
      'found',
      'Navy Canvas Backpack & Matte Slate Insulated Bottle',
      'Discovered on the stone courtyard bench facing the Central Quad archway at 5:40 PM. Held safely at the Student Commons Lost & Found office.',
      'Bags & Carry',
      'Central Quad Courtyard',
      '2026-11-15',
      'Daniel Kim',
      '7397631012',
      'daniel.kim@campus.edu',
      'Open',
      danielId,
      'navy backpack, leather handle, slate bottle, central quad'
    ).lastInsertRowid
  );
  insertImage.run(bagFoundId, '/src/assets/images/item_student_backpack_1794881026117.jpg', 1);

  const headphonesFoundId = Number(
    insertItem.run(
      'found',
      'Matte Black Over-Ear Wireless Headphones & Hardshell Case',
      'Found inside an open charcoal zippered carrying case with USB-C and 3.5mm audio cables at the Student Commons Cafe Mezzanine table.',
      'Audio',
      'Student Commons · Cafe Mezzanine',
      '2026-11-15',
      'Vijayraj G',
      '7397631012',
      'gvijayraj2005@gmail.com',
      'Open',
      adminId,
      'headphones, wireless, matte black, carrying case, audio'
    ).lastInsertRowid
  );
  insertImage.run(headphonesFoundId, '/src/assets/images/item_wireless_headphones_1794881027209.jpg', 1);

  const keysFoundId = Number(
    insertItem.run(
      'found',
      'Campus RFID Access Fob (Card 21489) & Two Brass Keys',
      'Turned in at Engineering Hall B Lobby Reception. Features a dark navy RFID fob labeled Card 21489, two Yale brass keys, and a woven slate lanyard.',
      'Keys & IDs',
      'Engineering Hall B · Lobby Reception',
      '2026-11-16',
      'Engineering Reception',
      '7397631012',
      'gvijayraj2005@gmail.com',
      'Open',
      adminId,
      'keys, brass, campus access fob, lanyard, engineering hall'
    ).lastInsertRowid
  );
  insertImage.run(keysFoundId, '/src/assets/images/item_keys_lanyard_1794881027811.jpg', 1);

  const calcLostId = Number(
    insertItem.run(
      'lost',
      'Graphing Calculator & Calculus II Linen Notebook',
      'Left in Lecture Hall C-102 front row after morning Differential Equations seminar. Includes a silver metal pen tucked into the linen notebook.',
      'Academic',
      'Lecture Hall C-102',
      '2026-11-13',
      'Daniel Kim',
      '7397631012',
      'daniel.kim@campus.edu',
      'Recovered',
      danielId,
      'calculator, texas instruments, notebook, calculus, pen'
    ).lastInsertRowid
  );
  insertImage.run(calcLostId, '/src/assets/images/item_scientific_calculator_1794881028607.jpg', 1);

  insertItem.run(
    'lost',
    'Black Compact Umbrella with Maple Wood Handle',
    'Dropped near the North Transit Stop campus shuttle shelter during evening rain. No logo, curved maple wood grip and nylon sleeve.',
    'Accessories',
    'North Transit Stop · Shuttle Shelter',
    '2026-11-16',
    'Alex Rivera',
    '7397631012',
    'alex.rivera@campus.edu',
    'Open',
    alexId,
    'umbrella, black, maple handle, transit stop'
  );

  // Seed potential matches (explicitly labeled as requiring verification)
  const insertMatch = db.prepare(`
    INSERT INTO matches (lost_item_id, found_item_id, score, reason, ai_verified, status)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  insertMatch.run(
    laptopLostId,
    laptopFoundId,
    96,
    'Potential match requiring verification: Identical silver 14-inch ultrabook, charcoal felt sleeve, braided USB-C cable, and same-day Main Science Library location.',
    1,
    'Suggested'
  );

  insertMatch.run(
    bagLostId,
    bagFoundId,
    92,
    'Potential match requiring verification: Matching navy canvas backpack with tan leather trim, slate bottle, and Central Quad date/location alignment.',
    1,
    'Suggested'
  );

  // Seed claims across lifecycle statuses
  const insertClaim = db.prepare(`
    INSERT INTO claims (item_id, claimant_id, claimant_name, claimant_email, claimant_phone, proof_description, identifying_details, status, admin_notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertClaim.run(
    laptopFoundId,
    alexId,
    'Alex Rivera',
    'alex.rivera@campus.edu',
    '7397631012',
    'Silver 14-inch laptop has a subtle geometric sticker on the bottom shell and serial suffix 8K42. The charcoal felt sleeve holds a 2m braided USB-C cable.',
    'Serial ending in 8K42, login screen shows Alex Rivera.',
    'Under Verification',
    'Awaiting student ID check at Main Science Library circulation desk.'
  );

  insertClaim.run(
    bagFoundId,
    mayaId,
    'Maya Patel',
    'maya.patel@campus.edu',
    '7397631012',
    'Navy canvas bag with tan leather top handle and front zipper pocket containing a green campus lab pass and slate insulated water bottle.',
    'Front pocket has lab pass #4412.',
    'Pending',
    ''
  );

  insertClaim.run(
    calcLostId,
    danielId,
    'Daniel Kim',
    'daniel.kim@campus.edu',
    '7397631012',
    'Calculus II linen notebook has handwritten notes on derivatives on page 1 and a silver Parker-style pen.',
    'Verified handwritten name inside back cover.',
    'Recovered',
    'Handed back to Daniel Kim on 2026-11-14 after ID verification.'
  );

  // Seed notifications
  const insertNotif = db.prepare(`
    INSERT INTO notifications (user_id, user_email, title, message, type, related_item_id, is_read)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  insertNotif.run(
    alexId,
    'alex.rivera@campus.edu',
    'Potential Match Found (96%)',
    'A found Silver Laptop in Charcoal Felt Sleeve at Main Science Library matches your lost report. Verification required.',
    'match',
    laptopFoundId,
    0
  );

  insertNotif.run(
    alexId,
    'alex.rivera@campus.edu',
    'Claim Under Verification',
    'Your ownership claim for the Silver Laptop is currently Under Verification by Campus Security.',
    'claim',
    laptopFoundId,
    0
  );

  insertNotif.run(
    mayaId,
    'maya.patel@campus.edu',
    'Potential Match Found (92%)',
    'A found Navy Canvas Backpack at Central Quad Courtyard may match your lost backpack.',
    'match',
    bagFoundId,
    0
  );

  insertNotif.run(
    danielId,
    'daniel.kim@campus.edu',
    'Item Successfully Recovered',
    'Your Graphing Calculator & Calculus II Notebook claim has been marked Recovered.',
    'recovery',
    calcLostId,
    1
  );

  insertNotif.run(
    adminId,
    'gvijayraj2005@gmail.com',
    'New Ownership Claim Pending',
    'Maya Patel submitted a claim for Navy Canvas Backpack & Matte Slate Insulated Bottle.',
    'claim',
    bagFoundId,
    0
  );

  db.prepare(`
    INSERT INTO activity_logs (actor_email, action, target_type, target_id, details)
    VALUES (?, ?, ?, ?, ?)
  `).run('gvijayraj2005@gmail.com', 'System Seeded', 'system', 0, 'Initial campus lost and found dataset initialized.');
}
