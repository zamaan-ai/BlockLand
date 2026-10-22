import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { ethers } from 'ethers';
import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import { success, error } from '../lib/response';
import { logAction } from '../lib/auditLogger';
import { emitTransferUpdate } from '../lib/socketEvents';
import { runFraudChecks } from '../lib/fraudDetection';
import { isWithinActiveJurisdiction } from '../lib/authorization';
import { cacheDel, cacheGet, cacheSet } from '../lib/cache';
import { sendOtpEmail } from '../lib/email';
import { getSocketServer } from '../lib/socket';
import { notifySavedPropertyWatchers } from '../lib/watchlistNotifications';

const activeStatuses = ['INITIATED', 'LOCKED', 'ESCROW_FUNDED', 'UNDER_REVIEW', 'APPROVED'] as const;

export const prepareTransfer = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const landId = String(req.body.landId || '');
    const submittedWallet = String(req.body.toWalletAddress || '').trim();
    const amountTextInput = String(req.body.amount ?? '');
    const amount = Number(amountTextInput);
    if (!landId || !ethers.isAddress(submittedWallet) || !/^\d{1,18}(?:\.\d{1,2})?$/.test(amountTextInput) || !Number.isFinite(amount) || amount <= 0) {
      return error(res, 'A valid plot, buyer wallet, and positive sale amount with at most two decimals are required', 400);
    }
    const toWalletAddress = ethers.getAddress(submittedWallet);
    const land = await prisma.land.findUnique({ where: { id: landId }, select: { id: true, plotId: true, ownerId: true, ownerWallet: true, status: true, lockTransferId: true, transferFrozen: true, encumbrances: { where: { active: true }, select: { id: true } }, disputes: { where: { status: { in: ['OPEN', 'UNDER_REVIEW'] } }, select: { id: true } } } });
    if (!land) return error(res, 'Land not found', 404);
    if (land.ownerId !== req.user!.id) return error(res, 'Only the current plot owner can initiate a sale', 403);
    if (!['VERIFIED', 'TRANSFERRED'].includes(land.status) || land.transferFrozen || land.lockTransferId || land.encumbrances.length || land.disputes.length) {
      return error(res, 'This plot is not eligible for transfer due to its verification, freeze, lock, or restriction status', 409);
    }
    if (!req.user!.walletAddress || land.ownerWallet?.toLowerCase() !== req.user!.walletAddress.toLowerCase()) return error(res, 'Connect and verify the wallet recorded as this plot owner before starting a sale', 409);
    const buyer = await prisma.user.findUnique({ where: { walletAddress: toWalletAddress }, select: { id: true } });
    if (!buyer || buyer.id === req.user!.id) return error(res, 'Buyer wallet must belong to another registered account', 400);
    if (!req.user!.email || !req.user!.emailVerified) return error(res, 'A verified email address is required to receive the sale OTP', 400);

    const nonce = crypto.randomBytes(24).toString('hex');
    const amountText = amount.toFixed(2);
    const message = [
      'BlockLand land sale authorization',
      `Owner: ${req.user!.id}`,
      `Plot: ${land.plotId}`,
      `Land record: ${land.id}`,
      `Buyer wallet: ${toWalletAddress}`,
      `Amount INR: ${amountText}`,
      `Nonce: ${nonce}`,
    ].join('\n');
    const otp = String(crypto.randomInt(100000, 1000000));
    const otpKey = `transfer-sale-otp:${req.user!.id}:${land.id}`;
    const rateKey = `transfer-sale-otp-rate:${req.user!.id}:${land.id}`;
    if (await cacheGet(rateKey)) return error(res, 'A sale OTP was sent recently. Wait one minute before requesting another.', 429);
    await cacheSet(`transfer-sale-challenge:${req.user!.id}:${land.id}`, { message, nonce, toWalletAddress, amount: amountText }, 300);
    await cacheSet(otpKey, { otp, nonce }, 600);
    await cacheSet(rateKey, true, 60);
    await sendOtpEmail(req.user!.email, otp);
    return success(res, { message, nonce, expiresIn: 300, otpExpiresIn: 600 }, 'Wallet authorization challenge created and OTP sent to your account email');
  } catch (err) { next(err); }
};

export const initiateTransfer = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { landId, toWalletAddress, notes, amount, sellerSignature, saleNonce, saleOtp } = req.body;
    if (!landId || !toWalletAddress || !amount || !sellerSignature || !saleNonce || !saleOtp) return error(res, 'landId, toWalletAddress, amount, wallet signature, sale nonce, and OTP are required', 400);
    const amountInput = String(amount);
    if (!ethers.isAddress(String(toWalletAddress)) || !/^\d{1,18}(?:\.\d{1,2})?$/.test(amountInput) || !Number.isFinite(Number(amountInput)) || Number(amountInput) <= 0) return error(res, 'A valid buyer wallet and positive amount with at most two decimals are required', 400);
    const normalizedBuyerWallet = ethers.getAddress(String(toWalletAddress));
    const idempotencyKey = req.headers['idempotency-key'] ? String(req.headers['idempotency-key']) : undefined;
    if (idempotencyKey) {
      const existing = await prisma.transfer.findUnique({ where: { idempotencyKey } });
      if (existing) return existing.fromUserId === req.user!.id
        ? success(res, { transfer: existing }, 'Existing idempotent transfer')
        : error(res, 'Transfer not found', 404);
    }

    const challengeKey = `transfer-sale-challenge:${req.user!.id}:${String(landId)}`;
    const otpKey = `transfer-sale-otp:${req.user!.id}:${String(landId)}`;
    const challenge = await cacheGet<{ message: string; nonce: string; toWalletAddress: string; amount: string }>(challengeKey);
    const otp = await cacheGet<{ otp: string; nonce: string }>(otpKey);
    if (!challenge || !otp || challenge.nonce !== String(saleNonce) || otp.nonce !== String(saleNonce) || challenge.toWalletAddress.toLowerCase() !== normalizedBuyerWallet.toLowerCase() || challenge.amount !== Number(amountInput).toFixed(2)) {
      return error(res, 'Sale authorization has expired or does not match this transfer. Prepare the sale again.', 400);
    }
    if (otp.otp !== String(saleOtp)) return error(res, 'Invalid sale OTP', 401);
    const landAuthorization = await prisma.land.findUnique({ where: { id: String(landId) }, select: { ownerId: true, ownerWallet: true, transferFrozen: true } });
    if (!landAuthorization || landAuthorization.ownerId !== req.user!.id || landAuthorization.transferFrozen || !req.user!.walletAddress || landAuthorization.ownerWallet?.toLowerCase() !== req.user!.walletAddress.toLowerCase()) {
      return error(res, 'Current owner or verified wallet does not match the sale authorization', 403);
    }
    let signerAddress: string;
    try { signerAddress = ethers.verifyMessage(challenge.message, String(sellerSignature)); }
    catch { return error(res, 'Invalid wallet signature', 401); }
    if (signerAddress.toLowerCase() !== req.user!.walletAddress.toLowerCase()) return error(res, 'Wallet signature does not match the registered plot owner', 401);
    await cacheDel(challengeKey);
    await cacheDel(otpKey);

    const transfer = await prisma.$transaction(async (tx) => {
      const land = await tx.land.findUnique({ where: { id: landId }, include: { encumbrances: { where: { active: true } }, disputes: { where: { status: { in: ['OPEN', 'UNDER_REVIEW'] } } } } });
      if (!land) throw new Error('LAND_NOT_FOUND');
      if (land.ownerId !== req.user!.id) throw new Error('FORBIDDEN');
      if (!['VERIFIED', 'TRANSFERRED'].includes(land.status)) throw new Error('LAND_NOT_VERIFIED');
      if (land.transferFrozen) throw new Error('LAND_FROZEN');
      if (land.encumbrances.length || land.disputes.length) throw new Error('LAND_BLOCKED');
      const existing = await tx.transfer.findFirst({ where: { landId, status: { in: [...activeStatuses] } } });
      if (existing || land.lockTransferId) throw new Error('LAND_LOCKED');
      const buyer = await tx.user.findUnique({ where: { walletAddress: normalizedBuyerWallet } });
      if (!buyer) throw new Error('BUYER_NOT_FOUND');
      const now = new Date();
      const cooldownEndsAt = new Date(now.getTime() + 48 * 60 * 60 * 1000);
      const created = await tx.transfer.create({ data: { idempotencyKey, landId, fromUserId: req.user!.id, toUserId: buyer.id, toWalletAddress: normalizedBuyerWallet, notes, sellerSignature, sellerOtpVerified: true, buyerVerified: buyer.isVerified, status: 'LOCKED', cooldownEndsAt, lockExpiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000), escrow: { create: { amount: amountInput, currency: 'INR', status: 'PENDING' } } } });
      await tx.land.update({ where: { id: landId }, data: { status: 'LOCKED_FOR_SALE', lockTransferId: created.id } });
      await tx.notification.create({ data: { userId: req.user!.id, type: 'SALE_LOCKED', title: 'Sale request locked', message: `Transfer ${created.id} is in progress.` } });
      if (buyer.id !== req.user!.id) {
        await tx.notification.create({ data: { userId: buyer.id, type: 'PURCHASE_REQUEST', title: 'Purchase initiated', message: `A transfer request was opened for ${land.plotId}.` } });
      }
      await notifySavedPropertyWatchers(tx, land.id, 'WATCHLIST_TRANSFER_LOCKED', 'Watchlisted property locked for transfer', `An owner has started a sale for ${land.plotId}.`, [req.user!.id, buyer.id]);
      return created;
    });
    await runFraudChecks(landId, req.user!.id);
    await logAction('TRANSFER_LOCKED', req.user!.id, 'Transfer', transfer.id);
    emitTransferUpdate(getSocketServer(), transfer.id, 'LOCKED');
    return success(res, { transfer }, 'Transfer initiated and land locked', 201);
  } catch (err) {
    const message = (err as Error).message;
    const map: Record<string, [string, number]> = { LAND_NOT_FOUND: ['Land not found', 404], FORBIDDEN: ['You do not own this land', 403], LAND_NOT_VERIFIED: ['Land must be verified', 400], LAND_BLOCKED: ['Land has an active dispute or encumbrance', 400], LAND_LOCKED: ['A transfer is already active', 409], LAND_FROZEN: ['Owner has frozen transfers for this plot', 423], BUYER_NOT_FOUND: ['Buyer wallet is not registered', 400] };
    if (map[message]) return error(res, map[message][0], map[message][1]);
    next(err);
  }
};

export const cancelTransfer = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const transfer = await prisma.transfer.findUnique({
      where: { id: String(req.params.transferId) },
      include: {
        escrow: true,
        land: {
          include: {
            disputes: { where: { status: { in: ['OPEN', 'UNDER_REVIEW'] } } },
            encumbrances: { where: { active: true } },
          },
        },
      },
    });
    if (!transfer || transfer.fromUserId !== req.user!.id) return error(res, 'Transfer not found', 404);
    if (!['LOCKED', 'INITIATED'].includes(transfer.status) || transfer.escrow?.status === 'FUNDED') return error(res, 'A sale can only be cancelled before escrow is funded', 409);
    const restoredStatus = transfer.land.disputes.length ? 'DISPUTED' : transfer.land.encumbrances.length ? 'MORTGAGED' : 'VERIFIED';
    const cancelled = await prisma.$transaction(async (tx) => {
      const updated = await tx.transfer.update({ where: { id: transfer.id }, data: { status: 'CANCELLED' } });
      await tx.land.update({ where: { id: transfer.landId }, data: { status: restoredStatus, lockTransferId: null } });
      if (transfer.escrow) await tx.escrowAccount.update({ where: { transferId: transfer.id }, data: { status: 'FAILED', refundReference: 'Cancelled before escrow funding' } });
      if (transfer.toUserId) await tx.notification.create({ data: { userId: transfer.toUserId, type: 'TRANSFER_CANCELLED', title: 'Sale cancelled', message: `The owner cancelled transfer ${transfer.id} before escrow funding.` } });
      await notifySavedPropertyWatchers(tx, transfer.landId, 'WATCHLIST_TRANSFER_CANCELLED', 'Watchlisted property sale cancelled', `The active sale lock on ${transfer.land.plotId} was cancelled.`, [transfer.fromUserId]);
      return updated;
    });
    await logAction('TRANSFER_CANCELLED_BY_OWNER', req.user!.id, 'Transfer', transfer.id);
    emitTransferUpdate(getSocketServer(), transfer.id, 'CANCELLED');
    return success(res, { transfer: cancelled }, 'Sale cancelled and plot unlocked');
  } catch (err) { next(err); }
};

export const fundEscrow = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const transfer = await prisma.transfer.findUnique({ where: { id: String(req.params.transferId) }, include: { escrow: true } });
    if (!transfer || (transfer.fromUserId !== req.user!.id && transfer.toUserId !== req.user!.id)) return error(res, 'Transfer not found', 404);
    if (!transfer.escrow || !['LOCKED', 'INITIATED'].includes(transfer.status)) return error(res, 'Transfer is not ready for escrow', 400);
    const updated = await prisma.$transaction(async (tx) => {
      await tx.escrowAccount.update({ where: { transferId: transfer.id }, data: { status: 'FUNDED', fundedAt: new Date(), provider: 'DEMO_ESCROW', depositReference: `demo-${Date.now()}` } });
      return tx.transfer.update({ where: { id: transfer.id }, data: { status: 'ESCROW_FUNDED' } });
    });
    await logAction('ESCROW_FUNDED', req.user!.id, 'Transfer', transfer.id);
    emitTransferUpdate(getSocketServer(), transfer.id, 'ESCROW_FUNDED');
    return success(res, { transfer: updated }, 'Escrow funded');
  } catch (err) { next(err); }
};

export const listTransfers = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const where: Prisma.TransferWhereInput = req.user!.role === 'ADMIN'
      ? {}
      : req.user!.role === 'GOVERNMENT'
        ? { land: req.roleAssignment?.jurisdiction === '*' ? {} : { state: { equals: req.roleAssignment?.jurisdiction || '__no_assigned_jurisdiction__', mode: 'insensitive' } } }
        : { OR: [{ fromUserId: req.user!.id }, { toUserId: req.user!.id }] };
    const transfers = await prisma.transfer.findMany({ where, include: { land: true, escrow: true, fromUser: { select: { id: true, name: true, walletAddress: true } }, toUser: { select: { id: true, name: true, walletAddress: true } }, approvals: true }, orderBy: { createdAt: 'desc' } });
    return success(res, { transfers, count: transfers.length });
  } catch (err) { next(err); }
};

export const getTransferDetail = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const transfer = await prisma.transfer.findUnique({
      where: { id: String(req.params.transferId) },
      include: {
        land: { select: { id: true, plotId: true, title: true, state: true, district: true, status: true, tokenId: true, blockchainTxHash: true } },
        escrow: true,
        approvals: { include: { officer: { select: { id: true, name: true } } } },
        fromUser: { select: { id: true, name: true, walletAddress: true, isVerified: true } },
        toUser: { select: { id: true, name: true, walletAddress: true, isVerified: true } },
        documents: { select: { id: true, name: true, originalName: true, mimeType: true, size: true, sha256Hash: true, documentType: true, isVerified: true, createdAt: true } },
      },
    });
    if (!transfer) return error(res, 'Not found', 404);
    const participant = transfer.fromUserId === req.user!.id || transfer.toUserId === req.user!.id;
    const allowed = req.user!.role === 'ADMIN'
      || participant
      || (req.user!.role === 'GOVERNMENT' && isWithinActiveJurisdiction(req, transfer.land.state));
    if (!allowed) return error(res, 'Forbidden', 403);
    return success(res, { transfer });
  } catch (err) { next(err); }
};

export const approveTransfer = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const transfer = await prisma.transfer.findUnique({
      where: { id: String(req.params.transferId) },
      include: {
        escrow: true,
        approvals: true,
        land: {
          include: {
            disputes: { where: { status: { in: ['OPEN', 'UNDER_REVIEW'] } } },
            encumbrances: { where: { active: true } },
            fraudFlags: { where: { status: { in: ['OPEN', 'UNDER_REVIEW'] }, severity: { in: ['HIGH', 'CRITICAL'] } } },
          },
        },
      },
    });
    if (!transfer || !['ESCROW_FUNDED', 'UNDER_REVIEW', 'LOCKED'].includes(transfer.status)) return error(res, 'Transfer is not awaiting approval', 400);
    if (!isWithinActiveJurisdiction(req, transfer.land.state)) return error(res, 'Outside your assigned jurisdiction', 403);
    if (transfer.fromUserId === req.user!.id || transfer.toUserId === req.user!.id) return error(res, 'An officer cannot approve a transfer where they are a party', 403);
    if (transfer.land.disputes.length || transfer.land.encumbrances.length) return error(res, 'This plot has an active dispute or encumbrance and cannot be transferred', 409);
    if (transfer.cooldownEndsAt && transfer.cooldownEndsAt > new Date()) return error(res, 'Cooling-off period has not ended', 400);
    if (!transfer.escrow || transfer.escrow.status !== 'FUNDED') return error(res, 'Escrow must be funded', 400);
    if (transfer.approvals.some((approval) => approval.officerId === req.user!.id)) return error(res, 'You have already approved this transfer', 409);
    const approvalThreshold = Number(process.env.SECOND_APPROVAL_THRESHOLD_INR || 5000000);
    const requiresSecondApproval = transfer.land.fraudFlags.length > 0 || Number(transfer.escrow.amount) >= approvalThreshold;
    if (requiresSecondApproval && transfer.approvals.length === 0) {
      const pending = await prisma.$transaction(async (tx) => {
        await tx.transferApproval.create({ data: { transferId: transfer.id, officerId: req.user!.id, approved: true, notes: req.body.notes } });
        return tx.transfer.update({ where: { id: transfer.id }, data: { status: 'UNDER_REVIEW' } });
      });
      await logAction('TRANSFER_FIRST_APPROVAL_RECORDED', req.user!.id, 'Transfer', transfer.id, {
        reason: transfer.land.fraudFlags.length ? 'HIGH_RISK_FLAG' : 'HIGH_VALUE',
        approvalThreshold,
      });
      emitTransferUpdate(getSocketServer(), transfer.id, 'UNDER_REVIEW');
      return success(res, { transfer: pending, approvalsRequired: 2, approvalsReceived: 1 }, 'First approval recorded; a different authorized officer must approve this high-risk transfer');
    }
    const updated = await prisma.$transaction(async (tx) => {
      await tx.transferApproval.create({ data: { transferId: transfer.id, officerId: req.user!.id, approved: true, notes: req.body.notes } });
      const t = await tx.transfer.update({ where: { id: transfer.id }, data: { status: 'COMPLETED', approvedById: req.user!.id, approvedAt: new Date(), completedAt: new Date() } });
      await tx.land.update({ where: { id: t.landId }, data: { ownerId: t.toUserId!, ownerWallet: t.toWalletAddress, status: 'TRANSFERRED', lockTransferId: null } });
      await tx.escrowAccount.update({ where: { transferId: t.id }, data: { status: 'RELEASED', releasedAt: new Date() } });
      await tx.ownershipHistory.create({ data: { landId: t.landId, transferId: t.id, ownerId: t.toUserId!, ownerWallet: t.toWalletAddress, eventType: 'TRANSFER_COMPLETED' } });
      await tx.notification.create({ data: { userId: t.toUserId!, type: 'TRANSFER_COMPLETED', title: 'Land transfer completed', message: `Plot ${transfer.land.plotId} is now assigned to you.` } });
      await notifySavedPropertyWatchers(tx, t.landId, 'WATCHLIST_TRANSFER_COMPLETED', 'Watchlisted property ownership changed', `${transfer.land.plotId} has a completed ownership transfer.`);
      return t;
    });
    await logAction('TRANSFER_COMPLETED', req.user!.id, 'Transfer', transfer.id);
    emitTransferUpdate(getSocketServer(), transfer.id, 'COMPLETED');
    return success(res, { transfer: updated }, 'Transfer completed');
  } catch (err) {
    if (typeof err === 'object' && err !== null && 'code' in err && err.code === 'P2002') {
      return error(res, 'This officer has already approved this transfer', 409);
    }
    next(err);
  }
};

export const rejectTransfer = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const transfer = await prisma.transfer.findUnique({ where: { id: String(req.params.transferId) }, include: { escrow: true, land: { include: { disputes: { where: { status: { in: ['OPEN', 'UNDER_REVIEW'] } } }, encumbrances: { where: { active: true } } } } } });
    if (!transfer || ['COMPLETED', 'REJECTED', 'REFUNDED'].includes(transfer.status)) return error(res, 'Transfer already processed', 400);
    if (!isWithinActiveJurisdiction(req, transfer.land.state)) return error(res, 'Outside your assigned jurisdiction', 403);
    if (transfer.fromUserId === req.user!.id || transfer.toUserId === req.user!.id) return error(res, 'An officer cannot reject a transfer where they are a party', 403);
    if (!req.body.reason || !String(req.body.reason).trim()) return error(res, 'Reason required', 400);
    const updated = await prisma.$transaction(async (tx) => {
      const t = await tx.transfer.update({ where: { id: transfer.id }, data: { status: 'REFUNDED', rejectionReason: req.body.reason || 'Rejected by government' } });
      const restoredStatus = transfer.land.disputes.length ? 'DISPUTED' : transfer.land.encumbrances.length ? 'MORTGAGED' : 'VERIFIED';
      await tx.land.update({ where: { id: t.landId }, data: { status: restoredStatus, lockTransferId: null } });
      if (transfer.escrow?.status === 'FUNDED') {
        await tx.escrowAccount.update({ where: { transferId: t.id }, data: { status: 'REFUNDED', refundedAt: new Date(), refundReference: `refund-${Date.now()}` } });
      } else if (transfer.escrow) {
        await tx.escrowAccount.update({ where: { transferId: t.id }, data: { status: 'FAILED', refundReference: 'No escrow funds were received' } });
      }
      await tx.notification.createMany({
        data: [transfer.fromUserId, transfer.toUserId].filter((userId): userId is string => !!userId).map((userId) => ({
          userId, type: 'TRANSFER_REJECTED', title: 'Transfer rejected', message: `Transfer ${t.id} was rejected: ${String(req.body.reason).trim()}`,
        })),
      });
      return t;
    });
    await logAction('TRANSFER_REJECTED', req.user!.id, 'Transfer', transfer.id, { reason: req.body.reason });
    emitTransferUpdate(getSocketServer(), transfer.id, 'REFUNDED');
    return success(res, { transfer: updated }, 'Transfer rejected and escrow refunded');
  } catch (err) { next(err); }
};
