import tls from 'node:tls';
import net from 'node:net';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const [host, dir] = process.argv.slice(2);
if (!host || !dir) throw new Error('Usage: node test-frp-tls.mjs <host> <private-pki-directory>');
const ca = await readFile(`${dir}/ca.crt`);
const cert = await readFile(`${dir}/client.crt`);
const key = await readFile(`${dir}/client.key`);
function handshake(options, shouldPass) {
    return new Promise((resolve, reject) => {
        let timer;
        const socket = tls.connect({ host, port: 7000, servername: host, ca, rejectUnauthorized: true, ...options });
        const deadline = setTimeout(() => { socket.destroy(); reject(new Error('TLS probe timed out')); }, 8000);
        socket.once('secureConnect', () => {
            // TLS 1.3 can deliver a client-certificate alert just after this event.
            timer = setTimeout(() => {
                clearTimeout(deadline);
                socket.destroy();
                shouldPass ? resolve(socket.getProtocol()) : reject(new Error('Unauthenticated TLS connection survived'));
            }, 400);
        });
        socket.once('error', error => {
            clearTimeout(timer); clearTimeout(deadline);
            socket.destroy();
            shouldPass ? reject(error) : resolve(error.code);
        });
    });
}
await handshake({ cert, key }, true);
console.log('PASS: verified server identity and authorized client certificate.');
await handshake({}, false);
console.log('PASS: missing client certificate rejected.');
await handshake({ cert, key, ca: [] }, false);
console.log('PASS: untrusted server certificate rejected.');
await handshake({ cert, key, servername: 'wrong-host.invalid' }, false);
console.log('PASS: wrong server name rejected.');
await new Promise((resolve, reject) => {
    let received = 0;
    const socket = net.connect({ host, port: 7000 }, () => socket.write('GET / HTTP/1.1\r\nHost: test\r\n\r\n'));
    const timer = setTimeout(() => { socket.destroy(); reject(new Error('Plaintext connection was not closed')); }, 5000);
    socket.on('data', data => { received += data.length; });
    socket.on('error', () => {});
    socket.once('close', () => { clearTimeout(timer); assert.equal(received, 0); resolve(); });
});
console.log('PASS: plaintext connection rejected.');
