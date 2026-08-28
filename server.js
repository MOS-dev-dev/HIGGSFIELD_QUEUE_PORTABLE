process.env.TZ = process.env.TZ || 'Asia/Ho_Chi_Minh';
import express from 'express';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import fs from 'fs';
import https from 'https';
import httpModule from 'http';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { promisify } from 'util';
import puppeteer from 'puppeteer-core';
import { video_generate, resolveToHostPath, sanitizePrompt } from './video_generate.js';
import { runCliTask, estimateCost, getAccountCredits, CLI_VIDEO_MODELS } from './cli_generate.js';

const execAsync = promisify(exec);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3100;
const CDP_HOST = process.env.CDP_HOST || '127.0.0.1';
const CDP_PORT = parseInt(process.env.CDP_PORT || '9333', 10);
const DB_PATH = path.join(__dirname, 'queue_db.json');
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const DOWNLOAD_DIR = path.join(__dirname, 'downloads');
const LOG_DIR = path.join(__dirname, 'logs');
const LOG_KEEP_DAYS = parseInt(process.env.LOG_KEEP_DAYS || '30', 10);

let lastLiveScreenshot = null;

// Đảm bảo thư mục uploads, downloads, logs tồn tại
if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}
if (!fs.existsSync(DOWNLOAD_DIR)) {
    fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
}
if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
}

// =========================================================================
// HỆ THỐNG GHI LOG FILE (xoay theo ngày, giữ tối đa LOG_KEEP_DAYS ngày)
// =========================================================================
let _logStream = null;
let _logStreamDate = null;

function getLogFilePath(date) {
    const d = date || new Date();
    const ymd = d.toISOString().slice(0, 10); // YYYY-MM-DD (UTC để đồng nhất)
    return path.join(LOG_DIR, `${ymd}.log`);
}

function getLogStream() {
    const today = new Date().toISOString().slice(0, 10);
    if (_logStreamDate !== today) {
        // Đóng stream cũ nếu có
        if (_logStream) { try { _logStream.end(); } catch (_) {} }
        // Mở stream mới cho ngày hôm nay (append)
        _logStream = fs.createWriteStream(getLogFilePath(), { flags: 'a', encoding: 'utf-8' });
        _logStreamDate = today;
        // Xóa log cũ hơn LOG_KEEP_DAYS ngày
        cleanOldLogs();
    }
    return _logStream;
}

function cleanOldLogs() {
    try {
        const cutoff = Date.now() - LOG_KEEP_DAYS * 24 * 60 * 60 * 1000;
        const files = fs.readdirSync(LOG_DIR).filter(f => /^\d{4}-\d{2}-\d{2}\.log$/.test(f));
        for (const file of files) {
            const filePath = path.join(LOG_DIR, file);
            const mtime = fs.statSync(filePath).mtimeMs;
            if (mtime < cutoff) {
                fs.unlinkSync(filePath);
            }
        }
    } catch (_) {}
}

function writeLogLine(level, message, source) {
    try {
        const stream = getLogStream();
        const ts = new Date().toISOString(); // UTC ISO
        const line = `${ts} [${level.toUpperCase()}] [${source}] ${message}\n`;
        stream.write(line);
    } catch (_) {}
}

// =========================================================================
// THƯ MỤC LƯU VIDEO KẾT QUẢ (SAMBA-accessible)
// =========================================================================
const VIDEO_SAVE_DIR = process.env.VIDEO_SAVE_DIR || '/mnt/Data-ReadOnly/media_team/higgfield-queue';
if (!fs.existsSync(VIDEO_SAVE_DIR)) {
    try { fs.mkdirSync(VIDEO_SAVE_DIR, { recursive: true }); } catch (e) {
        console.warn('⚠️ Không thể tạo VIDEO_SAVE_DIR:', e.message);
    }
}

/**
 * Sanitize tên thư mục: giữ chữ, số, dấu cách, gạch ngang, gạch dưới, dấu chấm
 * Cắt tối đa 60 ký tự để tránh đường dẫn quá dài
 */
function sanitizeFolderName(name) {
    if (!name || !name.trim()) return null;
    return name.trim()
        .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')  // ký tự không hợp lệ
        .replace(/\s+/g, ' ')                       // nhiều space → 1 space
        .replace(/\.{2,}/g, '.')                    // .. → .
        .trim()
        .substring(0, 60);
}

/**
 * Tải video từ CDN về thư mục cục bộ
 * Đường dẫn: VIDEO_SAVE_DIR/{creator}/{taskName}/{YYYYMMDD_HHmmss_XXXX}.mp4
 */
async function downloadAndSaveVideo(task, videoUrl) {
    try {
        const creator = sanitizeFolderName(task.creator) || 'Unknown';
        const taskFolder = sanitizeFolderName(task.taskName) || ('task_' + task.id.slice(-4));

        const saveDir = path.join(VIDEO_SAVE_DIR, creator, taskFolder);
        if (!fs.existsSync(saveDir)) {
            fs.mkdirSync(saveDir, { recursive: true });
        }

        // Tên file: YYYYMMDD_HHmmss_XXXX.mp4
        const now = new Date();
        const pad = n => String(n).padStart(2, '0');
        const dateStr = `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}`;
        const timeStr = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
        const rand = Math.random().toString(36).substr(2, 4).toUpperCase();
        const filename = `${dateStr}_${timeStr}_${rand}.mp4`;
        const savePath = path.join(saveDir, filename);

        // Tải file từ CDN — dùng https/httpModule đã import ở top
        const protocol = videoUrl.startsWith('https') ? https : httpModule;

        await new Promise((resolve, reject) => {
            const file = fs.createWriteStream(savePath);
            const req = protocol.get(videoUrl, { timeout: 120000 }, (response) => {
                if (response.statusCode === 301 || response.statusCode === 302) {
                    file.close();
                    fs.unlink(savePath, () => {});
                    // Follow redirect
                    const redirectUrl = response.headers.location;
                    const proto2 = redirectUrl.startsWith('https') ? https : httpModule;
                    const file2 = fs.createWriteStream(savePath);
                    proto2.get(redirectUrl, (res2) => {
                        res2.pipe(file2);
                        file2.on('finish', () => file2.close(resolve));
                        file2.on('error', (e) => { fs.unlink(savePath, () => {}); reject(e); });
                    }).on('error', reject);
                    return;
                }
                if (response.statusCode !== 200) {
                    file.close();
                    fs.unlink(savePath, () => {});
                    return reject(new Error(`HTTP ${response.statusCode}`));
                }
                response.pipe(file);
                file.on('finish', () => file.close(resolve));
                file.on('error', (err) => { fs.unlink(savePath, () => {}); reject(err); });
            });
            req.on('error', (err) => { fs.unlink(savePath, () => {}); reject(err); });
            req.on('timeout', () => { req.destroy(); reject(new Error('Download timeout')); });
        });

        // Đường dẫn local để serve qua web
        const localWebPath = `/saved-videos/${encodeURIComponent(creator)}/${encodeURIComponent(taskFolder)}/${encodeURIComponent(filename)}`;
        return { savePath, localWebPath, filename };
    } catch (err) {
        console.error('❌ downloadAndSaveVideo lỗi:', err.message);
        return null;
    }
}

const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server, {
    cors: { origin: '*' }
});

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Phục vụ static files từ public, uploads và downloads
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOAD_DIR));
app.use('/downloads', express.static(DOWNLOAD_DIR));
app.use('/saved-videos', express.static(VIDEO_SAVE_DIR, {
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.mp4')) {
            res.setHeader('Content-Type', 'video/mp4');
            res.setHeader('Content-Disposition', 'inline');
        }
    }
}));

// Lightweight Multipart/Form-Data Parser Middleware (không cần phụ thuộc ngoài)
app.use((req, res, next) => {
    const contentType = req.headers['content-type'] || '';
    if (!contentType.includes('multipart/form-data')) {
        return next();
    }

    const match = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
    if (!match) return next();

    const boundary = match[1] || match[2];
    const chunks = [];

    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
        try {
            const buffer = Buffer.concat(chunks);
            const boundaryBuffer = Buffer.from(`--${boundary}`);
            const parts = splitBuffer(buffer, boundaryBuffer);

            req.body = req.body || {};
            req.files = [];

            for (const part of parts) {
                if (part.length === 0 || part.equals(Buffer.from('--\r\n')) || part.equals(Buffer.from('--'))) continue;

                const headerEndIndex = part.indexOf('\r\n\r\n');
                if (headerEndIndex === -1) continue;

                const headerStr = part.slice(0, headerEndIndex).toString('utf-8');
                let bodyBuffer = part.slice(headerEndIndex + 4);

                // Loại bỏ CRLF cuối body nếu có
                if (bodyBuffer.length >= 2 && bodyBuffer[bodyBuffer.length - 2] === 13 && bodyBuffer[bodyBuffer.length - 1] === 10) {
                    bodyBuffer = bodyBuffer.slice(0, bodyBuffer.length - 2);
                }

                const dispMatch = headerStr.match(/Content-Disposition:\s*form-data;\s*name="([^"]+)"(?:;\s*filename="([^"]+)")?/i);
                if (!dispMatch) continue;

                const fieldName = dispMatch[1];
                const fileName = dispMatch[2];

                if (fileName) {
                    if (bodyBuffer.length > 0) {
                        const safeName = `upload_${Date.now()}_${Math.random().toString(36).slice(2, 6)}_${path.basename(fileName).replace(/[^a-zA-Z0-9._-]/g, '_')}`;
                        const savedPath = path.join(UPLOAD_DIR, safeName);
                        fs.writeFileSync(savedPath, bodyBuffer);
                        const fileInfo = {
                            fieldname: fieldName,
                            originalname: fileName,
                            filename: safeName,
                            path: savedPath,
                            size: bodyBuffer.length
                        };
                        req.files.push(fileInfo);
                        req.file = fileInfo;
                    }
                } else {
                    req.body[fieldName] = bodyBuffer.toString('utf-8');
                }
            }
            next();
        } catch (e) {
            console.error('Lỗi phân tích multipart body:', e.message);
            next();
        }
    });
});

function splitBuffer(buf, delimiter) {
    const arr = [];
    let cur = 0;
    while (cur < buf.length) {
        const index = buf.indexOf(delimiter, cur);
        if (index === -1) {
            arr.push(buf.slice(cur));
            break;
        }
        arr.push(buf.slice(cur, index));
        cur = index + delimiter.length;
        if (buf.slice(cur, cur + 2).equals(Buffer.from('\r\n'))) {
            cur += 2;
        }
    }
    return arr;
}

// Trạng thái Queue toàn cục
let state = {
    isRunning: false,
    isPaused: false,
    currentTaskId: null,
    queue: [],
    // CLI Credit Mode
    cliRunningCount: 0,         // số job CLI đang chạy song song
    cliMaxParallel: parseInt(process.env.CLI_MAX_PARALLEL || '20', 10),
    _cdpDownloadPromise: null,      // chỉ CDP dùng để đồng bộ download giữa 2 task liên tiếp
    _cdpDownloadingTaskId: null     // CLI KHÔNG dùng — CLI download hoàn toàn độc lập
};

// Mutex & AbortController điều khiển tiến trình chạy
let isProcessing = false;
let currentAbortController = null;
// Map jobId → AbortController cho các job CLI đang chạy song song
const cliAbortControllers = new Map();
let lastCdpStatus = {
    connected: false,
    host: CDP_HOST,
    port: CDP_PORT,
    version: null,
    checkedAt: null
};

// Helper chuyển đổi Base64 Data URL thành file trong ./uploads
function saveBase64Image(dataUriOrBase64, originalName = 'reference.png') {
    try {
        let base64Data = dataUriOrBase64;
        let ext = 'png';

        const match = dataUriOrBase64.match(/^data:image\/([a-zA-Z0-9+]+);base64,(.+)$/);
        if (match) {
            ext = match[1].replace('jpeg', 'jpg');
            base64Data = match[2];
        } else if (originalName && originalName.includes('.')) {
            ext = originalName.split('.').pop().toLowerCase();
        }

        const fileName = `upload_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.${ext}`;
        const filePath = path.join(UPLOAD_DIR, fileName);
        const buffer = Buffer.from(base64Data, 'base64');
        fs.writeFileSync(filePath, buffer);
        return filePath;
    } catch (err) {
        console.error('Lỗi lưu ảnh Base64:', err.message);
        return null;
    }
}

// Tính toán và định dạng thời gian chạy thực tế
function formatExecutionDuration(startedAt, completedAt) {
    if (!startedAt || !completedAt) return '';
    const diffMs = new Date(completedAt).getTime() - new Date(startedAt).getTime();
    if (diffMs < 0) return '';
    const totalSec = Math.floor(diffMs / 1000);
    const hrs = Math.floor(totalSec / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    const secs = totalSec % 60;
    if (hrs > 0) return `${hrs}h ${mins}m ${secs}s`;
    if (mins > 0) return `${mins}m ${secs}s`;
    return `${secs}s`;
}

// Tải dữ liệu từ database file queue_db.json
function loadDB() {
    if (fs.existsSync(DB_PATH)) {
        try {
            const raw = fs.readFileSync(DB_PATH, 'utf-8');
            const data = JSON.parse(raw);
            if (Array.isArray(data.queue)) {
                // Phục hồi các task bị dở dang (running) khi server khởi động lại
                state.queue = data.queue.map(task => {
                    if (task.status === 'running') {
                        return {
                            ...task,
                            status: 'pending',
                            progress: 0,
                            currentStep: 'Khởi động lại sau sự cố (Restored to pending)'
                        };
                    }
                    if (!task.executionTime && task.startedAt && task.completedAt) {
                        task.executionTime = formatExecutionDuration(task.startedAt, task.completedAt);
                    }
                    return task;
                });
            }
        } catch (e) {
            console.error("Lỗi đọc DB file, tạo DB mới:", e.message);
        }
    }
}

// Lưu dữ liệu vào database file
function saveDB() {
    try {
        fs.writeFileSync(DB_PATH, JSON.stringify({ queue: state.queue }, null, 2), 'utf-8');
    } catch (e) {
        console.error("Lỗi ghi DB file:", e.message);
    }
}

loadDB();

// Log Broadcaster
function broadcastLog(level, message, source = 'system') {
    const now = new Date();
    const date = now.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const time = now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    const timestamp = `${date} ${time}`;
    const logItem = { timestamp, level, message, source };
    console.log(`[${time}] [${level.toUpperCase()}] ${message}`);
    io.emit('log', logItem);
    // Ghi vào file log
    writeLogLine(level, message, source);
}

// Tính toán thống kê hàng chờ
function getQueueStats() {
    const total = state.queue.length;
    const pending = state.queue.filter(t => t.status === 'pending').length;
    const running = state.queue.filter(t => t.status === 'running').length;
    const completed = state.queue.filter(t => t.status === 'completed').length;
    const failed = state.queue.filter(t => t.status === 'failed').length;
    return { total, pending, running, completed, failed };
}

// Broadcast Queue State
function broadcastState() {
    saveDB();
    const currentTask = state.queue.find(t => t.id === state.currentTaskId) || null;
    const stats = getQueueStats();

    io.emit('queue_state', {
        isRunning: state.isRunning,
        isPaused: state.isPaused,
        currentTaskId: state.currentTaskId,
        currentTask,
        stats,
        tasks: state.queue,
        queue: state.queue
    });
}

function fetchCdpInfo(host, port) {
    return new Promise((resolve, reject) => {
        const req = http.get({
            host: host,
            port: port,
            path: '/json/version',
            headers: { 'Host': `127.0.0.1:${port}` },
            timeout: 2500
        }, (res) => {
            if (res.statusCode !== 200) {
                return reject(new Error(`HTTP ${res.statusCode}`));
            }
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    reject(e);
                }
            });
        });
        req.on('error', reject);
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('ETIMEDOUT'));
        });
    });
}

// CDP Health Check & Broadcast
async function checkCdpStatus() {
    try {
        const info = await fetchCdpInfo(CDP_HOST, CDP_PORT);
        lastCdpStatus = {
            connected: true,
            host: CDP_HOST,
            port: CDP_PORT,
            version: info.Browser || info['User-Agent'] || 'Chrome CDP Ready',
            checkedAt: new Date().toISOString()
        };
    } catch (err) {
        lastCdpStatus = {
            connected: false,
            host: CDP_HOST,
            port: CDP_PORT,
            error: err.message,
            checkedAt: new Date().toISOString()
        };
    }

    io.emit('cdp_status', lastCdpStatus);
    return lastCdpStatus;
}

// Poller định kỳ kiểm tra CDP mỗi 5 giây
setInterval(checkCdpStatus, 5000);
checkCdpStatus().catch(() => {});

// Live Stream Broadcaster khi Idle (khi không có task đang chạy)
let isCapturingIdle = false;
async function captureIdleScreenshot() {
    if (isProcessing || isCapturingIdle || !lastCdpStatus.connected) return;
    isCapturingIdle = true;
    let browser = null;
    try {
        const info = await fetchCdpInfo(CDP_HOST, CDP_PORT);
        if (!info || !info.webSocketDebuggerUrl) return;

        let wsUrl = info.webSocketDebuggerUrl;
        try {
            const urlObj = new URL(wsUrl);
            urlObj.hostname = CDP_HOST;
            urlObj.port = String(CDP_PORT);
            wsUrl = urlObj.toString();
        } catch (e) {}

        browser = await puppeteer.connect({
            browserWSEndpoint: wsUrl,
            headers: { Host: `127.0.0.1:${CDP_PORT}` },
            defaultViewport: null
        });

        const pages = await browser.pages();
        const page = pages.find((p) => {
            try { return p.url().includes('higgsfield.ai'); } catch { return false; }
        }) || (pages.length > 0 ? pages[0] : null);

        if (page && !page.isClosed()) {
            const b64 = await page.screenshot({ encoding: 'base64', type: 'jpeg', quality: 50 });
            lastLiveScreenshot = `data:image/jpeg;base64,${b64}`;
            io.emit('live_preview', {
                screenshot: lastLiveScreenshot,
                image: lastLiveScreenshot
            });
        }
    } catch (err) {
        // Bỏ qua lỗi chụp khi idle
    } finally {
        if (browser) {
            try { browser.disconnect(); } catch (e) {}
        }
        isCapturingIdle = false;
    }
}

// Tự động quét và đồng bộ các link video đã hoàn thành từ Feed Higgsfield về Database
let isSyncingVideos = false;
async function syncCompletedVideosFromFeed() {
    if (isSyncingVideos || isProcessing || !lastCdpStatus.connected) return 0;
    
    // Kiểm tra xem có task nào hoàn thành nhưng thiếu videoUrl không
    const pendingSyncTasks = state.queue.filter(t => t.status === 'completed' && !t.videoUrl);
    if (pendingSyncTasks.length === 0) return 0;
    
    isSyncingVideos = true;
    let browser = null;
    let syncedCount = 0;
    try {
        const info = await fetchCdpInfo(CDP_HOST, CDP_PORT);
        if (!info || !info.webSocketDebuggerUrl) return 0;

        let wsUrl = info.webSocketDebuggerUrl;
        try {
            const urlObj = new URL(wsUrl);
            urlObj.hostname = CDP_HOST;
            urlObj.port = String(CDP_PORT);
            wsUrl = urlObj.toString();
        } catch (e) {}

        browser = await puppeteer.connect({
            browserWSEndpoint: wsUrl,
            headers: { Host: `127.0.0.1:${CDP_PORT}` },
            defaultViewport: null
        });

        const pages = await browser.pages();
        const page = pages.find((p) => {
            try { return p.url().includes('higgsfield.ai'); } catch { return false; }
        }) || (pages.length > 0 ? pages[0] : null);

        if (page && !page.isClosed()) {
            const feedVideos = await page.evaluate(() => {
                const cards = Array.from(document.querySelectorAll('[data-asset-id], [data-cinematic-cell-id]'));
                const seen = new Set();
                const list = [];
                for (const card of cards) {
                    const assetId = card.getAttribute('data-asset-id') || card.getAttribute('data-cinematic-cell-id');
                    if (!assetId || seen.has(assetId)) continue;
                    seen.add(assetId);
                    
                    let videoUrl = null;
                    const vid = card.querySelector('video');
                    if (vid && vid.src && !vid.src.includes('static.higgsfield.ai') && !vid.src.includes('blob:')) {
                        videoUrl = vid.src;
                    }
                    if (!videoUrl) {
                        const img = card.querySelector('img');
                        const src = img ? (img.src || img.getAttribute('src') || '') : '';
                        const match = src.match(/user_([^\/]+)\/hf_([a-zA-Z0-9_-]+)_thumbnail/);
                        if (match) {
                            videoUrl = `https://d8j0ntlcm91z4.cloudfront.net/user_${match[1]}/hf_${match[2]}.mp4`;
                        }
                    }
                    if (videoUrl) {
                        list.push({ assetId, videoUrl });
                    }
                }
                return list;
            });

            if (Array.isArray(feedVideos) && feedVideos.length > 0) {
                // Lọc bỏ những video đã được gán cho task khác
                const assignedUrls = new Set(state.queue.map(t => t.videoUrl).filter(Boolean));
                const availableVideos = feedVideos.filter(v => !assignedUrls.has(v.videoUrl));

                for (let i = 0; i < pendingSyncTasks.length; i++) {
                    const task = pendingSyncTasks[i];
                    if (i < availableVideos.length) {
                        const matched = availableVideos[i];
                        if (matched && matched.videoUrl) {
                            task.videoUrl = matched.videoUrl;
                            task.videoSrc = matched.videoUrl;
                            task.currentStep = 'Hoàn tất thành công! Đã có link video.';
                            syncedCount++;
                            broadcastLog('success', `🎬 [ĐỒNG BỘ LINK] Đã tự động thu thập link video cho Task [${task.id}]: ${matched.videoUrl}`);
                        }
                    }
                }
                if (syncedCount > 0) {
                    saveDB();
                    broadcastState();
                }
            }
        }
    } catch (e) {
    } finally {
        if (browser) {
            try { browser.disconnect(); } catch (e) {}
        }
        isSyncingVideos = false;
    }
    return syncedCount;
}

// Chụp cập nhật màn hình Live Stream định kỳ mỗi 3 giây
setInterval(captureIdleScreenshot, 3000);
// Tự động quét đồng bộ video link mỗi 15 giây
setInterval(syncCompletedVideosFromFeed, 15000);

// =========================================================================
// REST API ENDPOINTS
// =========================================================================

// Đồng bộ thủ công các link video từ Feed
app.post(['/api/queue/sync-videos', '/api/tasks/sync-videos'], async (req, res) => {
    try {
        const count = await syncCompletedVideosFromFeed();
        res.json({ success: true, syncedCount: count });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Lấy danh sách hàng chờ & trạng thái
app.get(['/api/queue', '/api/tasks'], (req, res) => {
    const currentTask = state.queue.find(t => t.id === state.currentTaskId) || null;
    res.json({
        isRunning: state.isRunning,
        isPaused: state.isPaused,
        currentTaskId: state.currentTaskId,
        currentTask,
        stats: getQueueStats(),
        tasks: state.queue,
        queue: state.queue
    });
});

// Kiểm tra trạng thái kết nối Chrome CDP
app.get('/api/cdp/status', async (req, res) => {
    const status = await checkCdpStatus();
    res.json(status);
});

// Lấy ảnh Live Stream hiện tại
app.get('/api/cdp/live-preview', (req, res) => {
    res.json({
        screenshot: lastLiveScreenshot
    });
});

// Endpoint Upload File ảnh riêng lẻ
app.post('/api/upload', (req, res) => {
    if (req.file) {
        return res.json({
            success: true,
            filePath: req.file.path,
            filename: req.file.filename,
            url: `/uploads/${req.file.filename}`
        });
    }

    const { imageData, imageBase64, imageName } = req.body || {};
    const rawImage = imageData || imageBase64;
    if (rawImage) {
        const savedPath = saveBase64Image(rawImage, imageName || 'upload.png');
        if (savedPath) {
            const filename = path.basename(savedPath);
            return res.json({
                success: true,
                filePath: savedPath,
                filename: filename,
                url: `/uploads/${filename}`
            });
        }
    }

    res.status(400).json({ error: "Không tìm thấy dữ liệu ảnh upload" });
});

// Thêm task đơn lẻ
app.post(['/api/queue/add', '/api/tasks'], (req, res) => {
    const { prompt, creator, model, duration, aspectRatio, resolution, unlimited } = req.body || {};
    let imagePaths = [];
    if (req.body?.imagePaths) {
        imagePaths = Array.isArray(req.body.imagePaths) ? req.body.imagePaths : [req.body.imagePaths];
    } else if (req.body?.imagePath) {
        imagePaths = req.body.imagePath.split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
    }

    let videoPaths = [];
    if (req.body?.videoPaths) {
        videoPaths = Array.isArray(req.body.videoPaths) ? req.body.videoPaths : [req.body.videoPaths];
    } else if (req.body?.videoPath) {
        videoPaths = req.body.videoPath.split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
    }

    const rawImageData = req.body?.imageData || req.body?.imageBase64 || null;

    const sanitizedPrompt = sanitizePrompt(prompt || '');
    if (!sanitizedPrompt) {
        return res.status(400).json({ error: "Prompt không được để trống sau khi làm sạch" });
    }

    // Phân loại các file tải lên qua multipart theo đúng thứ tự FIFO xuất hiện
    if (req.files && req.files.length > 0) {
        for (const file of req.files) {
            const ext = path.extname(file.originalname || file.filename).toLowerCase();
            const isVideo = ['.mp4', '.webm', '.mov', '.avi', '.mkv'].includes(ext) || file.fieldname === 'video' || file.fieldname === 'videos';
            if (isVideo) {
                videoPaths.push(file.path);
            } else {
                imagePaths.push(file.path);
            }
        }
    } else if (rawImageData && imagePaths.length === 0) {
        const savedPath = saveBase64Image(rawImageData, req.body?.imageName || 'image.png');
        if (savedPath) imagePaths.push(savedPath);
    }

    const creatorName = creator ? creator.trim() : null;
    const taskNameRaw = (req.body?.taskName || '').trim() || null;
    const creditMode  = req.body?.creditMode === true || req.body?.creditMode === 'true';
    const cliModel    = (req.body?.cliModel || 'seedance_2_5').trim();

    const newTask = {
        id: 'task_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
        creator: creatorName,
        taskName: taskNameRaw,
        prompt: sanitizedPrompt,
        imagePath: imagePaths.length > 0 ? imagePaths[0] : null,
        imagePaths: imagePaths.length > 0 ? imagePaths : null,
        videoPath: videoPaths.length > 0 ? videoPaths[0] : null,
        videoPaths: videoPaths.length > 0 ? videoPaths : null,
        model: model || "Seedance 2.5",
        duration: duration || null,
        aspectRatio: aspectRatio || "16:9",
        resolution: resolution || "720p",
        unlimited: unlimited !== undefined ? (unlimited === true || unlimited === 'true') : true,
        // CLI Credit Mode fields
        creditMode: creditMode,
        cliModel: creditMode ? cliModel : undefined,
        creditCost: null,
        cliJobId: null,
        status: 'pending',
        progress: 0,
        currentStep: '',
        retries: 0,
        createdAt: new Date().toISOString()
    };

    state.queue.push(newTask);
    broadcastState();
    const creatorLog = creatorName ? ` [Bởi: ${creatorName}]` : '';
    const modeLog = creditMode ? ` 🪙 [Credit/${cliModel}]` : '';
    broadcastLog('info', `Đã thêm task mới vào Queue${creatorLog}${modeLog}: "${newTask.prompt.slice(0, 35)}..."`);
    // Kích hoạt CLI queue ngay nếu task là credit mode và queue đang chạy
    if (creditMode && state.isRunning && !state.isPaused) {
        setTimeout(processCliQueue, 100);
    }
    res.json({ success: true, task: newTask });
});

// Thêm hàng loạt task (Bulk Add)
app.post(['/api/queue/bulk-add', '/api/tasks/bulk'], (req, res) => {
    const { prompts, options = {} } = req.body || {};
    if (!Array.isArray(prompts) || prompts.length === 0) {
        return res.status(400).json({ error: "Danh sách prompt rỗng" });
    }

    const addedTasks = [];
    prompts.forEach(p => {
        const rawText = typeof p === 'string' ? p : (p.prompt ? p.prompt : '');
        const text = sanitizePrompt(rawText);
        if (!text) return;

        let img = p.imagePath || options.imagePath || null;
        if (p.imageData || p.imageBase64) {
            const saved = saveBase64Image(p.imageData || p.imageBase64, p.imageName || 'bulk_img.png');
            if (saved) img = saved;
        }

        const creatorName = (p.creator || options.creator || '').trim() || null;
        const taskNameBulk = (p.taskName || options.taskName || '').trim() || null;
        const creditModeBulk = !!(p.creditMode || options.creditMode);
        const cliModelBulk = (p.cliModel || options.cliModel || 'seedance_2_5').trim();

        const newTask = {
            id: 'task_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
            creator: creatorName,
            taskName: taskNameBulk,
            prompt: text,
            imagePath: img,
            model: p.model || options.model || "Seedance 2.5",
            duration: p.duration || options.duration || null,
            aspectRatio: p.aspectRatio || options.aspectRatio || "16:9",
            resolution: p.resolution || options.resolution || "720p",
            unlimited: p.unlimited !== undefined ? p.unlimited : (options.unlimited !== undefined ? options.unlimited : true),
            creditMode: creditModeBulk,
            cliModel: creditModeBulk ? cliModelBulk : undefined,
            creditCost: null,
            cliJobId: null,
            status: 'pending',
            progress: 0,
            currentStep: '',
            retries: 0,
            createdAt: new Date().toISOString()
        };
        state.queue.push(newTask);
        addedTasks.push(newTask);
    });

    broadcastState();
    const creditCount = addedTasks.filter(t => t.creditMode).length;
    const modeLog = creditCount > 0 ? ` (${creditCount} credit mode)` : '';
    broadcastLog('info', `Đã import hàng loạt ${addedTasks.length} task mới vào Queue${modeLog}.`);
    // Kích hoạt CLI queue nếu có credit task
    if (creditCount > 0 && state.isRunning && !state.isPaused) {
        setTimeout(processCliQueue, 100);
    }
    res.json({ success: true, count: addedTasks.length, tasks: addedTasks });
});

// Điều khiển hàng chờ qua endpoint tổng quát
app.post('/api/queue/control', (req, res) => {
    const { action } = req.body || {}; // start, pause, stop, clearCompleted
    handleQueueControl(action);
    res.json({ success: true, isRunning: state.isRunning, isPaused: state.isPaused });
});

// Các endpoint điều khiển chuẩn RESTful theo PROJECT.md
app.post('/api/queue/start', (req, res) => {
    handleQueueControl('start');
    res.json({ success: true, isRunning: state.isRunning });
});

app.post('/api/queue/pause', (req, res) => {
    handleQueueControl('pause');
    res.json({ success: true, isPaused: state.isPaused });
});

app.post('/api/queue/stop', (req, res) => {
    handleQueueControl('stop');
    res.json({ success: true, isRunning: false });
});

app.delete('/api/tasks/completed', (req, res) => {
    handleQueueControl('clearCompleted');
    res.json({ success: true, count: state.queue.length });
});

function handleQueueControl(action) {
    if (action === 'start') {
        state.isPaused = false;
        if (!state.isRunning) {
            state.isRunning = true;
            broadcastLog('success', '▶️ Đã KÍCH HOẠT chạy Hàng chờ (Queue Started).');
            processQueueLoop();
            processCliQueue();   // Kích hoạt CLI Credit Mode song song
        } else {
            broadcastLog('info', '▶️ Hàng chờ đang tiếp tục xử lý.');
            processQueueLoop();
            processCliQueue();   // Tiếp tục CLI Credit Mode
        }
    } else if (action === 'pause') {
        state.isRunning = false;
        state.isPaused = true;
        broadcastLog('warning', '⏸️ Đã TẠM DỪNG Hàng chờ (Queue Paused).');
    } else if (action === 'stop') {
        state.isRunning = false;
        state.isPaused = false;
        if (currentAbortController) {
            try {
                currentAbortController.abort();
            } catch (e) {}
        }
        state.currentTaskId = null;
        broadcastLog('error', '⏹️ Đã DỪNG Hàng chờ và hủy task đang thực thi.');
    } else if (action === 'clearCompleted') {
        state.queue = state.queue.filter(t => t.status !== 'completed');
        broadcastLog('info', '🧹 Đã dọn dẹp các task đã hoàn thành khỏi danh sách.');
    }
    broadcastState();
}

// Xóa task cụ thể
app.delete(['/api/queue/task/:id', '/api/tasks/:id'], (req, res) => {
    const { id } = req.params;
    if (state.currentTaskId === id && currentAbortController) {
        try {
            currentAbortController.abort();
        } catch (e) {}
    }
    state.queue = state.queue.filter(t => t.id !== id);
    broadcastState();
    broadcastLog('info', `Đã xóa task ${id}`);
    res.json({ success: true });
});

// Thử lại (Retry) task cụ thể
app.post(['/api/queue/task/:id/retry', '/api/tasks/:id/retry'], (req, res) => {
    const { id } = req.params;
    const task = state.queue.find(t => t.id === id);
    if (task) {
        task.status = 'pending';
        task.retries = 0;
        task.progress = 0;
        task.currentStep = '';
        broadcastState();
        broadcastLog('info', `Đã chuyển task [${id}] về trạng thái chờ xử lý lại (Retry).`);
    }
    res.json({ success: true });
});

// Đổi lượt tạo: Đẩy task lên vị trí đầu tiên của danh sách chờ (Ưu tiên hàng đầu - Karaoke style)
app.post(['/api/queue/task/:id/move-top', '/api/tasks/:id/move-top'], (req, res) => {
    const { id } = req.params;
    const taskIndex = state.queue.findIndex(t => t.id === id);
    if (taskIndex === -1) return res.status(404).json({ error: 'Task không tồn tại' });
    
    const task = state.queue[taskIndex];
    if (task.status !== 'pending') {
        return res.status(400).json({ error: 'Chỉ có thể đổi thứ tự task đang chờ (pending)' });
    }

    state.queue.splice(taskIndex, 1);
    
    const firstPendingIdx = state.queue.findIndex(t => t.status === 'pending');
    if (firstPendingIdx !== -1) {
        state.queue.splice(firstPendingIdx, 0, task);
    } else {
        const runningIdx = state.queue.findIndex(t => t.status === 'running');
        if (runningIdx !== -1) {
            state.queue.splice(runningIdx + 1, 0, task);
        } else {
            state.queue.unshift(task);
        }
    }
    
    saveDB();
    broadcastState();
    broadcastLog('info', `⭐ [ƯU TIÊN] Đã đẩy Task [${id}] lên đầu danh sách chờ tạo.`);
    res.json({ success: true, queue: state.queue });
});

// Đổi lượt tạo: Đẩy task lên trước 1 bậc (Move Up)
app.post(['/api/queue/task/:id/move-up', '/api/tasks/:id/move-up'], (req, res) => {
    const { id } = req.params;
    const pendingTasks = state.queue.filter(t => t.status === 'pending');
    const pIdx = pendingTasks.findIndex(t => t.id === id);
    if (pIdx > 0) {
        const currentTask = pendingTasks[pIdx];
        const prevTask = pendingTasks[pIdx - 1];
        
        const realCurrIdx = state.queue.indexOf(currentTask);
        const realPrevIdx = state.queue.indexOf(prevTask);
        
        state.queue[realCurrIdx] = prevTask;
        state.queue[realPrevIdx] = currentTask;
        
        saveDB();
        broadcastState();
        broadcastLog('info', `⬆️ Đã đẩy Task [${id}] lên trước 1 lượt.`);
    }
    res.json({ success: true, queue: state.queue });
});

// Đổi lượt tạo: Đẩy task lùi sau 1 bậc (Move Down)
app.post(['/api/queue/task/:id/move-down', '/api/tasks/:id/move-down'], (req, res) => {
    const { id } = req.params;
    const pendingTasks = state.queue.filter(t => t.status === 'pending');
    const pIdx = pendingTasks.findIndex(t => t.id === id);
    if (pIdx >= 0 && pIdx < pendingTasks.length - 1) {
        const currentTask = pendingTasks[pIdx];
        const nextTask = pendingTasks[pIdx + 1];
        
        const realCurrIdx = state.queue.indexOf(currentTask);
        const realNextIdx = state.queue.indexOf(nextTask);
        
        state.queue[realCurrIdx] = nextTask;
        state.queue[realNextIdx] = currentTask;
        
        saveDB();
        broadcastState();
        broadcastLog('info', `⬇️ Đã đẩy Task [${id}] lùi sau 1 lượt.`);
    }
    res.json({ success: true, queue: state.queue });
});

// Cập nhật toàn bộ thứ tự (Batch Reorder)
app.post(['/api/queue/reorder', '/api/tasks/reorder'], (req, res) => {
    const { taskIds } = req.body;
    if (Array.isArray(taskIds)) {
        const idMap = new Map(state.queue.map(t => [t.id, t]));
        const reordered = [];
        for (const id of taskIds) {
            if (idMap.has(id)) {
                reordered.push(idMap.get(id));
                idMap.delete(id);
            }
        }
        for (const remaining of idMap.values()) {
            reordered.push(remaining);
        }
        state.queue = reordered;
        saveDB();
        broadcastState();
        broadcastLog('info', '🔄 Đã cập nhật lại toàn bộ thứ tự hàng chờ.');
    }
    res.json({ success: true, queue: state.queue });
});

// =========================================================================
// TIẾN TRÌNH QUÉT CLI ĐỊNH KỲ LIÊN TỤC (REALTIME BACKGROUND CLI POLLER)
// =========================================================================
let isCliPolling = false;
let cliGateStatusLogged = false;
let lastKnownActiveJobIds = new Set();
let latestCliStatus = { activeCount: 0, lastCheck: null, jobs: [], activeJobs: [] };

async function pollCliStatus() {
    if (isCliPolling) return latestCliStatus;
    isCliPolling = true;
    try {
        const { stdout } = await execAsync('higgsfield generate list --json --size 5', { timeout: 8000 });
        if (!stdout) {
            if (!cliGateStatusLogged) {
                broadcastLog('warning', '⚠️ [CLI Cloud] Higgsfield CLI trả về rỗng — bỏ qua cổng giới hạn Cloud.', 'cli');
                cliGateStatusLogged = true;
            }
            return latestCliStatus;
        }

        const jobs = JSON.parse(stdout);
        if (Array.isArray(jobs)) {
            const finishedStates = ['completed', 'failed', 'canceled', 'cancelled', 'error', 'rejected', 'done', 'success', 'nsfw', 'blocked', 'moderation', 'moderation_blocked', 'moderation_rejected', 'censored', 'expired'];
            const activeStates = ['waiting', 'queued', 'processing', 'running', 'pending', 'in_progress', 'generating', 'rendering', 'submitted', 'created'];
            const activeJobs = jobs.filter(j => {
                const st = (j.status || j.state || j.status_text || '').toLowerCase().trim();
                return st && activeStates.includes(st) && !finishedStates.includes(st);
            });

            latestCliStatus = {
                activeCount: activeJobs.length,
                lastCheck: new Date().toISOString(),
                jobs: jobs.slice(0, 5),
                activeJobs: activeJobs
            };

            const currentActiveIds = new Set(activeJobs.map(j => j.id));

            // Báo cáo nếu có job đang chạy/chờ render trên Cloud
            if (activeJobs.length > 0) {
                const jobDesc = activeJobs.map(j => `[${(j.id || '').slice(0, 8)}...] (${(j.status || j.state || 'WAITING').toUpperCase()})`).join(', ');
                broadcastLog('warning', `📡 [CLI Cloud] Quét định kỳ: Đang có ${activeJobs.length} job trên Cloud: ${jobDesc}`, 'cli');
            } else {
                // Nếu vừa chuyển từ bận sang rảnh hoặc kiểm tra rảnh
                if (lastKnownActiveJobIds.size > 0) {
                    broadcastLog('success', `🟢 [CLI Cloud] Hàng chờ Cloud đã rảnh hoàn toàn (0 active jobs).`, 'cli');
                }
            }

            // Báo cáo các job vừa hoàn tất thành công
            for (const j of jobs) {
                const st = (j.status || j.state || '').toLowerCase();
                const resultUrl = j.result_url || j.url;
                if (st === 'completed' && resultUrl && lastKnownActiveJobIds.has(j.id)) {
                    broadcastLog('success', `🎉 [CLI Cloud] Job [${(j.id || '').slice(0, 8)}...] đã render xong trên Cloud! 🎬 ${resultUrl}`, 'cli');
                }
            }

            lastKnownActiveJobIds = currentActiveIds;
            io.emit('cli_status', latestCliStatus);
        }
    } catch (err) {
        if (!cliGateStatusLogged) {
            broadcastLog('warning', `⚠️ [CLI Cloud] Higgsfield CLI không sẵn sàng (${err.message}). Cổng giới hạn Cloud ĐÃ TẮT.`, 'cli');
            cliGateStatusLogged = true;
        }
    } finally {
        isCliPolling = false;
    }
    return latestCliStatus;
}

// Bật tiến trình quét CLI định kỳ mỗi 15 giây liên tục
setInterval(pollCliStatus, 15000);
// Chạy quét thử 1 lần sau 3 giây khi server khởi động
setTimeout(pollCliStatus, 3000);

// Kiểm tra qua Higgsfield CLI xem hàng chờ Cloud có rảnh không.
async function isCliQueueFree() {
    try {
        const res = await pollCliStatus();
        if (res.activeCount > 0) {
            const firstActive = res.activeJobs[0] || {};
            const jobStatus = (firstActive.status || firstActive.state || 'WAITING').toUpperCase();
            const jobIdShort = (firstActive.id || '').slice(0, 8);
            broadcastLog('warning', `⏳ [CLI Cloud Throttle] Phát hiện Job Cloud [${jobIdShort}...] đang ở trạng thái "${jobStatus}". Đợi 30s để Cloud render xong...`, 'cli');
            return false;
        }
        broadcastLog('success', '🟢 [CLI Cloud Throttle] Hàng chờ Cloud đang rảnh (0 active jobs). Cho phép Chrome CDP nạp task tiếp theo.', 'cli');
        return true;
    } catch (err) {
        return true; // Không throttle khi lỗi
    }
}

// =========================================================================
// VÒNG LẶP QUEUE RUNNER TỰ ĐỘNG (PROCESS QUEUE LOOP)
// =========================================================================
async function processQueueLoop() {
    if (!state.isRunning || state.isPaused) {
        isProcessing = false;
        return;
    }

    // Mutex ngăn chặn thực thi trùng lặp song song
    if (isProcessing) {
        return;
    }
    isProcessing = true;

    // Tìm task pending tiếp theo — CHỈ lấy task CDP (không phải credit mode)
    const nextTask = state.queue.find(t => t.status === 'pending' && !t.creditMode);
    if (!nextTask) {
        state.isRunning = false;
        state.currentTaskId = null;
        isProcessing = false;
        broadcastLog('success', '🎉 Tất cả task trong Hàng chờ đã hoàn tất!');
        broadcastState();
        return;
    }

    // ── Không còn chờ CLI rảnh Ở ĐÂY nữa ──────────────────────────────────
    // Luồng mới: CDP bắt đầu ngay (upload, prompt, thông số...),
    // chỉ dừng lại đúng tại bước ấn Generate để chờ điều kiện.
    // ─────────────────────────────────────────────────────────────────────────

    state.currentTaskId = nextTask.id;
    nextTask.status = 'running';
    nextTask.progress = 5;
    nextTask.currentStep = 'Đang kết nối Chrome CDP...';
    nextTask.startedAt = new Date().toISOString();
    broadcastState();
    broadcastLog('info', `🎬 Bắt đầu thực thi Task [${nextTask.id}]: "${nextTask.prompt.slice(0, 35)}..."`);

    currentAbortController = new AbortController();

    try {
        const result = await video_generate({
            prompt: nextTask.prompt,
            imagePath: nextTask.imagePath,
            imagePaths: nextTask.imagePaths || (nextTask.imagePath ? [nextTask.imagePath] : []),
            videoPath: nextTask.videoPath || null,
            videoPaths: nextTask.videoPaths || (nextTask.videoPath ? [nextTask.videoPath] : []),
            model: nextTask.model || 'Seedance 2.5',
            duration: nextTask.duration || '20s',
            aspectRatio: nextTask.aspectRatio || '16:9',
            resolution: nextTask.resolution || '720p',
            unlimited: nextTask.unlimited !== undefined ? nextTask.unlimited : true,
            saveVideo: nextTask.saveVideo !== undefined ? nextTask.saveVideo : true,
            downloadVideo: nextTask.downloadVideo === true,
            outputDir: nextTask.outputDir ? resolveToHostPath(nextTask.outputDir) : path.join(__dirname, 'downloads'),
            checkGallery: nextTask.checkGallery === true,
            pollTimeoutMs: nextTask.pollTimeoutMs || 1500000, // 25 phút
            cdpHost: CDP_HOST,
            cdpPort: CDP_PORT,
            signal: currentAbortController.signal,

            // ── CALLBACK TRƯỚC KHI BẤM GENERATE ───────────────────────────────
            // Lúc này: upload xong, prompt xong, thông số xong.
            // Chỉ cần đảm bảo: (1) CLI rảnh + (2) download video trước xong.
            onBeforeGenerate: async () => {
                // (1) Chờ download video CDP task trước — dùng state riêng của CDP, không bị CLI ghi đè
                if (state._cdpDownloadPromise && state._cdpDownloadingTaskId) {
                    const downloadingTask = state.queue.find(t => t.id === state._cdpDownloadingTaskId);
                    const isStillDownloading = downloadingTask && !downloadingTask.localVideoPath;

                    if (isStillDownloading) {
                        broadcastLog('info', `⏳ [Trước Generate] Đợi download video CDP task [${state._cdpDownloadingTaskId.slice(-8)}] hoàn tất...`, 'cli');
                        try {
                            await state._cdpDownloadPromise;
                        } catch (_) {}
                        broadcastLog('success', '✅ [Trước Generate] Download video CDP trước đã xong.', 'cli');
                    } else {
                        broadcastLog('info', `⏭️ [Trước Generate] Bỏ qua đợi download CDP task [${state._cdpDownloadingTaskId?.slice(-8)}] — đã xong hoặc không tìm thấy.`, 'cli');
                    }
                    state._cdpDownloadPromise = null;
                    state._cdpDownloadingTaskId = null;
                }

                // (2) Chờ CLI xác nhận Higgsfield rảnh (không có job nào đang render trên Cloud)
                if (!state.isRunning || state.isPaused) return; // abort nếu queue bị dừng
                let isFree = await isCliQueueFree();
                while (!isFree && state.isRunning && !state.isPaused) {
                    if (currentAbortController?.signal.aborted) return;
                    await new Promise(r => setTimeout(r, 30000));
                    isFree = await isCliQueueFree();
                }
            },

            onProgress: (step, total, message) => {
                const pct = Math.round((step / total) * 100);
                nextTask.progress = pct;
                nextTask.currentStep = `[${step}/${total}] ${message}`;
                broadcastState();
                io.emit('task_progress', {
                    taskId: nextTask.id,
                    step,
                    totalSteps: total,
                    total,
                    progress: pct,
                    percentage: pct,
                    message,
                    currentStep: message
                });
                broadcastLog('info', `[Task ${nextTask.id}] Bước ${step}/${total}: ${message}`);
            },
            onScreenshot: (screenshotBase64) => {
                io.emit('live_preview', {
                    taskId: nextTask.id,
                    screenshot: `data:image/jpeg;base64,${screenshotBase64}`,
                    image: `data:image/jpeg;base64,${screenshotBase64}`
                });
            },
            onLog: (msg) => {
                broadcastLog('info', `[CDP] ${msg}`);
            }
        });

        nextTask.status = 'completed';
        nextTask.progress = 100;
        nextTask.currentStep = 'Hoàn tất thành công!';
        nextTask.completedAt = new Date().toISOString();
        if (nextTask.startedAt) {
            nextTask.executionTime = formatExecutionDuration(nextTask.startedAt, nextTask.completedAt);
        }
        // FIX #1: lưu link video nếu pipeline thu thập được
        if (result && result.videoUrl) {
            nextTask.videoUrl = result.videoUrl;
            nextTask.videoSrc = result.videoSrc || result.videoUrl;
            if (result.videoPath) nextTask.videoPath = result.videoPath;
            nextTask.currentStep = 'Hoàn tất thành công! Đã có link video.';

            // Tự động tải video về thư mục lưu trữ — lưu Promise vào state
            // để task KẾ TIẾP có thể chờ download này xong trước khi bấm Generate
            const dlPromise = downloadAndSaveVideo(nextTask, result.videoUrl).then(saved => {
                if (saved) {
                    nextTask.localVideoPath = saved.savePath;
                    nextTask.localVideoUrl  = saved.localWebPath;
                    nextTask.currentStep = `Hoàn tất! Video đã lưu: ${saved.filename}`;
                    broadcastLog('success', `💾 Đã lưu video về: ${saved.savePath}`);
                    broadcastState();
                    saveDB();
                }
            }).catch(err => {
                broadcastLog('warning', `⚠️ Không thể lưu video về máy chủ: ${err.message}`);
            });
            state._cdpDownloadPromise = dlPromise;
            state._cdpDownloadingTaskId = nextTask.id; // state riêng CDP, CLI không đụng vào

        } else if (result && result.dryRun) {
            nextTask.currentStep = 'Dry-run hoàn tất (chưa bấm Generate).';
        } else {
            nextTask.currentStep = 'Đã gửi lệnh nhưng chưa thu thập được link video.';
        }
        const timeLog = nextTask.executionTime ? ` trong ${nextTask.executionTime}` : '';
        broadcastLog('success', `✅ Task [${nextTask.id}] đã hoàn thành thành công${timeLog}!${nextTask.videoUrl ? ' 🎬 ' + nextTask.videoUrl : ''}`);

    } catch (error) {
        nextTask.completedAt = new Date().toISOString();
        if (nextTask.startedAt) {
            nextTask.executionTime = formatExecutionDuration(nextTask.startedAt, nextTask.completedAt);
        }
        if (error.name === 'AbortError' || currentAbortController?.signal.aborted) {
            nextTask.status = 'failed';
            nextTask.currentStep = 'Đã hủy theo lệnh dừng của người dùng.';
            broadcastLog('warning', `⏹️ Task [${nextTask.id}] đã bị dừng theo yêu cầu.`);
        } else {
            console.error(`❌ Task [${nextTask.id}] gặp lỗi:`, error.message);
            if (nextTask.retries < 2) {
                nextTask.retries += 1;
                nextTask.status = 'pending';
                nextTask.progress = 0;
                nextTask.currentStep = `Chờ thử lại lần ${nextTask.retries}/2...`;
                broadcastLog('warning', `⚠️ Task [${nextTask.id}] lỗi (${error.message}). Tự động thử lại (${nextTask.retries}/2)...`);
            } else {
                nextTask.status = 'failed';
                nextTask.currentStep = `Lỗi: ${error.message}`;
                const timeLog = nextTask.executionTime ? ` (thời gian: ${nextTask.executionTime})` : '';
                broadcastLog('error', `💥 Task [${nextTask.id}] thất bại sau 2 lần thử lại (${error.message})${timeLog}.`);
            }
        }
    } finally {
        currentAbortController = null;
        state.currentTaskId = null;
        isProcessing = false;
        broadcastState();

        // Tiếp tục chạy task kế tiếp nếu Queue vẫn bật
        if (state.isRunning && !state.isPaused) {
            setTimeout(processQueueLoop, 2500);
        }
    }
}

// =========================================================================
// CLI CREDIT MODE — VÒNG LẶP SONG SONG
// =========================================================================

async function runOneCliTask(task) {
    const abortCtrl = new AbortController();
    cliAbortControllers.set(task.id, abortCtrl);

    task.status = 'running';
    task.startedAt = new Date().toISOString();
    task.progress = 0;
    task.currentStep = '🪙 [CLI] Đang khởi động...';
    broadcastState();
    broadcastLog('info', `🪙 [CLI] Bắt đầu task credit [${task.id}]: "${task.prompt.slice(0, 35)}..."`);

    try {
        const result = await runCliTask(task, {
            signal: abortCtrl.signal,
            onProgress: (pct, _stepN, msg) => {
                task.progress = pct;
                task.currentStep = `[CLI] ${msg}`;
                broadcastState();
                io.emit('task_progress', { taskId: task.id, progress: pct, message: msg });
            },
            onLog: (msg) => broadcastLog('info', `[CLI][${task.id.slice(-8)}] ${msg}`)
        });

        task.status      = 'completed';
        task.progress    = 100;
        task.completedAt = new Date().toISOString();
        if (task.startedAt) task.executionTime = formatExecutionDuration(task.startedAt, task.completedAt);
        task.videoUrl    = result.videoUrl;
        task.videoSrc    = result.videoUrl;
        task.cliJobId    = result.jobId;
        task.creditCost  = result.creditCost;
        task.currentStep = `🪙 Hoàn tất!${result.creditCost != null ? ` (${result.creditCost} credits)` : ''}`;
        broadcastLog('success', `✅ [CLI] Task [${task.id}] xong! Credits: ${result.creditCost ?? '?'}. 🎬 ${result.videoUrl}`);

        if (result.videoUrl) {
            const dlPromise = downloadAndSaveVideo(task, result.videoUrl)
                .then(saved => {
                    if (saved) {
                        task.localVideoPath = saved.savePath;
                        task.localVideoUrl  = saved.localWebPath;
                        task.currentStep    = `🪙 Video đã lưu: ${saved.filename}`;
                        broadcastLog('success', `💾 [CLI] Đã lưu video: ${saved.savePath}`);
                        broadcastState(); saveDB();
                    }
                })
                .catch(err => broadcastLog('warning', `⚠️ [CLI] Không lưu được: ${err.message}`));
            state._currentDownloadPromise = dlPromise;
            state._downloadingTaskId = task.id;
        }

    } catch (err) {
        task.completedAt = new Date().toISOString();
        if (task.startedAt) task.executionTime = formatExecutionDuration(task.startedAt, task.completedAt);
        task.status      = 'failed';
        task.currentStep = err.message === 'Cancelled' ? '⏹️ Đã hủy.' : `🪙 Lỗi: ${err.message}`;
        broadcastLog(err.message === 'Cancelled' ? 'warning' : 'error',
            `${err.message === 'Cancelled' ? '⏹️' : '💥'} [CLI] Task [${task.id}]: ${err.message}`);

    } finally {
        cliAbortControllers.delete(task.id);
        state.cliRunningCount = Math.max(0, state.cliRunningCount - 1);
        broadcastState(); saveDB();
        if (state.isRunning && !state.isPaused) setTimeout(processCliQueue, 500);
    }
}

function processCliQueue() {
    if (!state.isRunning || state.isPaused) return;
    const pendingCli = state.queue.filter(t => t.status === 'pending' && t.creditMode === true);
    if (pendingCli.length === 0) return;
    const slots = state.cliMaxParallel - state.cliRunningCount;
    if (slots <= 0) return;
    for (const task of pendingCli.slice(0, slots)) {
        state.cliRunningCount++;
        broadcastLog('info', `🪙 [CLI] Nạp slot ${state.cliRunningCount}/${state.cliMaxParallel}: [${task.id.slice(-8)}]`);
        runOneCliTask(task);
    }
    broadcastState();
}

// Lấy danh sách IP mạng LAN
function getLocalLanIPs() {
    const nets = os.networkInterfaces();
    const ips = [];
    for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
            if (net.family === 'IPv4' && !net.internal) {
                ips.push({ name, address: net.address });
            }
        }
    }
    return ips;
}

// Endpoint lấy thông tin mạng LAN
app.get('/api/lan-info', (req, res) => {
    const lanIPs = getLocalLanIPs();
    res.json({
        port: PORT,
        primaryLanIP: lanIPs.length > 0 ? lanIPs[0].address : '127.0.0.1',
        allLanIPs: lanIPs,
        lanUrl: lanIPs.length > 0 ? `http://${lanIPs[0].address}:${PORT}` : `http://localhost:${PORT}`
    });
});

// Socket.io Connection
io.on('connection', (socket) => {
    const currentTask = state.queue.find(t => t.id === state.currentTaskId) || null;
    socket.emit('queue_state', {
        isRunning: state.isRunning,
        isPaused: state.isPaused,
        currentTaskId: state.currentTaskId,
        currentTask,
        stats: getQueueStats(),
        tasks: state.queue,
        queue: state.queue
    });
    socket.emit('cdp_status', lastCdpStatus);
    if (lastLiveScreenshot) {
        socket.emit('live_preview', {
            screenshot: lastLiveScreenshot,
            image: lastLiveScreenshot
        });
    }
});

// =========================================================================
// API CREDIT MODE — Tài khoản, models, cấu hình song song
// =========================================================================

// GET /api/account/credits — credit balance hiện tại
app.get('/api/account/credits', async (req, res) => {
    try {
        const info = await getAccountCredits();
        res.json({ ...info, cliMaxParallel: state.cliMaxParallel, cliRunningCount: state.cliRunningCount });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/cli/models — danh sách model CLI video
app.get('/api/cli/models', (req, res) => {
    res.json({ models: CLI_VIDEO_MODELS });
});

// POST /api/cli/settings — cập nhật max parallel
app.post('/api/cli/settings', (req, res) => {
    const { maxParallel } = req.body || {};
    if (maxParallel !== undefined) {
        const n = parseInt(maxParallel, 10);
        if (n >= 1 && n <= 20) {
            state.cliMaxParallel = n;
            broadcastLog('info', `⚙️ [CLI] Cập nhật giới hạn song song: ${n} job đồng thời.`);
            // Nạp thêm nếu có slot mới
            if (state.isRunning && !state.isPaused) processCliQueue();
        }
    }
    res.json({ cliMaxParallel: state.cliMaxParallel, cliRunningCount: state.cliRunningCount });
});

// =========================================================================
// API LOGS — Xem lại lịch sử log theo ngày
// =========================================================================

// GET /api/logs — Danh sách file log đang có
app.get('/api/logs', (req, res) => {
    try {
        const files = fs.readdirSync(LOG_DIR)
            .filter(f => /^\d{4}-\d{2}-\d{2}\.log$/.test(f))
            .sort().reverse()
            .map(f => {
                const stat = fs.statSync(path.join(LOG_DIR, f));
                return { date: f.replace('.log', ''), filename: f, size: stat.size, mtime: stat.mtime };
            });
        res.json({ files, logDir: LOG_DIR, keepDays: LOG_KEEP_DAYS });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/logs/:date — Đọc log ngày cụ thể (YYYY-MM-DD)
// Query: ?tail=N, ?level=error|warning|info|success, ?q=keyword
app.get('/api/logs/:date', (req, res) => {
    try {
        const dateStr = req.params.date;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr))
            return res.status(400).json({ error: 'Định dạng ngày phải là YYYY-MM-DD' });
        const filePath = path.join(LOG_DIR, `${dateStr}.log`);
        if (!fs.existsSync(filePath))
            return res.json({ date: dateStr, lines: [], message: 'Không có log cho ngày này' });

        let lines = fs.readFileSync(filePath, 'utf-8').split('\n').filter(Boolean);
        if (req.query.level)
            lines = lines.filter(l => l.toLowerCase().includes(`[${req.query.level.toLowerCase()}]`));
        if (req.query.q)
            lines = lines.filter(l => l.toLowerCase().includes(req.query.q.toLowerCase()));
        if (req.query.tail) {
            const n = parseInt(req.query.tail, 10);
            if (n > 0) lines = lines.slice(-n);
        }
        const parsed = lines.map(line => {
            const m = line.match(/^(\S+) \[(\w+)\] \[(\w+)\] ([\s\S]*)$/);
            if (m) return { ts: m[1], level: m[2].toLowerCase(), source: m[3], message: m[4] };
            return { ts: null, level: 'info', source: 'system', message: line };
        });
        res.json({ date: dateStr, total: parsed.length, lines: parsed });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/logs/:date/download — Tải file log thô
app.get('/api/logs/:date/download', (req, res) => {
    const dateStr = req.params.date;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return res.status(400).send('Bad date');
    const filePath = path.join(LOG_DIR, `${dateStr}.log`);
    if (!fs.existsSync(filePath)) return res.status(404).send('Không tìm thấy file log');
    res.setHeader('Content-Disposition', `attachment; filename="higgsfield-${dateStr}.log"`);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.sendFile(filePath);
});

server.listen(PORT, '0.0.0.0', () => {
    const lanIPs = getLocalLanIPs();
    const primaryIP = lanIPs.length > 0 ? lanIPs[0].address : '127.0.0.1';
    console.log(`====================================================`);
    console.log(`🚀 Higgsfield AI Queue Dashboard running on:`);
    console.log(`   🏠 Local: http://localhost:${PORT}`);
    console.log(`   🌐 LAN:   http://${primaryIP}:${PORT} (Dành cho các máy cùng mạng LAN)`);
    console.log(`📡 Connected to Chrome CDP at http://${CDP_HOST}:${CDP_PORT}`);
    console.log(`====================================================`);
});
