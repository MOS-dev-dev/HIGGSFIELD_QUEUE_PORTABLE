import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { fileURLToPath } from 'url';

/**
 * Mock Chrome CDP Server
 * Emulates Chrome Remote Debugging Protocol HTTP endpoints (/json/version, /json/list, /json/new, etc.)
 * and WebSocket JSON-RPC 2.0 communication for Puppeteer-core and health checks.
 */
export class MockCDPServer {
    constructor(options = {}) {
        this.port = options.port || 9333;
        this.host = options.host || '127.0.0.1';
        this.browserId = options.browserId || 'mock-browser-uuid-12345';
        this.targetUrl = options.targetUrl || 'https://higgsfield.ai/ai/video';
        
        this.server = null;
        this.wss = null;
        this.sockets = new Set();
        this.callHistory = [];
        this.isRunning = false;
        this.isResponding = true;
        this.errorMode = false;

        this.pages = [
            {
                description: '',
                devtoolsFrontendUrl: `/devtools/inspector.html?ws=${this.host}:${this.port}/devtools/page/page-1`,
                id: 'page-1',
                title: 'Higgsfield AI - Video Studio',
                type: 'page',
                url: this.targetUrl,
                webSocketDebuggerUrl: `ws://${this.host}:${this.port}/devtools/page/page-1`
            }
        ];
    }

    /**
     * Start Mock CDP HTTP and WebSocket Server
     */
    start() {
        return new Promise((resolve, reject) => {
            this.server = http.createServer((req, res) => {
                this.handleHttpRequest(req, res);
            });

            this.wss = new WebSocketServer({ noServer: true });

            this.server.on('upgrade', (request, socket, head) => {
                if (!this.isResponding) {
                    socket.destroy();
                    return;
                }
                this.wss.handleUpgrade(request, socket, head, (ws) => {
                    this.wss.emit('connection', ws, request);
                });
            });

            this.wss.on('connection', (ws, req) => {
                this.sockets.add(ws);

                ws.on('message', (message) => {
                    this.handleWsMessage(ws, message);
                });

                ws.on('close', () => {
                    this.sockets.delete(ws);
                });

                ws.on('error', () => {
                    this.sockets.delete(ws);
                });
            });

            this.server.listen(this.port, this.host, () => {
                this.isRunning = true;
                resolve(this);
            });

            this.server.on('error', (err) => {
                reject(err);
            });
        });
    }

    /**
     * Stop Mock CDP Server
     */
    stop() {
        return new Promise((resolve) => {
            this.isRunning = false;
            for (const ws of this.sockets) {
                try {
                    ws.terminate();
                } catch (e) {}
            }
            this.sockets.clear();

            if (this.wss) {
                this.wss.close();
            }

            if (this.server) {
                this.server.close(() => {
                    resolve();
                });
            } else {
                resolve();
            }
        });
    }

    /**
     * Handle HTTP Requests for CDP metadata
     */
    handleHttpRequest(req, res) {
        if (!this.isResponding) {
            // Simulate hanging / timeout
            return;
        }

        if (this.errorMode) {
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end('Internal Server Error in Mock CDP');
            return;
        }

        const url = new URL(req.url, `http://${this.host}:${this.port}`);
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Access-Control-Allow-Origin', '*');

        if (url.pathname === '/json/version') {
            res.writeHead(200);
            res.end(JSON.stringify({
                Browser: 'Chrome/124.0.6367.60',
                'Protocol-Version': '1.3',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                'V8-Version': '12.4.254.14',
                'WebKit-Version': '537.36 (@12345678)',
                webSocketDebuggerUrl: `ws://${this.host}:${this.port}/devtools/browser/${this.browserId}`
            }));
        } else if (url.pathname === '/json/list' || url.pathname === '/json') {
            res.writeHead(200);
            res.end(JSON.stringify(this.pages));
        } else if (url.pathname === '/json/new' || url.pathname.startsWith('/json/new?')) {
            const targetUrl = url.searchParams.get('url') || 'about:blank';
            const pageId = `page-${Date.now()}`;
            const newPage = {
                description: '',
                devtoolsFrontendUrl: `/devtools/inspector.html?ws=${this.host}:${this.port}/devtools/page/${pageId}`,
                id: pageId,
                title: 'New Tab',
                type: 'page',
                url: targetUrl,
                webSocketDebuggerUrl: `ws://${this.host}:${this.port}/devtools/page/${pageId}`
            };
            this.pages.push(newPage);
            res.writeHead(200);
            res.end(JSON.stringify(newPage));
        } else if (url.pathname.startsWith('/json/close/')) {
            const pageId = url.pathname.replace('/json/close/', '');
            this.pages = this.pages.filter(p => p.id !== pageId);
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end('Target is closing');
        } else if (url.pathname.startsWith('/json/activate/')) {
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end('Target activated');
        } else if (url.pathname === '/json/protocol') {
            res.writeHead(200);
            res.end(JSON.stringify({ domains: [{ domain: 'Page', version: '1.3' }, { domain: 'Runtime', version: '1.3' }] }));
        } else {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not Found');
        }
    }

    /**
     * Handle WebSocket CDP RPC Messages
     */
    handleWsMessage(ws, rawMessage) {
        try {
            const msg = JSON.parse(rawMessage.toString());
            this.callHistory.push(msg);

            const { id, method, params } = msg;

            // Emulate standard CDP responses
            if (method === 'Target.setDiscoverTargets') {
                ws.send(JSON.stringify({ id, result: {} }));
                // Broadcast target created events
                for (const page of this.pages) {
                    ws.send(JSON.stringify({
                        method: 'Target.targetCreated',
                        params: {
                            targetInfo: {
                                targetId: page.id,
                                type: page.type,
                                title: page.title,
                                url: page.url,
                                attached: false,
                                browserContextId: 'default'
                            }
                        }
                    }));
                }
            } else if (method === 'Target.setAutoAttach') {
                ws.send(JSON.stringify({ id, result: {} }));
            } else if (method === 'Target.getTargets') {
                ws.send(JSON.stringify({
                    id,
                    result: {
                        targetInfos: this.pages.map(p => ({
                            targetId: p.id,
                            type: p.type,
                            title: p.title,
                            url: p.url,
                            attached: false,
                            browserContextId: 'default'
                        }))
                    }
                }));
            } else if (method === 'Target.attachToTarget') {
                ws.send(JSON.stringify({
                    id,
                    result: { sessionId: `session-${params?.targetId || '1'}` }
                }));
            } else if (method === 'Page.enable' || method === 'Runtime.enable' || method === 'DOM.enable' || method === 'CSS.enable' || method === 'Network.enable') {
                ws.send(JSON.stringify({ id, result: {} }));
            } else if (method === 'Page.getFrameTree') {
                ws.send(JSON.stringify({
                    id,
                    result: {
                        frameTree: {
                            frame: {
                                id: 'frame-1',
                                loaderId: 'loader-1',
                                url: this.targetUrl,
                                securityOrigin: 'https://higgsfield.ai',
                                mimeType: 'text/html'
                            },
                            childFrames: []
                        }
                    }
                }));
            } else if (method === 'Page.navigate') {
                if (params && params.url) {
                    this.targetUrl = params.url;
                    if (this.pages[0]) this.pages[0].url = params.url;
                }
                ws.send(JSON.stringify({
                    id,
                    result: { frameId: 'frame-1', loaderId: 'loader-1' }
                }));
                // Emit load events
                setTimeout(() => {
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({
                            method: 'Page.frameNavigated',
                            params: { frame: { id: 'frame-1', url: this.targetUrl } }
                        }));
                        ws.send(JSON.stringify({
                            method: 'Page.loadEventFired',
                            params: { timestamp: Date.now() / 1000 }
                        }));
                    }
                }, 50);
            } else if (method === 'Page.captureScreenshot') {
                // Return 1x1 transparent JPEG base64
                const mockBase64 = '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
                ws.send(JSON.stringify({
                    id,
                    result: { data: mockBase64 }
                }));
            } else if (method === 'Runtime.evaluate') {
                ws.send(JSON.stringify({
                    id,
                    result: {
                        result: {
                            type: 'string',
                            value: 'mock_eval_result'
                        }
                    }
                }));
            } else if (method === 'Browser.getVersion') {
                ws.send(JSON.stringify({
                    id,
                    result: {
                        protocolVersion: '1.3',
                        product: 'Chrome/124.0.6367.60',
                        revision: '@12345678',
                        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0.0.0',
                        jsVersion: '12.4.254.14'
                    }
                }));
            } else {
                // Default acknowledgment for other CDP commands
                ws.send(JSON.stringify({
                    id,
                    result: {}
                }));
            }
        } catch (e) {
            // Silently ignore or send error
        }
    }

    /**
     * Helpers for test state mutation & verification
     */
    setResponding(state) {
        this.isResponding = state;
    }

    setErrorMode(state) {
        this.errorMode = state;
    }

    simulateDisconnect() {
        for (const ws of this.sockets) {
            try {
                ws.close(1001, 'Mock CDP server disconnected');
            } catch (e) {}
        }
        this.sockets.clear();
    }

    getCallHistory() {
        return [...this.callHistory];
    }

    clearCallHistory() {
        this.callHistory = [];
    }

    getConnectedClientsCount() {
        return this.sockets.size;
    }
}

/**
 * Standalone runner for testing or CLI invocation
 */
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const port = parseInt(process.env.CDP_PORT || '9333', 10);
    const mock = new MockCDPServer({ port });
    mock.start().then(() => {
        console.log(`[MockCDP] Mock Chrome CDP Server listening on http://127.0.0.1:${port}`);
    }).catch(err => {
        console.error('[MockCDP] Failed to start:', err.message);
        process.exit(1);
    });
}
