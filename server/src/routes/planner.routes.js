import { Router } from 'express';
import requireAuth from '../middleware/auth.middleware.js';
import * as ctrl from '../controllers/planner.controller.js';

const router = Router();

router.use(requireAuth);

// People the share picker can offer (the user's accepted connections).
router.get('/connections', ctrl.shareCandidates);

// Plans (visibility + role gated in the service).
router.get('/plans', ctrl.listPlans);
router.post('/plans', ctrl.createPlan);
router.get('/plans/:planId', ctrl.getPlan);
router.patch('/plans/:planId', ctrl.updatePlan);
router.delete('/plans/:planId', ctrl.deletePlan);

// Plan membership (owner only).
router.post('/plans/:planId/members', ctrl.addMember);
router.patch('/plans/:planId/members/:userId', ctrl.setMemberRole);
router.delete('/plans/:planId/members/:userId', ctrl.removeMember);

// Goals live under a plan; edits/deletes resolve the plan role from the goal.
router.post('/plans/:planId/goals', ctrl.createGoal);
router.patch('/goals/:goalId', ctrl.updateGoal);
router.delete('/goals/:goalId', ctrl.removeGoal);

export default router;
