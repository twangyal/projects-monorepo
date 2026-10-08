import { createServer as netServer, type Socket } from 'node:net';
import { TLSSocket } from 'node:tls';
import { createServer as httpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { performance } from 'node:perf_hooks';
import { validateTransport, httpAuthority, type TransportConfig } from './transport.ts';
import { MAX_CONNECTIONS, LISTEN_BACKLOG, TLS_HANDSHAKE_MS, HEADER_TIMEOUT_MS, MAX_HEADER_BYTES, MAX_HEADER_FIELDS, SOCKET_IDLE_MS, CONNECTION_TIMEOUT_MS, BODY_TIMEOUT_MS, ADMISSION_TIMEOUT_MS, RESPONSE_TIMEOUT_MS, MotionError } from './types.ts';
export type RequestContext = {
    signal: AbortSignal;
    body(): void;
    processing(): void;
    response(): void;
    check(): void;
    destroy(): void;
};
export type Network = {
    origin: string;
    authority: string;
    port: number;
    close(): Promise<void>;
};
export async function bindNetwork(config: TransportConfig, handler: (request: IncomingMessage, response: ServerResponse, context: RequestContext) => void): Promise<Network> {
    validateTransport(config);
    const used = new WeakSet<Socket>();
    const sockets = new Set<Socket>();
    const contexts = new WeakMap<Socket, RequestContext>();
    let stopping = false;
    const parser = httpServer({ maxHeaderSize: MAX_HEADER_BYTES, insecureHTTPParser: false, headersTimeout: 0, requestTimeout: 0, connectionsCheckingInterval: 1000 }, (req, res) => {
        const context = contexts.get(req.socket);
        if (!context || stopping || used.has(req.socket)) {
            req.socket.destroy();
            return;
        }
        used.add(req.socket);
        res.shouldKeepAlive = false;
        handler(req, res, context);
    });
    parser.maxHeadersCount = 0;
    parser.maxRequestsPerSocket = 1;
    parser.on('clientError', (_error, socket) => socket.destroy());
    parser.on('checkContinue', (_req, res) => { res.destroy(); });
    parser.on('checkExpectation', (_req, res) => res.destroy());
    parser.on('upgrade', (_req, socket) => socket.destroy());
    parser.on('connect', (_req, socket) => socket.destroy());
    const listener = netServer({ pauseOnConnect: true }, raw => {
        if (stopping || sockets.size >= MAX_CONNECTIONS) {
            raw.destroy();
            return;
        }
        sockets.add(raw);
        let socket: Socket = raw;
        const abort = new AbortController();
        let timer: ReturnType<typeof setTimeout>;
        let deadline = 0;
        const total = performance.now() + CONNECTION_TIMEOUT_MS;
        let responseStarted = false;
        const destroy = () => { abort.abort(); socket.destroy(); raw.destroy(); };
        const phase = (ms: number) => { check(); deadline = Math.min(total, performance.now() + ms); clearTimeout(timer); timer = setTimeout(destroy, Math.max(0, deadline - performance.now())); timer.unref(); };
        const check = () => { if (abort.signal.aborted || performance.now() >= total || deadline > 0 && performance.now() >= deadline)
            throw new MotionError('timeout', 'The connection deadline expired.'); };
        const ctx: RequestContext = { signal: abort.signal, body: () => phase(BODY_TIMEOUT_MS), processing: () => { socket.setTimeout(0); phase(ADMISSION_TIMEOUT_MS); }, response: () => { if (!responseStarted) {
                socket.setTimeout(SOCKET_IDLE_MS, destroy);
                phase(RESPONSE_TIMEOUT_MS);
                responseStarted = true;
            }
            else
                check(); }, check, destroy };
        raw.once('close', () => { clearTimeout(timer); sockets.delete(raw); abort.abort(); });
        raw.on('error', () => destroy());
        const headers = () => {
            try {
                phase(HEADER_TIMEOUT_MS);
                socket.setTimeout(SOCKET_IDLE_MS, destroy);
                let parts: Buffer[] = [];
                let length = 0;
                const receive = (chunk: Buffer) => {
                    try {
                        check();
                        parts.push(chunk);
                        length += chunk.length;
                        const data = Buffer.concat(parts, length);
                        const end = data.indexOf('\r\n\r\n');
                        if (end < 0) {
                            if (length > MAX_HEADER_BYTES)
                                destroy();
                            return;
                        }
                        if (end + 4 > MAX_HEADER_BYTES) {
                            destroy();
                            return;
                        }
                        const lines = data.subarray(0, end).toString('latin1').split('\r\n');
                        const first = lines.shift()!;
                        // Explicit raw syntax guard rejects controls before Node normalizes headers.
                        // eslint-disable-next-line no-control-regex
                        if (!/^[A-Z]+ \/[^\x00-\x20\x7f]* HTTP\/1\.[01]$/.test(first) || lines.length > MAX_HEADER_FIELDS || lines.some(line => !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+:[\t\x20-\x7e\x80-\xff]*$/.test(line))) {
                            destroy();
                            return;
                        }
                        socket.pause();
                        socket.removeListener('data', receive);
                        parts = [];
                        contexts.set(socket, ctx);
                        socket.unshift(data);
                        parser.emit('connection', socket);
                        socket.resume();
                    }
                    catch {
                        destroy();
                    }
                };
                socket.on('data', receive);
                socket.resume();
            }
            catch {
                destroy();
            }
        };
        if (config.secureContext) {
            phase(TLS_HANDSHAKE_MS);
            const secure = new TLSSocket(raw, { isServer: true, secureContext: config.secureContext, ALPNProtocols: ['http/1.1'] });
            socket = secure;
            secure.on('error', destroy);
            secure.once('secure', () => { try {
                check();
                headers();
            }
            catch {
                destroy();
            } });
            secure.resume();
        }
        else
            headers();
    });
    await new Promise<void>((resolve, reject) => { listener.once('error', reject); listener.listen({ host: config.bind, port: config.port, backlog: LISTEN_BACKLOG }, () => { listener.removeListener('error', reject); resolve(); }); });
    listener.on('error', () => { });
    const address = listener.address();
    if (!address || typeof address === 'string')
        throw new MotionError('unavailable', 'Listener unavailable.');
    const port = address.port, authority = config.mode === 'https-lan' ? config.authority : httpAuthority(port), origin = config.mode === 'https-lan' ? config.origin : `http://${authority}`;
    return { origin, authority, port, close: async () => { stopping = true; const closed = new Promise<void>(resolve => listener.close(() => resolve())); for (const socket of sockets)
            socket.destroy(); await closed; parser.close(); } };
}
