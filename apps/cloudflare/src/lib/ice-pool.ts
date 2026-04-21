export function getDefaultIcePool(): RTCIceServer[] {
  return [
    { urls: ["stun:stun.cloudflare.com:3478"] },
    { urls: ["stun:stun.l.google.com:19302"] },
    { urls: ["stun:stun1.l.google.com:19302"] },
    { urls: ["stun:stun.miwifi.com:3478"] }
  ];
}
