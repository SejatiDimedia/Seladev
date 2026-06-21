import dns from 'dns';
import { URL } from 'url';
import { ValidationError } from '../../lib/errors';

/**
 * Checks if an IP address (IPv4 or IPv6) belongs to a private, loopback, or link-local range.
 */
export function isPrivateIp(ip: string): boolean {
  const ipTrimmed = ip.trim().toLowerCase();

  // Localhost / Loopback shortcuts
  if (
    ipTrimmed === 'localhost' ||
    ipTrimmed === '::1' ||
    ipTrimmed === '0:0:0:0:0:0:0:1' ||
    ipTrimmed === '0000:0000:0000:0000:0000:0000:0000:0001'
  ) {
    return true;
  }

  // IPv4 Check
  const ipv4Regex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
  const ipv4Match = ipTrimmed.match(ipv4Regex);
  if (ipv4Match && ipv4Match.length === 5) {
    const o1 = Number(ipv4Match[1]);
    const o2 = Number(ipv4Match[2]);
    const o3 = Number(ipv4Match[3]);
    const o4 = Number(ipv4Match[4]);
    
    // Validate octet ranges
    if (o1 > 255 || o2 > 255 || o3 > 255 || o4 > 255) {
      return false;
    }

    // 127.0.0.0/8 (Loopback)
    if (o1 === 127) return true;
    
    // 10.0.0.0/8 (Private Network)
    if (o1 === 10) return true;
    
    // 172.16.0.0/12 (Private Network)
    if (o1 === 172 && o2 >= 16 && o2 <= 31) return true;
    
    // 192.168.0.0/16 (Private Network)
    if (o1 === 192 && o2 === 168) return true;
    
    // 169.254.0.0/16 (Link-local / Cloud Metadata API)
    if (o1 === 169 && o2 === 254) return true;

    return false;
  }

  // IPv6 Check
  // Unique Local Addresses (fc00::/7) start with "fc" or "fd"
  if (ipTrimmed.startsWith('fc') || ipTrimmed.startsWith('fd')) {
    return true;
  }

  // Link-Local Addresses (fe80::/10) start with "fe8", "fe9", "fea", or "feb"
  if (
    ipTrimmed.startsWith('fe8') ||
    ipTrimmed.startsWith('fe9') ||
    ipTrimmed.startsWith('fea') ||
    ipTrimmed.startsWith('feb')
  ) {
    return true;
  }

  return false;
}

/**
 * Validates a target URL for webhooks.
 * Ensures the protocol is HTTPS and resolves the hostname via DNS, ensuring no resolved IP is private.
 */
export async function validateWebhookUrl(urlStr: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch (err) {
    throw new ValidationError([], 'Webhook URL must be a valid absolute URL');
  }

  if (parsed.protocol !== 'https:') {
    throw new ValidationError([], 'Webhook URL must use HTTPS');
  }

  const hostname = parsed.hostname;

  try {
    const addresses = await dns.promises.lookup(hostname, { all: true });
    
    if (!addresses || addresses.length === 0) {
      throw new ValidationError([], `Could not resolve hostname: ${hostname}`);
    }

    for (const { address } of addresses) {
      if (isPrivateIp(address)) {
        throw new ValidationError([], `Webhook URL resolves to a blocked IP address: ${address}`);
      }
    }
  } catch (err: any) {
    if (err instanceof ValidationError) {
      throw err;
    }
    throw new ValidationError([], `Failed to resolve webhook target hostname '${hostname}': ${err.message}`);
  }
}
