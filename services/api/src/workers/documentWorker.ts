import fs from 'fs';
import prisma from '../lib/prisma';
import { pinFileToIpfs } from '../lib/ipfs';
import { registerWorker } from '../lib/queue';
import { sendEmail } from '../lib/email';

registerWorker('pin-document', async (data) => {
  const documentId = String(data.documentId);
  const doc = await prisma.document.findUnique({
    where: { id: documentId },
    include: { user: true },
  });
  if (!doc || !fs.existsSync(doc.path)) return;
  const pinned = await pinFileToIpfs(doc.path, doc.originalName);
  await prisma.document.update({
    where: { id: doc.id },
    data: { ipfsHash: pinned.ipfsHash },
  });
  if (doc.user.email) {
    await sendEmail(
      doc.user.email,
      'Document processed',
      `<p>${doc.originalName} was hashed and queued for IPFS.</p><p>CID: ${pinned.ipfsHash}</p>`
    );
  }
});
