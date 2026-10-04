export function sameOrigin(request: Request) {
  const header = request.headers.get('origin');
  if (!header) return false;

  try {
    const origin = new URL(header);
    if (origin.origin !== header || (origin.protocol !== 'https:' && origin.protocol !== 'http:')) return false;

    // Render terminates HTTPS before forwarding the request to the Node server.
    const host = (request.headers.get('x-forwarded-host') || request.headers.get('host') || new URL(request.url).host).split(',')[0].trim();
    const protocol = (request.headers.get('x-forwarded-proto') || new URL(request.url).protocol.slice(0, -1)).split(',')[0].trim().toLowerCase();
    return origin.host.toLowerCase() === host.toLowerCase() && origin.protocol === `${protocol}:`;
  } catch {
    return false;
  }
}
