import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import * as authController from '../controllers/auth.controller';
import * as identityController from '../controllers/identity.controller';
import * as walletController from '../controllers/wallet.controller';

const router = Router();

/**
 * @openapi
 * /auth/register:
 *   post:
 *     summary: Register with email and password
 *     tags: [Auth]
 *     security: []
 */
router.post('/register', authController.register);
/**
 * @openapi
 * /auth/login:
 *   post:
 *     summary: Login with email and password
 *     tags: [Auth]
 *     security: []
 */
router.post('/login', authController.login);
router.get('/me', authenticate, authController.me);
router.post('/switch-role', authenticate, authController.switchRole);
router.post('/wallet/challenge', authenticate, walletController.walletChallenge);
router.post('/wallet/verify', authenticate, walletController.verifyWallet);
router.post('/identity/otp/send', authenticate, identityController.sendIdentityOtp);
router.post('/identity/otp/verify', authenticate, identityController.verifyIdentityOtp);
router.post('/verify-email', authController.verifyEmail);
router.get('/verify-email', authController.verifyEmail);
/**
 * @openapi
 * /auth/google:
 *   post:
 *     summary: Google OAuth (ID token or demo)
 *     tags: [Auth]
 *     security: []
 */
router.post('/google', authController.googleAuth);
router.post('/otp/send', authController.sendAadhaarOtp);
router.post('/otp/verify', authController.verifyAadhaarOtp);

export default router;
