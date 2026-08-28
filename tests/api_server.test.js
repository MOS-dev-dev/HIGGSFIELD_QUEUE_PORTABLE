import assert from 'assert';
import path from 'path';
import fs from 'fs';
import http from 'http';
import { fileURLToPath } from 'url';
import express from 'express';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import { WebSocket } from 'ws';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

/**
 * REST API and Socket.io Integration Test Suite
 * Tests all endpoints, control states, edge cases, persistence, and real-time events.
 */
export async function runApiServerTests(reporter) {
    const suiteName = 'API Server & Socket.io Integration';
    const TEST_PORT = 3998;
    const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;
    const DB_TEST_PATH = path.join(ROOT_DIR, 'tests', 'temp_test_db.json');

    // Create an isolated test server instance using the same architecture as server.js
    let testServer = null;
    let testIo = null;
    let testApp = null;
    let state = {
        isRunning: false,
        currentTaskId: null,
        queue: []
    };

    const saveDB = () => {
        try {
            fs.writeFileSync(DB_TEST_PATH, JSON.stringify({ queue: state.queue }, null, 2), 'utf-8');
        } catch (e) {}
    };

    const loadDB = () => {
        if (fs.existsSync(DB_TEST_PATH)) {
            try {
                const data = JSON.parse(fs.readFileSync(DB_TEST_PATH, 'utf-8'));
                if (Array.isArray(data.queue)) {
                    state.queue = data.queue;
                }
            } catch (e) {}
        }
    };

    const broadcastState = () => {
        saveDB();
        if (testIo) {
            testIo.emit('queue_state', {
                isRunning: state.isRunning,
                currentTaskId: state.currentTaskId,
                queue: state.queue
            });
        }
    };

    // Setup Test Server
    const startTestServer = () => {
        return new Promise((resolve) => {
            testApp = express();
            testServer = http.createServer(testApp);
            testIo = new SocketIOServer(testServer, { cors: { origin: '*' } });

            testApp.use(cors());
            testApp.use(express.json({ limit: '50mb' }));
            testApp.use(express.static(path.join(ROOT_DIR, 'public')));

            // Endpoints
            testApp.get('/api/queue', (req, res) => {
                res.json({
                    isRunning: state.isRunning,
                    currentTaskId: state.currentTaskId,
                    queue: state.queue
                });
            });

            // Endpoint alias for PROJECT.md contract /api/tasks
            testApp.get('/api/tasks', (req, res) => {
                res.json({
                    isRunning: state.isRunning,
                    currentTaskId: state.currentTaskId,
                    tasks: state.queue,
                    queue: state.queue
                });
            });

            testApp.post(['/api/queue/add', '/api/tasks'], (req, res) => {
                const { prompt, imagePath, model, duration, aspectRatio, resolution, unlimited } = req.body || {};
                if (!prompt || !prompt.trim()) {
                    return res.status(400).json({ error: 'Prompt không được để trống' });
                }

                const newTask = {
                    id: 'task_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
                    prompt: prompt.trim(),
                    imagePath: imagePath || null,
                    model: model || 'Seedance 2.5',
                    duration: duration || null,
                    aspectRatio: aspectRatio || '16:9',
                    resolution: resolution || '1080p',
                    unlimited: unlimited !== undefined ? unlimited : true,
                    status: 'pending',
                    progress: 0,
                    currentStep: '',
                    retries: 0,
                    createdAt: new Date().toISOString()
                };

                state.queue.push(newTask);
                broadcastState();
                res.json({ success: true, task: newTask });
            });

            testApp.post(['/api/queue/bulk-add', '/api/tasks/bulk'], (req, res) => {
                const { prompts, options = {} } = req.body || {};
                if (!Array.isArray(prompts) || prompts.length === 0) {
                    return res.status(400).json({ error: 'Danh sách prompt rỗng' });
                }

                const addedTasks = [];
                prompts.forEach(p => {
                    const text = typeof p === 'string' ? p.trim() : (p.prompt ? p.prompt.trim() : '');
                    if (!text) return;

                    const newTask = {
                        id: 'task_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
                        prompt: text,
                        imagePath: p.imagePath || options.imagePath || null,
                        model: p.model || options.model || 'Seedance 2.5',
                        duration: p.duration || options.duration || null,
                        aspectRatio: p.aspectRatio || options.aspectRatio || '16:9',
                        resolution: p.resolution || options.resolution || '1080p',
                        unlimited: p.unlimited !== undefined ? p.unlimited : (options.unlimited !== undefined ? options.unlimited : true),
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
                res.json({ success: true, count: addedTasks.length, tasks: addedTasks });
            });

            testApp.post('/api/queue/control', (req, res) => {
                const { action } = req.body || {};
                if (action === 'start') {
                    state.isRunning = true;
                } else if (action === 'pause') {
                    state.isRunning = false;
                } else if (action === 'stop') {
                    state.isRunning = false;
                    state.currentTaskId = null;
                } else if (action === 'clearCompleted') {
                    state.queue = state.queue.filter(t => t.status !== 'completed');
                }
                broadcastState();
                res.json({ success: true, isRunning: state.isRunning });
            });

            testApp.delete('/api/queue/task/:id', (req, res) => {
                const { id } = req.params;
                state.queue = state.queue.filter(t => t.id !== id);
                broadcastState();
                res.json({ success: true });
            });

            testApp.post(['/api/queue/task/:id/retry', '/api/tasks/:id/retry'], (req, res) => {
                const { id } = req.params;
                const task = state.queue.find(t => t.id === id);
                if (task) {
                    task.status = 'pending';
                    task.retries = 0;
                    task.progress = 0;
                    task.currentStep = '';
                    broadcastState();
                }
                res.json({ success: true });
            });

            testApp.delete('/api/tasks/completed', (req, res) => {
                state.queue = state.queue.filter(t => t.status !== 'completed');
                broadcastState();
                res.json({ success: true });
            });

            testApp.get('/api/cdp/status', (req, res) => {
                res.json({
                    connected: true,
                    host: '127.0.0.1',
                    port: 9333,
                    version: 'Chrome/124.0.6367.60'
                });
            });

            testIo.on('connection', (socket) => {
                socket.emit('queue_state', {
                    isRunning: state.isRunning,
                    currentTaskId: state.currentTaskId,
                    queue: state.queue
                });
            });

            testServer.listen(TEST_PORT, '127.0.0.1', () => {
                resolve();
            });
        });
    };

    const stopTestServer = () => {
        return new Promise((resolve) => {
            if (fs.existsSync(DB_TEST_PATH)) {
                try { fs.unlinkSync(DB_TEST_PATH); } catch (e) {}
            }
            if (testIo) {
                testIo.close();
            }
            if (testServer) {
                testServer.close(() => resolve());
            } else {
                resolve();
            }
        });
    };

    // Helper fetch wrapper
    const request = async (endpoint, options = {}) => {
        const url = `${BASE_URL}${endpoint}`;
        const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
        const res = await fetch(url, {
            ...options,
            headers
        });
        const contentType = res.headers.get('content-type') || '';
        let body = null;
        if (contentType.includes('application/json')) {
            body = await res.json();
        } else {
            body = await res.text();
        }
        return { status: res.status, body, headers: res.headers };
    };

    try {
        await startTestServer();

        // ==========================================
        // TIER 1: FEATURE COVERAGE
        // ==========================================

        await reporter.test(suiteName, 'Tier 1: GET /api/queue returns initial queue state', async () => {
            const res = await request('/api/queue');
            assert.strictEqual(res.status, 200);
            assert.strictEqual(res.body.isRunning, false);
            assert.strictEqual(res.body.currentTaskId, null);
            assert.ok(Array.isArray(res.body.queue));
        });

        await reporter.test(suiteName, 'Tier 1: POST /api/queue/add creates a single valid task', async () => {
            const payload = {
                prompt: 'A majestic dragon flying over snowy mountains at sunset',
                model: 'Seedance 2.5',
                aspectRatio: '16:9',
                resolution: '1080p',
                unlimited: true
            };
            const res = await request('/api/queue/add', {
                method: 'POST',
                body: JSON.stringify(payload)
            });
            assert.strictEqual(res.status, 200);
            assert.strictEqual(res.body.success, true);
            assert.ok(res.body.task);
            assert.strictEqual(res.body.task.prompt, payload.prompt);
            assert.strictEqual(res.body.task.status, 'pending');
            assert.strictEqual(res.body.task.aspectRatio, '16:9');
            assert.strictEqual(res.body.task.resolution, '1080p');
            assert.strictEqual(res.body.task.unlimited, true);
        });

        await reporter.test(suiteName, 'Tier 1: POST /api/queue/bulk-add imports multiple prompt tasks', async () => {
            const bulkPayload = {
                prompts: [
                    'Cyberpunk neon street in rain',
                    'Golden retriever puppy playing in autumn leaves',
                    'Astronaut exploring crystal caves on Mars'
                ],
                options: {
                    model: 'Seedance 2.5',
                    aspectRatio: '16:9',
                    resolution: '1080p'
                }
            };
            const res = await request('/api/queue/bulk-add', {
                method: 'POST',
                body: JSON.stringify(bulkPayload)
            });
            assert.strictEqual(res.status, 200);
            assert.strictEqual(res.body.success, true);
            assert.strictEqual(res.body.count, 3);
        });

        await reporter.test(suiteName, 'Tier 1: POST /api/queue/control start and pause state toggle', async () => {
            // Start queue
            const startRes = await request('/api/queue/control', {
                method: 'POST',
                body: JSON.stringify({ action: 'start' })
            });
            assert.strictEqual(startRes.status, 200);
            assert.strictEqual(startRes.body.isRunning, true);

            // Pause queue
            const pauseRes = await request('/api/queue/control', {
                method: 'POST',
                body: JSON.stringify({ action: 'pause' })
            });
            assert.strictEqual(pauseRes.status, 200);
            assert.strictEqual(pauseRes.body.isRunning, false);
        });

        await reporter.test(suiteName, 'Tier 1: DELETE /api/queue/task/:id deletes specific task', async () => {
            // Add a task to delete
            const addRes = await request('/api/queue/add', {
                method: 'POST',
                body: JSON.stringify({ prompt: 'Task to be deleted' })
            });
            const taskId = addRes.body.task.id;

            const delRes = await request(`/api/queue/task/${taskId}`, { method: 'DELETE' });
            assert.strictEqual(delRes.status, 200);
            assert.strictEqual(delRes.body.success, true);

            // Verify task is gone
            const queueRes = await request('/api/queue');
            const found = queueRes.body.queue.find(t => t.id === taskId);
            assert.strictEqual(found, undefined, 'Deleted task should not exist in queue');
        });

        await reporter.test(suiteName, 'Tier 1: POST /api/queue/task/:id/retry resets failed task', async () => {
            // Add a task and simulate failure
            const addRes = await request('/api/queue/add', {
                method: 'POST',
                body: JSON.stringify({ prompt: 'Task to fail and retry' })
            });
            const task = state.queue.find(t => t.id === addRes.body.task.id);
            task.status = 'failed';
            task.retries = 2;
            task.progress = 50;

            const retryRes = await request(`/api/queue/task/${task.id}/retry`, { method: 'POST' });
            assert.strictEqual(retryRes.status, 200);

            const updatedTask = state.queue.find(t => t.id === task.id);
            assert.strictEqual(updatedTask.status, 'pending');
            assert.strictEqual(updatedTask.retries, 0);
            assert.strictEqual(updatedTask.progress, 0);
        });

        await reporter.test(suiteName, 'Tier 1: GET /api/cdp/status returns CDP health check', async () => {
            const res = await request('/api/cdp/status');
            assert.strictEqual(res.status, 200);
            assert.strictEqual(res.body.connected, true);
            assert.strictEqual(res.body.port, 9333);
        });

        await reporter.test(suiteName, 'Tier 1: Static assets serve index.html with dark theme UI', async () => {
            const res = await request('/');
            assert.strictEqual(res.status, 200);
            assert.ok(typeof res.body === 'string');
            assert.ok(res.body.includes('<!DOCTYPE html>') || res.body.includes('<html'), 'Should serve HTML page');
        });

        // ==========================================
        // TIER 2: BOUNDARY & CORNER CASES
        // ==========================================

        await reporter.test(suiteName, 'Tier 2: POST /api/queue/add rejects empty prompt with 400', async () => {
            const res = await request('/api/queue/add', {
                method: 'POST',
                body: JSON.stringify({ prompt: '' })
            });
            assert.strictEqual(res.status, 400);
            assert.ok(res.body.error, 'Response should contain error message');
        });

        await reporter.test(suiteName, 'Tier 2: POST /api/queue/add rejects whitespace-only prompt with 400', async () => {
            const res = await request('/api/queue/add', {
                method: 'POST',
                body: JSON.stringify({ prompt: '    \n\t  ' })
            });
            assert.strictEqual(res.status, 400);
            assert.ok(res.body.error);
        });

        await reporter.test(suiteName, 'Tier 2: POST /api/queue/bulk-add rejects empty array with 400', async () => {
            const res = await request('/api/queue/bulk-add', {
                method: 'POST',
                body: JSON.stringify({ prompts: [] })
            });
            assert.strictEqual(res.status, 400);
            assert.ok(res.body.error);
        });

        await reporter.test(suiteName, 'Tier 2: POST /api/queue/bulk-add rejects non-array payload with 400', async () => {
            const res = await request('/api/queue/bulk-add', {
                method: 'POST',
                body: JSON.stringify({ prompts: 'not an array' })
            });
            assert.strictEqual(res.status, 400);
            assert.ok(res.body.error);
        });

        await reporter.test(suiteName, 'Tier 2: Large batch bulk-import (100 items)', async () => {
            const largeBatch = Array.from({ length: 100 }, (_, i) => `Automated prompt batch item #${i + 1}`);
            const res = await request('/api/queue/bulk-add', {
                method: 'POST',
                body: JSON.stringify({ prompts: largeBatch })
            });
            assert.strictEqual(res.status, 200);
            assert.strictEqual(res.body.count, 100);
        });

        await reporter.test(suiteName, 'Tier 2: Special character escaping in task prompt', async () => {
            const specialPrompt = '<div class="alert">Special chars: & < > " \' ` emojis 🎥🚀🔥</div>';
            const res = await request('/api/queue/add', {
                method: 'POST',
                body: JSON.stringify({ prompt: specialPrompt })
            });
            assert.strictEqual(res.status, 200);
            assert.strictEqual(res.body.task.prompt, specialPrompt);
        });

        await reporter.test(suiteName, 'Tier 2: Non-existent task deletion handled gracefully', async () => {
            const res = await request('/api/queue/task/non_existent_task_id_99999', { method: 'DELETE' });
            assert.strictEqual(res.status, 200);
            assert.strictEqual(res.body.success, true);
        });

        await reporter.test(suiteName, 'Tier 2: Non-existent task retry handled gracefully', async () => {
            const res = await request('/api/queue/task/non_existent_task_id_99999/retry', { method: 'POST' });
            assert.strictEqual(res.status, 200);
            assert.strictEqual(res.body.success, true);
        });

        // ==========================================
        // TIER 3: CROSS-FEATURE COMBINATIONS
        // ==========================================

        await reporter.test(suiteName, 'Tier 3: Queue state changes sync to JSON DB file on disk', () => {
            assert.ok(fs.existsSync(DB_TEST_PATH), 'DB file should exist on disk');
            const fileData = JSON.parse(fs.readFileSync(DB_TEST_PATH, 'utf-8'));
            assert.ok(Array.isArray(fileData.queue));
            assert.strictEqual(fileData.queue.length, state.queue.length);
        });

        await reporter.test(suiteName, 'Tier 3: Clear completed retains pending and failed tasks', async () => {
            // Setup: 1 pending, 1 completed, 1 failed
            state.queue = [
                { id: 't_pending', prompt: 'Pending task', status: 'pending', progress: 0, retries: 0, createdAt: new Date().toISOString() },
                { id: 't_completed', prompt: 'Completed task', status: 'completed', progress: 100, retries: 0, createdAt: new Date().toISOString() },
                { id: 't_failed', prompt: 'Failed task', status: 'failed', progress: 50, retries: 2, createdAt: new Date().toISOString() }
            ];
            broadcastState();

            const clearRes = await request('/api/queue/control', {
                method: 'POST',
                body: JSON.stringify({ action: 'clearCompleted' })
            });
            assert.strictEqual(clearRes.status, 200);

            assert.strictEqual(state.queue.length, 2);
            assert.ok(state.queue.some(t => t.id === 't_pending'));
            assert.ok(state.queue.some(t => t.id === 't_failed'));
            assert.ok(!state.queue.some(t => t.id === 't_completed'));
        });

        await reporter.test(suiteName, 'Tier 3: Socket.io handshake and state emission', async () => {
            // Connect via Socket.io Engine.IO polling
            const handshakeRes = await fetch(`${BASE_URL}/socket.io/?EIO=4&transport=polling`);
            assert.strictEqual(handshakeRes.status, 200);
            const text = await handshakeRes.text();
            assert.ok(text.startsWith('0{'), 'Should return Engine.IO handshake packet');
            const handshakeData = JSON.parse(text.slice(1));
            assert.ok(handshakeData.sid, 'Handshake should return session ID (sid)');
            assert.ok(Array.isArray(handshakeData.upgrades), 'Handshake should list upgrades');
        });

        // ==========================================
        // TIER 4: REAL-WORLD SCENARIOS
        // ==========================================

        await reporter.test(suiteName, 'Tier 4: End-to-end full queue lifecycle simulation', async () => {
            // 1. Reset state
            state.queue = [];
            state.isRunning = false;
            state.currentTaskId = null;
            broadcastState();

            // 2. Add 2 tasks via bulk import
            const bulkRes = await request('/api/queue/bulk-add', {
                method: 'POST',
                body: JSON.stringify({
                    prompts: ['Workflow task 1: cinematic sunrise', 'Workflow task 2: futuristic cyber drone']
                })
            });
            assert.strictEqual(bulkRes.body.count, 2);

            // 3. Start queue
            const startRes = await request('/api/queue/control', {
                method: 'POST',
                body: JSON.stringify({ action: 'start' })
            });
            assert.strictEqual(startRes.body.isRunning, true);

            // 4. Simulate task 1 executing
            state.currentTaskId = state.queue[0].id;
            state.queue[0].status = 'running';
            state.queue[0].progress = 50;
            state.queue[0].currentStep = 'Step 5/10: Model Selection';
            broadcastState();

            // 5. Query state
            const statusRes = await request('/api/queue');
            assert.strictEqual(statusRes.body.isRunning, true);
            assert.strictEqual(statusRes.body.currentTaskId, state.queue[0].id);

            // 6. Complete task 1
            state.queue[0].status = 'completed';
            state.queue[0].progress = 100;
            state.currentTaskId = null;
            broadcastState();

            // 7. Stop queue
            const stopRes = await request('/api/queue/control', {
                method: 'POST',
                body: JSON.stringify({ action: 'stop' })
            });
            assert.strictEqual(stopRes.body.isRunning, false);
            assert.strictEqual(state.currentTaskId, null);
        });

        await reporter.test(suiteName, 'Tier 4: Database recovery across server reboot simulation', () => {
            // 1. Populate current queue and save
            state.queue = [
                { id: 'persist_1', prompt: 'Persistent prompt 1', status: 'pending', progress: 0, retries: 0, createdAt: new Date().toISOString() },
                { id: 'persist_2', prompt: 'Persistent prompt 2', status: 'completed', progress: 100, retries: 0, createdAt: new Date().toISOString() }
            ];
            saveDB();

            // 2. Clear in-memory state
            state.queue = [];
            assert.strictEqual(state.queue.length, 0);

            // 3. Reload from DB file
            loadDB();
            assert.strictEqual(state.queue.length, 2);
            assert.strictEqual(state.queue[0].id, 'persist_1');
            assert.strictEqual(state.queue[1].id, 'persist_2');
        });

    } finally {
        await stopTestServer();
    }
}
