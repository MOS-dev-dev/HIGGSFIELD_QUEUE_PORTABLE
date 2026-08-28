/**
 * cli_generate.js
 * Tạo video qua Higgsfield CLI (tiêu credit, hỗ trợ chạy song song).
 * Không dùng CDP/browser — gọi trực tiếp `higgsfield` CLI.
 */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

// ── Helpers ────────────────────────────────────────────────────────────────

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * Chạy lệnh `higgsfield ...args` và trả về stdout dưới dạng string.
 * Luôn append --json --no-color để parse dễ.
 */
function runHF(args, { signal, timeoutMs = 60000 } = {}) {
    return new Promise((resolve, reject) => {
        const proc = spawn('higgsfield', [...args, '--json', '--no-color'], {
            timeout: timeoutMs,
            env: { ...process.env }
        });

        let stdout = '';
        let stderr = '';
        proc.stdout.on('data', d => { stdout += d.toString(); });
        proc.stderr.on('data', d => { stderr += d.toString(); });

        if (signal) {
            signal.addEventListener('abort', () => {
                proc.kill('SIGTERM');
                reject(new Error('Cancelled'));
            }, { once: true });
        }

        proc.on('close', code => {
            if (code === 0) {
                try {
                    resolve(JSON.parse(stdout.trim()));
                } catch {
                    resolve(stdout.trim());
                }
            } else {
                reject(new Error(`higgsfield exit ${code}: ${stderr.trim() || stdout.trim()}`));
            }
        });

        proc.on('error', reject);
    });
}

// ── Model list (CLI job_type → display name) ───────────────────────────────

export const CLI_VIDEO_MODELS = [
    { jobType: 'seedance_2_5',    name: 'Seedance 2.5' },
    { jobType: 'seedance_2_0',    name: 'Seedance 2.0' },
    { jobType: 'seedance_2_0_mini', name: 'Seedance 2.0 Mini' },
    { jobType: 'seedance1_5',     name: 'Seedance 1.5 Pro' },
    { jobType: 'veo3_1',          name: 'Veo 3.1' },
    { jobType: 'veo3',            name: 'Veo 3' },
    { jobType: 'veo3_1_lite',     name: 'Veo 3.1 Lite' },
    { jobType: 'kling3_0',        name: 'Kling v3.0' },
    { jobType: 'kling3_0_turbo',  name: 'Kling 3.0 Turbo' },
    { jobType: 'kling2_6',        name: 'Kling 2.6' },
    { jobType: 'wan3_0',          name: 'Wan 3.0' },
    { jobType: 'wan3_0_prime',    name: 'Wan 3.0 Prime' },
    { jobType: 'wan2_7',          name: 'Wan 2.7' },
    { jobType: 'wan2_6',          name: 'Wan 2.6' },
    { jobType: 'grok_video_v15',  name: 'Grok Video 1.5' },
    { jobType: 'grok_video',      name: 'Grok Video' },
    { jobType: 'minimax_h3',      name: 'MiniMax H3' },
    { jobType: 'minimax_hailuo',  name: 'Minimax Hailuo' },
    { jobType: 'flux_3_video',    name: 'FLUX 3 Video' },
];

// ── Credit estimation ─────────────────────────────────────────────────────

/**
 * Ước tính credit trước khi tạo job.
 * Trả về số credits (float), hoặc null nếu lỗi.
 */
export async function estimateCost(task) {
    try {
        const jobType = task.cliModel || 'seedance_2_5';
        const args = ['generate', 'cost', jobType,
            '--prompt', task.prompt || 'video',
        ];
        if (task.duration)    args.push('--duration', String(parseInt(task.duration) || 5));
        if (task.aspectRatio) args.push('--aspect-ratio', task.aspectRatio);
        // Upload ảnh để ước tính chính xác nếu có
        if (task.imagePath)   args.push('--image-references', resolvePath(task.imagePath));

        const res = await runHF(args, { timeoutMs: 30000 });
        return typeof res.credits === 'number' ? res.credits : null;
    } catch {
        return null;
    }
}

/**
 * Lấy credit balance hiện tại của tài khoản.
 */
export async function getAccountCredits() {
    const res = await runHF(['account', 'status'], { timeoutMs: 15000 });
    return {
        credits: res.credits ?? 0,
        email:   res.email   ?? '',
        plan:    res.subscription_plan_type ?? ''
    };
}

// ── File upload ───────────────────────────────────────────────────────────

function resolvePath(p) {
    if (!p) return null;
    if (path.isAbsolute(p)) return p;
    return path.join(process.cwd(), p);
}

/**
 * Upload một file lên Higgsfield, trả về upload_id (UUID string).
 */
async function uploadFile(filePath, signal) {
    const abs = resolvePath(filePath);
    if (!abs || !fs.existsSync(abs)) throw new Error(`File không tồn tại: ${filePath}`);
    const res = await runHF(['upload', 'create', abs], { signal, timeoutMs: 120000 });
    // CLI trả về { id, url, ... } hoặc mảng
    const id = Array.isArray(res) ? res[0]?.id : res?.id;
    if (!id) throw new Error(`Upload không trả về ID: ${JSON.stringify(res)}`);
    return id;
}

/**
 * Upload tất cả files cần thiết cho task, trả về { imageIds[], videoIds[] }
 */
async function uploadTaskFiles(task, onLog, signal) {
    const imageIds = [];
    const videoIds = [];

    const imagePaths = task.imagePaths
        ? task.imagePaths
        : (task.imagePath ? [task.imagePath] : []);

    const videoPaths = task.videoPaths
        ? task.videoPaths
        : (task.videoPath ? [task.videoPath] : []);

    for (const p of imagePaths) {
        if (!p) continue;
        onLog(`📤 Đang upload ảnh tham chiếu: ${path.basename(p)}...`);
        const id = await uploadFile(p, signal);
        imageIds.push(id);
        onLog(`✅ Upload ảnh xong: ${id}`);
    }

    for (const p of videoPaths) {
        if (!p) continue;
        onLog(`📤 Đang upload video tham chiếu: ${path.basename(p)}...`);
        const id = await uploadFile(p, signal);
        videoIds.push(id);
        onLog(`✅ Upload video xong: ${id}`);
    }

    return { imageIds, videoIds };
}

// ── Job submission ────────────────────────────────────────────────────────

/**
 * Tạo job generation, trả về { jobId, creditCost? }.
 */
async function submitJob(task, imageIds, videoIds, signal) {
    const jobType = task.cliModel || 'seedance_2_5';
    const args = ['generate', 'create', jobType,
        '--prompt', task.prompt || 'video',
    ];

    // Fix duration: bỏ suffix 's' nếu có ("5s" → 5)
    const dur = parseInt(String(task.duration || '5').replace(/s$/i, '')) || 5;
    args.push('--duration', String(dur));
    if (task.aspectRatio) args.push('--aspect-ratio', task.aspectRatio);
    if (task.resolution && task.resolution !== '720p') {
        args.push('--resolution', task.resolution);
    }

    // Auto-detect mode dựa vào media references
    // seedance_2_5: t2v (no media), omni_reference (image+video), video_edit (video only)
    // Chỉ áp dụng cho seedance; các model khác có thể khác
    const isSeedance = jobType.startsWith('seedance') || jobType.startsWith('wan');
    if (isSeedance && (imageIds.length > 0 || videoIds.length > 0)) {
        if (imageIds.length > 0 && videoIds.length > 0) {
            args.push('--mode', 'omni_reference');   // cả ảnh lẫn video
        } else if (videoIds.length > 0) {
            args.push('--mode', 'video_edit');        // chỉ video
        }
        // chỉ ảnh → không cần mode, model tự detect (i2v)
    }

    for (const id of imageIds) args.push('--image-references', id);
    for (const id of videoIds) args.push('--video-references', id);

    const res = await runHF(args, { signal, timeoutMs: 60000 });
    // CLI trả về array [jobId] hoặc object {id}
    const jobId = Array.isArray(res) ? res[0] : (res?.id || res?.job_id);
    if (!jobId) throw new Error(`Không lấy được job ID từ CLI: ${JSON.stringify(res)}`);
    return { jobId, creditCost: res?.credits_used ?? null };
}

// ── Polling ───────────────────────────────────────────────────────────────

/**
 * Poll job cho đến khi succeeded/failed, với progress callback.
 * @param {string} jobId
 * @param {function} onProgress  — (message, elapsed) => void
 * @param {AbortSignal} signal
 * @param {number} timeoutMs
 * @returns {object} job result JSON
 */
async function pollJob(jobId, onProgress, signal, timeoutMs = 25 * 60 * 1000) {
    const start = Date.now();
    const interval = 10000; // poll mỗi 10s

    while (Date.now() - start < timeoutMs) {
        if (signal?.aborted) throw new Error('Cancelled');

        const elapsed = Math.round((Date.now() - start) / 1000);
        onProgress(`⏳ Đang render... [${elapsed}s]`, elapsed);

        await sleep(interval);
        if (signal?.aborted) throw new Error('Cancelled');

        const job = await runHF(['generate', 'get', jobId], { signal, timeoutMs: 15000 });
        const status = (job?.status || job?.state || '').toLowerCase();

        if (status === 'succeeded' || status === 'completed' || status === 'done') {
            return job;
        }
        // Fallback: Higgsfield đôi khi trả status lạ nhưng result_url đã có → coi là xong
        if (job?.result_url) {
            return job;
        }
        if (status === 'failed' || status === 'error' || status === 'cancelled') {
            throw new Error(`Job thất bại: ${job?.error || status}`);
        }
        // Tiếp tục poll nếu pending/in_progress/running/processing/waiting/queued
    }
    throw new Error('Timeout: Job render quá 25 phút');
}

// ── Extract video URL từ job result ───────────────────────────────────────

function extractVideoUrl(jobResult) {
    // Higgsfield CLI trả về "result_url" (field chính)
    if (jobResult?.result_url)   return jobResult.result_url;
    // Fallback các field phổ biến khác
    if (jobResult?.output_url)   return jobResult.output_url;
    if (jobResult?.video_url)    return jobResult.video_url;
    if (jobResult?.url)          return jobResult.url;
    // output là mảng
    const outputs = jobResult?.outputs || jobResult?.results || [];
    if (Array.isArray(outputs) && outputs.length > 0) {
        const first = outputs[0];
        return first?.url || first?.video_url || first?.output_url || first?.result_url || first;
    }
    return null;
}

// ── Main entry point ──────────────────────────────────────────────────────

/**
 * Chạy toàn bộ luồng CLI generation cho một task.
 * @param {object} task
 * @param {object} options
 * @param {function} options.onProgress  (pct, step, message) => void
 * @param {function} options.onLog       (message) => void
 * @param {AbortSignal} options.signal
 * @returns {{ videoUrl, creditCost, jobId }}
 */
export async function runCliTask(task, {
    onProgress = () => {},
    onLog = () => {},
    signal = null
} = {}) {
    const steps = 5;
    const step = (n, msg) => { onProgress(Math.round((n / steps) * 100), n, msg); onLog(msg); };

    // Bước 1: Ước tính cost
    step(1, '💰 Ước tính chi phí credit...');
    const estimated = await estimateCost(task);
    if (estimated !== null) {
        onLog(`💰 Chi phí ước tính: ${estimated} credits`);
    }

    // Bước 2: Kiểm tra balance
    step(2, '🔍 Kiểm tra credit balance...');
    const account = await getAccountCredits();
    onLog(`💳 Balance hiện tại: ${account.credits} credits`);
    if (estimated !== null && account.credits < estimated) {
        throw new Error(`Không đủ credit: cần ~${estimated}, hiện có ${account.credits}`);
    }

    // Bước 3: Upload files
    step(3, '📤 Upload ảnh/video tham chiếu...');
    const { imageIds, videoIds } = await uploadTaskFiles(task, onLog, signal);
    if (imageIds.length === 0 && videoIds.length === 0) {
        onLog('ℹ️ Không có file tham chiếu — tạo video từ text-only.');
    }

    // Bước 4: Submit job
    step(4, '🚀 Gửi lệnh tạo video lên Higgsfield...');
    const { jobId, creditCost } = await submitJob(task, imageIds, videoIds, signal);
    onLog(`🎯 Job ID: ${jobId}${creditCost != null ? ` | Chi phí: ${creditCost} credits` : ''}`);

    // Bước 5: Poll cho đến khi xong
    step(5, '⏳ Đợi video render trên Higgsfield Cloud...');
    const jobResult = await pollJob(
        jobId,
        (msg) => onLog(msg),
        signal,
        25 * 60 * 1000
    );

    const videoUrl = extractVideoUrl(jobResult);
    if (!videoUrl) {
        throw new Error(`Job hoàn thành nhưng không tìm thấy video URL: ${JSON.stringify(jobResult)}`);
    }

    onLog(`🎬 Video URL: ${videoUrl}`);
    return {
        videoUrl,
        jobId,
        creditCost: creditCost ?? estimated,
        jobResult
    };
}

export default { runCliTask, estimateCost, getAccountCredits, CLI_VIDEO_MODELS };
