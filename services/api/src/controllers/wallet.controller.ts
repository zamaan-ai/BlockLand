import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { ethers } from 'ethers';
import prisma from '../lib/prisma';
import { cacheGet, cacheSet, cacheDel } from '../lib/cache';
import { success, error } from '../lib/response';
import { logAction } from '../lib/auditLogger';

export const walletChallenge = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const walletAddress = String(req.body.walletAddress || '').trim();
    if (!ethers.isAddress(walletAddress)) return error(res, 'Valid walletAddress required', 400);
    const nonce = crypto.randomBytes(24).toString('hex');
    const message = `BlockLand wallet ownership verification\nUser: ${req.user!.id}\nWallet: ${walletAddress}\nNonce: ${nonce}`;
    await cacheSet(`wallet-challenge:${req.user!.id}:${walletAddress.toLowerCase()}`, { message, nonce }, 300);
    return success(res, { message, expiresIn: 300 }, 'Challenge created');
  } catch (err) { next(err); }
};

export const verifyWallet = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const walletAddress = String(req.body.walletAddress || '').trim();
    const signature = String(req.body.signature || '');
    const key = `wallet-challenge:${req.user!.id}:${walletAddress.toLowerCase()}`;
    const challenge = await cacheGet<{ message: string; nonce: string }>(key);
    if (!challenge) return error(res, 'Challenge expired', 400);
    const recovered = ethers.verifyMessage(challenge.message, signature);
    if (recovered.toLowerCase() !== walletAddress.toLowerCase()) return error(res, 'Wallet signature does not match', 401);
    const user = await prisma.$transaction(async (tx) => {
      const updatedUser = await tx.user.update({ where: { id: req.user!.id }, data: { walletAddress } });
      await tx.land.updateMany({ where: { ownerId: req.user!.id, ownerWallet: null }, data: { ownerWallet: walletAddress } });
      return updatedUser;
    });
    await cacheDel(key);
    await logAction('WALLET_VERIFIED', req.user!.id, 'User', req.user!.id, { walletAddress });
    return success(res, { user: { id: user.id, walletAddress: user.walletAddress } }, 'Wallet verified');
  } catch (err) { next(err); }
};
