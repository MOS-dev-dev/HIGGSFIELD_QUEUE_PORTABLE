#!/usr/bin/env node
// backfill_videos.mjs — Tải tất cả video cũ về /mnt/Data-ReadOnly/media_team/higgfield-queue/
import fs from 'fs';
import path from 'path';
import https from 'https';
import httpModule from 'http';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, 'queue_db.json');
const VIDEO_SAVE_DIR = '/mnt/Data-ReadOnly/media_team/higgfield-queue';

function sanitizeFolderName(name) {
    if (!name || !name.trim()) return null;
    return name.trim()
        .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
        .replace(/\s+/g, ' ')
        .replace(/\.{2,}/g, '.')
        .trim()
        .substring(0, 60);
}

function buildFilename(task) {
    const now = task.completedAt ? new Date(task.completedAt) : new Date();
    const pad = n => String(n).padStart(2, '0');
    const d = `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}`;
    const t = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const rand = Math.random().toString(36).substr(2, 4).toUpperCase();
    return `${d}_${t}_${rand}.mp4`;
}

function downloadFile(url, destPath) {
    return new Promise((resolve, reject) => {
        const protocol = url.startsWith('https') ? https : httpModule;
        const file = fs.createWriteStream(destPath);
        const req = protocol.get(url, { timeout: 120000 }, (response) => {
            if (response.statusCode === 301 || response.statusCode === 302) {
                file.close();
                fs.unlink(destPath, () => {});
                return downloadFile(response.headers.location, destPath).then(resolve).catch(reject);
            }
            if (response.statusCode !== 200) {
                file.close();
                fs.unlink(destPath, () => {});
                return reject(new Error(`HTTP ${response.statusCode}`));
            }
            response.pipe(file);
            file.on('finish', () => file.close(resolve));
            file.on('error', err => { fs.unlink(destPath, () => {}); reject(err); });
        });
        req.on('error', err => { fs.unlink(destPath, () => {}); reject(err); });
        req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    });
}

async function main() {
    const data = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
    const tasks = data.queue;
    const toDownload = tasks.filter(t => t.status === 'completed' && t.videoUrl && !t.localVideoPath);
    console.log(`\n🚀 Bắt đầu tải ${toDownload.length} video về ${VIDEO_SAVE_DIR}\n`);
    let ok = 0, fail = 0;

    for (let i = 0; i < toDownload.length; i++) {
        const task = toDownload[i];
        const creator   = sanitizeFolderName(task.creator) || 'Unknown';
        const taskFolder = sanitizeFolderName(task.taskName) || ('task_' + task.id.slice(-4));
        const saveDir = path.join(VIDEO_SAVE_DIR, creator, taskFolder);
        if (!fs.existsSync(saveDir)) fs.mkdirSync(saveDir, { recursive: true });

        const filename = buildFilename(task);
        const savePath = path.join(saveDir, filename);
        const localWebPath = `/saved-videos/${encodeURIComponent(creator)}/${encodeURIComponent(taskFolder)}/${encodeURIComponent(filename)}`;
        process.stdout.write(`[${i+1}/${toDownload.length}] ${task.id.slice(-8)} → `);

        try {
            await downloadFile(task.videoUrl, savePath);
            const size = fs.statSync(savePath).size;
            console.log(`✅ ${filename} (${(size/1024/1024).toFixed(1)} MB)`);
            const dbTask = tasks.find(t => t.id === task.id);
            if (dbTask) { dbTask.localVideoPath = savePath; dbTask.localVideoUrl = localWebPath; }
            fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf-8');
            ok++;
        } catch (err) {
            console.log(`❌ ${err.message}`);
            fail++;
        }
        await new Promise(r => setTimeout(r, 300));
    }

    console.log(`\n✅ Hoàn tất: ${ok} thành công, ${fail} thất bại`);
}

main().catch(console.error);
