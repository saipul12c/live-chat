// Utility crypto helpers using Web Crypto API
async function sha256(text) {
    const enc = new TextEncoder();
    const data = enc.encode(text);
    const hash = await crypto.subtle.digest('SHA-256', data);
    return new Uint8Array(hash);
}

function toArrayBuffer(str) {
    return new TextEncoder().encode(str);
}

function concatUint8(a, b) {
    const c = new Uint8Array(a.length + b.length);
    c.set(a, 0);
    c.set(b, a.length);
    return c;
}

function arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

function base64ToArrayBuffer(base64) {
    const binary = atob(base64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
}

// Derive an AES-GCM 256-bit key from passphrase and salt
async function deriveKey(passphrase, saltBytes) {
    const passKey = await crypto.subtle.importKey(
        'raw',
        toArrayBuffer(passphrase),
        { name: 'PBKDF2' },
        false,
        ['deriveKey']
    );

    const key = await crypto.subtle.deriveKey(
        {
            name: 'PBKDF2',
            salt: saltBytes,
            iterations: 200000,
            hash: 'SHA-256'
        },
        passKey,
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt']
    );

    return key;
}

// Encrypt text -> base64 of (iv || ciphertext)
async function encryptText(plainText, key) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoded = toArrayBuffer(plainText);
    const cipherBuffer = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: iv },
        key,
        encoded
    );

    const combined = concatUint8(iv, new Uint8Array(cipherBuffer));
    return arrayBufferToBase64(combined.buffer);
}

// Decrypt base64 (iv || ciphertext) -> plaintext
async function decryptText(base64Combined, key) {
    try {
        const combinedBuf = base64ToArrayBuffer(base64Combined);
        const combined = new Uint8Array(combinedBuf);
        const iv = combined.slice(0, 12);
        const ciphertext = combined.slice(12);
        const plainBuffer = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: iv },
            key,
            ciphertext
        );
        return new TextDecoder().decode(plainBuffer);
    } catch (e) {
        console.error('Decrypt failed', e);
        throw e;
    }
}

// Convenience: compute salt from two ids (stable ordering)
async function computeSaltForPair(idA, idB) {
    const sorted = [String(idA), String(idB)].sort().join(':');
    return await sha256(sorted);
}

// Exported helpers
window.E2E = {
    deriveKey,
    encryptText,
    decryptText,
    computeSaltForPair
};
