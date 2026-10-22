import fs from 'fs';
import crypto from 'crypto';

export async function pinFileToIpfs(filePath: string, name: string): Promise<{ ipfsHash: string; pinned: boolean }> {
  const key = process.env.PINATA_API_KEY;
  const secret = process.env.PINATA_SECRET_KEY;
  const jwt = process.env.PINATA_JWT;

  if ((key && secret) || jwt) {
    const bytes = fs.readFileSync(filePath);
    const form = new FormData();
    form.append('file', new Blob([bytes]), name);
    const headers: Record<string, string> = {};
    if (jwt) headers.Authorization = `Bearer ${jwt}`;
    else {
      headers.pinata_api_key = key as string;
      headers.pinata_secret_api_key = secret as string;
    }
    const res = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', { method: 'POST', headers, body: form });
    if (!res.ok) throw new Error(`Pinata upload failed: ${res.status}`);
    const data = (await res.json()) as { IpfsHash: string };
    return { ipfsHash: data.IpfsHash, pinned: true };
  }

  const buf = fs.readFileSync(filePath);
  const mock = 'bafy' + crypto.createHash('sha256').update(buf).digest('hex').slice(0, 46);
  console.log('[ipfs:demo]', { name, ipfsHash: mock });
  return { ipfsHash: mock, pinned: false };
}
