import { Router } from 'express';
import { authenticate, optionalAuth } from '../middleware/auth';
import * as controller from '../controllers/engagement.controller';

const router = Router();

router.post('/site-visits', optionalAuth, controller.createSiteVisit);
router.get('/site-visits', authenticate, controller.listSiteVisits);
router.post('/reviews', optionalAuth, controller.createReview);
router.get('/reviews', optionalAuth, controller.listReviews);
router.post('/enquiries', optionalAuth, controller.createEnquiry);

export default router;
