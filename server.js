const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const sharp = require('sharp');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const db = new sqlite3.Database(path.join(__dirname, 'database.sqlite'), (err) => {
    if (err) console.error('Erreur ouverture BDD:', err);
    else console.log('Base de données SQLite connectée.');
});

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        client TEXT,
        commande TEXT,
        logo TEXT,
        couleur TEXT,
        dimension TEXT,
        hauteur TEXT,
        quantite INTEGER,
        papier_masquage INTEGER DEFAULT 0,
        double_face_int INTEGER DEFAULT 0,
        double_face_ext INTEGER DEFAULT 0,
        gabarit_carton INTEGER DEFAULT 0,
        checked INTEGER DEFAULT 0,
        archived INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Migration additive : ajoute les colonnes options aux BDD déjà existantes.
    // ADD COLUMN est non destructif et réversible (DROP COLUMN sur SQLite récent).
    const OPTION_COLS = ['papier_masquage', 'double_face_int', 'double_face_ext', 'gabarit_carton'];
    db.all(`PRAGMA table_info(requests)`, [], (err, cols) => {
        if (err || !cols) return;
        const existing = new Set(cols.map(c => c.name));
        OPTION_COLS.forEach(name => {
            if (!existing.has(name)) {
                db.run(`ALTER TABLE requests ADD COLUMN ${name} INTEGER DEFAULT 0`);
            }
        });
        // Hauteur (mm) : 2e dimension pour calculer la surface en m². TEXT comme dimension.
        if (!existing.has('hauteur')) {
            db.run(`ALTER TABLE requests ADD COLUMN hauteur TEXT`);
        }
    });

    db.run(`CREATE TABLE IF NOT EXISTS maquettes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        client TEXT,
        description TEXT,
        filename TEXT,
        original_name TEXT,
        mime_type TEXT,
        file_size INTEGER,
        analysis TEXT,
        status TEXT DEFAULT 'en_attente',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
});

// Multer pour upload de fichier
const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename: (_req, file, cb) => {
        const uniq = crypto.randomBytes(8).toString('hex');
        const ext = path.extname(file.originalname) || '';
        cb(null, `${Date.now()}-${uniq}${ext}`);
    }
});
const upload = multer({
    storage,
    limits: { fileSize: 30 * 1024 * 1024 } // 30 Mo
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// =========================================
//  Analyse d'un fichier reçu (Maquette)
// =========================================
const VECTOR_EXTS = new Set(['.svg', '.ai', '.eps', '.pdf', '.cdr']);
const VECTOR_MIMES = new Set(['image/svg+xml', 'application/postscript', 'application/pdf', 'application/illustrator']);

async function analyzeFile(filePath, originalName, mimeType, fileSize) {
    const ext = path.extname(originalName).toLowerCase();
    const isVector = VECTOR_EXTS.has(ext) || VECTOR_MIMES.has(mimeType);
    const poidsKo = Math.round(fileSize / 102.4) / 10; // 1 décimale

    let format = (ext || '').replace('.', '').toUpperCase() || (mimeType.split('/')[1] || 'inconnu').toUpperCase();

    const report = {
        format,
        vectoriel: isVector,
        dimensions: null,
        poids: poidsKo,
        fond_transparent: 'non_applicable',
        resolution_suffisante: null,
        nettete: null,
        artefacts_compression: false,
        fond_parasite: false,
        complexite: null,
        nombre_couleurs_estime: null,
        utilisable_impression: false,
        utilisable_web: false,
        score_global: 0,
        verdict_vendeuse: '',
        action_suggeree_client: null,
        note_interne_graphiste: ''
    };

    if (isVector) {
        // Fichier vectoriel : très peu de contrôles pixel, tout est bon a priori
        report.dimensions = null;
        report.fond_transparent = (ext === '.svg'); // heuristique
        report.resolution_suffisante = true;
        report.nettete = 'nette';
        report.artefacts_compression = false;
        report.fond_parasite = false;
        report.complexite = 'simple';
        report.nombre_couleurs_estime = null;
        report.utilisable_impression = true;
        report.utilisable_web = true;
        report.score_global = 10;
        report.verdict_vendeuse = 'Logo vectoriel parfait, utilisable tel quel.';
        report.action_suggeree_client = null;
        report.note_interne_graphiste = `Fichier ${format} vectoriel, ${poidsKo} Ko. Prêt pour production DTF.`;
        return report;
    }

    // Fichier raster : on utilise sharp
    try {
        const img = sharp(filePath, { failOn: 'none' });
        const meta = await img.metadata();
        const stats = await img.stats();

        const width = meta.width || 0;
        const height = meta.height || 0;
        report.dimensions = width && height ? `${width}x${height}` : null;

        const longSide = Math.max(width, height);
        report.resolution_suffisante = longSide >= 1000;

        // Fond transparent = présence d'un canal alpha avec variations
        if (meta.hasAlpha) {
            const alphaChannel = stats.channels[stats.channels.length - 1];
            const hasTransparency = alphaChannel && (alphaChannel.min < 250);
            report.fond_transparent = !!hasTransparency;
        } else {
            report.fond_transparent = false;
        }

        // Estimer le nombre de couleurs : on réduit à une palette 256 et on compte les uniques
        // Approche : downscale vers 100x100, extraire raw, compter couleurs uniques
        const { data, info } = await sharp(filePath, { failOn: 'none' })
            .removeAlpha()
            .resize(100, 100, { fit: 'inside' })
            .raw()
            .toBuffer({ resolveWithObject: true });
        const colors = new Set();
        for (let i = 0; i < data.length; i += info.channels) {
            // Quantize to 5-bit per channel (32 levels) -> capture clusters de couleurs
            const r = data[i] >> 3;
            const g = data[i + 1] >> 3;
            const b = data[i + 2] >> 3;
            colors.add((r << 10) | (g << 5) | b);
        }
        const colorCount = colors.size;
        report.nombre_couleurs_estime = colorCount;

        if (colorCount < 30) report.complexite = 'simple';
        else if (colorCount < 300) report.complexite = 'moyenne';
        else report.complexite = 'complexe';

        // Détection d'un fond parasite : si les 4 coins ont des couleurs très similaires
        // ET qu'on n'a pas de transparence, il y a probablement un fond
        if (!report.fond_transparent && width > 0 && height > 0) {
            const sampleSize = Math.min(20, Math.floor(Math.min(width, height) / 10) || 1);
            const corners = await sharp(filePath, { failOn: 'none' })
                .removeAlpha()
                .raw()
                .toBuffer({ resolveWithObject: true });
            const c = corners.info.channels;
            const w = corners.info.width;
            const h = corners.info.height;
            const getPixel = (x, y) => {
                const idx = (y * w + x) * c;
                return [corners.data[idx], corners.data[idx + 1], corners.data[idx + 2]];
            };
            const cornersPx = [
                getPixel(2, 2),
                getPixel(w - 3, 2),
                getPixel(2, h - 3),
                getPixel(w - 3, h - 3)
            ];
            const dist = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
            const maxDist = Math.max(
                dist(cornersPx[0], cornersPx[1]),
                dist(cornersPx[0], cornersPx[2]),
                dist(cornersPx[0], cornersPx[3])
            );
            // Si les 4 coins sont très proches, c'est probablement un fond uni
            report.fond_parasite = maxDist < 30;
        }

        // Netteté : heuristique basée sur l'écart-type des pixels
        // Un écart-type élevé = contraste/détails, un faible = flou/uni
        const avgStd = stats.channels.slice(0, 3).reduce((s, ch) => s + ch.stdev, 0) / 3;
        if (longSide < 500) report.nettete = 'pixelisee';
        else if (avgStd < 25) report.nettete = 'floue';
        else report.nettete = 'nette';

        // Artefacts de compression : JPEG avec petite taille/pixel = compressé
        if (format === 'JPG' || format === 'JPEG' || mimeType === 'image/jpeg') {
            const bytesPerPixel = fileSize / (width * height || 1);
            report.artefacts_compression = bytesPerPixel < 0.5;
        }

        // Utilisable impression : haute résolution + pas d'artefacts lourds
        report.utilisable_impression = longSide >= 1500 && !report.artefacts_compression;
        report.utilisable_web = longSide >= 400;

        // Score global
        let score = 0;
        if (report.resolution_suffisante) score += 2;
        if (longSide >= 2000) score += 1;
        if (report.fond_transparent || report.complexite === 'simple') score += 1;
        if (!report.fond_parasite) score += 1;
        if (report.nettete === 'nette') score += 2;
        else if (report.nettete === 'floue') score += 0;
        else score -= 1;
        if (!report.artefacts_compression) score += 1;
        if (report.utilisable_impression) score += 2;
        score = Math.max(0, Math.min(10, score));
        report.score_global = score;

        // Verdict vendeuse (langage simple)
        if (score >= 8) {
            report.verdict_vendeuse = 'Logo de bonne qualité, utilisable pour la production.';
            report.action_suggeree_client = null;
        } else if (score >= 5) {
            report.verdict_vendeuse = 'Logo correct mais perfectible, mieux vaut demander une meilleure version.';
            report.action_suggeree_client = 'Bonjour, pourriez-vous nous envoyer votre logo en version vectorielle (SVG ou AI) ou en haute résolution ? Cela garantira un rendu parfait à l\'impression. Merci !';
        } else {
            report.verdict_vendeuse = 'Logo insuffisant pour la production, demander impérativement une meilleure version.';
            report.action_suggeree_client = 'Bonjour, le fichier reçu n\'est pas exploitable pour l\'impression. Pourriez-vous nous transmettre le logo en version vectorielle (SVG, AI, EPS ou PDF) ou une image haute résolution (au moins 2000 px) avec fond transparent ? Merci !';
        }

        // Note interne graphiste
        const notes = [];
        notes.push(`${format} ${width}x${height}px, ${poidsKo} Ko`);
        if (report.fond_transparent) notes.push('fond transparent');
        else if (report.fond_parasite) notes.push('fond uni à détourer');
        if (report.artefacts_compression) notes.push('artefacts JPEG visibles');
        if (report.nettete !== 'nette') notes.push(`image ${report.nettete}`);
        notes.push(`${colorCount} couleurs estimées`);
        if (!report.utilisable_impression) notes.push('à revectoriser pour print');
        report.note_interne_graphiste = notes.join(' · ') + '.';

    } catch (e) {
        report.verdict_vendeuse = 'Impossible d\'analyser ce fichier, vérifier avec le graphiste.';
        report.note_interne_graphiste = `Analyse échouée : ${e.message}`;
        report.score_global = 0;
    }

    return report;
}

// =========================================
//  Routes HTTP maquettes (upload / download)
// =========================================
app.post('/api/maquettes', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'Aucun fichier' });
        const { client = '', description = '' } = req.body || {};
        const analysis = await analyzeFile(req.file.path, req.file.originalname, req.file.mimetype, req.file.size);

        db.run(
            `INSERT INTO maquettes (client, description, filename, original_name, mime_type, file_size, analysis) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [client, description, req.file.filename, req.file.originalname, req.file.mimetype, req.file.size, JSON.stringify(analysis)],
            function (err) {
                if (err) return res.status(500).json({ error: err.message });
                const maquette = {
                    id: this.lastID,
                    client,
                    description,
                    filename: req.file.filename,
                    original_name: req.file.originalname,
                    mime_type: req.file.mimetype,
                    file_size: req.file.size,
                    analysis,
                    status: 'en_attente',
                    created_at: new Date().toISOString()
                };
                io.emit('maquette_added', maquette);
                res.json(maquette);
            }
        );
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Téléchargement du fichier original à sa taille d'origine
app.get('/api/maquettes/:id/file', (req, res) => {
    const id = parseInt(req.params.id);
    db.get(`SELECT filename, original_name, mime_type FROM maquettes WHERE id = ?`, [id], (err, row) => {
        if (err || !row) return res.status(404).send('Introuvable');
        const filePath = path.join(UPLOAD_DIR, row.filename);
        if (!fs.existsSync(filePath)) return res.status(404).send('Fichier manquant');
        res.setHeader('Content-Type', row.mime_type || 'application/octet-stream');
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(row.original_name)}"`);
        fs.createReadStream(filePath).pipe(res);
    });
});

// Aperçu inline (image directe pour la preview)
app.get('/api/maquettes/:id/preview', (req, res) => {
    const id = parseInt(req.params.id);
    db.get(`SELECT filename, mime_type FROM maquettes WHERE id = ?`, [id], (err, row) => {
        if (err || !row) return res.status(404).send('Introuvable');
        const filePath = path.join(UPLOAD_DIR, row.filename);
        if (!fs.existsSync(filePath)) return res.status(404).send('Fichier manquant');
        res.setHeader('Content-Type', row.mime_type || 'application/octet-stream');
        fs.createReadStream(filePath).pipe(res);
    });
});

// =========================================
//  Socket.io
// =========================================
io.on('connection', (socket) => {
    console.log('Un utilisateur connecté:', socket.id);

    db.all(`SELECT * FROM requests WHERE archived = 0 ORDER BY id DESC`, [], (err, rows) => {
        if (!err) socket.emit('load_requests', rows);
    });

    db.all(`SELECT * FROM maquettes ORDER BY id DESC`, [], (err, rows) => {
        if (!err) {
            const parsed = rows.map(r => ({ ...r, analysis: r.analysis ? JSON.parse(r.analysis) : null }));
            socket.emit('load_maquettes', parsed);
        }
    });

    socket.on('add_request', (data) => {
        const { client, commande, logo, couleur, dimension, hauteur, quantite } = data;
        const papier_masquage = data.papier_masquage ? 1 : 0;
        const double_face_int = data.double_face_int ? 1 : 0;
        const double_face_ext = data.double_face_ext ? 1 : 0;
        const gabarit_carton = data.gabarit_carton ? 1 : 0;
        const stmt = db.prepare(`INSERT INTO requests (client, commande, logo, couleur, dimension, hauteur, quantite, papier_masquage, double_face_int, double_face_ext, gabarit_carton) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
        stmt.run([client, commande, logo, couleur, dimension, hauteur, quantite, papier_masquage, double_face_int, double_face_ext, gabarit_carton], function (err) {
            if (!err) {
                const newRequest = { id: this.lastID, client, commande, logo, couleur, dimension, hauteur, quantite, papier_masquage, double_face_int, double_face_ext, gabarit_carton, checked: 0, archived: 0, created_at: new Date().toISOString() };
                io.emit('request_added', newRequest);
            }
        });
        stmt.finalize();
    });

    socket.on('toggle_check', (data) => {
        const { id, checked } = data;
        db.run(`UPDATE requests SET checked = ? WHERE id = ?`, [checked ? 1 : 0, id], (err) => {
            if (!err) io.emit('request_updated', { id, checked: checked ? 1 : 0 });
        });
    });

    socket.on('delete_request', (id) => {
        db.run(`DELETE FROM requests WHERE id = ?`, [id], (err) => {
            if (!err) io.emit('request_deleted', id);
        });
    });

    // Suppression groupée (sélection multiple)
    socket.on('delete_requests', (ids) => {
        if (!Array.isArray(ids)) return;
        const clean = ids.map(n => parseInt(n, 10)).filter(Number.isInteger);
        if (clean.length === 0) return;
        const placeholders = clean.map(() => '?').join(',');
        db.run(`DELETE FROM requests WHERE id IN (${placeholders})`, clean, (err) => {
            if (!err) io.emit('requests_deleted', clean);
        });
    });

    socket.on('update_request', (data) => {
        const { id, client, commande, logo, couleur, dimension, hauteur, quantite } = data;
        const papier_masquage = data.papier_masquage ? 1 : 0;
        const double_face_int = data.double_face_int ? 1 : 0;
        const double_face_ext = data.double_face_ext ? 1 : 0;
        const gabarit_carton = data.gabarit_carton ? 1 : 0;
        db.run(
            `UPDATE requests SET client=?, commande=?, logo=?, couleur=?, dimension=?, hauteur=?, quantite=?, papier_masquage=?, double_face_int=?, double_face_ext=?, gabarit_carton=? WHERE id=?`,
            [client, commande, logo, couleur, dimension, hauteur, quantite, papier_masquage, double_face_int, double_face_ext, gabarit_carton, id],
            (err) => {
                if (!err) io.emit('request_edited', { id, client, commande, logo, couleur, dimension, hauteur, quantite, papier_masquage, double_face_int, double_face_ext, gabarit_carton });
            }
        );
    });

    socket.on('archive_production', () => {
        db.run(`UPDATE requests SET archived = 1 WHERE checked = 1 AND archived = 0`, function (err) {
            if (!err) io.emit('production_archived');
        });
    });

    socket.on('archive_single', (id) => {
        db.run(`UPDATE requests SET archived = 1 WHERE id = ?`, [id], (err) => {
            if (!err) io.emit('request_archived_single', id);
        });
    });

    socket.on('get_print_data', () => {
        db.all(`SELECT * FROM requests WHERE checked = 1 AND archived = 0 ORDER BY id DESC`, [], (err, rows) => {
            if (!err) socket.emit('print_data_ready', rows);
        });
    });

    // ---- Archives ----
    socket.on('get_archived_requests', () => {
        db.all(`SELECT * FROM requests WHERE archived = 1 ORDER BY created_at DESC, id DESC`, [], (err, rows) => {
            if (!err) socket.emit('archived_requests', rows);
        });
    });

    socket.on('restore_request', (id) => {
        db.run(`UPDATE requests SET archived = 0, checked = 0 WHERE id = ?`, [id], (err) => {
            if (!err) {
                db.get(`SELECT * FROM requests WHERE id = ?`, [id], (err2, row) => {
                    if (!err2 && row) io.emit('request_restored', row);
                });
            }
        });
    });

    socket.on('delete_archived', (id) => {
        db.run(`DELETE FROM requests WHERE id = ? AND archived = 1`, [id], (err) => {
            if (!err) io.emit('archived_deleted', id);
        });
    });

    // ---- Maquettes ----
    socket.on('delete_maquette', (id) => {
        db.get(`SELECT filename FROM maquettes WHERE id = ?`, [id], (err, row) => {
            if (!err && row) {
                const fp = path.join(UPLOAD_DIR, row.filename);
                if (fs.existsSync(fp)) { try { fs.unlinkSync(fp); } catch(_){} }
            }
            db.run(`DELETE FROM maquettes WHERE id = ?`, [id], (err2) => {
                if (!err2) io.emit('maquette_deleted', id);
            });
        });
    });

    socket.on('update_maquette_status', ({ id, status }) => {
        db.run(`UPDATE maquettes SET status = ? WHERE id = ?`, [status, id], (err) => {
            if (!err) io.emit('maquette_status_changed', { id, status });
        });
    });

    socket.on('disconnect', () => {
        console.log('Déconnexion:', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Serveur en ligne sur http://localhost:${PORT}`);
});
