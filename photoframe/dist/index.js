var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// shared/license.ts
var license_exports = {};
__export(license_exports, {
  TRIAL_DAYS: () => TRIAL_DAYS,
  calculateTrialDaysRemaining: () => calculateTrialDaysRemaining,
  formatLicenseKey: () => formatLicenseKey,
  generateLicenseKey: () => generateLicenseKey,
  isTrialExpired: () => isTrialExpired,
  validateLicenseKey: () => validateLicenseKey
});
function calculateChecksum(code) {
  const combined = code + SECRET_SALT;
  let hash = 0;
  for (let i = 0; i < combined.length; i++) {
    const char = combined.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  const checksum = Math.abs(hash).toString(36).toUpperCase().padStart(4, "0").slice(-4);
  return checksum;
}
function validateLicenseKey(key) {
  try {
    const parts = key.trim().toUpperCase().split("-");
    if (parts.length !== 4) return false;
    if (parts[0] !== "PRO") return false;
    if (parts[1] !== "2025") return false;
    if (parts[2].length !== 4) return false;
    if (parts[3].length !== 4) return false;
    const code = parts[2];
    const providedChecksum = parts[3];
    const calculatedChecksum = calculateChecksum(code);
    return providedChecksum === calculatedChecksum;
  } catch {
    return false;
  }
}
function generateLicenseKey(code) {
  const cleanCode = code.toUpperCase().slice(0, 4).padEnd(4, "0");
  const checksum = calculateChecksum(cleanCode);
  return `PRO-2025-${cleanCode}-${checksum}`;
}
function formatLicenseKey(key) {
  return key.toUpperCase().replace(/[^A-Z0-9]/g, "").match(/.{1,4}/g)?.join("-") || key;
}
function calculateTrialDaysRemaining(firstLaunchDate) {
  const now = /* @__PURE__ */ new Date();
  const diffMs = now.getTime() - firstLaunchDate.getTime();
  const diffDays = Math.floor(diffMs / (1e3 * 60 * 60 * 24));
  const remaining = TRIAL_DAYS - diffDays;
  return Math.max(0, remaining);
}
function isTrialExpired(firstLaunchDate) {
  return calculateTrialDaysRemaining(firstLaunchDate) === 0;
}
var SECRET_SALT, TRIAL_DAYS;
var init_license = __esm({
  "shared/license.ts"() {
    "use strict";
    SECRET_SALT = "PhotoFrame-PRO-v1-2025-Marius";
    TRIAL_DAYS = 10;
  }
});

// server/index.ts
import express2 from "express";
import cors from "cors";
import https from "https";
import fs4 from "fs";
import path5 from "path";

// server/routes.ts
import { createServer } from "http";
import multer from "multer";
import path2 from "path";
import fs2 from "fs/promises";
import crypto from "crypto";

// server/storage.ts
import { randomUUID } from "crypto";
import fs from "fs/promises";
import path from "path";
var FileStorage = class {
  photos;
  orders;
  dbPath;
  ordersPath;
  uploadsDir;
  licensePath;
  firstLaunchPath;
  licenseKey = null;
  firstLaunchDate = null;
  constructor(dbPath = "/data/photos.json", uploadsDir = "/data/uploads", licensePath = "/data/license.key", firstLaunchPath = "/data/first_launch.txt", ordersPath = "/data/orders.json") {
    this.photos = /* @__PURE__ */ new Map();
    this.orders = /* @__PURE__ */ new Map();
    this.dbPath = dbPath;
    this.ordersPath = ordersPath;
    this.uploadsDir = uploadsDir;
    this.licensePath = licensePath;
    this.firstLaunchPath = firstLaunchPath;
    this.init();
  }
  async init() {
    try {
      console.log("[FileStorage] Inizializzazione storage persistente...");
      try {
        await fs.mkdir(this.uploadsDir, { recursive: true });
        console.log(`[FileStorage] Directory uploads: ${this.uploadsDir}`);
      } catch (err) {
        console.error("[FileStorage] Errore creazione uploads dir:", err);
      }
      try {
        const data = await fs.readFile(this.dbPath, "utf-8");
        const photosArray = JSON.parse(data);
        this.photos = new Map(photosArray.map((p) => [p.id, p]));
        console.log(`[FileStorage] Database caricato: ${this.photos.size} foto`);
      } catch (err) {
        console.log("[FileStorage] Database non trovato, creazione nuovo...");
        await this.save();
      }
      await this.scanAndSync();
      await this.cleanupTrashedPhotos();
      await this.loadLicenseKey();
      await this.loadFirstLaunchDate();
      await this.loadOrders();
    } catch (error) {
      console.error("[FileStorage] Errore inizializzazione:", error);
    }
  }
  async loadOrders() {
    try {
      const data = await fs.readFile(this.ordersPath, "utf-8");
      const ordersArray = JSON.parse(data);
      this.orders = new Map(ordersArray.map((o) => [o.id, {
        ...o,
        createdAt: o.createdAt instanceof Date ? o.createdAt : new Date(o.createdAt)
      }]));
      console.log(`[FileStorage] Ordini caricati: ${this.orders.size}`);
    } catch {
      console.log("[FileStorage] Database ordini non trovato, creazione nuovo...");
      await this.saveOrders();
    }
  }
  async saveOrders() {
    try {
      const ordersArray = Array.from(this.orders.values());
      await fs.writeFile(this.ordersPath, JSON.stringify(ordersArray, null, 2), "utf-8");
    } catch (error) {
      console.error("[FileStorage] Errore salvataggio ordini:", error);
      throw error;
    }
  }
  async loadLicenseKey() {
    try {
      const key = await fs.readFile(this.licensePath, "utf-8");
      this.licenseKey = key.trim();
      console.log("[FileStorage] Licenza PRO caricata");
    } catch {
      console.log("[FileStorage] Nessuna licenza PRO trovata (versione FREE)");
      this.licenseKey = null;
    }
  }
  async cleanupTrashedPhotos() {
    try {
      const trashedPhotos = Array.from(this.photos.values()).filter((p) => p.inTrash);
      if (trashedPhotos.length === 0) {
        console.log("[FileStorage] Nessuna foto nel cestino da eliminare");
        return;
      }
      console.log(`[FileStorage] Eliminazione ${trashedPhotos.length} foto dal cestino...`);
      for (const photo of trashedPhotos) {
        try {
          const fullPath = path.join(this.uploadsDir, path.basename(photo.filepath));
          await fs.unlink(fullPath);
          this.photos.delete(photo.id);
          console.log(`[FileStorage] Eliminata: ${photo.filename}`);
        } catch (err) {
          console.error(`[FileStorage] Errore eliminazione ${photo.filename}:`, err);
        }
      }
      await this.save();
      console.log("[FileStorage] Pulizia cestino completata");
    } catch (error) {
      console.error("[FileStorage] Errore pulizia cestino:", error);
    }
  }
  async scanAndSync() {
    try {
      console.log("[FileStorage] Scansione directory uploads...");
      const files = await fs.readdir(this.uploadsDir);
      const imageFiles = files.filter((f) => /\.(jpg|jpeg|png|webp)$/i.test(f));
      console.log(`[FileStorage] Trovati ${imageFiles.length} file immagine`);
      const existingPaths = new Set(
        Array.from(this.photos.values()).map((p) => path.basename(p.filepath))
      );
      const orphanedFiles = imageFiles.filter((f) => !existingPaths.has(f));
      if (orphanedFiles.length > 0) {
        console.log(`[FileStorage] Recupero ${orphanedFiles.length} foto orfane...`);
        for (const filename of orphanedFiles) {
          const stats = await fs.stat(path.join(this.uploadsDir, filename));
          const photo = {
            id: randomUUID(),
            filename,
            filepath: `/uploads/${filename}`,
            uploadedAt: stats.birthtime || /* @__PURE__ */ new Date(),
            inTrash: false
          };
          this.photos.set(photo.id, photo);
          console.log(`[FileStorage] Recuperata: ${filename}`);
        }
        await this.save();
      }
      const dbFilenames = Array.from(this.photos.values()).map((p) => path.basename(p.filepath));
      const deletedFiles = dbFilenames.filter((f) => !imageFiles.includes(f));
      if (deletedFiles.length > 0) {
        console.log(`[FileStorage] Rimozione ${deletedFiles.length} metadati obsoleti...`);
        const entries = Array.from(this.photos.entries());
        for (const [id, photo] of entries) {
          if (deletedFiles.includes(path.basename(photo.filepath))) {
            this.photos.delete(id);
          }
        }
        await this.save();
      }
      console.log(`[FileStorage] Sincronizzazione completata: ${this.photos.size} foto attive`);
    } catch (error) {
      console.error("[FileStorage] Errore scansione:", error);
    }
  }
  async save() {
    try {
      const photosArray = Array.from(this.photos.values());
      await fs.writeFile(this.dbPath, JSON.stringify(photosArray, null, 2), "utf-8");
      console.log(`[FileStorage] Database salvato: ${photosArray.length} foto`);
    } catch (error) {
      console.error("[FileStorage] Errore salvataggio database:", error);
    }
  }
  async getAllPhotos() {
    return Array.from(this.photos.values()).sort(
      (a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime()
    );
  }
  async getPhoto(id) {
    return this.photos.get(id);
  }
  async createPhoto(insertPhoto) {
    const id = randomUUID();
    const photo = {
      ...insertPhoto,
      id,
      uploadedAt: /* @__PURE__ */ new Date(),
      inTrash: false
    };
    this.photos.set(id, photo);
    await this.save();
    return photo;
  }
  async deletePhoto(id) {
    const result = this.photos.delete(id);
    if (result) {
      await this.save();
    }
    return result;
  }
  async moveToTrash(id) {
    const photo = this.photos.get(id);
    if (!photo) return void 0;
    photo.inTrash = true;
    this.photos.set(id, photo);
    await this.save();
    console.log(`[FileStorage] Foto spostata nel cestino: ${photo.filename}`);
    return photo;
  }
  async restoreFromTrash(id) {
    const photo = this.photos.get(id);
    if (!photo) return void 0;
    photo.inTrash = false;
    this.photos.set(id, photo);
    await this.save();
    console.log(`[FileStorage] Foto ripristinata dal cestino: ${photo.filename}`);
    return photo;
  }
  async emptyTrash() {
    const trashedPhotos = Array.from(this.photos.values()).filter((p) => p.inTrash);
    let deleted = 0;
    for (const photo of trashedPhotos) {
      try {
        const fullPath = path.join(this.uploadsDir, path.basename(photo.filepath));
        await fs.unlink(fullPath);
        this.photos.delete(photo.id);
        deleted++;
        console.log(`[FileStorage] Eliminata dal cestino: ${photo.filename}`);
      } catch (err) {
        console.error(`[FileStorage] Errore eliminazione ${photo.filename}:`, err);
      }
    }
    if (deleted > 0) {
      await this.save();
    }
    console.log(`[FileStorage] Cestino svuotato: ${deleted} foto eliminate`);
    return deleted;
  }
  async saveLicenseKey(key) {
    try {
      await fs.writeFile(this.licensePath, key.trim(), "utf-8");
      this.licenseKey = key.trim();
      console.log("[FileStorage] Licenza PRO salvata");
    } catch (error) {
      console.error("[FileStorage] Errore salvataggio licenza:", error);
      throw error;
    }
  }
  async getLicenseKey() {
    return this.licenseKey;
  }
  async loadFirstLaunchDate() {
    try {
      const dateStr = await fs.readFile(this.firstLaunchPath, "utf-8");
      this.firstLaunchDate = new Date(dateStr.trim());
      console.log(`[FileStorage] First launch: ${this.firstLaunchDate.toISOString()}`);
    } catch {
      this.firstLaunchDate = /* @__PURE__ */ new Date();
      await this.setFirstLaunchDate(this.firstLaunchDate);
      console.log(`[FileStorage] Trial iniziato: ${this.firstLaunchDate.toISOString()}`);
    }
  }
  async getFirstLaunchDate() {
    return this.firstLaunchDate;
  }
  async setFirstLaunchDate(date) {
    try {
      await fs.writeFile(this.firstLaunchPath, date.toISOString(), "utf-8");
      this.firstLaunchDate = date;
      console.log("[FileStorage] First launch date salvata");
    } catch (error) {
      console.error("[FileStorage] Errore salvataggio first launch:", error);
      throw error;
    }
  }
  async createOrder(orderData) {
    const order = {
      id: randomUUID(),
      ...orderData,
      status: orderData.status || "paid",
      customerName: orderData.customerName || null,
      currency: orderData.currency || "EUR",
      emailSent: orderData.emailSent || false,
      createdAt: /* @__PURE__ */ new Date()
    };
    this.orders.set(order.id, order);
    await this.saveOrders();
    console.log(`[FileStorage] Ordine creato: ${order.lemonsqueezyOrderId} - ${order.licenseKey}`);
    return order;
  }
  async updateOrderEmailStatus(orderId, emailSent) {
    const order = this.orders.get(orderId);
    if (order) {
      order.emailSent = emailSent;
      await this.saveOrders();
      console.log(`[FileStorage] Order ${orderId} emailSent aggiornato: ${emailSent}`);
    }
  }
  async getAllOrders() {
    return Array.from(this.orders.values()).sort(
      (a, b) => {
        const aTime = a.createdAt instanceof Date ? a.createdAt.getTime() : new Date(a.createdAt).getTime();
        const bTime = b.createdAt instanceof Date ? b.createdAt.getTime() : new Date(b.createdAt).getTime();
        return bTime - aTime;
      }
    );
  }
  async getOrderByLemonsqueezyId(lemonsqueezyOrderId) {
    return Array.from(this.orders.values()).find(
      (o) => o.lemonsqueezyOrderId === lemonsqueezyOrderId
    );
  }
};
var UPLOAD_DIR = process.env.UPLOAD_DIR || (process.env.NODE_ENV === "development" ? "uploads" : "/data/uploads");
var DB_PATH = process.env.DB_PATH || (process.env.NODE_ENV === "development" ? "photos.json" : "/data/photos.json");
var LICENSE_PATH = process.env.LICENSE_PATH || (process.env.NODE_ENV === "development" ? "license.key" : "/data/license.key");
var FIRST_LAUNCH_PATH = process.env.FIRST_LAUNCH_PATH || (process.env.NODE_ENV === "development" ? "first_launch.txt" : "/data/first_launch.txt");
var ORDERS_PATH = process.env.ORDERS_PATH || (process.env.NODE_ENV === "development" ? "orders.json" : "/data/orders.json");
var storage = new FileStorage(DB_PATH, UPLOAD_DIR, LICENSE_PATH, FIRST_LAUNCH_PATH, ORDERS_PATH);

// shared/schema.ts
import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
var photos = pgTable("photos", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  filename: text("filename").notNull(),
  filepath: text("filepath").notNull(),
  uploadedAt: timestamp("uploaded_at").defaultNow().notNull(),
  inTrash: boolean("in_trash").notNull().default(false)
});
var insertPhotoSchema = createInsertSchema(photos).omit({
  id: true,
  uploadedAt: true,
  inTrash: true
});
var orders = pgTable("orders", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  lemonsqueezyOrderId: text("lemonsqueezy_order_id").notNull().unique(),
  customerEmail: text("customer_email").notNull(),
  customerName: text("customer_name"),
  amount: text("amount").notNull(),
  currency: text("currency").notNull().default("EUR"),
  licenseKey: text("license_key").notNull(),
  status: text("status").notNull().default("paid"),
  emailSent: boolean("email_sent").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull()
});
var insertOrderSchema = createInsertSchema(orders).omit({
  id: true,
  createdAt: true
});

// server/routes.ts
init_license();

// server/email.ts
import { Resend } from "resend";
var RESEND_API_KEY = process.env.RESEND_API_KEY || "re_GPGfLjLZ_Lt1NEgBFcQ14im3oMb5mdjit";
var ADMIN_EMAIL = "edisonacdc88@gmail.com";
var FROM_EMAIL = "PhotoFrame PRO <onboarding@resend.dev>";
var resend = new Resend(RESEND_API_KEY);
async function sendLicenseNotificationToAdmin(data) {
  if (!RESEND_API_KEY) {
    console.warn("[Email] RESEND_API_KEY non configurata - skip email");
    return false;
  }
  try {
    const emailBody = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #4CAF50; color: white; padding: 20px; border-radius: 5px; }
    .content { background: #f9f9f9; padding: 20px; border-radius: 5px; margin-top: 20px; }
    .license-key { background: #fff; padding: 15px; border-left: 4px solid #4CAF50; font-family: monospace; font-size: 18px; font-weight: bold; margin: 15px 0; }
    .details { background: #fff; padding: 15px; border-radius: 5px; margin-top: 10px; }
    .label { font-weight: bold; color: #666; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>\u{1F389} Nuova Vendita PhotoFrame PRO!</h1>
    </div>
    
    <div class="content">
      <p><strong>Congratulazioni!</strong> Hai appena ricevuto un nuovo ordine PhotoFrame PRO.</p>
      
      <div class="license-key">
        ${data.licenseKey}
      </div>
      
      <div class="details">
        <p><span class="label">Cliente:</span> ${data.customerName || "N/A"}</p>
        <p><span class="label">Email:</span> ${data.customerEmail}</p>
        <p><span class="label">Importo:</span> ${data.currency} ${data.amount}</p>
        <p><span class="label">Order ID:</span> ${data.orderId}</p>
      </div>
      
      <p style="margin-top: 20px; padding: 15px; background: #fff3cd; border-radius: 5px;">
        <strong>\u{1F4CB} Prossimi Passi:</strong><br>
        1. Copia il codice licenza sopra<br>
        2. Invia al cliente via email o Lemon Squeezy<br>
        3. Il cliente lo inserir\xE0 nell'app per attivare PRO
      </p>
    </div>
  </div>
</body>
</html>
    `.trim();
    const result = await resend.emails.send({
      from: FROM_EMAIL,
      to: [ADMIN_EMAIL],
      subject: `\u{1F389} Nuova Vendita PhotoFrame PRO - ${data.currency} ${data.amount}`,
      html: emailBody
    });
    if (result.error) {
      console.error("[Email] Errore Resend:", result.error);
      return false;
    }
    console.log("[Email] Email inviata con successo:", result.data?.id);
    return true;
  } catch (error) {
    console.error("[Email] Errore invio email:", error);
    return false;
  }
}
async function sendTestEmail(to = ADMIN_EMAIL) {
  try {
    const result = await resend.emails.send({
      from: FROM_EMAIL,
      to: [to],
      subject: "Test PhotoFrame - Resend Funziona! \u2705",
      html: "<p>Congratulazioni! Resend \xE8 configurato correttamente. Riceverai qui i codici licenza automatici.</p>"
    });
    if (result.error) {
      console.error("[Email Test] Errore:", result.error);
      return false;
    }
    console.log("[Email Test] Email di test inviata:", result.data?.id);
    return true;
  } catch (error) {
    console.error("[Email Test] Errore:", error);
    return false;
  }
}

// server/routes.ts
var UPLOAD_DIR2 = process.env.UPLOAD_DIR || "uploads";
var upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR2,
    filename: (req, file, cb) => {
      const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
      cb(null, uniqueSuffix + path2.extname(file.originalname));
    }
  }),
  fileFilter: (req, file, cb) => {
    const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Invalid file type. Only JPEG, PNG and WebP are allowed."));
    }
  },
  limits: {
    fileSize: 10 * 1024 * 1024
    // 10MB
  }
});
async function registerRoutes(app2) {
  const publicDir = process.env.NODE_ENV === "production" ? path2.join(process.cwd(), "dist", "public") : path2.join(process.cwd(), "client", "public");
  app2.use("/uploads", (req, res, next) => {
    res.setHeader("Cache-Control", "public, max-age=31536000");
    next();
  });
  app2.use("/uploads", (await import("express")).static(UPLOAD_DIR2));
  app2.get("/card-install", async (req, res) => {
    const filePath = path2.join(publicDir, "install.html");
    res.sendFile(filePath);
  });
  app2.get("/photoframe-screensaver-card.js", async (req, res) => {
    const filePath = path2.join(publicDir, "photoframe-screensaver-card.js");
    res.setHeader("Content-Type", "application/javascript; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.sendFile(filePath);
  });
  app2.get("/lovelace/photoframe-screensaver-card.js", async (req, res) => {
    const filePath = path2.join(publicDir, "photoframe-screensaver-card.js");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.sendFile(filePath);
  });
  app2.get("/download/photoframe-screensaver-card.js", async (req, res) => {
    const filePath = path2.join(publicDir, "photoframe-screensaver-card.js");
    res.setHeader("Content-Type", "application/javascript; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=photoframe-screensaver-card.js");
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.download(filePath);
  });
  app2.get("/download-addon", async (req, res) => {
    const addonPath = path2.join(process.cwd(), "addon", "photoframe-addon-v1.0.27.tar.gz");
    res.setHeader("Content-Type", "application/gzip");
    res.setHeader("Content-Disposition", "attachment; filename=photoframe-addon-v1.0.27.tar.gz");
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.download(addonPath);
  });
  app2.get("/download-github-update", async (req, res) => {
    const updatePath = path2.join(process.cwd(), "addon", "photoframe-addon-github-update.tar.gz");
    res.setHeader("Content-Type", "application/gzip");
    res.setHeader("Content-Disposition", "attachment; filename=photoframe-github-update.tar.gz");
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.download(updatePath);
  });
  app2.get("/api/photos", async (req, res) => {
    try {
      const photos2 = await storage.getAllPhotos();
      res.json(photos2);
    } catch (error) {
      console.error("Error fetching photos:", error);
      res.status(500).json({ error: "Failed to fetch photos" });
    }
  });
  app2.get("/api/photos/:id", async (req, res) => {
    try {
      const photo = await storage.getPhoto(req.params.id);
      if (!photo) {
        return res.status(404).json({ error: "Photo not found" });
      }
      res.json(photo);
    } catch (error) {
      console.error("Error fetching photo:", error);
      res.status(500).json({ error: "Failed to fetch photo" });
    }
  });
  app2.post("/api/photos/upload", upload.array("photos", 50), async (req, res) => {
    try {
      console.log("[UPLOAD] Inizio upload, UPLOAD_DIR:", UPLOAD_DIR2);
      const files = req.files;
      console.log("[UPLOAD] File ricevuti:", files?.length || 0);
      if (!files || files.length === 0) {
        console.error("[UPLOAD] Nessun file ricevuto");
        return res.status(400).json({ error: "No files uploaded" });
      }
      console.log("[UPLOAD] Elaborazione file...");
      const uploadedPhotos = await Promise.all(
        files.map(async (file) => {
          console.log("[UPLOAD] File:", file.originalname, "\u2192", file.filename);
          const photoData = insertPhotoSchema.parse({
            filename: file.originalname,
            filepath: `/uploads/${file.filename}`
          });
          const photo = await storage.createPhoto(photoData);
          console.log("[UPLOAD] Foto salvata:", photo.id);
          return photo;
        })
      );
      console.log("[UPLOAD] Upload completato:", uploadedPhotos.length, "foto");
      res.json(uploadedPhotos);
    } catch (error) {
      console.error("[UPLOAD] ERRORE:", error);
      console.error("[UPLOAD] Stack:", error instanceof Error ? error.stack : "N/A");
      res.status(500).json({
        error: "Failed to upload photos",
        details: error instanceof Error ? error.message : String(error)
      });
    }
  });
  app2.delete("/api/photos/:id", async (req, res) => {
    try {
      const photo = await storage.getPhoto(req.params.id);
      if (!photo) {
        return res.status(404).json({ error: "Photo not found" });
      }
      const filename = path2.basename(photo.filepath);
      const filepath = path2.join(UPLOAD_DIR2, filename);
      try {
        await fs2.unlink(filepath);
      } catch (error) {
        console.error("Error deleting file:", error);
      }
      const deleted = await storage.deletePhoto(req.params.id);
      if (!deleted) {
        return res.status(500).json({ error: "Failed to delete photo" });
      }
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting photo:", error);
      res.status(500).json({ error: "Failed to delete photo" });
    }
  });
  app2.patch("/api/photos/:id/trash", async (req, res) => {
    try {
      const photo = await storage.moveToTrash(req.params.id);
      if (!photo) {
        return res.status(404).json({ error: "Photo not found" });
      }
      res.json(photo);
    } catch (error) {
      console.error("Error moving photo to trash:", error);
      res.status(500).json({ error: "Failed to move photo to trash" });
    }
  });
  app2.patch("/api/photos/:id/restore", async (req, res) => {
    try {
      const photo = await storage.restoreFromTrash(req.params.id);
      if (!photo) {
        return res.status(404).json({ error: "Photo not found" });
      }
      res.json(photo);
    } catch (error) {
      console.error("Error restoring photo:", error);
      res.status(500).json({ error: "Failed to restore photo" });
    }
  });
  app2.post("/api/photos/empty-trash", async (req, res) => {
    try {
      const deletedCount = await storage.emptyTrash();
      res.json({ success: true, deletedCount });
    } catch (error) {
      console.error("Error emptying trash:", error);
      res.status(500).json({ error: "Failed to empty trash" });
    }
  });
  app2.get("/api/slideshow/status", (req, res) => {
    res.json({
      playing: true,
      interval: 15
    });
  });
  app2.post("/api/slideshow/control", async (req, res) => {
    const { action, interval } = req.body;
    if (!action) {
      return res.status(400).json({ error: "Action is required" });
    }
    res.json({
      success: true,
      action,
      interval: interval || 15
    });
  });
  app2.get("/api/license", async (req, res) => {
    try {
      const key = await storage.getLicenseKey();
      const isValid = key ? validateLicenseKey(key) : false;
      if (isValid) {
        return res.json({
          hasLicense: true,
          isValid: true,
          isPro: true,
          isTrial: false,
          isExpired: false,
          daysRemaining: 0
        });
      }
      const firstLaunch = await storage.getFirstLaunchDate();
      if (!firstLaunch) {
        return res.json({
          hasLicense: false,
          isValid: false,
          isPro: false,
          isTrial: false,
          isExpired: true,
          daysRemaining: 0
        });
      }
      const { calculateTrialDaysRemaining: calculateTrialDaysRemaining2, isTrialExpired: isTrialExpired2 } = await Promise.resolve().then(() => (init_license(), license_exports));
      const daysRemaining = calculateTrialDaysRemaining2(firstLaunch);
      const expired = isTrialExpired2(firstLaunch);
      res.json({
        hasLicense: false,
        isValid: false,
        isPro: false,
        isTrial: !expired,
        // Trial attivo solo se non scaduto
        isExpired: expired,
        daysRemaining
      });
    } catch (error) {
      console.error("Error checking license:", error);
      res.status(500).json({ error: "Failed to check license" });
    }
  });
  app2.post("/api/license/activate", async (req, res) => {
    try {
      const { licenseKey } = req.body;
      if (!licenseKey || typeof licenseKey !== "string") {
        return res.status(400).json({ error: "License key is required" });
      }
      const isValid = validateLicenseKey(licenseKey);
      if (!isValid) {
        return res.status(400).json({ error: "Invalid license key" });
      }
      await storage.saveLicenseKey(licenseKey);
      console.log("[LICENSE] PRO attivata:", licenseKey);
      res.json({
        success: true,
        message: "Licenza PRO attivata con successo!",
        isPro: true
      });
    } catch (error) {
      console.error("Error activating license:", error);
      res.status(500).json({ error: "Failed to activate license" });
    }
  });
  app2.post("/api/webhooks/lemonsqueezy", async (req, res) => {
    try {
      const signature = req.headers["x-signature"];
      const secret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET;
      if (!secret) {
        console.error("[Webhook] LEMONSQUEEZY_WEBHOOK_SECRET non configurata");
        return res.status(500).json({ error: "Webhook secret not configured" });
      }
      const rawBody = JSON.stringify(req.body);
      const hmac = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
      if (hmac !== signature) {
        console.error("[Webhook] Firma non valida");
        return res.status(401).json({ error: "Invalid signature" });
      }
      const payload = req.body;
      const eventName = payload.meta?.event_name;
      console.log(`[Webhook] Evento ricevuto: ${eventName}`);
      if (eventName === "order_created") {
        const order = payload.data?.attributes;
        if (!order) {
          console.error("[Webhook] Payload ordine mancante");
          return res.status(400).json({ error: "Missing order data" });
        }
        const existingOrder = await storage.getOrderByLemonsqueezyId(order.identifier);
        if (existingOrder) {
          console.log("[Webhook] Ordine gi\xE0 processato:", order.identifier);
          return res.status(200).json({ message: "Already processed" });
        }
        const randomCode = Math.random().toString(36).substring(2, 6).toUpperCase();
        const licenseKey = generateLicenseKey(randomCode);
        const orderData = insertOrderSchema.parse({
          lemonsqueezyOrderId: order.identifier,
          customerEmail: order.user_email,
          customerName: order.user_name || null,
          amount: (order.total / 100).toFixed(2),
          currency: order.currency || "EUR",
          licenseKey,
          status: order.status || "paid"
        });
        const savedOrder = await storage.createOrder(orderData);
        console.log("[Webhook] Ordine salvato:", savedOrder.id);
        const emailSuccess = await sendLicenseNotificationToAdmin({
          customerEmail: order.user_email,
          customerName: order.user_name,
          licenseKey,
          amount: (order.total / 100).toFixed(2),
          currency: order.currency || "EUR",
          orderId: order.identifier
        });
        await storage.updateOrderEmailStatus(savedOrder.id, emailSuccess);
        console.log(`[Webhook] Email ${emailSuccess ? "inviata" : "FALLITA"} per ordine ${savedOrder.id}`);
      }
      res.status(200).json({ message: "Webhook processed" });
    } catch (error) {
      console.error("[Webhook] Errore:", error);
      res.status(500).json({ error: "Webhook processing failed" });
    }
  });
  app2.get("/api/orders", async (req, res) => {
    try {
      const orders2 = await storage.getAllOrders();
      res.json(orders2);
    } catch (error) {
      console.error("Error fetching orders:", error);
      res.status(500).json({ error: "Failed to fetch orders" });
    }
  });
  app2.post("/api/test/send-email", async (req, res) => {
    try {
      console.log("[Test Email] Invio email di test...");
      const success = await sendTestEmail();
      if (success) {
        res.json({
          success: true,
          message: "Email di test inviata! Controlla mariusgrosu8879@gmail.com"
        });
      } else {
        res.status(500).json({
          success: false,
          message: "Errore invio email - controlla RESEND_API_KEY"
        });
      }
    } catch (error) {
      console.error("Error sending test email:", error);
      res.status(500).json({ error: "Failed to send test email" });
    }
  });
  if (process.env.NODE_ENV === "development") {
    app2.post("/api/test/expire-trial", async (req, res) => {
      try {
        const { daysAgo } = req.body;
        const targetDays = typeof daysAgo === "number" ? daysAgo : 11;
        const pastDate = new Date(Date.now() - targetDays * 24 * 60 * 60 * 1e3);
        await storage.setFirstLaunchDate(pastDate);
        console.log(`[TEST] Trial scaduto impostato a ${targetDays} giorni fa:`, pastDate.toISOString());
        res.json({ success: true, firstLaunchDate: pastDate.toISOString() });
      } catch (error) {
        console.error("Error setting trial expiration:", error);
        res.status(500).json({ error: "Failed to set trial expiration" });
      }
    });
    app2.post("/api/test/reset-trial", async (req, res) => {
      try {
        const now = /* @__PURE__ */ new Date();
        await storage.setFirstLaunchDate(now);
        console.log("[TEST] Trial resettato a oggi:", now.toISOString());
        res.json({ success: true, firstLaunchDate: now.toISOString() });
      } catch (error) {
        console.error("Error resetting trial:", error);
        res.status(500).json({ error: "Failed to reset trial" });
      }
    });
  }
  const httpServer = createServer(app2);
  return httpServer;
}

// server/vite.ts
import express from "express";
import fs3 from "fs";
import path4 from "path";
import { createServer as createViteServer, createLogger } from "vite";

// vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path3 from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";
var vite_config_default = defineConfig({
  plugins: [
    react(),
    runtimeErrorOverlay(),
    ...process.env.NODE_ENV !== "production" && process.env.REPL_ID !== void 0 ? [
      await import("@replit/vite-plugin-cartographer").then(
        (m) => m.cartographer()
      ),
      await import("@replit/vite-plugin-dev-banner").then(
        (m) => m.devBanner()
      )
    ] : []
  ],
  resolve: {
    alias: {
      "@": path3.resolve(import.meta.dirname, "client", "src"),
      "@shared": path3.resolve(import.meta.dirname, "shared"),
      "@assets": path3.resolve(import.meta.dirname, "attached_assets")
    }
  },
  root: path3.resolve(import.meta.dirname, "client"),
  build: {
    outDir: path3.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true
  },
  server: {
    fs: {
      strict: true,
      deny: ["**/.*"]
    }
  }
});

// server/vite.ts
import { nanoid } from "nanoid";
var viteLogger = createLogger();
function log(message, source = "express") {
  const formattedTime = (/* @__PURE__ */ new Date()).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true
  });
  console.log(`${formattedTime} [${source}] ${message}`);
}
async function setupVite(app2, server) {
  const serverOptions = {
    middlewareMode: true,
    hmr: { server },
    allowedHosts: true
  };
  const vite = await createViteServer({
    ...vite_config_default,
    configFile: false,
    customLogger: {
      ...viteLogger,
      error: (msg, options) => {
        viteLogger.error(msg, options);
        process.exit(1);
      }
    },
    server: serverOptions,
    appType: "custom"
  });
  app2.use(vite.middlewares);
  app2.use("*", async (req, res, next) => {
    const url = req.originalUrl;
    try {
      const clientTemplate = path4.resolve(
        import.meta.dirname,
        "..",
        "client",
        "index.html"
      );
      let template = await fs3.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid()}"`
      );
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e);
      next(e);
    }
  });
}
function serveStatic(app2) {
  const distPath = path4.resolve(import.meta.dirname, "public");
  if (!fs3.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`
    );
  }
  app2.use(express.static(distPath));
  app2.use("*", (_req, res) => {
    res.sendFile(path4.resolve(distPath, "index.html"));
  });
}

// server/index.ts
var app = express2();
app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: false
}));
app.use(express2.json({
  verify: (req, _res, buf) => {
    req.rawBody = buf;
  }
}));
app.use(express2.urlencoded({ extended: false }));
app.use((req, res, next) => {
  const start = Date.now();
  const path6 = req.path;
  let capturedJsonResponse = void 0;
  const originalResJson = res.json;
  res.json = function(bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };
  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path6.startsWith("/api")) {
      let logLine = `${req.method} ${path6} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }
      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "\u2026";
      }
      log(logLine);
    }
  });
  next();
});
(async () => {
  const server = await registerRoutes(app);
  app.use((err, _req, res, _next) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";
    res.status(status).json({ message });
    throw err;
  });
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }
  const port = parseInt(process.env.PORT || "5000", 10);
  server.listen({
    port,
    host: "0.0.0.0",
    reusePort: true
  }, () => {
    log(`HTTP serving on port ${port}`);
  });
  try {
    const certDir = path5.join(process.cwd(), "certs");
    const certPath = path5.join(certDir, "server.crt");
    const keyPath = path5.join(certDir, "server.key");
    if (!fs4.existsSync(certPath) || !fs4.existsSync(keyPath)) {
      log("Creating self-signed SSL certificate...");
      if (!fs4.existsSync(certDir)) {
        fs4.mkdirSync(certDir, { recursive: true });
      }
      const { execSync } = await import("child_process");
      try {
        execSync(
          `openssl req -x509 -newkey rsa:2048 -nodes -sha256 -days 365 -keyout "${keyPath}" -out "${certPath}" -subj "/C=IT/ST=State/L=City/O=PhotoFrame/CN=192.168.178.80"`,
          { stdio: "inherit" }
        );
        log("Self-signed certificate created successfully");
      } catch (err) {
        log("OpenSSL not available, HTTPS will not be enabled");
      }
    }
    if (fs4.existsSync(certPath) && fs4.existsSync(keyPath)) {
      const httpsOptions = {
        key: fs4.readFileSync(keyPath),
        cert: fs4.readFileSync(certPath)
      };
      const httpsPort = parseInt(process.env.HTTPS_PORT || "5443", 10);
      const httpsServer = https.createServer(httpsOptions, app);
      httpsServer.listen({
        port: httpsPort,
        host: "0.0.0.0",
        reusePort: true
      }, () => {
        log(`HTTPS serving on port ${httpsPort}`);
      });
    }
  } catch (error) {
    log("HTTPS setup failed, continuing with HTTP only");
  }
})();
