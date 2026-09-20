#!/usr/bin/env python3
"""Issue an Authelia reset link via its private API, not by signing a token.

With --emit-private-link, stdout is SENSITIVE and must be captured directly into
the owner's private delivery artifact. Never log it or paste it into chat.
"""
import argparse
import base64
import html
import json
from pathlib import Path
import re
import subprocess
import time
from urllib.parse import urlsplit


def extract_link(message, public_url):
    matches = set(re.findall(re.escape(public_url.rstrip('/')) +
                             r'/reset-password/step2\?token=[A-Za-z0-9_.-]+', html.unescape(message)))
    if len(matches) != 1:
        raise RuntimeError('Expected one newly generated reset link for the configured portal.')
    return matches.pop()


def new_notification(previous, current):
    # Authelia replaces its filesystem notification, rather than appending it.
    # A prior file-size offset can skip the new message (or read nothing).
    if not current or current == previous or len(current) > 65536:
        raise RuntimeError('No fresh bounded notification was available. No link was delivered.')
    return current.decode('utf-8')


def validate_delivery_claims(claims, username, started, now):
    # This is a delivery/freshness check, not a replacement for Authelia's
    # signature, action and one-time-record validation in the browser flow.
    if claims.get('username') != username or not started - 5 <= claims.get('iat', 0) <= now + 5:
        raise RuntimeError('The notification does not match this reset request. No link was delivered.')
    expires = claims.get('exp', 0)
    if not now < expires <= now + 900:
        raise RuntimeError('Unexpected reset-link expiry. No link was delivered.')
    return expires


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--public-url', required=True)
    parser.add_argument('--username', default='owner')
    parser.add_argument('--directory', type=Path, default=Path('/opt/hapi-gateway'))
    parser.add_argument('--emit-private-link', action='store_true', required=True)
    args = parser.parse_args()
    public = urlsplit(args.public_url)
    if public.scheme != 'https' or not public.hostname or public.username or public.query or public.fragment or public.path != '/auth':
        parser.error('Expected the exact HTTPS /auth portal URL without credentials, query or fragment.')
    if not re.fullmatch(r'[a-z][a-z0-9_-]{2,31}', args.username):
        parser.error('Invalid username.')
    notifier = args.directory / 'authelia-data' / 'enrollment-notifications.txt'
    previous = notifier.read_bytes() if notifier.exists() else b''
    started = time.time()
    result = subprocess.run([
        'docker', 'exec', 'hapi-authelia', 'wget', '-q', '-O', '-',
        '--header', 'Host: ' + public.netloc,
        '--header', 'X-Forwarded-Host: ' + public.netloc,
        '--header', 'X-Forwarded-Proto: https',
        '--header', 'Content-Type: application/json',
        '--post-data', json.dumps({'username': args.username}),
        'http://127.0.0.1:9091/auth/api/reset-password/identity/start',
    ], capture_output=True)
    if result.returncode or json.loads(result.stdout).get('status') != 'OK':
        raise RuntimeError('The private Authelia reset request failed. No link was delivered.')
    with notifier.open('rb') as stream:
        message = new_notification(previous, stream.read(65537))
    link = extract_link(message, args.public_url)
    token = link.split('?token=', 1)[1]
    payload = token.split('.')[1]
    claims = json.loads(base64.urlsafe_b64decode(payload + '=' * (-len(payload) % 4)))
    # Decode expiry only for display. The real Authelia endpoint validates the
    # signature, issuer, action, expiry and one-time database record.
    expires = validate_delivery_claims(claims, args.username, started, time.time())
    print(json.dumps({'url': link, 'expires_unix': expires, 'username': args.username}))


if __name__ == '__main__':
    main()
